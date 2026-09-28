// Dashboard de los bots (companeros IA): pensamientos, objetivos, consumos, velocidad del LLM y
// controles de arranque/parada del servidor y de los bots, comandos rapidos, personalidad, modelo,
// servidor de destino, auto-reinicio y copias de seguridad programadas. Proceso independiente del
// bot para poder arrancarlo/pararlo sin morir con el. Solo escucha en 127.0.0.1.
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
const SERVER_PORT = 25565; // servidor Paper local (server\main)
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
        serverExternal: 'The bots are set to join an external server: start and stop it on that machine',
        rconFailed: (out) => `RCON failed: ${out}`,
        ollamaStarting: (pid) => `Ollama starting (PID ${pid})...`,
        ollamaSlow: 'Ollama did not respond within 20 s',
        botAlreadyOn: 'The bot is already running',
        botNoServer: 'Warning: the server is not reachable; the bot will retry when connecting',
        profilesFailed: (out) => `Could not build the bot profiles: ${out}`,
        botStarting: (pid) => `Bot starting (PID ${pid})...`,
        botJoined: (names) => `${names} joined the world`,
        botDied: 'The bot closed while starting; check logs\\bot_stderr.log',
        botSlow: 'The bot is still starting (taking more than 90 s)',
        botAlreadyOff: 'The bot was already stopped',
        botStopped: 'Bot stopped and model unloaded from VRAM',
        restartCrashed: (n) => `The bot process died: restarting it (auto-restart #${n})`,
        restartStuck: (n) => `No bot has been in the world for 2 minutes: restarting (auto-restart #${n})`,
        restartGaveUp: 'The bot crashed 5 times in 10 minutes: auto-restart paused. Check logs\\bot_stderr.log and start it again.',
        msCode: (code) => `Microsoft sign-in for the bot: open https://www.microsoft.com/link and enter the code ${code}`,
        noPlayer: 'No player to go to: join the world first',
        botsSaved: 'Bots saved',
        targetSaved: 'Server address saved',
        restarting: 'restarting the bot to apply it...',
        invalid: (what) => `Invalid ${what}`,
        backupDone: (file) => `World backed up: backups\\${file}`,
        backupFailed: (out) => `Backup failed: ${out}`,
        backupExternal: 'Backups only cover the bundled local server',
        backupEvery: (h) => h ? `Automatic backups every ${h} h while the server is on` : 'Automatic backups off',
        autoRestart: (on) => `Auto-restart ${on ? 'on' : 'off'}`,
        modelSet: (m) => `Model set to ${m}`,
        benchRunning: (m) => `Measuring ${m} (loads it into VRAM, may take a minute)...`,
        benchDone: (m, g, p) => `${m}: ${g} tok/s generating, ${p} tok/s reading`,
        benchFailed: (m) => `Could not measure ${m} (does it fit in memory?)`,
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
        serverExternal: 'Los bots van a un servidor externo: arrancalo y paralo en esa maquina',
        rconFailed: (out) => `RCON fallo: ${out}`,
        ollamaStarting: (pid) => `Ollama arrancando (PID ${pid})...`,
        ollamaSlow: 'Ollama no respondio en 20 s',
        botAlreadyOn: 'El bot ya esta en marcha',
        botNoServer: 'Aviso: no se llega al servidor; el bot reintentara al conectar',
        profilesFailed: (out) => `No se pudieron generar los perfiles: ${out}`,
        botStarting: (pid) => `Bot arrancando (PID ${pid})...`,
        botJoined: (names) => `${names} ha entrado al mundo`,
        botDied: 'El bot se ha cerrado al arrancar; mira logs\\bot_stderr.log',
        botSlow: 'El bot sigue arrancando (tarda mas de 90 s)',
        botAlreadyOff: 'El bot ya estaba parado',
        botStopped: 'Bot parado y modelo descargado de la VRAM',
        restartCrashed: (n) => `El proceso del bot ha muerto: reiniciando (auto-reinicio n.º ${n})`,
        restartStuck: (n) => `Ningun bot lleva 2 minutos en el mundo: reiniciando (auto-reinicio n.º ${n})`,
        restartGaveUp: 'El bot ha fallado 5 veces en 10 minutos: auto-reinicio en pausa. Mira logs\\bot_stderr.log y vuelve a arrancarlo.',
        msCode: (code) => `Inicio de sesion Microsoft del bot: abre https://www.microsoft.com/link e introduce el codigo ${code}`,
        noPlayer: 'No hay jugador al que ir: entra primero al mundo',
        botsSaved: 'Bots guardados',
        targetSaved: 'Direccion del servidor guardada',
        restarting: 'reiniciando el bot para aplicarlo...',
        invalid: (what) => `${what} no valido`,
        backupDone: (file) => `Mundo respaldado: backups\\${file}`,
        backupFailed: (out) => `El backup fallo: ${out}`,
        backupExternal: 'Los backups solo cubren el servidor local incluido',
        backupEvery: (h) => h ? `Backups automaticos cada ${h} h con el servidor encendido` : 'Backups automaticos desactivados',
        autoRestart: (on) => `Auto-reinicio ${on ? 'activado' : 'desactivado'}`,
        modelSet: (m) => `Modelo cambiado a ${m}`,
        benchRunning: (m) => `Midiendo ${m} (lo carga en VRAM, puede tardar un minuto)...`,
        benchDone: (m, g, p) => `${m}: ${g} tok/s generando, ${p} tok/s leyendo`,
        benchFailed: (m) => `No se pudo medir ${m} (¿cabe en memoria?)`,
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

