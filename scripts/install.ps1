# FelixIAMinecraft installer. Downloads everything the project needs into this folder
# (portable runtimes, Paper, plugins, client mods, npm packages, Ollama models) and writes
# the per-install config (RCON passwords, whitelist, EULA). Nothing is installed system-wide.
#
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Player <YourMinecraftName>
#
# Every step is idempotent: re-running skips what is already in place.
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_]{3,16}$')]
    [string]$Player,          # your Minecraft username (added to the whitelist)
    [switch]$AcceptEula,      # accept the Minecraft EULA without prompting
    [switch]$WithTestServer,  # also set up server\world_test (flat world on :25566) + the tester bot
    [switch]$Rocm,            # AMD GPU: add Ollama's ROCm libraries
    [switch]$SkipModels,      # don't pull the Ollama models (~5 GB)
    [switch]$SkipSkin,        # don't boot the server once to give the bot its skin
    [switch]$DeployPrism      # copy the client instance into Prism Launcher's instances folder
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$R = $PSScriptRoot | Split-Path -Parent
. "$R\scripts\env.ps1"

$manifest = Get-Content "$R\scripts\downloads.json" -Raw | ConvertFrom-Json
$dl = "$R\cache\downloads"
New-Item -ItemType Directory -Force -Path $dl, "$R\runtime", "$R\run", "$R\logs" | Out-Null

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    $text" -ForegroundColor DarkGray }

# Downloads $Url into cache\downloads\$File (unless a verified copy is already there) and returns the path.
function Get-Verified {
    param([string]$Url, [string]$File, [string]$Sha256, [string]$Sha512)
    $out = Join-Path $dl $File
    $algo = if ($Sha512) { 'SHA512' } else { 'SHA256' }
    $want = if ($Sha512) { $Sha512 } else { $Sha256 }
    if (Test-Path $out) {
        if ((Get-FileHash $out -Algorithm $algo).Hash -eq $want) { Ok "cached  $File"; return $out }
        Remove-Item $out -Force
    }
    Ok "download $File"
    & "$env:SystemRoot\System32\curl.exe" -L --fail --silent --show-error --retry 3 -o "$out.part" $Url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
    $got = (Get-FileHash "$out.part" -Algorithm $algo).Hash
    if ($got -ne $want) {
        Remove-Item "$out.part" -Force
        throw "Checksum mismatch for $File (expected $want, got $got)"
    }
    Move-Item "$out.part" $out -Force
    return $out
}

# Extracts a zip into $Dest, flattening a single top-level folder (node-v20.../, jdk-21.../).
function Expand-Flat {
    param([string]$Zip, [string]$Dest)
    $tmp = Join-Path $env:TEMP ("extract_" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp, $Dest | Out-Null
    # Windows' own tar.exe, not Git Bash's (which can't handle "X:\..." paths).
    & "$env:SystemRoot\System32\tar.exe" -xf $Zip -C $tmp
    if ($LASTEXITCODE -ne 0) { throw "Could not extract $Zip" }
    $top = @(Get-ChildItem $tmp)
    $src = if ($top.Count -eq 1 -and $top[0].PSIsContainer) { $top[0].FullName } else { $tmp }
    Get-ChildItem $src -Force | ForEach-Object { Move-Item $_.FullName $Dest -Force }
    Remove-Item $tmp -Recurse -Force
}

function Get-OfflineUuid([string]$Name) {
    $b = [System.Security.Cryptography.MD5]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes("OfflinePlayer:$Name"))
    $b[6] = ($b[6] -band 0x0f) -bor 0x30
    $b[8] = ($b[8] -band 0x3f) -bor 0x80
    $h = -join ($b | ForEach-Object { $_.ToString('x2') })
    "$($h.Substring(0,8))-$($h.Substring(8,4))-$($h.Substring(12,4))-$($h.Substring(16,4))-$($h.Substring(20))"
}

function New-Password {
    $chars = [char[]]'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Write-Json($Path, $Object) {
    # ConvertTo-Json in Windows PowerShell unwraps single-item arrays, so build the array text by hand.
    $items = @($Object | ForEach-Object { $_ | ConvertTo-Json -Compress })
    Set-Content -Path $Path -Value ("[`n  " + ($items -join ",`n  ") + "`n]") -Encoding ASCII
}

