# Para todo lo que este corriendo (regla D.5: no dejar procesos colgados).
# Detiene el servidor Paper via RCON (comando "stop", guarda el mundo), luego el bot y Ollama.

$ErrorActionPreference = 'SilentlyContinue'
$R = $PSScriptRoot | Split-Path -Parent
. "$R\scripts\env.ps1"

function Send-RconStop {
    param([string]$RconFile)
    if (-not (Test-Path $RconFile)) { return }
    $parts = (Get-Content $RconFile).Split(':')
    $ip = $parts[0]; $port = [int]$parts[1]; $pass = $parts[2]
    try {
        & "$R\runtime\node\node.exe" "$R\scripts\rcon_client.js" $ip $port $pass "stop"
        Write-Host "RCON stop enviado a $ip`:$port"
    } catch {
        Write-Host "No se pudo enviar RCON stop a $ip`:$port ($($_.Exception.Message))"
    }
}

Send-RconStop "$R\run\rcon_main.txt"
Send-RconStop "$R\run\rcon_test.txt"

Start-Sleep -Seconds 8

$pidsFile = "$R\run\pids.json"
if (Test-Path $pidsFile) {
    $pids = Get-Content $pidsFile | ConvertFrom-Json
    foreach ($prop in $pids.PSObject.Properties) {
        $procId = $prop.Value
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) {
            Write-Host "Deteniendo $($prop.Name) (PID $procId)"
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $pidsFile -Force
}

# Red de seguridad: matar cualquier java/node/ollama/llama-server lanzado desde dentro de la carpeta raiz.
# ollama.exe lanza un subproceso llama-server.exe que NO muere solo si el padre se mata con -Force
# (ver NOTAS.md: 3 llama-server.exe quedaron huerfanos reteniendo ~10GB de VRAM tras kills manuales).
Get-Process java, node, ollama, llama-server -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($R, [System.StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object {
    Write-Host "Deteniendo proceso huerfano $($_.ProcessName) (PID $($_.Id))"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

Write-Host "stop_all.ps1 completado."
