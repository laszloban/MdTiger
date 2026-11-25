<#
.SYNOPSIS
  Spike check S1: measures how long each shell takes until the first document
  is rendered and the window is usable.

.DESCRIPTION
  Starts the shell N times with a document. The app reports "ready" from the
  front end once the document is painted, writes its own timings to a result
  file and exits (MDTIGER_SPIKE_EXIT_ON_READY). For each run the script
  records:
    - ProcessMs: process start (WPF) or main() (Tauri) until ready, measured
      inside the app. This is the number to compare with NFR-01.
    - NavMs:     WebView navigation start until ready (front-end share).
    - WallMs:    launch until the process has exited again: an upper bound,
      since it also includes shutdown.
  The first run after a reboot is the real cold start. Later runs are warm.

.EXAMPLE
  .\measure-startup.ps1 -Shell tauri -Runs 10
  .\measure-startup.ps1 -Shell wpf -Runs 10 -Document .\samples\big.md
#>
param(
    [ValidateSet("tauri", "wpf")] [string] $Shell = "tauri",
    [int] $Runs = 10,
    [string] $Document = (Join-Path $PSScriptRoot "samples\showcase.md"),
    # Optional: measure a different build, e.g. the ReadyToRun publish output.
    [string] $Exe
)

if (-not $Exe) {
    $Exe = switch ($Shell) {
        "tauri" { Join-Path $PSScriptRoot "tauri\src-tauri\target\release\mdtiger-spike-tauri.exe" }
        "wpf"   { Join-Path $PSScriptRoot "wpf\publish\MdTigerSpikeWpf.exe" }
    }
}
$exe = $Exe
if (-not (Test-Path $exe)) { throw "Build the $Shell shell first: $exe not found" }
$Document = (Resolve-Path $Document).Path
$resultFile = Join-Path ([IO.Path]::GetTempPath()) "mdtiger-spike-ready.txt"

$env:MDTIGER_SPIKE_EXIT_ON_READY = "1"
$env:MDTIGER_SPIKE_RESULT = $resultFile
$rows = @()
try {
    for ($i = 1; $i -le $Runs; $i++) {
        Remove-Item $resultFile -ErrorAction SilentlyContinue
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $p = Start-Process -FilePath $exe -ArgumentList "`"$Document`"" -PassThru
        if (-not $p.WaitForExit(30000)) { $p.Kill(); Write-Warning "run $i timed out"; continue }
        $sw.Stop()
        $parts = if (Test-Path $resultFile) { (Get-Content $resultFile -Raw).Trim().Split(";") } else { @("", "") }
        $rows += [pscustomobject]@{
            Run       = $i
            ProcessMs = [int]$parts[0]
            NavMs     = [int]$parts[1]
            WallMs    = [int]$sw.ElapsedMilliseconds
        }
        Start-Sleep -Milliseconds 500
    }
}
finally {
    Remove-Item Env:\MDTIGER_SPIKE_EXIT_ON_READY, Env:\MDTIGER_SPIKE_RESULT -ErrorAction SilentlyContinue
}

$rows | Format-Table -AutoSize
$warm = $rows | Select-Object -Skip 1
if ($warm) {
    $sorted = $warm.ProcessMs | Sort-Object
    $median = $sorted[[int][math]::Floor(($sorted.Count - 1) / 2)]
    "{0}: first run {1} ms; warm runs median {2} ms, min {3} ms, max {4} ms (ProcessMs)" -f `
        $Shell, $rows[0].ProcessMs, $median, $sorted[0], $sorted[-1]
}
