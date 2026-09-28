// Utilidades compartidas por el bot probador (sin LLM). Habla por el chat del
// servidor y usa comandos de OP (concedidos a "Tester" en world_test/ops.json)
// para preparar escenarios (/give, /tp, /setblock, /summon, /data get).
'use strict';

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function onceEvent(emitter, event, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout esperando evento '${event}'`)), timeoutMs);
        emitter.once(event, (...args) => {
            clearTimeout(timer);
            resolve(args[0]);
        });
    });
}

export async function waitForPlayer(bot, name, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const p = bot.players[name];
        if (p && p.entity) return p.entity;
        await sleep(1000);
    }
    throw new Error(`Jugador/bot '${name}' no aparecio en ${timeoutMs}ms`);
}

export function distance(posA, posB) {
    const dx = posA.x - posB.x, dy = posA.y - posB.y, dz = posA.z - posB.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Envia un mensaje de chat publico (el companero escucha todo el chat publico). */
export function say(bot, message) {
    bot.chat(message);
}

/** Envia un comando de servidor (requiere que 'Tester' sea OP, ver world_test/ops.json). */
export function cmd(bot, command) {
    bot.chat(command.startsWith('/') ? command : '/' + command);
}

/**
 * Envia un comando y espera el primer mensaje de sistema recibido que haga match con matchFn.
 * Se usa para leer resultados de /data get ... sin necesitar que el probador navegue el mundo.
 */
export function cmdAndWait(bot, command, matchFn, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const onMsg = (jsonMsg) => {
            const text = jsonMsg.toString();
            if (matchFn(text)) {
                cleanup();
                resolve(text);
            }
        };
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`timeout esperando respuesta a: ${command}`));
        }, timeoutMs);
        function cleanup() {
            clearTimeout(timer);
            bot.removeListener('message', onMsg);
        }
        bot.on('message', onMsg);
        cmd(bot, command);
    });
}

/** Lee el inventario de una entidad via /data get entity <name> Inventory (requiere OP). */
export async function getEntityInventory(bot, entityName, timeoutMs = 8000) {
    const text = await cmdAndWait(
        bot,
        `data get entity ${entityName} Inventory`,
        (t) => t.includes('has the following entity data') || t.includes('Inventory'),
        timeoutMs
    );
    // Ejemplo de formato: "Claude has the following entity data: [{Slot: 0b, id: "minecraft:oak_log", count: 10}, ...]"
    const items = [];
    const re = /id:\s*"minecraft:([a-z0-9_]+)".*?count:\s*(\d+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        items.push({ id: m[1], count: parseInt(m[2], 10) });
    }
    return items;
}

export function countItem(items, id) {
    return items.filter((i) => i.id === id).reduce((sum, i) => sum + i.count, 0);
}

/**
 * Lee la posicion real de una entidad via '/data get entity <name> Pos' (dato autoritativo
 * del servidor). Se usa en vez de bot.players[name].entity porque esa referencia del cliente
 * mineflayer del probador puede quedar sin fijar durante minutos mientras el companero esta
 * siguiendo/persiguiendo activamente (visto en pruebas reales: sigueme fallaba con "no se ve
 * la entidad" pese a que el companero SI estaba al lado, segun el log del servidor).
 */
export async function getEntityPos(bot, entityName, timeoutMs = 8000) {
    const text = await cmdAndWait(
        bot,
        `data get entity ${entityName} Pos`,
        (t) => t.includes('has the following entity data') || t.includes('Pos'),
        timeoutMs
    );
    const re = /(-?\d+\.?\d*)d?,\s*(-?\d+\.?\d*)d?,\s*(-?\d+\.?\d*)d?/;
    const m = re.exec(text);
    if (!m) throw new Error(`no se pudo parsear la posicion de ${entityName}: ${text}`);
    return { x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) };
}

/** Lee el contenido de un contenedor (cofre, etc.) via /data get block x y z Items. */
export async function getBlockItems(bot, x, y, z, timeoutMs = 8000) {
    const text = await cmdAndWait(
        bot,
        `data get block ${x} ${y} ${z} Items`,
        (t) => t.includes('has the following block data') || t.includes('Items'),
        timeoutMs
    );
    const items = [];
    const re = /id:\s*"minecraft:([a-z0-9_]+)".*?count:\s*(\d+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        items.push({ id: m[1], count: parseInt(m[2], 10) });
    }
    return items;
}

/**
 * Comprueba si una entidad marcada con un tag sigue existiendo (para saber si un mob murio).
 * No se traga errores/timeouts como "no existe": eso daria falsos positivos de "muerto" cuando
 * en realidad es un fallo de RCON. Deja que el caller (pollUntil) reintente en ese caso.
 */
export async function entityWithTagExists(bot, tag, timeoutMs = 8000) {
    const text = await cmdAndWait(
        bot,
        `data get entity @e[tag=${tag},limit=1]`,
        (t) => t.includes('has the following entity data') || t.includes('No entity was found'),
        timeoutMs
    );
    return !text.includes('No entity was found');
}

/** Recoge todos los mensajes de chat publico de un jugador concreto durante un periodo de tiempo. */
export function collectChatFrom(bot, username, windowMs) {
    const messages = [];
    const onChat = (user, message) => {
        if (user === username) messages.push(message);
    };
    bot.on('chat', onChat);
    return sleep(windowMs).then(() => {
        bot.removeListener('chat', onChat);
        return messages;
    });
}

/**
 * Espera a que el companero deje de generar actividad en su log (heuristica de "idle"):
 * sondea el tamano del fichero de log y considera que esta inactivo cuando no crece
 * durante quietMs seguidos. Evita que la siguiente prueba mande una orden nueva mientras
 * el companero (modelo local, lento) todavia esta terminando de decidir/ejecutar la anterior.
 */
export async function waitForBotIdle(logPath, { quietMs = 12000, timeoutMs = 120000, pollMs = 2000 } = {}) {
    const fs = await import('fs');
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;
    let lastChangeAt = Date.now();
    while (Date.now() < deadline) {
        let size = 0;
        try {
            size = fs.statSync(logPath).size;
        } catch {
            // el log puede no existir todavia; tratamos como "sin cambios"
        }
        if (size !== lastSize) {
            lastSize = size;
            lastChangeAt = Date.now();
        }
        if (Date.now() - lastChangeAt >= quietMs) {
            return true;
        }
        await sleep(pollMs);
    }
    return false; // timeout: seguimos igualmente, el timeout de cada prueba ya es generoso
}

export async function walkForwardBlocks(bot, blocks, msPerBlock = 400) {
    const start = bot.entity.position.clone();
    bot.setControlState('forward', true);
    const totalMs = blocks * msPerBlock;
    await sleep(totalMs);
    bot.setControlState('forward', false);
    return distance(start, bot.entity.position);
}
