const fs = require('fs');
const path = require('path');
const nbt = require('prismarine-nbt');

const serversList = {
  type: 'compound',
  name: '',
  value: {
    servers: {
      type: 'list',
      value: {
        type: 'compound',
        value: [
          {
            name: { type: 'string', value: 'IAMine local' },
            ip: { type: 'string', value: '127.0.0.1:25565' },
            acceptTextures: { type: 'byte', value: 1 }
          }
        ]
      }
    }
  }
};

const buf = nbt.writeUncompressed(serversList, 'big');
const outPath = path.join(__dirname, '..', 'IAMine', '.minecraft', 'servers.dat');
fs.writeFileSync(outPath, buf);
console.log('Wrote', outPath, buf.length, 'bytes');

const readBuf = fs.readFileSync(outPath);
(async () => {
  const parsed = await nbt.parse(readBuf);
  console.log(JSON.stringify(nbt.simplify(parsed.parsed), null, 2));
})();
