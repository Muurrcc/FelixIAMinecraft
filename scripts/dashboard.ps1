# Arranca el dashboard de Claude (http://127.0.0.1:8090) en segundo plano, si no esta ya corriendo, y lo abre en el navegador.
# Es independiente del bot y del servidor: desde el panel se pueden arrancar y parar ambos.
param([switch]$NoBrowser)

$R = $PSScriptRoot | Split-Path -Parent
New-Item -ItemType Directory -Force -Path "$R\logs" | Out-Null

$up = Test-NetConnection -ComputerName 127.0.0.1 -Port 8090 -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $up) {
    Start-Process -FilePath "$R\runtime\node\node.exe" -ArgumentList "`"$R\dashboard\server.mjs`"" -WorkingDirectory "$R\dashboard" -WindowStyle Hidden `
        -RedirectStandardOutput "$R\logs\dashboard_stdout.log" -RedirectStandardError "$R\logs\dashboard_stderr.log" | Out-Null
    Start-Sleep -Seconds 2
    Write-Host "Dashboard started at http://127.0.0.1:8090"
} else {
    Write-Host "Dashboard already running at http://127.0.0.1:8090"
}
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:8090" }
