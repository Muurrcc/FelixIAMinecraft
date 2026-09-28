// Dashboard de Claude (companero IA): pensamientos, objetivos, consumos, velocidad del LLM y
// controles de arranque/parada del servidor y del bot. Proceso independiente del bot para
// poder arrancarlo/pararlo sin morir con el. Solo escucha en 127.0.0.1.
// Uso: runtime\node\node.exe dashboard\server.mjs   (ver scripts\dashboard.ps1)
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(HERE, '..');
const R_LOWER = R.toLowerCase() + '\\';
const PORT = Number(process.env.DASHBOARD_PORT || 8090);
const MINDSERVER = 'http://localhost:8080';
const OLLAMA = 'http://127.0.0.1:11434';
const SERVER_PORT = 25565;
const BOT_NAME = 'Claude';
const NODE = `${R}\\runtime\\node\\node.exe`;
const JAVA = `${R}\\runtime\\java\\bin\\java.exe`;

// Idioma del panel desde config/language.json (el mismo que usa el bot); ingles si falta o no esta traducido.
const LANG = (() => {
    try { return String(JSON.parse(fs.readFileSync(`${R}\\config\\language.json`, 'utf8')).language).toLowerCase().startsWith('es') ? 'es' : 'en'; }
    catch { return 'en'; }
})();
const MSG = {
    en: {
        mindConnected: 'Connected to the bot MindServer',
        serverAlreadyOn: 'The server is already running',
        serverAlreadyStarting: 'The server is already starting',
        serverStarting: (pid) => `Server starting (PID ${pid})...`,
        serverReady: 'Server ready',
        serverDied: 'The server closed while starting; check logs\\server_main_stdout.log',
        serverSlow: 'The server did not finish starting within 180 s',
        serverAlreadyOff: 'The server was already stopped',
        serverStopping: 'Saving the world and stopping the server (RCON stop)...',
        serverStopped: 'Server stopped',
        serverKilled: 'Server force-closed (it did not respond to stop)',
        rconFailed: (out) => `RCON failed: ${out}`,
        ollamaStarting: (pid) => `Ollama starting (PID ${pid})...`,
        ollamaSlow: 'Ollama did not respond within 20 s',
        botAlreadyOn: 'The bot is already running',
        botNoServer: 'Warning: the server is not running; the bot will retry when connecting',
        llmConfigFailed: (out) => `apply_llm_config failed: ${out}`,
        botStarting: (pid) => `Bot starting (PID ${pid})...`,
        botJoined: 'Claude joined the world',
        botDied: 'The bot closed while starting; check logs\\bot_stderr.log',
        botSlow: 'The bot is still starting (taking more than 60 s)',
        botAlreadyOff: 'The bot was already stopped',
        botStopped: 'Bot stopped and model unloaded from VRAM',
        busy: (what) => `Wait: ${what} in progress`,
        listening: (port) => `Dashboard at http://127.0.0.1:${port}`,
    },
    es: {
        mindConnected: 'Conectado al MindServer del bot',
        serverAlreadyOn: 'El servidor ya esta encendido',
        serverAlreadyStarting: 'El servidor ya se esta arrancando',
        serverStarting: (pid) => `Servidor arrancando (PID ${pid})...`,
        serverReady: 'Servidor listo',
        serverDied: 'El servidor se ha cerrado al arrancar; mira logs\\server_main_stdout.log',
        serverSlow: 'El servidor no termino de arrancar en 180 s',
        serverAlreadyOff: 'El servidor ya estaba apagado',
        serverStopping: 'Guardando mundo y parando servidor (RCON stop)...',
        serverStopped: 'Servidor parado',
        serverKilled: 'Servidor forzado a cerrar (no respondio a stop)',
        rconFailed: (out) => `RCON fallo: ${out}`,
        ollamaStarting: (pid) => `Ollama arrancando (PID ${pid})...`,
        ollamaSlow: 'Ollama no respondio en 20 s',
        botAlreadyOn: 'El bot ya esta en marcha',
        botNoServer: 'Aviso: el servidor no esta encendido; el bot reintentara al conectar',
        llmConfigFailed: (out) => `apply_llm_config fallo: ${out}`,
        botStarting: (pid) => `Bot arrancando (PID ${pid})...`,
        botJoined: 'Claude ha entrado al mundo',
        botDied: 'El bot se ha cerrado al arrancar; mira logs\\bot_stderr.log',
        botSlow: 'El bot sigue arrancando (tarda mas de 60 s)',
        botAlreadyOff: 'El bot ya estaba parado',
        botStopped: 'Bot parado y modelo descargado de la VRAM',
        busy: (what) => `Espera: ${what} en curso`,
        listening: (port) => `Dashboard en http://127.0.0.1:${port}`,
    },
}[LANG];

