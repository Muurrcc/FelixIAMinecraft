# Variables de entorno del proyecto IAMine. Cargar con: . <raiz>\scripts\env.ps1
# Todo apunta dentro de la carpeta raiz (regla D.1). No se toca PATH/entorno global.

$R = Split-Path -Parent $PSScriptRoot

$env:PATH              = "$R\runtime\node;$R\runtime\java\bin;$R\runtime\ollama;$env:PATH"
$env:OLLAMA_MODELS     = "$R\models\ollama"
$env:OLLAMA_HOST       = "127.0.0.1:11434"
$env:OLLAMA_KEEP_ALIVE = "30m"
$env:npm_config_cache  = "$R\cache\npm"
$env:HF_HOME           = "$R\cache\huggingface"
$env:TEMP              = "$R\cache\tmp"
$env:TMP               = $env:TEMP

New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