# Sets up one Paper server folder from server-template\ (only writes files that don't exist yet).
function Initialize-Server {
    param([string]$Dir, [string]$Template, [string]$RconFile, [int]$RconPort, [string[]]$Whitelist, [string[]]$Ops)
    New-Item -ItemType Directory -Force -Path "$Dir\plugins" | Out-Null
    $jar = Get-Verified -Url $manifest.paper.url -File $manifest.paper.file -Sha256 $manifest.paper.sha256
    if (-not (Test-Path "$Dir\$($manifest.paper.file)")) { Copy-Item $jar "$Dir\$($manifest.paper.file)" }

    if (-not (Test-Path "$Dir\server.properties")) {
        $pass = New-Password
        (Get-Content "$R\server-template\$Template" -Raw).Replace('__RCON_PASSWORD__', $pass) |
            Set-Content "$Dir\server.properties" -Encoding ASCII -NoNewline
        Set-Content $RconFile "127.0.0.1:${RconPort}:$pass" -Encoding ASCII -NoNewline
        Ok "server.properties written (random RCON password in run\$(Split-Path $RconFile -Leaf))"
    } else { Ok "server.properties already exists, kept" }
    if (-not (Test-Path "$Dir\spigot.yml")) { Copy-Item "$R\server-template\spigot.yml" "$Dir\spigot.yml" }
    Set-Content "$Dir\eula.txt" "eula=true" -Encoding ASCII

    if (-not (Test-Path "$Dir\whitelist.json")) {
        Write-Json "$Dir\whitelist.json" ($Whitelist | ForEach-Object { [ordered]@{ uuid = (Get-OfflineUuid $_); name = $_ } })
    }
    if ($Ops -and -not (Test-Path "$Dir\ops.json")) {
        Write-Json "$Dir\ops.json" ($Ops | ForEach-Object { [ordered]@{ uuid = (Get-OfflineUuid $_); name = $_; level = 4; bypassesPlayerLimit = $false } })
    }
}

function Test-Port([int]$Port) {
    $c = New-Object System.Net.Sockets.TcpClient
    try { $c.Connect('127.0.0.1', $Port); $true } catch { $false } finally { $c.Close() }
}

# ---------------------------------------------------------------------------------------------

Write-Host "FelixIAMinecraft installer - everything goes into $R" -ForegroundColor White

if (-not $AcceptEula) {
    Write-Host "`nThe Minecraft server needs you to accept the Minecraft EULA: https://aka.ms/MinecraftEULA"
    $answer = Read-Host "Do you accept it? (y/N)"
    if ($answer -notmatch '^(y|yes|s|si)$') { throw "EULA not accepted, stopping." }
}

Step "Portable runtimes (Node.js, Java 21, Ollama)"
foreach ($rt in $manifest.runtimes) {
    $dest = Join-Path $R $rt.dest
    if (Test-Path (Join-Path $dest $rt.check)) { Ok "$($rt.name) already installed"; continue }
    $zip = Get-Verified -Url $rt.url -File $rt.file -Sha256 $rt.sha256
    Ok "extract $($rt.name)"
    Expand-Flat $zip $dest
}
if ($Rocm -and -not (Test-Path "$R\runtime\ollama\lib\ollama\rocm")) {
    $zip = Get-Verified -Url $manifest.ollama_rocm.url -File $manifest.ollama_rocm.file -Sha256 $manifest.ollama_rocm.sha256
    Ok "extract ROCm libraries"
    Expand-Flat $zip "$R\runtime\ollama"
}

Step "Paper server (server\main)"
Initialize-Server -Dir "$R\server\main" -Template 'main.properties' -RconFile "$R\run\rcon_main.txt" -RconPort 25575 -Whitelist @($Player, 'Claude')
foreach ($p in $manifest.plugins) {
    $jar = Get-Verified -Url $p.url -File $p.file -Sha512 $p.sha512
    Copy-Item $jar "$R\server\main\plugins\$($p.file)" -Force
}

if ($WithTestServer) {
    Step "Test server (server\world_test)"
    Initialize-Server -Dir "$R\server\world_test" -Template 'test.properties' -RconFile "$R\run\rcon_test.txt" -RconPort 25576 -Whitelist @('Claude', 'Tester') -Ops @('Tester')
}

Step "Client mods (client\IAMine\.minecraft\mods)"
$mods = "$R\client\IAMine\.minecraft\mods"
New-Item -ItemType Directory -Force -Path $mods | Out-Null
foreach ($m in $manifest.mods) {
    $jar = Get-Verified -Url $m.url -File $m.file -Sha512 $m.sha512
    Copy-Item $jar "$mods\$($m.file)" -Force
}

Step "npm packages"
$npmDirs = @("$R\mindcraft") + $(if ($WithTestServer) { @("$R\tests\tester-bot") } else { @() })
foreach ($dir in $npmDirs) {
    # npm writes node_modules\.package-lock.json only after a complete install.
    if (Test-Path "$dir\node_modules\.package-lock.json") { Ok "already installed in $(Split-Path $dir -Leaf)"; continue }
    Push-Location $dir
    try {
        & npm.cmd ci --no-audit --no-fund --loglevel=error
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $dir" }
    } finally { Pop-Location }
}

if (-not (Test-Path "$R\mindcraft\keys.json")) {
    Copy-Item "$R\mindcraft\keys.example.json" "$R\mindcraft\keys.json"
    Ok "created mindcraft\keys.json (empty, only needed for cloud models)"
}