// socket.io-client ya viene con Mindcraft: no se instala nada nuevo.
const { io } = createRequire(`${R}\\mindcraft\\package.json`)('socket.io-client');

// Mismo entorno que scripts\env.ps1 (solo para los procesos hijos, nunca global).
const childEnv = {
    ...process.env,
    PATH: `${R}\\runtime\\node;${R}\\runtime\\java\\bin;${R}\\runtime\\ollama;${process.env.PATH}`,
    OLLAMA_MODELS: `${R}\\models\\ollama`,
    OLLAMA_HOST: '127.0.0.1:11434',
    OLLAMA_KEEP_ALIVE: '30m',
    npm_config_cache: `${R}\\cache\\npm`,
    HF_HOME: `${R}\\cache\\huggingface`,
    TEMP: `${R}\\cache\\tmp`,
    TMP: `${R}\\cache\\tmp`,
};

// ---------- estado compartido ----------
const S = {
    agentState: null,        // ultimo getFullState del bot
    agentStateAt: 0,
    agents: [],              // agents-status del mindserver
    outputs: [],             // ultimos bot-output (lo que dice/hace)
    metrics: null,
    status: {},
    events: [],              // registro de acciones del panel
};
const clients = new Set();
function broadcast(type, data) {
    const msg = `data: ${JSON.stringify({ type, data })}\n\n`;
    for (const res of clients) res.write(msg);
}
function logEvent(text) {
    const e = { at: Date.now(), text };
    S.events.push(e);
    if (S.events.length > 50) S.events.shift();
    broadcast('event', e);
    console.log(new Date().toISOString(), text);
}

// ---------- utilidades ----------
function portOpen(port, host = '127.0.0.1', timeout = 800) {
    return new Promise((resolve) => {
        const s = net.createConnection({ port, host });
        const done = (ok) => { s.destroy(); resolve(ok); };
        s.setTimeout(timeout, () => done(false));
        s.once('connect', () => done(true));
        s.once('error', () => done(false));
    });
}
async function fetchJson(url, opts = {}, timeout = 2000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
        const r = await fetch(url, { ...opts, signal: ctl.signal });
        return r.ok ? await r.json() : null;
    } catch { return null; } finally { clearTimeout(t); }
}
function run(file, args, opts = {}) {
    return new Promise((resolve) => {
        execFile(file, args, { windowsHide: true, timeout: 60000, ...opts }, (err, stdout, stderr) =>
            resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') }));
    });
}
function rcon(cmd) {
    const [ip, port, pass] = fs.readFileSync(`${R}\\run\\rcon_main.txt`, 'utf8').trim().split(':');
    return run(NODE, [`${R}\\scripts\\rcon_client.js`, ip, port, pass, cmd], { timeout: 10000 });
}
function spawnDetached(file, args, cwd, logName, extraEnv = {}) {
    const out = fs.openSync(`${R}\\logs\\${logName}_stdout.log`, 'w');
    const err = fs.openSync(`${R}\\logs\\${logName}_stderr.log`, 'w');
    const p = spawn(file, args, { cwd, env: { ...childEnv, ...extraEnv }, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
    p.unref();
    fs.closeSync(out); fs.closeSync(err);
    return p.pid;
}
function isAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
}
function readPids() {
    try { return JSON.parse(fs.readFileSync(`${R}\\run\\pids.json`, 'utf8')); } catch { return {}; }
}
function writePids(patch) {
    const p = { ...readPids(), ...patch };
    for (const k of Object.keys(p)) if (p[k] == null) delete p[k];
    fs.writeFileSync(`${R}\\run\\pids.json`, JSON.stringify(p, null, 2));
}
function tail(file, n) {
    try {
        const st = fs.statSync(file);
        const len = Math.min(st.size, 16384);
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, st.size - len);
        fs.closeSync(fd);
        return buf.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-n);
    } catch { return []; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- conexion con el mindserver del bot ----------
const mind = io(MINDSERVER, { reconnection: true, reconnectionDelay: 1500, reconnectionDelayMax: 3000, timeout: 2000 });
mind.on('connect', () => { mind.emit('listen-to-agents'); logEvent(MSG.mindConnected); });
mind.on('disconnect', () => { S.agentState = null; S.agents = []; broadcast('state', null); });
mind.on('agents-status', (agents) => { S.agents = agents; });
mind.on('state-update', (states) => {
    const st = states?.[BOT_NAME] || Object.values(states || {})[0] || null;
    S.agentState = st;
    S.agentStateAt = Date.now();
    broadcast('state', st);
});
mind.on('bot-output', (agentName, message) => {
    const o = { at: Date.now(), agent: agentName, message };
    S.outputs.push(o);
    if (S.outputs.length > 60) S.outputs.shift();
    broadcast('output', o);
});

// ---------- metricas (bucle PowerShell persistente, clases WMI independientes del idioma) ----------
let lastProcSample = new Map();
function classify(p) {
    const pth = (p.path || '').toLowerCase();
    if (p.name === 'java' && pth.startsWith(R_LOWER)) return 'server';
    if (p.name === 'javaw') return 'client';
    if ((p.name === 'ollama' || p.name === 'llama-server') && pth.startsWith(R_LOWER)) return 'llm';
    if (p.name === 'node' && pth.startsWith(R_LOWER)) return p.pid === process.pid ? 'dashboard' : 'bot';
    return null;
}
function startMetrics() {
    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'metrics.ps1')],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    ps.stdout.on('data', (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith('{')) continue;
            try { onMetrics(JSON.parse(line)); } catch { /* linea incompleta */ }
        }
    });
    ps.on('exit', () => setTimeout(startMetrics, 3000));
    process.on('exit', () => { try { ps.kill(); } catch { } });
}
function onMetrics(m) {
    const groups = {};
    const now = m.t;
    const next = new Map();
    for (const p of m.procs || []) {
        const g = classify(p);
        if (!g) continue;
        next.set(p.pid, { t: now, cpu: p.cpuSec || 0 });
        const prev = lastProcSample.get(p.pid);
        const cpuPct = prev && now > prev.t ? ((p.cpuSec - prev.cpu) / ((now - prev.t) / 1000)) / m.cores * 100 : 0;
        const G = (groups[g] ||= { cpu: 0, ram: 0, n: 0 });
        G.cpu += Math.max(0, cpuPct); G.ram += p.ram || 0; G.n++;
    }
    lastProcSample = next;
    S.metrics = { t: now, cpu: m.cpu, gpu: m.gpu, vramUsed: m.vramUsed, vramTotal: m.vramTotal,
        ramUsed: m.ramTotal - m.ramFree, ramTotal: m.ramTotal, cores: m.cores, groups };
    broadcast('metrics', S.metrics);
}

