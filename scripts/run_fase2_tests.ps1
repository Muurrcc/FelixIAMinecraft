# Orquesta la ejecucion de las pruebas de Fase 2 (ver PLAN_A_ISO.md, seccion Fase 2):
# Ollama + servidor world_test + bot Claude (puerto 25566) + tester-bot (sin LLM).
# Escribe resultados en tests\resultados\fase2.md (lo genera run_tests.js).

$ErrorActionPreference = 'Stop'
$R = $PSScriptRoot | Split-Path -Parent
. "$R\scripts\env.ps1"

Write-Host "=== Fase 2: preparando entorno de pruebas ==="

# Por seguridad, asegurar que no queda nada corriendo de una pasada anterior.
& "$R\scripts\stop_all.ps1" | Out-Null
Start-Sleep -Seconds 3

# Memoria limpia para cada pasada de pruebas (evita contaminar la prueba con historial de una pasada anterior fallida).
# La memoria real de "Claude" (la de jugar en server\main) se guarda en run\claude_memoria_real y se restaura al final.
$backup = "$R\run\claude_memoria_real"
Remove-Item $backup -Force -Recurse -ErrorAction SilentlyContinue
if (Test-Path "$R\mindcraft\bots\Claude") { Copy-Item "$R\mindcraft\bots\Claude" $backup -Recurse -Force }
Remove-Item "$R\mindcraft\bots\Claude\memory.json" -Force -ErrorAction SilentlyContinue
Remove-Item "$R\mindcraft\bots\Claude\histories\*" -Force -Recurse -ErrorAction SilentlyContinue

# Mundo world_test limpio en cada pasada (evita mobs/objetos/inventario acumulados de pasadas anteriores; regenera con el preset plano alto ya fijado en server.properties).
Remove-Item "$R\server\world_test\world_test" -Force -Recurse -ErrorAction SilentlyContinue
Remove-Item "$R\server\world_test\world_test_nether" -Force -Recurse -ErrorAction SilentlyContinue
Remove-Item "$R\server\world_test\world_test_the_end" -Force -Recurse -ErrorAction SilentlyContinue

Write-Host "=== Arrancando Ollama + world_test + Claude (puerto 25566) ==="
& "$R\scripts\start_all.ps1" -Test

# Esperar a que el bot haya hecho spawn (log "<nombre> spawned.")
$deadline = (Get-Date).AddSeconds(120)
$spawned = $false
while ((Get-Date) -lt $deadline) {
    $log = Get-Content "$R\logs\bot_stdout.log" -Raw -ErrorAction SilentlyContinue
    if ($log -and $log -match 'spawned\.') { $spawned = $true; break }
    Start-Sleep -Seconds 3
}
if (-not $spawned) {
    Write-Host "AVISO: no se confirmo 'spawned.' en bot_stdout.log tras 120s; se continua igualmente (puede que ya lo hiciera)."
}
Write-Host "Bot listo. Esperando 10s de margen antes de lanzar el tester-bot..."
Start-Sleep -Seconds 10

Write-Host "=== Lanzando tester-bot (7 escenarios de Fase 2) ==="
Push-Location "$R\tests\tester-bot"
$env:TEST_PORT = "25566"
$env:TEST_BOT_NAME = "Claude"
& "$R\runtime\node\node.exe" run_tests.js 2>&1 | Tee-Object -FilePath "$R\logs\fase2_tester_bot.log"
$testExit = $LASTEXITCODE
Remove-Item Env:\TEST_PORT -ErrorAction SilentlyContinue
Remove-Item Env:\TEST_BOT_NAME -ErrorAction SilentlyContinue
Pop-Location

Write-Host "=== Parando todo ==="
& "$R\scripts\stop_all.ps1" | Out-Null

if (Test-Path $backup) {
    Remove-Item "$R\mindcraft\bots\Claude" -Force -Recurse -ErrorAction SilentlyContinue
    Copy-Item $backup "$R\mindcraft\bots\Claude" -Recurse -Force
    Write-Host "Memoria real de Claude restaurada."
}

Write-Host "=== Fase 2 completada. Codigo de salida del tester-bot: $testExit ==="
Write-Host "Resultados en tests\resultados\fase2.md, log completo en logs\fase2_tester_bot.log"
exit $testExit
