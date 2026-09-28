// Cliente RCON minimo (protocolo "Source RCON", el que usa Minecraft/Paper).
// Uso: node rcon_client.js <ip> <puerto> <password> <comando>
'use strict';
const net = require('net');

const [, , host, portStr, password, ...cmdParts] = process.argv;
const port = parseInt(portStr, 10);
const command = cmdParts.join(' ');

if (!host || !port || !password || !command) {
    console.error('Uso: node rcon_client.js <ip> <puerto> <password> <comando>');
    process.exit(1);
}

const TYPE_AUTH = 3;
const TYPE_AUTH_RESPONSE = 2;
const TYPE_EXEC = 2;
const TYPE_RESPONSE = 0;

function buildPacket(id, type, body) {
    const bodyBuf = Buffer.from(body + '\0', 'ascii');
    const len = 4 + 4 + bodyBuf.length + 1;
    const buf = Buffer.alloc(4 + len);
    buf.writeInt32LE(len, 0);
    buf.writeInt32LE(id, 4);
    buf.writeInt32LE(type, 8);
    bodyBuf.copy(buf, 12);
    buf.writeUInt8(0, 12 + bodyBuf.length);
    return buf;
}

function readPackets(buf) {
    const packets = [];
    let offset = 0;
    while (offset + 4 <= buf.length) {
        const len = buf.readInt32LE(offset);
        if (offset + 4 + len > buf.length) break;
        const id = buf.readInt32LE(offset + 4);
        const type = buf.readInt32LE(offset + 8);
        const body = buf.toString('ascii', offset + 12, offset + 4 + len - 2);
        packets.push({ id, type, body });
        offset += 4 + len;
    }
    return packets;
}

const socket = net.createConnection({ host, port, timeout: 5000 }, () => {
    socket.write(buildPacket(1, TYPE_AUTH, password));
});

let stage = 'auth';
let recvBuf = Buffer.alloc(0);

socket.on('data', (chunk) => {
    recvBuf = Buffer.concat([recvBuf, chunk]);
    const packets = readPackets(recvBuf);
    if (packets.length === 0) return;
    recvBuf = Buffer.alloc(0);

    for (const pkt of packets) {
        if (stage === 'auth') {
            if (pkt.type === TYPE_AUTH_RESPONSE) {
                if (pkt.id === -1) {
                    console.error('RCON: autenticacion fallida');
                    socket.destroy();
                    process.exit(1);
                }
                stage = 'exec';
                socket.write(buildPacket(2, TYPE_EXEC, command));
            }
        } else if (stage === 'exec' && pkt.type === TYPE_RESPONSE) {
            console.log(pkt.body);
            socket.end();
            process.exit(0);
        }
    }
});

socket.on('timeout', () => {
    console.error('RCON: timeout de conexion');
    socket.destroy();
    process.exit(1);
});

socket.on('error', (err) => {
    console.error('RCON: error de conexion -', err.message);
    process.exit(1);
});
