# Muestra el estado actual de todos los componentes (Ollama, servidor(es), bot).

$ErrorActionPreference = 'SilentlyContinue'
$R = $PSScriptRoot | Split-Path -Parent
. "$R\scripts\env.ps1"

Write-Host "=== FelixIAMinecraft status ($(Get-Date -Format s)) ==="

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
            Write-Host "[DOWN]   $($prop.Name): PID $procId is gone"
        }
    }
} else {
    Write-Host "No run\pids.json - nothing started with start_all.ps1 (or already stopped)."
}

Write-Host "--- Ports ---"
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
    Write-Host "$(if ($open) {'[open]  '} else {'[closed]'}) $p ($label)"
}

Write-Host "--- Ollama (loaded models) ---"
if (Test-NetConnection -ComputerName 127.0.0.1 -Port 11434 -InformationLevel Quiet -WarningAction SilentlyContinue) {
    & "$R\runtime\ollama\ollama.exe" ps
} else { Write-Host "Ollama is off." }

Write-Host "--- Disk ---"
$drive = Get-PSDrive -Name ($R.Substring(0,1))
Write-Host "Drive $($R.Substring(0,1)): $([math]::Round($drive.Free/1GB,1)) GB free of $([math]::Round(($drive.Free+$drive.Used)/1GB,1)) GB"
