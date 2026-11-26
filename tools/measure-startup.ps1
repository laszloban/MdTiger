<#
.SYNOPSIS
  Measures how long MdTiger takes from process start until the first frame is
  painted and the window is shown.

.DESCRIPTION
  Starts the exe N times with a throw-away profile (MDTIGER_PROFILE_DIR) and
  reads the "ready ProcessMs=<n> FrontMs=<n>" line the app writes to its log:
    - ProcessMs: main() until ready, measured inside the app. Compare with NFR-01.
    - FrontMs:   WebView navigation start until ready (front-end share).
  The app is stopped as soon as the line appears. The first run creates the
  WebView2 profile, so it counts as cold; the rest are warm. Real cold start
  (after a reboot) must be measured by hand.

.EXAMPLE
  .\tools\measure-startup.ps1 -Runs 10
  .\tools\measure-startup.ps1 -Runs 10 -Document .\tests\fixtures\plain.md
#>
param(
    [int] $Runs = 10,
    [string] $Exe = (Join-Path $PSScriptRoot "..\src-tauri\target\release\mdtiger.exe"),
    # Optional document to open. Default: none (empty state).
    [string] $Document
)

if (-not (Test-Path $Exe)) { throw "Build first with: npx tauri build --no-bundle: $Exe not found" }
$Exe = (Resolve-Path $Exe).Path
if (Get-Process -Name mdtiger -ErrorAction SilentlyContinue) {
    throw "MdTiger is already running; close it first (single-instance would hand the launch over)."
}

$profileDir = Join-Path ([IO.Path]::GetTempPath()) ("mdtiger-measure-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $profileDir | Out-Null
$logFile = Join-Path $profileDir "logs\mdtiger.log"
$env:MDTIGER_PROFILE_DIR = $profileDir
$rows = @()
try {
    for ($i = 1; $i -le $Runs; $i++) {
        Remove-Item $logFile -ErrorAction SilentlyContinue
        $exeArgs = @(); if ($Document) { $exeArgs += "`"$((Resolve-Path $Document).Path)`"" }
        $p = if ($exeArgs) { Start-Process -FilePath $Exe -ArgumentList $exeArgs -PassThru } else { Start-Process -FilePath $Exe -PassThru }
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        $match = $null
        while ([DateTime]::UtcNow -lt $deadline -and -not $match) {
            Start-Sleep -Milliseconds 50
            if (Test-Path $logFile) {
                $match = Select-String -Path $logFile -Pattern "ready ProcessMs=(\d+) FrontMs=(\d+)" -ErrorAction SilentlyContinue | Select-Object -First 1
            }
        }
        if ($match) {
            $rows += [pscustomobject]@{
                Run       = $i
                ProcessMs = [int]$match.Matches[0].Groups[1].Value
                FrontMs   = [int]$match.Matches[0].Groups[2].Value
            }
        } else {
            Write-Warning "run ${i}: no ready line within 30 s"
        }
        & taskkill /PID $p.Id /T /F | Out-Null
        Start-Sleep -Milliseconds 700
    }
}
finally {
    Remove-Item Env:\MDTIGER_PROFILE_DIR -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue
}

$rows | Format-Table -AutoSize
$warm = $rows | Select-Object -Skip 1
if ($warm) {
    $sorted = $warm.ProcessMs | Sort-Object
    $median = $sorted[[int][math]::Floor(($sorted.Count - 1) / 2)]
    "first run {0} ms; warm runs median {1} ms, min {2} ms, max {3} ms (ProcessMs)" -f `
        $rows[0].ProcessMs, $median, $sorted[0], $sorted[-1]
}
