# build.ps1 — build the agent exe + installer, then delete all temp artifacts.
#
# Run from the PowerBIAgent folder:
#     .\build.ps1
#
# Produces:  installer_output\FishbowlPowerBIAgent-Setup.exe
# Cleans up: the PyInstaller build cache and temp workpath (the scratch files
#            that antivirus tends to flag), so nothing transient is left behind.

$ErrorActionPreference = "Stop"
$pa   = $PSScriptRoot
$work = Join-Path $env:TEMP "fbpbi_build"
$dist = Join-Path $pa "dist"

# Locate the Inno Setup compiler (v7 or v6).
$iscc = @(
    "$env:ProgramFiles\Inno Setup 7\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 7\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "ISCC.exe not found - install Inno Setup from https://jrsoftware.org/isinfo.php" }

Write-Host "[1/4] Clearing old build output..." -ForegroundColor Cyan
Remove-Item -Recurse -Force (Join-Path $pa "build"), $dist, $work -ErrorAction SilentlyContinue

Write-Host "[2/4] Building exe (PyInstaller)..." -ForegroundColor Cyan
# --workpath in TEMP keeps the volatile build cache out of the OneDrive-synced
# project folder (avoids file locks and sync churn).
python -m PyInstaller --noconfirm --workpath $work --distpath $dist (Join-Path $pa "FishbowlPBIAgent.spec")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed (exit $LASTEXITCODE)" }

Write-Host "[3/4] Building installer (Inno Setup)..." -ForegroundColor Cyan
& $iscc (Join-Path $pa "installer.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed (exit $LASTEXITCODE)" }

Write-Host "[4/4] Cleaning up temp build artifacts..." -ForegroundColor Cyan
# Remove the scratch dirs AV tends to flag. 'dist' is kept so you can test the
# raw exe; uncomment the next line to remove it too once the installer is built.
Remove-Item -Recurse -Force $work, (Join-Path $pa "build") -ErrorAction SilentlyContinue
# Remove-Item -Recurse -Force $dist -ErrorAction SilentlyContinue

$setup = Join-Path $pa "installer_output\FishbowlPowerBIAgent-Setup.exe"
Write-Host "Done. Installer: $setup" -ForegroundColor Green
