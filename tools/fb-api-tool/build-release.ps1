# Production builds, for every architecture and both front ends.
#
# Self-contained, so the tool runs on a machine with no .NET installed: it gets
# handed to whoever is debugging a Fishbowl server, and "install a runtime
# first" is how a diagnostic tool ends up not being used.
#
# Single-file, so what gets shared is one attachment. The catalog and both
# guides are ALSO embedded in the exe, so a copy on its own still has its
# endpoints and its documentation; the assets\ folder beside it is only there
# for when someone wants to read or edit the catalog by hand.
#
# Not trimmed. Both toolkits resolve controls, templates and converters by name
# at runtime, so the trimmer cannot see what is reachable and removes things
# that crash on a screen nobody happened to open during the build.
#
# EVERY executable is named for what it runs on — FbApiTool-win-x64.exe, not
# FbApiTool.exe. Four builds that share one filename are four attachments
# nobody can tell apart once they are out of their folders, and running the
# wrong one fails with a message about the processor rather than about the
# name.

param(
    # 'wpf' is Windows-only and is what shipped as v1.0; 'avalonia' is the
    # cross-platform rebuild. Both by default, so a release is comparable.
    [ValidateSet('both', 'wpf', 'avalonia')]
    [string] $Ui = 'both',

    # Linux builds are Avalonia-only and are off unless asked for, because
    # nothing has yet been run there.
    [switch] $Linux
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# The screenshots live in the Word guide; the help page that ships is generated
# from it. Build it first, so a release can never carry a stale one.
Write-Host 'building the help page...' -ForegroundColor Cyan
node tools\build-help.js
if ($LASTEXITCODE -ne 0) { throw 'help build failed' }

Get-Process FbApiTool -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item dist -Recurse -Force -ErrorAction SilentlyContinue
# A leftover from a previous failure would make the folder ambiguous.
Remove-Item *_wpftmp.csproj -Force -ErrorAction SilentlyContinue

$targets = @()
if ($Ui -in 'both', 'wpf') {
    # WPF is Windows-only by construction — it targets net9.0-windows.
    $targets += [pscustomobject]@{ Ui = 'wpf'; Project = 'FbApiTool.csproj'; Rid = 'win-x64' }
    $targets += [pscustomobject]@{ Ui = 'wpf'; Project = 'FbApiTool.csproj'; Rid = 'win-arm64' }
}
if ($Ui -in 'both', 'avalonia') {
    $targets += [pscustomobject]@{ Ui = 'avalonia'; Project = 'ui\FbApiTool.Ui.csproj'; Rid = 'win-x64' }
    $targets += [pscustomobject]@{ Ui = 'avalonia'; Project = 'ui\FbApiTool.Ui.csproj'; Rid = 'win-arm64' }
    if ($Linux) {
        $targets += [pscustomobject]@{ Ui = 'avalonia'; Project = 'ui\FbApiTool.Ui.csproj'; Rid = 'linux-x64' }
        $targets += [pscustomobject]@{ Ui = 'avalonia'; Project = 'ui\FbApiTool.Ui.csproj'; Rid = 'linux-arm64' }
    }
}

foreach ($t in $targets) {
    $out = "dist\$($t.Ui)-$($t.Rid)"
    Write-Host "building $($t.Ui) $($t.Rid)..." -ForegroundColor Cyan

    dotnet publish $t.Project -c Release -r $t.Rid -o $out --nologo --self-contained `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:EnableCompressionInSingleFile=true `
        -p:PublishReadyToRun=true
    if ($LASTEXITCODE -ne 0) { throw "$($t.Ui) $($t.Rid) failed" }

    # Renamed after publishing rather than through AssemblyName, which would
    # also rename the assembly — and the Avalonia build loads its icon through
    # avares://FbApiTool/, which is keyed on the assembly name.
    $isWindows = $t.Rid.StartsWith('win-')
    $built  = Join-Path $out ($(if ($isWindows) { 'FbApiTool.exe' } else { 'FbApiTool' }))
    $wanted = Join-Path $out ("FbApiTool-$($t.Ui)-$($t.Rid)" + $(if ($isWindows) { '.exe' } else { '' }))

    if (Test-Path $built) {
        Move-Item $built $wanted -Force
    } else {
        throw "no executable at $built"
    }
}

Write-Host ''
foreach ($t in $targets) {
    $out = "dist\$($t.Ui)-$($t.Rid)"
    $exe = Get-ChildItem $out -Filter 'FbApiTool-*' | Select-Object -First 1
    if ($exe) {
        '{0,-46} {1,6:N1} MB' -f $exe.Name, ($exe.Length / 1MB)
    }
}