// ---------- configuracion (config\ = compartida con los scripts, data\ = preferencias del panel) ----------
function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
const BOTS_FILE = `${R}\\config\\bots.json`;
const LLM_FILE = `${R}\\config\\llm.json`;
const PREFS_FILE = `${R}\\data\\dashboard.json`;
const botsCfg = () => readJson(BOTS_FILE, { server: {}, bots: [{ name: 'Claude', personality: 'explorer' }] });
const botNames = () => (botsCfg().bots || []).map((b) => b.name);
const personalities = () => Object.keys(readJson(`${R}\\config\\personalities.json`, {})).filter((k) => !k.startsWith('_'));
function target() {
    const s = botsCfg().server || {};
    const host = s.host || '127.0.0.1';
    return { host, port: Number(s.port) || SERVER_PORT, auth: s.auth === 'microsoft' ? 'microsoft' : 'offline',
        version: s.version || '1.21.6', local: ['127.0.0.1', 'localhost'].includes(host.toLowerCase()) };
}
const prefs = { autoRestart: true, backupHours: 0, lastBackup: 0, speeds: {}, ...readJson(PREFS_FILE, {}) };
const savePrefs = () => writeJson(PREFS_FILE, prefs);

// ---------- estado compartido ----------
const S = {
    states: {},              // ultimo getFullState de cada bot, por nombre
    agents: [],              // agents-status del mindserver
    outputs: [],             // ultimos bot-output (lo que dice/hace)
    metrics: null,
    status: {},
    events: [],              // registro de acciones del panel
    botWanted: false,        // el usuario lo arranco y no lo ha parado: el vigilante lo mantiene vivo
    restarts: 0,             // auto-reinicios desde que arranco el panel
    restartTimes: [],
    msCode: null,            // codigo de inicio de sesion Microsoft pendiente (auth "microsoft")
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
const serverReachable = () => { const t = target(); return portOpen(t.port, t.host, t.local ? 800 : 1500); };
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
    return run(NODE, [`${R}\\scripts\\rcon_client.js`, ip, port, pass, cmd], { timeout: 30000 });
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
const inGame = (name) => !!S.agents.find((a) => a.name === name)?.in_game;
const botRunning = () => mind.connected || isAlive(readPids().bot);

// ---------- conexion con el mindserver del bot ----------
const mind = io(MINDSERVER, { reconnection: true, reconnectionDelay: 1500, reconnectionDelayMax: 3000, timeout: 2000 });
mind.on('connect', () => { mind.emit('listen-to-agents'); logEvent(MSG.mindConnected); });
mind.on('disconnect', () => { S.states = {}; S.agents = []; broadcast('state', {}); });
mind.on('agents-status', (agents) => { S.agents = agents; });
mind.on('state-update', (states) => {
    S.states = states || {};
    broadcast('state', S.states);
    recordLiveSpeeds();
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

// ---------- modelos de Ollama (leidos del disco: no hace falta que Ollama este encendido) ----------
const shortModel = (m) => String(m || '').replace(/^ollama\//, '').replace(/:latest$/, '');
function installedModels() {
    const root = `${R}\\models\\ollama\\manifests`;
    const llm = readJson(LLM_FILE, {});
    const embed = shortModel(llm.embedding_model);
    const out = [];
    const walk = (dir, parts) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.isDirectory()) { walk(path.join(dir, e.name), [...parts, e.name]); continue; }
            // manifests\<registro>\<espacio>\<modelo>\<etiqueta>
            if (parts.length !== 3) continue;
            const [registry, ns, model] = parts;
            const base = (registry === 'registry.ollama.ai' ? '' : registry + '/') + (ns === 'library' ? '' : ns + '/') + model;
            const name = shortModel(`${base}:${e.name}`);
            const man = readJson(path.join(dir, e.name), {});
            const size = (man.layers || []).reduce((s, l) => s + (l.size || 0), 0);
            if (name === embed || /embed|minilm|bge-/i.test(name)) continue;
            out.push({ name, size, speed: prefs.speeds[name] || null });
        }
    };
    walk(root, []);
    return out.sort((a, b) => a.name.localeCompare(b.name));
}
// Guarda la velocidad real medida en las llamadas del bot (tok/s medios por modelo).
let speedsSavedAt = 0;
function recordLiveSpeeds() {
    const byModel = {};
    for (const st of Object.values(S.states)) {
        for (const c of st?.mind?.llmCalls || []) {
            if (!(c.gen_ms > 0 && c.gen_tokens > 0)) continue;
            const m = (byModel[shortModel(c.model)] ||= { g: [], p: [] });
            m.g.push(c.gen_tokens / (c.gen_ms / 1000));
            if (c.prompt_ms > 0) m.p.push(c.prompt_tokens / (c.prompt_ms / 1000));
        }
    }
    const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    let changed = false;
    for (const [name, m] of Object.entries(byModel)) {
        if (m.g.length < 3) continue;
        const gen = +avg(m.g).toFixed(1), prompt = m.p.length ? Math.round(avg(m.p)) : null;
        const old = prefs.speeds[name];
        if (!old || old.gen !== gen || old.n !== m.g.length) { prefs.speeds[name] = { gen, prompt, n: m.g.length, at: Date.now(), source: 'live' }; changed = true; }
    }
    if (changed && Date.now() - speedsSavedAt > 60000) { speedsSavedAt = Date.now(); savePrefs(); }
}

// ---------- estado de servicios ----------
let busy = null; // accion en curso ('server-start', ...)
async function refreshStatus() {
    const pids = readPids();
    const t = target();
    const [serverUp, ollamaUp, ps] = await Promise.all([
        serverReachable(), portOpen(11434), fetchJson(`${OLLAMA}/api/ps`, {}, 1500),
    ]);
    const serverProc = t.local && isAlive(pids.server_main);
    const names = botNames();
    const botLog = tail(`${R}\\logs\\bot_stdout.log`, 12);
    // prismarine-auth imprime el codigo de inicio de sesion Microsoft en el log del bot.
    const code = t.auth === 'microsoft' && !names.some(inGame)
        ? botLog.join(' ').match(/microsoft\.com\/link\S*\s.*?code\s+([A-Z0-9]{6,})/i)?.[1] : null;
    if (code && code !== S.msCode) logEvent(MSG.msCode(code));
    S.msCode = code || null;
    S.status = {
        busy,
        server: serverUp ? 'on' : serverProc ? 'starting' : 'off',
        bot: names.some(inGame) ? 'on' : (mind.connected || isAlive(pids.bot)) ? 'starting' : 'off',
        bots: names.map((name) => ({ name, inGame: inGame(name) })),
        target: t,
        mindserver: mind.connected,
        ollama: ollamaUp ? 'on' : 'off',
        models: (ps?.models || []).map((x) => ({ name: x.name, size: x.size, vram: x.size_vram, ctx: x.context_length })),
        restarts: S.restarts,
        msCode: S.msCode,
        lastBackup: prefs.lastBackup,
        serverLog: t.local ? tail(`${R}\\logs\\server_main_stdout.log`, 14) : [],
        botLog: botLog.slice(-10),
    };
    broadcast('status', S.status);
}
setInterval(refreshStatus, 2000);

// ---------- acciones ----------
async function serverStart() {
    if (!target().local) return MSG.serverExternal;
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
    if (!target().local) return MSG.serverExternal;
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
    if (botRunning()) return MSG.botAlreadyOn;
    if (!(await serverReachable())) logEvent(MSG.botNoServer);
    await ensureOllama();
    // Un perfil por bot (nombre + personalidad + LLM); tambien anade bots nuevos a la whitelist local.
    const built = await run(NODE, [`${R}\\mindcraft\\tools\\build_profiles.js`], { env: childEnv });
    if (!built.ok) return MSG.profilesFailed(built.out.trim().split('\n').pop());
    if (target().local && (await portOpen(SERVER_PORT))) await rcon('whitelist reload');
    const pid = spawnDetached(NODE, ['main.js'], `${R}\\mindcraft`, 'bot');
    writePids({ bot: pid });
    S.botWanted = true;
    logEvent(MSG.botStarting(pid));
    const names = botNames();
    for (let i = 0; i < 90; i++) {
        await sleep(1000);
        if (names.every(inGame)) return MSG.botJoined(names.join(', '));
        if (!isAlive(pid)) return MSG.botDied;
    }
    return names.some(inGame) ? MSG.botJoined(names.filter(inGame).join(', ')) : MSG.botSlow;
}
async function botStop({ keepWanted = false } = {}) {
    if (!keepWanted) S.botWanted = false;
    const pid = readPids().bot;
    if (!mind.connected && !isAlive(pid)) return MSG.botAlreadyOff;
    if (mind.connected) mind.emit('shutdown');
    for (let i = 0; i < 8 && isAlive(pid); i++) await sleep(1000);
    if (isAlive(pid)) await run('taskkill', ['/PID', String(pid), '/T', '/F']);
    writePids({ bot: null });
    for (let i = 0; i < 5 && mind.connected; i++) await sleep(500);
    // Libera la VRAM del modelo (Ollama sigue vivo, recarga el modelo al volver a arrancar el bot).
    const ps = await fetchJson(`${OLLAMA}/api/ps`);
    for (const m of ps?.models || []) {
        await fetchJson(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: m.name, keep_alive: 0 }) }, 5000);
    }
    return MSG.botStopped;
}
// Tras cambiar bots, personalidad, modelo o servidor: si el bot estaba en marcha, se reinicia para aplicarlo.
async function applyWithRestart(msg) {
    if (!botRunning()) return msg;
    logEvent(`${msg} · ${MSG.restarting}`);
    await botStop();
    return botStart();
}

