const MAX_CALLS = 40;
const calls = [];

export function recordLlmCall(entry) {
    calls.push(entry);
    if (calls.length > MAX_CALLS) calls.shift();
}

export function getLlmCalls() {
    return calls.slice();
}
