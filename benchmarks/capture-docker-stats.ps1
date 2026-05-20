# Capture `docker stats` samples into a CSV while another benchmark is running.
# Usage:
#   pwsh benchmarks/capture-docker-stats.ps1 -DurationSec 60 -IntervalSec 2 -OutPath benchmarks/results/docker_stats.csv
# Optional -Filter restricts to containers whose name matches the regex (default: project containers).

param(
    [int]$DurationSec = 60,
    [int]$IntervalSec = 2,
    [string]$OutPath = "benchmarks/results/docker_stats.csv",
    [string]$Filter = "(auth-service|association-service|vote-service|blockchain-bridge|postgres|frontend)"
)

$ErrorActionPreference = 'Stop'

$outDir = Split-Path -Parent $OutPath
if ($outDir -and -not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$header = "timestamp,container,cpu_pct,mem_usage,mem_pct,net_io,block_io,pids"
Set-Content -Path $OutPath -Value $header -Encoding utf8

$format = "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}"
$endAt = (Get-Date).AddSeconds($DurationSec)
$sampleCount = 0

Write-Host "# docker stats capture: duration=${DurationSec}s interval=${IntervalSec}s out=$OutPath filter=$Filter"

while ((Get-Date) -lt $endAt) {
    $ts = (Get-Date).ToString("o")
    $raw = docker stats --no-stream --format $format
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "docker stats exited with code $LASTEXITCODE; stopping capture"
        break
    }

    foreach ($line in $raw) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $parts = $line -split '\|'
        if ($parts.Length -lt 7) { continue }
        $name = $parts[0]
        if ($name -notmatch $Filter) { continue }

        # Escape comma-containing fields ("23.5MiB / 1.95GiB", "0B / 0B")
        $row = @($ts, $name) + ($parts[1..6] | ForEach-Object {
            $v = $_.Trim()
            if ($v -match '[",]') { '"' + $v.Replace('"', '""') + '"' } else { $v }
        })
        Add-Content -Path $OutPath -Value ($row -join ',') -Encoding utf8
        $sampleCount++
    }

    Start-Sleep -Seconds $IntervalSec
}

Write-Host "# captured $sampleCount sample rows -> $OutPath"
