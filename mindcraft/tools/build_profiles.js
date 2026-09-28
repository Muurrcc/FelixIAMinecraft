// Genera un perfil de Mindcraft por bot de config/bots.json en profiles/generated/<nombre>.json:
// plantilla profiles/claude_bot.json + nombre + personalidad (config/personalities.json) + LLM (config/llm.json).
// Si el servidor es el local, anade los bots que falten a server/main/whitelist.json
// (el que llama debe hacer "whitelist reload" por RCON si el servidor ya esta encendido).
//
// Uso: node tools/build_profiles.js   (lo lanzan scripts/start_all.ps1 y el dashboard antes de arrancar el bot)

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { applyLlmConfig } from './apply_llm_config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const raizRoot = path.resolve(repoRoot, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

const cfg = readJson(path.join(raizRoot, 'config', 'bots.json'));
const personalities = readJson(path.join(raizRoot, 'config', 'personalities.json'));
const template = readJson(path.join(repoRoot, 'profiles', 'claude_bot.json'));
const outDir = path.join(repoRoot, 'profiles', 'generated');
fs.mkdirSync(outDir, { recursive: true });

const bots = (cfg.bots || []).filter((b) => /^[A-Za-z0-9_]{3,16}$/.test(b.name || ''));
if (!bots.length) throw new Error('config/bots.json no tiene ningun bot valido (nombre de 3-16 letras, numeros o _)');

for (const bot of bots) {
    const profile = structuredClone(template);
    profile.name = bot.name;
    const text = personalities[bot.personality];
    if (text) profile.conversing = profile.conversing.replace(/Personality: [^\n]*/, text.replace(/\$/g, '$$$$'));
    else if (bot.personality) console.warn(`Personalidad desconocida "${bot.personality}" para ${bot.name}; se usa la de la plantilla`);
    applyLlmConfig(profile);
    fs.writeFileSync(path.join(outDir, `${bot.name}.json`), JSON.stringify(profile, null, 4) + '\n');
    console.log(`Perfil ${bot.name}: personalidad=${text ? bot.personality : 'plantilla'}, modelo=${profile.model.model}`);
}
for (const f of fs.readdirSync(outDir)) {
    if (f.endsWith('.json') && !bots.some((b) => `${b.name}.json` === f)) fs.rmSync(path.join(outDir, f));
}

// Offline-mode UUID, igual que Get-OfflineUuid en scripts/install.ps1.
function offlineUuid(name) {
    const b = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
    b[6] = (b[6] & 0x0f) | 0x30;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const wlPath = path.join(raizRoot, 'server', 'main', 'whitelist.json');
const local = ['127.0.0.1', 'localhost'].includes(String(cfg.server?.host || '127.0.0.1').toLowerCase());
if (local && fs.existsSync(wlPath)) {
    const wl = readJson(wlPath);
    const missing = bots.filter((b) => !wl.some((e) => e.name?.toLowerCase() === b.name.toLowerCase()));
    if (missing.length) {
        for (const b of missing) wl.push({ uuid: offlineUuid(b.name), name: b.name });
        fs.writeFileSync(wlPath, JSON.stringify(wl, null, 2) + '\n');
        console.log(`Whitelist: anadidos ${missing.map((b) => b.name).join(', ')}`);
    }
}
