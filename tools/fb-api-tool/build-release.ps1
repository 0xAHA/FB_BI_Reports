# Production builds for both Windows architectures.
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
# Not trimmed. WPF resolves controls, templates and converters by name at
# runtime, so the trimmer cannot see what is reachable and removes things that
# crash on a screen nobody happened to open during the build.

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

foreach ($rid in 'win-x64', 'win-arm64') {
    Write-Host "building $rid..." -ForegroundColor Cyan
    dotnet publish FbApiTool.csproj -c Release -r $rid -o "dist\$rid" --nologo --self-contained `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:EnableCompressionInSingleFile=true `
        -p:PublishReadyToRun=true
    if ($LASTEXITCODE -ne 0) { throw "$rid failed" }
}

foreach ($rid in 'win-x64', 'win-arm64') {
    $exe = Get-Item "dist\$rid\FbApiTool.exe"
    '{0,-10} {1,-8} {2:N1} MB' -f $rid, $exe.VersionInfo.FileVersion, ($exe.Length / 1MB)
}

