# Copia de seguridad del mundo principal (server\main\world*). Conserva las ultimas 10.
# Pensado para ejecutarse al arrancar y cada 30 min (Task Scheduler o bucle en start_all).

$ErrorActionPreference = 'Stop'
$R = $PSScriptRoot | Split-Path -Parent
. "$R\scripts\env.ps1"

$worldDirs = @("world", "world_nether", "world_the_end") | ForEach-Object { "$R\server\main\$_" } | Where-Object { Test-Path $_ }

if ($worldDirs.Count -eq 0) {
    Write-Host "No hay carpetas de mundo todavia en server\main (el servidor no se ha lanzado aun). Nada que respaldar."
    exit 0
}

New-Item -ItemType Directory -Force -Path "$R\backups" | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$dest = "$R\backups\world_$stamp.zip"

Compress-Archive -Path $worldDirs -DestinationPath $dest -CompressionLevel Optimal
Write-Host "Backup creado: $dest"

# Conservar solo los ultimos 10
$backups = Get-ChildItem "$R\backups\world_*.zip" | Sort-Object LastWriteTime -Descending
if ($backups.Count -gt 10) {
    $backups | Select-Object -Skip 10 | ForEach-Object {
        Write-Host "Eliminando backup antiguo: $($_.Name)"
        Remove-Item $_.FullName -Force
    }
}
