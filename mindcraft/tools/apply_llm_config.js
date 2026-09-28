// Lee config/llm.json (fuente unica de la direccion del LLM)
// y actualiza el perfil del bot (profiles/<nombre>.json) con los campos model/embedding
// correctos, sin tocar el resto del perfil (personalidad, prompts, etc).
//
// Uso: node tools/apply_llm_config.js <ruta_perfil_relativa_al_repo>
// Se ejecuta desde scripts/start_all.ps1 antes de lanzar el bot.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const raizRoot = path.resolve(repoRoot, '..'); // raiz del proyecto (contiene config/)

const profileArg = process.argv[2];
if (!profileArg) {
    console.error('Uso: node tools/apply_llm_config.js <ruta_perfil>');
    process.exit(1);
}

const llmConfigPath = path.join(raizRoot, 'config', 'llm.json');
const profilePath = path.resolve(repoRoot, profileArg);

const llm = JSON.parse(fs.readFileSync(llmConfigPath, 'utf-8'));
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));

function stripApiPrefix(model, api) {
    return model.startsWith(api + '/') ? model.slice(api.length + 1) : model;
}

if (llm.backend === 'local' || llm.backend === 'remote') {
    profile.model = {
        api: 'ollama',
        model: stripApiPrefix(llm.chat_model, 'ollama'),
        url: llm.url
    };
    profile.embedding = {
        api: 'ollama',
        model: stripApiPrefix(llm.embedding_model, 'ollama'),
        url: llm.url,
        params: { num_gpu: llm.embedding_num_gpu ?? 0 }
    };
} else {
    throw new Error(`backend desconocido en config/llm.json: ${llm.backend}`);
}

fs.writeFileSync(profilePath, JSON.stringify(profile, null, 4) + '\n');
console.log(`Perfil actualizado (${profilePath}) con backend=${llm.backend}, url=${llm.url}, chat=${profile.model.model}, embedding=${profile.embedding.model}`);
