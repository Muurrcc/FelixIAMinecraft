// Lee config/llm.json (fuente unica de la direccion del LLM)
// y actualiza el perfil del bot (profiles/<nombre>.json) con los campos model/embedding
// correctos, sin tocar el resto del perfil (personalidad, prompts, etc).
//
// Uso: node tools/apply_llm_config.js <ruta_perfil_relativa_al_repo>
// build_profiles.js importa applyLlmConfig() para los perfiles generados de cada bot.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const raizRoot = path.resolve(repoRoot, '..'); // raiz del proyecto (contiene config/)

function stripApiPrefix(model, api) {
    return model.startsWith(api + '/') ? model.slice(api.length + 1) : model;
}

export function applyLlmConfig(profile) {
    const llm = JSON.parse(fs.readFileSync(path.join(raizRoot, 'config', 'llm.json'), 'utf-8'));
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
    return llm;
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
    const profileArg = process.argv[2];
    if (!profileArg) {
        console.error('Uso: node tools/apply_llm_config.js <ruta_perfil>');
        process.exit(1);
    }
    const profilePath = path.resolve(repoRoot, profileArg);
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    const llm = applyLlmConfig(profile);
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 4) + '\n');
    console.log(`Perfil actualizado (${profilePath}) con backend=${llm.backend}, url=${llm.url}, chat=${profile.model.model}, embedding=${profile.embedding.model}`);
}
