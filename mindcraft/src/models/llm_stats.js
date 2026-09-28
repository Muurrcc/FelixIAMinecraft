const MAX_CALLS = 40;
// The reasoning text is large; only the most recent calls keep it (the dashboard shows it next to recent turns).
const KEEP_THINKING = 10;
const MAX_THINKING_CHARS = 2500;
const MAX_REPLY_CHARS = 400;
const calls = [];
let pendingSince = null;

export function recordLlmCall(entry) {
    if (entry.thinking) {
        entry.thinking_chars = entry.thinking.length;
        if (entry.thinking.length > MAX_THINKING_CHARS) entry.thinking = entry.thinking.slice(0, MAX_THINKING_CHARS) + '…';
    }
    if (entry.reply && entry.reply.length > MAX_REPLY_CHARS) entry.reply = entry.reply.slice(0, MAX_REPLY_CHARS);
    calls.push(entry);
    if (calls.length > MAX_CALLS) calls.shift();
    const old = calls.length - KEEP_THINKING - 1;
    if (old >= 0) delete calls[old].thinking;
}

export function getLlmCalls() {
    return calls.slice();
}

// Start time of the request the model is working on right now, or null.
export function setLlmPending(since) {
    pendingSince = since;
}

export function getLlmPending() {
    return pendingSince;
}
