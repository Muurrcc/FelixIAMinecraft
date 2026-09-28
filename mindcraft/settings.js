const settings = {
    "minecraft_version": "1.21.6", // fijado (verificado en NOTAS.md, no "auto", para que coincida con el servidor Paper)
    "host": process.env.MINDCRAFT_HOST || "127.0.0.1", // servidor Paper local, solo localhost
    "port": Number(process.env.MINDCRAFT_PORT) || 25565, // puerto del servidor Paper (server.properties); override con MINDCRAFT_PORT para apuntar a world_test (25566) en pruebas
    "auth": "offline", // servidor local en modo offline, sin cuenta de Microsoft

    // the mindserver manages all agents and hosts the UI
    "mindserver_port": 8080,
    "auto_open_ui": false, // desatendido: no abrir navegador automaticamente

    "base_profile": "assistant", // survival, assistant, creative, or god_mode
    "profiles": [
        "./profiles/claude_bot.json", // nombre_bot=Claude (antes Alex, seccion B de PLAN_A_ISO.md)
    ],

    "load_memory": true, // cargar memoria de sesiones anteriores (persistencia, fase 3)
    "init_message": "Responde con hola mundo y tu nombre", // sends to all on spawn
    "only_chat_with": [], // publico: responde a quien lo mencione o le susurre (logica de mencion en el propio prompt/companion)

    "speak": false,
    // SIN VOZ: el compañero solo se comunica por el chat de Minecraft (regla del plan). No activar TTS/STT.

    "chat_ingame": true, // bot responses are shown in minecraft chat
    "language": "Spanish", // traduce entradas/salidas del chat a espanol; los prompts internos y el tool-calling siguen en ingles (mejor fiabilidad con Andy-4, ver NOTAS.md)
    "render_bot_view": false, // show bot's view in browser at localhost:3000, 3001...

    "allow_insecure_coding": false, // allows newAction command and model can write/run code on your computer. enable at own risk
    "allow_vision": false, // allows vision model to interpret screenshots as inputs
    "blocked_actions" : ["!checkBlueprint", "!checkBlueprintLevel", "!getBlueprint", "!getBlueprintLevel", "!attackPlayer"] , // commands to disable and remove from docs. !attackPlayer bloqueado a nivel de codigo (no solo prompt): el companero nunca debe poder atacar a un jugador humano, ni siquiera si el LLM decide invocarlo por confusion (ver Fase 2, prueba mata_zombi)
    "code_timeout_mins": -1, // minutes code is allowed to run. -1 for no timeout
    "relevant_docs_count": 5, // number of relevant code function docs to select for prompting. -1 for all

    "max_messages": 15, // max number of messages to keep in context
    "num_examples": 2, // number of examples to give to the model
    "max_commands": -1, // max number of commands that can be used in consecutive responses. -1 for no limit
    "show_command_syntax": "full", // "full", "shortened", or "none"
    "narrate_behavior": true, // chat simple automatic actions ('Picking up item!')
    "chat_bot_messages": true, // publicly chat messages to other bots

    "spawn_timeout": 30, // num seconds allowed for the bot to spawn before throwing error. Increase when spawning takes a while.
    "block_place_delay": 0, // delay between placing blocks (ms) if using newAction. helps avoid bot being kicked by anti-cheat mechanisms on servers.
  
    "log_all_prompts": false, // log ALL prompts to file
};

export default settings;
