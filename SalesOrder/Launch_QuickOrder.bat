@echo off
title Fishbowl Quick Order Launcher
:: Optional argument: the report to open, defaulting to v1.0.
::   Launch_QuickOrder.bat QuickOrder_v1.2.htm
set "REPORT=%~1"
if "%REPORT%"=="" set "REPORT=QuickOrder.htm"
set "FILE=%~dp0%REPORT%"
set "TMPDIR=%TEMP%\FBQuickOrder"

if not exist "%FILE%" (
  echo ERROR: No such report next to this launcher:
  echo   %FILE%
  echo.
  pause
  exit /b 1
)

echo =========================================
echo  Fishbowl Quick Order (Standalone)
echo =========================================
echo.
echo Report: %REPORT%
echo.
echo Opens the report with CORS security disabled
echo so it can reach your Fishbowl server's REST
echo API. Uses a separate temporary browser profile
echo so your normal browsing is unaffected.
echo.
echo NOTE: Sales-order creation is DISABLED in
echo standalone mode - the Create button stays
echo greyed out. Browse the catalogue, price it up
echo and build quotes here; submit from the Fishbowl
echo desktop client.
echo.
echo It is NOT fully read-only though: marking a
echo product as a customer favourite writes back to
echo the customer record on the server you log in to.
echo.

:: ---- Try Google Chrome ----
set "CHROME="
for %%P in (
  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
  "%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"
  "%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"
) do if exist %%P if not defined CHROME set "CHROME=%%P"

if defined CHROME (
  echo Found Chrome: %CHROME%
  echo Launching...
  start "" %CHROME% ^
    --disable-web-security ^
    --allow-file-access-from-files ^
    --user-data-dir="%TMPDIR%\Chrome" ^
    "%FILE%"
  goto :done
)

:: ---- Try Microsoft Edge ----
set "EDGE="
for %%P in (
  "%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe"
  "%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe"
  "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
) do if exist %%P if not defined EDGE set "EDGE=%%P"

if defined EDGE (
  echo Found Edge: %EDGE%
  echo Launching...
  start "" %EDGE% ^
    --disable-web-security ^
    --allow-file-access-from-files ^
    --user-data-dir="%TMPDIR%\Edge" ^
    "%FILE%"
  goto :done
)

:: ---- Not found ----
echo ERROR: Chrome or Edge not found in standard locations.
echo.
echo To launch manually, run one of:
echo.
echo Chrome:
echo   chrome.exe --disable-web-security --allow-file-access-from-files --user-data-dir="%TMPDIR%\Chrome" "%FILE%"
echo.
echo Edge:
echo   msedge.exe --disable-web-security --allow-file-access-from-files --user-data-dir="%TMPDIR%\Edge" "%FILE%"
echo.
pause
exit /b 1

:done
echo Done. The browser should open momentarily.
timeout /t 2 /nobreak >nul
exit /b 0