// ---------- estado de servicios ----------
let busy = null; // accion en curso ('server-start', ...)
async function refreshStatus() {
    const pids = readPids();
    const [serverUp, ollamaUp, ps] = await Promise.all([
        portOpen(SERVER_PORT), portOpen(11434), fetchJson(`${OLLAMA}/api/ps`, {}, 1500),
    ]);
    const serverProc = isAlive(pids.server_main);
    const botProc = isAlive(pids.bot);
    const agent = S.agents.find((a) => a.name === BOT_NAME);
    S.status = {
        busy,
        server: serverUp ? 'on' : serverProc ? 'starting' : 'off',
        bot: agent?.in_game ? 'on' : (mind.connected || botProc) ? 'starting' : 'off',
        mindserver: mind.connected,
        ollama: ollamaUp ? 'on' : 'off',
        models: (ps?.models || []).map((x) => ({ name: x.name, size: x.size, vram: x.size_vram, ctx: x.context_length })),
        serverLog: tail(`${R}\\logs\\server_main_stdout.log`, 14),
        botLog: tail(`${R}\\logs\\bot_stdout.log`, 10),
    };
    broadcast('status', S.status);
}
setInterval(refreshStatus, 2000);

// ---------- acciones ----------
async function serverStart() {
    if (await portOpen(SERVER_PORT)) return MSG.serverAlreadyOn;
    if (isAlive(readPids().server_main)) return MSG.serverAlreadyStarting;
    const pid = spawnDetached(JAVA, ['-Xms2G', '-Xmx6G', '-jar', 'paper-1.21.6-48.jar', '--nogui'], `${R}\\server\\main`, 'server_main');
    writePids({ server_main: pid });
    logEvent(MSG.serverStarting(pid));
    for (let i = 0; i < 90; i++) {
        await sleep(2000);
        if (tail(`${R}\\logs\\server_main_stdout.log`, 40).some((l) => l.includes('Done ('))) return MSG.serverReady;
        if (!isAlive(pid)) return MSG.serverDied;
    }
    return MSG.serverSlow;
}
async function serverStop() {
    const pid = readPids().server_main;
    if (!(await portOpen(SERVER_PORT)) && !isAlive(pid)) return MSG.serverAlreadyOff;
    logEvent(MSG.serverStopping);
    const r = await rcon('stop');
    for (let i = 0; i < 30; i++) {
        await sleep(1000);
        if (!isAlive(pid) && !(await portOpen(SERVER_PORT))) { writePids({ server_main: null }); return MSG.serverStopped; }
    }
    if (isAlive(pid)) { await run('taskkill', ['/PID', String(pid), '/T', '/F']); writePids({ server_main: null }); return MSG.serverKilled; }
    return r.ok ? MSG.serverStopped : MSG.rconFailed(r.out.trim());
}
async function ensureOllama() {
    if (await portOpen(11434)) return;
    const pid = spawnDetached(`${R}\\runtime\\ollama\\ollama.exe`, ['serve'], `${R}`, 'ollama');
    writePids({ ollama: pid });
    logEvent(MSG.ollamaStarting(pid));
    for (let i = 0; i < 20; i++) { await sleep(1000); if (await portOpen(11434)) return; }
    throw new Error(MSG.ollamaSlow);
}
async function botStart() {
    if (mind.connected || isAlive(readPids().bot)) return MSG.botAlreadyOn;
    if (!(await portOpen(SERVER_PORT))) logEvent(MSG.botNoServer);
    await ensureOllama();
    const cfg = await run(NODE, [`${R}\\mindcraft\\tools\\apply_llm_config.js`, `${R}\\mindcraft\\profiles\\claude_bot.json`], { env: childEnv });
    if (!cfg.ok) return MSG.llmConfigFailed(cfg.out.trim());
    const pid = spawnDetached(NODE, ['main.js'], `${R}\\mindcraft`, 'bot', { MINDCRAFT_PORT: String(SERVER_PORT) });
    writePids({ bot: pid });
    logEvent(MSG.botStarting(pid));
    for (let i = 0; i < 60; i++) {
        await sleep(1000);
        if (S.agents.find((a) => a.name === BOT_NAME)?.in_game) return MSG.botJoined;
        if (!isAlive(pid)) return MSG.botDied;
    }
    return MSG.botSlow;
}
async function botStop() {
    const pid = readPids().bot;
    if (!mind.connected && !isAlive(pid)) return MSG.botAlreadyOff;
    if (mind.connected) mind.emit('shutdown');
    for (let i = 0; i < 8 && isAlive(pid); i++) await sleep(1000);
    if (isAlive(pid)) await run('taskkill', ['/PID', String(pid), '/T', '/F']);
    writePids({ bot: null });
    // Libera la VRAM del modelo (Ollama sigue vivo, recarga el modelo al volver a arrancar el bot).
    const ps = await fetchJson(`${OLLAMA}/api/ps`);
    for (const m of ps?.models || []) {
        await fetchJson(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: m.name, keep_alive: 0 }) }, 5000);
    }
    return MSG.botStopped;
}
const actions = {
    'server/start': serverStart, 'server/stop': serverStop,
    'bot/start': botStart, 'bot/stop': botStop,
};

