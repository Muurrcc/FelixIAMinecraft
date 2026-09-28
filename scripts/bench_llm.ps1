# Mide tokens/s y latencia al primer token del modelo definido en config\llm.json.
# Uso: scripts\bench_llm.ps1            (sin el juego abierto)
#      scripts\bench_llm.ps1 -ConJuego  (con el juego abierto, para comparar VRAM disponible real)
param(
    [switch]$ConJuego
)

$ErrorActionPreference = 'Stop'
$R = $PSScriptRoot | Split-Path -Parent
. "$R\scripts\env.ps1"

$llm = Get-Content "$R\config\llm.json" | ConvertFrom-Json
$model = $llm.chat_model -replace '^ollama/', ''
$url = $llm.url

$prompt = "Explain in 3 sentences how to mine iron efficiently in Minecraft."
$body = @{
    model = $model
    prompt = $prompt
    stream = $false
    options = @{
        num_predict = 200  # limite realista: una respuesta de chat del bot, no un ensayo. Sin limite, Andy-4 puede divagar miles de tokens y el tok/s medido cae por el coste creciente de atencion sobre un contexto largo (no representativo del uso real).
    }
} | ConvertTo-Json

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$res = Invoke-RestMethod -Uri "$url/api/generate" -Method Post -Body $body -ContentType 'application/json'
$sw.Stop()

$totalMs = $sw.Elapsed.TotalMilliseconds
$evalCount = $res.eval_count
$evalDurationNs = $res.eval_duration
$loadDurationNs = $res.load_duration
$promptEvalDurationNs = $res.prompt_eval_duration

$tokPerSec = if ($evalDurationNs -gt 0) { [math]::Round($evalCount / ($evalDurationNs / 1e9), 1) } else { 0 }
$firstTokenS = [math]::Round(($loadDurationNs + $promptEvalDurationNs) / 1e9, 2)

$label = if ($ConJuego) { "CON juego abierto" } else { "SIN juego abierto" }
$line = "$(Get-Date -Format s) | $label | modelo=$model | tok/s=$tokPerSec | primer_token_s=$firstTokenS | tiempo_total_ms=$([math]::Round($totalMs,0)) | eval_count=$evalCount"

Write-Host $line
New-Item -ItemType Directory -Force -Path "$R\logs" | Out-Null
Add-Content -Path "$R\logs\bench.md" -Value $line

$vram = & "$R\runtime\ollama\ollama.exe" ps
Write-Host "--- ollama ps ---"
Write-Host $vram
Add-Content -Path "$R\logs\bench.md" -Value ($vram -join "`n")

if ($tokPerSec -lt 25 -or $firstTokenS -gt 1.5) {
    Write-Warning "No cumple el criterio de aceptacion (>=25 tok/s, <1.5s primer token). Ver Fase 1 del plan para alternativas (Q4, contexto 4096, micro)."
}
