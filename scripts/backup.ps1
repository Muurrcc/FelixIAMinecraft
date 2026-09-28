# Copia de seguridad del mundo principal (server\main\world*). Conserva las ultimas -Keep (10 por defecto).
# Funciona con el servidor encendido: el dashboard hace "save-off" + "save-all flush" antes y "save-on"
# despues, y aqui los ficheros se leen compartidos (Paper los tiene abiertos) saltando session.lock.
param([int]$Keep = 10)

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

Add-Type -AssemblyName System.IO.Compression
$zipStream = [IO.File]::Open("$dest.part", [IO.FileMode]::Create)
$zip = New-Object IO.Compression.ZipArchive($zipStream, [IO.Compression.ZipArchiveMode]::Create)
try {
    $base = "$R\server\main\"
    foreach ($f in $worldDirs | ForEach-Object { Get-ChildItem $_ -Recurse -File }) {
        if ($f.Name -eq 'session.lock') { continue }
        $entry = $zip.CreateEntry($f.FullName.Substring($base.Length).Replace('\', '/'), [IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = $f.LastWriteTime
        $in = [IO.File]::Open($f.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        $out = $entry.Open()
        try { $in.CopyTo($out) } finally { $out.Dispose(); $in.Dispose() }
    }
} finally { $zip.Dispose(); $zipStream.Dispose() }
Move-Item "$dest.part" $dest -Force
Write-Host "Backup creado: $dest"

# Conservar solo los ultimos $Keep
$backups = Get-ChildItem "$R\backups\world_*.zip" | Sort-Object LastWriteTime -Descending
if ($backups.Count -gt $Keep) {
    $backups | Select-Object -Skip $Keep | ForEach-Object {
        Write-Host "Eliminando backup antiguo: $($_.Name)"
        Remove-Item $_.FullName -Force
    }
}
