# Emite una linea JSON cada ~2s con metricas del sistema y de los procesos relevantes.
# Usa clases WMI (no contadores por nombre) porque los nombres de contadores estan localizados en Windows en espanol.
$ErrorActionPreference = 'SilentlyContinue'

$vramTotal = $null
Get-ChildItem 'HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' | ForEach-Object {
    $v = (Get-ItemProperty $_.PSPath).'HardwareInformation.qwMemorySize'
    if ($v -and ($vramTotal -eq $null -or [int64]$v -gt $vramTotal)) { $vramTotal = [int64]$v }
}
$cores = [Environment]::ProcessorCount

while ($true) {
    $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
    $gpu = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine |
        Where-Object { $_.Name -like '*engtype_3D*' -or $_.Name -like '*engtype_Compute*' } |
        Measure-Object UtilizationPercentage -Sum).Sum
    $vramUsed = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory |
        Measure-Object DedicatedUsage -Maximum).Maximum
    $os = Get-CimInstance Win32_OperatingSystem
    $procs = @(Get-Process java, javaw, node, ollama, llama-server | ForEach-Object {
        [pscustomobject]@{ pid = $_.Id; name = $_.ProcessName; path = $_.Path; cpuSec = $_.CPU; ram = $_.WorkingSet64 }
    })
    [pscustomobject]@{
        t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        cores = $cores
        cpu = $cpu
        gpu = [math]::Min(100, [double]$gpu)
        vramUsed = $vramUsed
        vramTotal = $vramTotal
        ramTotal = [int64]$os.TotalVisibleMemorySize * 1024
        ramFree = [int64]$os.FreePhysicalMemory * 1024
        procs = $procs
    } | ConvertTo-Json -Compress -Depth 4
    Start-Sleep -Milliseconds 1500
}
