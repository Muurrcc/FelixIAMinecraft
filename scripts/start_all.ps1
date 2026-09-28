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
Write-Host "[1/4] Arrancando Ollama..."
$ollama = Start-Process -FilePath "$R\runtime\ollama\ollama.exe" -ArgumentList "serve" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput "$R\logs\ollama_stdout.log" -RedirectStandardError "$R\logs\ollama_stderr.log"
$pids.ollama = $ollama.Id
if (-not (Wait-Port -HostName "127.0.0.1" -Port 11434 -TimeoutSec 30)) {
    throw "Ollama no respondio en el puerto 11434 tras 30s. Ver logs\ollama_stderr.log"
}
Write-Host "Ollama listo (PID $($ollama.Id))."

# 2) Servidor Paper (main o world_test segun -Test)
Write-Host "[2/4] Arrancando servidor Paper ($serverPidKey)..."
Push-Location $serverDir
$serverArgs = @("-Xms2G", "-Xmx6G", "-jar", "paper-1.21.6-48.jar", "--nogui")
$paper = Start-Process -FilePath "$R\runtime\java\bin\java.exe" -ArgumentList $serverArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput "$R\logs\${serverLogPrefix}_stdout.log" -RedirectStandardError "$R\logs\${serverLogPrefix}_stderr.log"
Pop-Location
$pids.$serverPidKey = $paper.Id
if (-not (Wait-LogContains -LogPath "$R\logs\${serverLogPrefix}_stdout.log" -Text "Done (" -TimeoutSec 180)) {
    throw "El servidor Paper no termino de arrancar tras 180s. Ver logs\${serverLogPrefix}_stdout.log"
}
Write-Host "Servidor Paper listo (PID $($paper.Id))."

$pids | ConvertTo-Json | Set-Content "$R\run\pids.json"

if ($SoloServidor) {
    Write-Host "SoloServidor activo: no se lanza el bot. PIDs guardados en run\pids.json."
    exit 0
}

# 3) Sincronizar config LLM -> perfil del bot (regla D.7, fuente unica config\llm.json)
Write-Host "[3/4] Sincronizando config\llm.json con el perfil del bot..."
& "$R\runtime\node\node.exe" "$R\mindcraft\tools\apply_llm_config.js" "$R\mindcraft\profiles\claude_bot.json"

# 4) Bot Mindcraft
Write-Host "[4/4] Arrancando bot Mindcraft (puerto $botPort)..."
Push-Location "$R\mindcraft"
$env:MINDCRAFT_PORT = "$botPort"
$bot = Start-Process -FilePath "$R\runtime\node\node.exe" -ArgumentList "main.js" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput "$R\logs\bot_stdout.log" -RedirectStandardError "$R\logs\bot_stderr.log"
Remove-Item Env:\MINDCRAFT_PORT
Pop-Location
$pids.bot = $bot.Id
$pids | ConvertTo-Json | Set-Content "$R\run\pids.json"

if (-not $Test) { & "$R\scripts\dashboard.ps1" }

Write-Host "Todo arrancado. PIDs:"
$pids | ConvertTo-Json
Write-Host "Logs en $R\logs\. Para parar todo: scripts\stop_all.ps1"
