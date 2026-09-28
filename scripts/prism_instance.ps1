# Copia/regenera la instancia "IAMine" desde la plantilla (client\IAMine\) hacia el
# InstanceDir real de Prism Launcher (leido de prismlauncher.cfg, solo lectura).
# Nunca toca otras instancias existentes del usuario.

$ErrorActionPreference = 'Stop'
$R = $PSScriptRoot | Split-Path -Parent
. "$R\scripts\env.ps1"

$prismCfg = "$env:APPDATA\PrismLauncher\prismlauncher.cfg"
if (-not (Test-Path $prismCfg)) {
    throw "No se encontro prismlauncher.cfg en $prismCfg. Prism Launcher no parece estar instalado para este usuario."
}

$instanceDirLine = Get-Content $prismCfg | Where-Object { $_ -like 'InstanceDir=*' } | Select-Object -First 1
$instanceDir = if ($instanceDirLine) { ($instanceDirLine -split '=', 2)[1].Trim() -replace '/', '\' } else { 'instances' }
# Si nunca se ha cambiado, Prism guarda "instances" (relativo a su carpeta de datos).
if (-not [System.IO.Path]::IsPathRooted($instanceDir)) { $instanceDir = Join-Path "$env:APPDATA\PrismLauncher" $instanceDir }

$dest = Join-Path $instanceDir "IAMine"
$src = "$R\client\IAMine"

Write-Host "Copiando plantilla de instancia:"
Write-Host "  origen : $src"
Write-Host "  destino: $dest"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
robocopy $src $dest /E /XO /NFL /NDL /NJH /NJS | Out-Null

Write-Host "Instancia IAMine desplegada en $dest."