// Copia del mundo con el servidor encendido: se congela el guardado mientras se comprime.
async function backupNow() {
    if (!target().local) return MSG.backupExternal;
    const up = await portOpen(SERVER_PORT);
    let r;
    try {
        if (up) { await rcon('save-off'); await rcon('save-all flush'); }
        r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${R}\\scripts\\backup.ps1`], { timeout: 15 * 60000 });
    } finally { if (up) await rcon('save-on'); }
    const lines = r.out.trim().split(/\r?\n/);
    if (!r.ok) return MSG.backupFailed(lines.pop());
    prefs.lastBackup = Date.now(); savePrefs();
    const file = lines.map((l) => l.match(/world_\d+_\d+\.zip/)?.[0]).find(Boolean);
    return file ? MSG.backupDone(file) : lines.pop();
}

async function setBots({ bots } = {}) {
    const known = personalities();
    if (!Array.isArray(bots) || bots.length < 1 || bots.length > 4) return MSG.invalid('bots');
    const clean = [];
    for (const b of bots) {
        const name = String(b?.name || '').trim();
        if (!/^[A-Za-z0-9_]{3,16}$/.test(name) || clean.some((c) => c.name.toLowerCase() === name.toLowerCase())) return MSG.invalid(`name "${name}"`);
        if (!known.includes(b.personality)) return MSG.invalid(`personality "${b.personality}"`);
        clean.push({ name, personality: b.personality });
    }
    writeJson(BOTS_FILE, { ...botsCfg(), bots: clean });
    return applyWithRestart(MSG.botsSaved);
}
async function setTarget({ host, port, auth, version } = {}) {
    host = String(host || '').trim(); port = Number(port); version = String(version || '').trim();
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) return MSG.invalid('host');
    if (!(port >= 1 && port <= 65535)) return MSG.invalid('port');
    if (!['offline', 'microsoft'].includes(auth)) return MSG.invalid('auth');
    if (!/^(auto|1\.\d+(\.\d+)?)$/.test(version)) return MSG.invalid('version');
    writeJson(BOTS_FILE, { ...botsCfg(), server: { host, port, auth, version } });
    return applyWithRestart(MSG.targetSaved);
}
async function setModel({ name } = {}) {
    if (!installedModels().some((m) => m.name === name)) return MSG.invalid('model');
    const llm = readJson(LLM_FILE, null);
    if (!llm) return MSG.invalid('config/llm.json');
    llm.chat_model = `ollama/${name}`;
    writeJson(LLM_FILE, llm);
    return applyWithRestart(MSG.modelSet(name));
}
// Mide un modelo con una peticion fija (mismo tipo de prompt que el bot, respuesta corta).
async function benchModel({ name } = {}) {
    if (!installedModels().some((m) => m.name === name)) return MSG.invalid('model');
    await ensureOllama();
    logEvent(MSG.benchRunning(name));
    const current = shortModel(readJson(LLM_FILE, {}).chat_model);
    const prompt = 'You are a Minecraft bot. The player says: "hey, can you get some wood and then build a small shelter next to the river before night?" '
        + 'Reply in one or two short sentences and include the command you would use first, like !collectBlocks("oak_log", 10).';
    const r = await fetchJson(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({
        model: name, prompt, stream: false, keep_alive: name === current ? '30m' : 0, options: { num_predict: 128, temperature: 0 },
    }) }, 240000);
    if (!r?.eval_count || !r.eval_duration) return MSG.benchFailed(name);
    const gen = +(r.eval_count / (r.eval_duration / 1e9)).toFixed(1);
    const promptTps = r.prompt_eval_duration ? Math.round(r.prompt_eval_count / (r.prompt_eval_duration / 1e9)) : null;
    const old = prefs.speeds[name];
    // Una medida real del bot (muchas llamadas) vale mas que el benchmark: solo se sustituye si no hay.
    if (!old || old.source !== 'live') prefs.speeds[name] = { gen, prompt: promptTps, n: 1, at: Date.now(), source: 'bench' };
    savePrefs();
    return MSG.benchDone(name, gen, promptTps ?? '?');
}
async function setPrefs(body = {}) {
    const msgs = [];
    if (typeof body.autoRestart === 'boolean') { prefs.autoRestart = body.autoRestart; msgs.push(MSG.autoRestart(body.autoRestart)); }
    if (body.backupHours !== undefined) {
        const h = Number(body.backupHours);
        if (![0, 1, 2, 3, 6, 12, 24].includes(h)) return MSG.invalid('interval');
        prefs.backupHours = h; msgs.push(MSG.backupEvery(h));
    }
    savePrefs();
    return msgs.join(' · ');
}

const actions = {
    'server/start': serverStart, 'server/stop': serverStop,
    'bot/start': botStart, 'bot/stop': () => botStop(),
    'backup': backupNow, 'bots': setBots, 'target': setTarget, 'model': setModel, 'model/bench': benchModel,
};

// ---------- vigilante: auto-reinicio del bot ----------
let notInGameSince = 0;
async function watchdog() {
    if (!S.botWanted || !prefs.autoRestart || busy) { notInGameSince = 0; return; }
    const alive = isAlive(readPids().bot);
    if (alive && botNames().some(inGame)) { notInGameSince = 0; return; }
    // Sin servidor no hay a donde volver: se espera a que vuelva en vez de reiniciar en bucle.
    if (!(await serverReachable())) { notInGameSince = 0; return; }
    if (alive) {
        // Mindcraft reinicia el agente por su cuenta; solo se interviene si lleva 2 min fuera del mundo.
        if (!notInGameSince) notInGameSince = Date.now();
        if (Date.now() - notInGameSince < 120000) return;
    }
    notInGameSince = 0;
    S.restartTimes = S.restartTimes.filter((t) => Date.now() - t < 600000);
    if (S.restartTimes.length >= 5) { S.botWanted = false; logEvent(MSG.restartGaveUp); return; }
    S.restartTimes.push(Date.now());
    S.restarts++;
    logEvent(alive ? MSG.restartStuck(S.restarts) : MSG.restartCrashed(S.restarts));
    busy = 'bot/restart';
    refreshStatus();
    try { await botStop({ keepWanted: true }); logEvent(await botStart()); }
    catch (e) { logEvent(`Error: ${e.message}`); }
    finally { busy = null; refreshStatus(); }
}
setInterval(watchdog, 5000);

// ---------- copias de seguridad programadas (solo con el servidor local encendido) ----------
setInterval(async () => {
    if (busy || !prefs.backupHours || Date.now() - prefs.lastBackup < prefs.backupHours * 3600000) return;
    if (!target().local || !(await portOpen(SERVER_PORT))) return;
    busy = 'backup';
    try { logEvent(await backupNow()); } catch (e) { logEvent(`Error: ${e.message}`); } finally { busy = null; }
}, 60000);

// ---------- comandos rapidos (se ejecutan directamente en Mindcraft, sin pasar por el LLM) ----------
function playerFor(agent) {
    const near = S.states[agent]?.nearby?.humanPlayers?.[0];
    if (near) return near;
    const player = (() => { try { return fs.readFileSync(`${R}\\data\\player.txt`, 'utf8').trim(); } catch { return ''; } })();
    if (player) return player;
    const skip = new Set([...botNames(), 'Tester'].map((n) => n.toLowerCase()));
    return readJson(`${R}\\server\\main\\whitelist.json`, []).map((e) => e.name).find((n) => n && !skip.has(n.toLowerCase())) || null;
}
function quickCommand(agent, cmd) {
    const player = playerFor(agent);
    const log = S.states[agent]?.nearby?.logType || 'oak_log';
    const make = {
        follow: () => player && `!followPlayer("${player}", 3)`,
        come: () => player && `!goToPlayer("${player}", 2)`,
        wood: () => `!collectBlocks("${log}", 16)`,
        stop: () => '!stop',
    }[cmd];
    return make ? make() : undefined;
}

// ---------- HTTP ----------
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/skin.png': ['skin.png', 'image/png'] };
function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 65536) req.destroy(); });
        req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
    });
}
function sendJson(res, obj, code = 200) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}
const configView = () => ({
    bots: botsCfg().bots || [], personalities: personalities(), target: target(),
    prefs: { autoRestart: prefs.autoRestart, backupHours: prefs.backupHours, lastBackup: prefs.lastBackup },
    models: installedModels(), model: shortModel(readJson(LLM_FILE, {}).chat_model),
});
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
        const init = { states: S.states, outputs: S.outputs, metrics: S.metrics, status: S.status, events: S.events };
        res.write(`data: ${JSON.stringify({ type: 'init', data: init })}\n\n`);
        req.on('close', () => clients.delete(res));
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') return sendJson(res, configView());
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        // Solo el propio panel: cualquier web abierta en el navegador podria hacer POST a 127.0.0.1 (CSRF).
        const origin = req.headers.origin;
        if (origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) { res.writeHead(403); return res.end(); }
        const name = url.pathname.slice(5);
        const body = await readBody(req);
        const agent = botNames().includes(body.agent) ? body.agent : botNames()[0];
        if (name === 'chat') {
            const msg = String(body.message || '').trim();
            if (msg && mind.connected) mind.emit('send-message', agent, { from: 'Panel', message: msg });
            return sendJson(res, { ok: !!msg && mind.connected });
        }
        if (name === 'command') {
            const message = quickCommand(agent, body.cmd);
            if (message === undefined) return sendJson(res, { ok: false, msg: MSG.invalid('command') });
            if (!message) return sendJson(res, { ok: false, msg: MSG.noPlayer });
            if (mind.connected && inGame(agent)) mind.emit('send-message', agent, { from: 'Panel', message });
            return sendJson(res, { ok: mind.connected && inGame(agent), sent: message });
        }
        if (name === 'prefs') { const msg = await setPrefs(body); logEvent(msg); return sendJson(res, { msg, config: configView() }); }
        const fn = actions[name];
        if (!fn) { res.writeHead(404); return res.end(); }
        if (busy) return sendJson(res, { msg: MSG.busy(busy) }, 409);
        busy = name;
        refreshStatus();
        let msg;
        try { msg = await fn(body); } catch (e) { msg = `Error: ${e.message}`; }
        busy = null;
        logEvent(msg);
        refreshStatus();
        return sendJson(res, { msg, config: configView() });
    }
    res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(MSG.listening(PORT)));

startMetrics();
refreshStatus();
