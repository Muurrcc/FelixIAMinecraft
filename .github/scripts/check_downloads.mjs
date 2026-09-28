// Validates scripts/downloads.json: every entry has an https URL and a well-formed SHA-256/512.
// Then downloads the files and compares the hash. By default only files up to 100 MB (plugins,
// mods, Paper); with --all also the big runtimes (Node, Java, Ollama).
import fs from 'node:fs';
import crypto from 'node:crypto';

const ALL = process.argv.includes('--all');
const LIMIT = 100 * 1024 * 1024;
const manifest = JSON.parse(fs.readFileSync(new URL('../../scripts/downloads.json', import.meta.url), 'utf8'));

const entries = [];
(function walk(o, where) {
    if (Array.isArray(o)) return o.forEach((v, i) => walk(v, `${where}[${i}]`));
    if (o && typeof o === 'object') {
        if ('url' in o) return entries.push({ where, ...o });
        for (const [k, v] of Object.entries(o)) walk(v, where ? `${where}.${k}` : k);
    }
})(manifest, '');

let failed = 0;
const fail = (e, msg) => { console.log(`::error::${e.where} (${e.file}): ${msg}`); failed++; };

for (const e of entries) {
    if (!/^https:\/\//.test(e.url)) fail(e, 'URL is not https');
    if (!e.file) fail(e, 'missing "file"');
    const algo = e.sha512 ? 'sha512' : e.sha256 ? 'sha256' : null;
    if (!algo) { fail(e, 'no sha256/sha512'); continue; }
    const len = algo === 'sha512' ? 128 : 64;
    if (!new RegExp(`^[0-9a-f]{${len}}$`, 'i').test(e[algo])) fail(e, `${algo} is not ${len} hex chars`);
}
console.log(`${entries.length} entries, format ${failed ? 'has errors' : 'ok'}`);

for (const e of entries) {
    const algo = e.sha512 ? 'sha512' : 'sha256';
    try {
        const head = await fetch(e.url, { method: 'HEAD', redirect: 'follow' });
        const size = Number(head.headers.get('content-length')) || 0;
        if (!head.ok) { fail(e, `HTTP ${head.status}`); continue; }
        if (!ALL && size > LIMIT) { console.log(`skip  ${e.file} (${(size / 1048576).toFixed(0)} MB, checked weekly)`); continue; }
        const res = await fetch(e.url, { redirect: 'follow' });
        if (!res.ok) { fail(e, `HTTP ${res.status}`); continue; }
        const hash = crypto.createHash(algo);
        for await (const chunk of res.body) hash.update(chunk);
        const got = hash.digest('hex');
        if (got.toLowerCase() !== e[algo].toLowerCase()) fail(e, `${algo} mismatch: got ${got}`);
        else console.log(`ok    ${e.file}`);
    } catch (err) {
        fail(e, err.message);
    }
}
if (failed) { console.log(`${failed} problem(s)`); process.exit(1); }
