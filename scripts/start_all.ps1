# Arranca todo en orden: Ollama -> esperar listo -> servidor Paper (main) -> esperar "Done" -> bot Mindcraft.
# Guarda los PIDs en run\pids.json para que stop_all.ps1 pueda pararlo todo limpiamente.
param(
    [Alias('ServerOnly')][switch]$SoloServidor,  # si se pasa, no lanza el bot (util para pruebas manuales del servidor)
    [switch]$Test  # si se pasa, arranca server\world_test (puerto 25566) en vez de server\main, y apunta el bot ahi (Fase 2)
)

$ErrorActionPreference = 'Stop'
$R = $PSScriptRoot | Split-Path -Parent
. "$R\scripts\env.ps1"

New-Item -ItemType Directory -Force -Path "$R\logs" | Out-Null
New-Item -ItemType Directory -Force -Path "$R\run" | Out-Null

$serverDir = if ($Test) { "$R\server\world_test" } else { "$R\server\main" }
$serverLogPrefix = if ($Test) { "server_test" } else { "server_main" }
$serverPidKey = if ($Test) { "server_test" } else { "server_main" }
$botPort = if ($Test) { 25566 } else { 25565 }

$pids = @{}

# Perfiles de los bots: config\bots.json + personalities.json + llm.json (regla D.7, fuente unica config\).
# Va antes del servidor porque tambien anade los bots nuevos a la whitelist.
& "$R\runtime\node\node.exe" "$R\mindcraft\tools\build_profiles.js"
if ($LASTEXITCODE -ne 0) { throw "build_profiles.js failed; check config\bots.json" }
$botsCfg = Get-Content "$R\config\bots.json" -Raw | ConvertFrom-Json
$external = -not $Test -and $botsCfg.server.host -notin @('127.0.0.1', 'localhost')

function Wait-Port {
    param([string]$HostName, [int]$Port, [int]$TimeoutSec = 60)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $ok = Test-NetConnection -ComputerName $HostName -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
        if ($ok) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Wait-LogContains {
    param([string]$LogPath, [string]$Text, [int]$TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $LogPath) {
            $content = Get-Content $LogPath -Raw -ErrorAction SilentlyContinue
            if ($content -and $content.Contains($Text)) { return $true }
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

# 1) Ollama
Write-Host "[1/4] Starting Ollama..."
$ollama = Start-Process -FilePath "$R\runtime\ollama\ollama.exe" -ArgumentList "serve" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput "$R\logs\ollama_stdout.log" -RedirectStandardError "$R\logs\ollama_stderr.log"
$pids.ollama = $ollama.Id
if (-not (Wait-Port -HostName "127.0.0.1" -Port 11434 -TimeoutSec 30)) {
    throw "Ollama did not answer on port 11434 after 30s. See logs\ollama_stderr.log"
}
Write-Host "Ollama ready (PID $($ollama.Id))."

# 2) Servidor Paper (main o world_test segun -Test); con un servidor externo no se arranca el local
if ($external) {
    Write-Host "[2/4] Servidor externo $($botsCfg.server.host):$($botsCfg.server.port) (config\bots.json): not starting the local one."
    if ($SoloServidor) { Write-Host "-ServerOnly does nothing with an external server."; exit 0 }
} else {
    Write-Host "[2/4] Starting the Paper server ($serverPidKey)..."
    Push-Location $serverDir
    $serverArgs = @("-Xms2G", "-Xmx6G", "-jar", "paper-1.21.6-48.jar", "--nogui")
    $paper = Start-Process -FilePath "$R\runtime\java\bin\java.exe" -ArgumentList $serverArgs -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput "$R\logs\${serverLogPrefix}_stdout.log" -RedirectStandardError "$R\logs\${serverLogPrefix}_stderr.log"
    Pop-Location
    $pids.$serverPidKey = $paper.Id
    if (-not (Wait-LogContains -LogPath "$R\logs\${serverLogPrefix}_stdout.log" -Text "Done (" -TimeoutSec 180)) {
        throw "The Paper server did not finish starting after 180s. See logs\${serverLogPrefix}_stdout.log"
    }
    Write-Host "Paper server ready (PID $($paper.Id))."
}

$pids | ConvertTo-Json | Set-Content "$R\run\pids.json"

if ($SoloServidor) {
    Write-Host "-ServerOnly: not starting the bot. PIDs saved in run\pids.json."
    exit 0
}

# 3) Perfiles ya generados antes de arrancar el servidor (para que la whitelist incluya a todos los bots)
Write-Host "[3/4] Bot profiles built from config\bots.json."

# 4) Bot Mindcraft
Write-Host "[4/4] Starting the Mindcraft bot..."
Push-Location "$R\mindcraft"
# Solo se fuerza el puerto con el servidor local; con uno externo manda config\bots.json.
if (-not $external) { $env:MINDCRAFT_PORT = "$botPort" }
$bot = Start-Process -FilePath "$R\runtime\node\node.exe" -ArgumentList "main.js" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput "$R\logs\bot_stdout.log" -RedirectStandardError "$R\logs\bot_stderr.log"
Remove-Item Env:\MINDCRAFT_PORT -ErrorAction SilentlyContinue
Pop-Location
$pids.bot = $bot.Id
$pids | ConvertTo-Json | Set-Content "$R\run\pids.json"

if (-not $Test) { & "$R\scripts\dashboard.ps1" }

Write-Host "Everything is running. PIDs:"
$pids | ConvertTo-Json
Write-Host "Logs in $R\logs\. To stop everything: scripts\stop_all.ps1"
