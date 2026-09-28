import { strictFormat } from '../utils/text.js';
import { recordLlmCall, setLlmPending } from './llm_stats.js';

const ns2ms = (ns) => (typeof ns === 'number' ? ns / 1e6 : null);

export class Ollama {
    static prefix = 'ollama';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params;
        this.url = url || 'http://127.0.0.1:11434';
        this.chat_endpoint = '/api/chat';
        this.embedding_endpoint = '/api/embeddings';
    }

    async sendRequest(turns, systemMessage) {
        let model = this.model_name || 'sweaterdog/andy-4:micro-q8_0';
        let messages = strictFormat(turns);
        messages.unshift({ role: 'system', content: systemMessage });
        const maxAttempts = 5;
        let attempt = 0;
        let finalRes = null;

        while (attempt < maxAttempts) {
            attempt++;
            console.log(`Awaiting local response... (model: ${model}, attempt: ${attempt})`);
            let res = null;
            try {
                const t0 = Date.now();
                setLlmPending(t0);
                let apiResponse;
                try {
                    apiResponse = await this.send(this.chat_endpoint, {
                        model: model,
                        messages: messages,
                        stream: false,
                        ...(this.params || {})
                    });
                } finally {
                    setLlmPending(null);
                }
                if (apiResponse) {
                    const content = apiResponse['message']['content'] ?? '';
                    // Reasoning models (Andy-4) think before answering: Ollama returns it in message.thinking,
                    // older builds leave it inline as <think>...</think>. Kept for the dashboard only.
                    const thinking = apiResponse.message.thinking
                        || (content.match(/<think>([\s\S]*?)<\/think>/) || [])[1] || '';
                    recordLlmCall({
                        at: Date.now(),
                        model,
                        wall_ms: Date.now() - t0,
                        load_ms: ns2ms(apiResponse.load_duration),
                        prompt_tokens: apiResponse.prompt_eval_count ?? null,
                        prompt_ms: ns2ms(apiResponse.prompt_eval_duration),
                        gen_tokens: apiResponse.eval_count ?? null,
                        gen_ms: ns2ms(apiResponse.eval_duration),
                        thinking: thinking.trim(),
                        reply: content.replace(/<think>[\s\S]*?<\/think>/g, '').trim(),
                    });
                    res = content;
                } else {
                    res = 'No response data.';
                }
            } catch (err) {
                if (err.message.toLowerCase().includes('context length') && turns.length > 1) {
                    console.log('Context length exceeded, trying again with shorter context.');
                    return await this.sendRequest(turns.slice(1), systemMessage);
                } else {
                    console.log(err);
                    res = 'My brain disconnected, try again.';
                }
            }

            const hasOpenTag = res.includes("<think>");
            const hasCloseTag = res.includes("</think>");

            if ((hasOpenTag && !hasCloseTag)) {
                console.warn("Partial <think> block detected. Re-generating...");
                if (attempt < maxAttempts) continue;
            }
            if (hasCloseTag && !hasOpenTag) {
                res = '<think>' + res;
            }
            if (hasOpenTag && hasCloseTag) {
                res = res.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            }
            finalRes = res;
            break;
        }

        if (finalRes == null) {
            console.warn("Could not get a valid response after max attempts.");
            finalRes = 'I thought too hard, sorry, try again.';
        }
        return finalRes;
    }

    async embed(text) {
        let model = this.model_name || 'embeddinggemma';
        let body = { model: model, input: text, ...(this.params || {}) };
        let res = await this.send(this.embedding_endpoint, body);
        return res['embedding'];
    }

    async send(endpoint, body) {
        const url = new URL(endpoint, this.url);
        let method = 'POST';
        let headers = new Headers();
        const request = new Request(url, { method, headers, body: JSON.stringify(body) });
        let data = null;
        try {
            const res = await fetch(request);
            if (res.ok) {
                data = await res.json();
            } else {
                throw new Error(`Ollama Status: ${res.status}`);
            }
        } catch (err) {
            console.error('Failed to send Ollama request.');
            console.error(err);
        }
        return data;
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: "user",
            content: [
                { type: "text", text: systemMessage },
                {
                    type: "image_url",
                    image_url: {
                        url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                    }
                }
            ]
        });
        
        return this.sendRequest(imageMessages, systemMessage);
    }
}