if (-not $SkipModels) {
    Step "Ollama models"
    $llm = Get-Content "$R\config\llm.json" -Raw | ConvertFrom-Json
    $ollama = $null
    if (-not (Test-Port 11434)) {
        $ollama = Start-Process -FilePath "$R\runtime\ollama\ollama.exe" -ArgumentList 'serve' -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput "$R\logs\ollama_install_stdout.log" -RedirectStandardError "$R\logs\ollama_install_stderr.log"
        $deadline = (Get-Date).AddSeconds(30)
        while (-not (Test-Port 11434) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
    }
    try {
        foreach ($model in @($llm.chat_model, $llm.embedding_model)) {
            $name = $model -replace '^ollama/', ''
            Ok "pull $name"
            & "$R\runtime\ollama\ollama.exe" pull $name
            if ($LASTEXITCODE -ne 0) { throw "ollama pull $name failed" }
        }
    } finally {
        if ($ollama) { Stop-Process -Id $ollama.Id -Force -ErrorAction SilentlyContinue }
    }
}

if (-not $SkipSkin -and -not (Test-Path "$R\server\main\plugins\SkinsRestorer\players\$(Get-OfflineUuid 'Claude').player")) {
    Step "First server boot: generate the world and give Claude its skin"
    if (Test-Port 25565) { throw "Something is already listening on port 25565. Stop it (scripts\stop_all.ps1) or re-run with -SkipSkin." }
    $log = "$R\logs\server_install_stdout.log"
    Remove-Item $log -ErrorAction SilentlyContinue
    $paper = Start-Process -FilePath "$R\runtime\java\bin\java.exe" -ArgumentList @('-Xms2G', '-Xmx6G', '-jar', $manifest.paper.file, '--nogui') `
        -WorkingDirectory "$R\server\main" -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$R\logs\server_install_stderr.log"
    $deadline = (Get-Date).AddMinutes(6)
    while ((Get-Date) -lt $deadline -and -not $paper.HasExited) {
        if ((Get-Content $log -Raw -ErrorAction SilentlyContinue) -match 'Done \(') { break }
        Start-Sleep -Seconds 2
    }
    if ($paper.HasExited -or -not ((Get-Content $log -Raw) -match 'Done \(')) {
        Stop-Process -Id $paper.Id -Force -ErrorAction SilentlyContinue
        throw "The server did not finish starting. See logs\server_install_stdout.log"
    }
    $ip, $port, $pass = (Get-Content "$R\run\rcon_main.txt").Split(':')
    $rcon = { param($cmd) & "$R\runtime\node\node.exe" "$R\scripts\rcon_client.js" $ip $port $pass $cmd }
    # "sr createcustom" runs asynchronously (it uploads the texture to MineSkin): wait for the file
    # it writes, since stopping the server early aborts it.
    $sr = "$R\server\main\plugins\SkinsRestorer"
    & $rcon 'sr createcustom claude_namemc https://s.namemc.com/i/a9170aed08194f7b.png' | Out-Null
    $d = (Get-Date).AddSeconds(90)
    while (-not (Test-Path "$sr\skins\claude_namemc.customskin") -and (Get-Date) -lt $d) { Start-Sleep -Seconds 1 }
    $skinOk = Test-Path "$sr\skins\claude_namemc.customskin"
    & $rcon 'stop' | Out-Null
    if (-not $paper.WaitForExit(90000)) { Stop-Process -Id $paper.Id -Force }
    if ($skinOk) {
        # "skin set" only works on online players, so assign it the way SkinsRestorer stores it.
        $uuid = Get-OfflineUuid 'Claude'
        New-Item -ItemType Directory -Force -Path "$sr\players" | Out-Null
        Set-Content "$sr\players\$uuid.player" -Encoding ASCII -NoNewline `
            ('{"uniqueId":"' + $uuid + '","skinIdentifier":{"identifier":"claude_namemc","type":"CUSTOM"},"offlineModeWarningDismissed":false,"dataVersion":2}')
        Ok "world generated, skin assigned"
    }
    else { Write-Warning "World generated, but the skin could not be set (MineSkin unreachable?). Re-run the installer later to retry." }
}

if ($DeployPrism) {
    Step "Prism Launcher instance"
    & "$R\scripts\prism_instance.ps1"
}

Write-Host "`nAll set." -ForegroundColor Green
Write-Host @"

Next steps:
  1. Start everything:   powershell -ExecutionPolicy Bypass -File scripts\start_all.ps1
  2. Dashboard:          http://127.0.0.1:8090 (opens automatically)
  3. In Minecraft 1.21.6 join 127.0.0.1 as '$Player' and say hi to Claude in chat.
  4. Stop everything:    powershell -ExecutionPolicy Bypass -File scripts\stop_all.ps1
"@
