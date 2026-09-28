# Muestra el estado actual de todos los componentes (Ollama, servidor(es), bot).

$ErrorActionPreference = 'SilentlyContinue'
$R = $PSScriptRoot | Split-Path -Parent
. "$R\scripts\env.ps1"

Write-Host "=== Estado IAMine ($(Get-Date -Format s)) ==="

$pidsFile = "$R\run\pids.json"
if (Test-Path $pidsFile) {
    $pids = Get-Content $pidsFile | ConvertFrom-Json
    foreach ($prop in $pids.PSObject.Properties) {
        $procId = $prop.Value
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) {
            $mem = [math]::Round($p.WorkingSet64 / 1MB, 0)
            Write-Host "[OK]     $($prop.Name): PID $procId, RAM ${mem}MB"
        } else {
            Write-Host "[CAIDO]  $($prop.Name): PID $procId ya no existe"
        }
    }
} else {
    Write-Host "No hay run\pids.json - nada arrancado con start_all.ps1 (o ya se paro)."
}

Write-Host "--- Puertos ---"
foreach ($p in @(11434, 25565, 25566, 25575, 25576, 8080)) {
    $open = Test-NetConnection -ComputerName 127.0.0.1 -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue
    $label = switch ($p) {
        11434 { "Ollama" }
        25565 { "Paper main" }
        25566 { "Paper world_test" }
        25575 { "RCON main" }
        25576 { "RCON world_test" }
        8080  { "Mindserver UI" }
    }
    Write-Host "$(if ($open) {'[abierto]'} else {'[cerrado]'}) $p ($label)"
}

Write-Host "--- Ollama (modelos cargados) ---"
if (Test-NetConnection -ComputerName 127.0.0.1 -Port 11434 -InformationLevel Quiet -WarningAction SilentlyContinue) {
    & "$R\runtime\ollama\ollama.exe" ps
} else { Write-Host "Ollama apagado." }

Write-Host "--- Disco ---"
$drive = Get-PSDrive -Name ($R.Substring(0,1))
Write-Host "Unidad $($R.Substring(0,1)): libres $([math]::Round($drive.Free/1GB,1)) GB de $([math]::Round(($drive.Free+$drive.Used)/1GB,1)) GB"