// ---------- HTTP ----------
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/skin.png': ['skin.png', 'image/png'] };
http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && STATIC[url.pathname]) {
        const [f, type] = STATIC[url.pathname];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        if (f === 'index.html') return res.end(fs.readFileSync(path.join(HERE, f), 'utf8').replace('<html lang="en">', `<html lang="${LANG}">`));
        return fs.createReadStream(path.join(HERE, f)).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        clients.add(res);
        const init = { state: S.agentState, outputs: S.outputs, metrics: S.metrics, status: S.status, events: S.events };
        res.write(`data: ${JSON.stringify({ type: 'init', data: init })}\n\n`);
        req.on('close', () => clients.delete(res));
        return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        // Solo el propio panel: cualquier web abierta en el navegador podria hacer POST a 127.0.0.1 (CSRF).
        const origin = req.headers.origin;
        if (origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) { res.writeHead(403); return res.end(); }
        const name = url.pathname.slice(5);
        if (name === 'chat') {
            let body = '';
            req.on('data', (d) => (body += d));
            req.on('end', () => {
                const msg = (JSON.parse(body || '{}').message || '').trim();
                if (msg && mind.connected) mind.emit('send-message', BOT_NAME, { from: 'Panel', message: msg });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: !!msg && mind.connected }));
            });
            return;
        }
        const fn = actions[name];
        if (!fn) { res.writeHead(404); return res.end(); }
        if (busy) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ msg: MSG.busy(busy) })); }
        busy = name;
        refreshStatus();
        let msg;
        try { msg = await fn(); } catch (e) { msg = `Error: ${e.message}`; }
        busy = null;
        logEvent(msg);
        refreshStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ msg }));
    }
    res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(MSG.listening(PORT)));

startMetrics();
refreshStatus();
