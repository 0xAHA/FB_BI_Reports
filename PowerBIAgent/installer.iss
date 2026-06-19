; Inno Setup 6 script — Fishbowl Power BI Agent
; Download Inno Setup: https://jrsoftware.org/isinfo.php
;
; Build steps:
;   1. pyinstaller FishbowlPBIAgent.spec
;   2. Open this file in Inno Setup Compiler and click Build → Compile
;   3. Distribute the resulting FishbowlPowerBIAgent-Setup.exe

[Setup]
AppName=Fishbowl Power BI Agent
AppVersion=1.0.0
AppPublisher=Your Company Name
DefaultDirName={autopf}\Fishbowl Power BI Agent
DefaultGroupName=Fishbowl Power BI Agent
OutputBaseFilename=FishbowlPowerBIAgent-Setup
OutputDir=installer_output
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
UninstallDisplayName=Fishbowl Power BI Agent
UninstallDisplayIcon={app}\FishbowlPBIAgent.exe
WizardStyle=modern
; Minimum: Windows 10 (required for modern DPAPI behaviour)
MinVersion=10.0
ArchitecturesInstallIn64BitMode=x64compatible
; Do not allow downgrade installs silently
AppMutex=FishbowlPBIAgent_Setup

[Messages]
; Shown on the final installer page
FinishedLabel=The Fishbowl Power BI Agent has been installed.%n%nThe configuration wizard will open next so you can enter your server and Power BI settings.

[Files]
; Everything produced by PyInstaller — includes Python runtime and all dependencies
Source: "dist\FishbowlPBIAgent\*"; DestDir: "{app}"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start Menu shortcuts
Name: "{group}\Configure Agent";    Filename: "{app}\FishbowlPBIAgent.exe"; Parameters: "wizard"
Name: "{group}\View Log";           Filename: "{app}\agent.log";            WorkingDir: "{app}"
Name: "{group}\Uninstall Agent";    Filename: "{uninstallexe}"

[Run]
; ── Step 1: Open config wizard (user can tick/untick on the final page) ──
Filename: "{app}\FishbowlPBIAgent.exe"; \
    Parameters: "wizard"; \
    Description: "Configure connection settings now (recommended)"; \
    Flags: postinstall skipifsilent waituntilterminated nowait

; ── Step 2: Install the Windows Service ──────────────────────────────────
Filename: "{app}\FishbowlPBIAgent.exe"; \
    Parameters: "install"; \
    Flags: runhidden waituntilterminated

; ── Step 3: Start the service ────────────────────────────────────────────
Filename: "{app}\FishbowlPBIAgent.exe"; \
    Parameters: "start"; \
    Flags: runhidden waituntilterminated

[UninstallRun]
; ── Stop the service first ───────────────────────────────────────────────
Filename: "{app}\FishbowlPBIAgent.exe"; \
    Parameters: "stop"; \
    Flags: runhidden waituntilterminated; \
    RunOnceId: "StopService"

; ── Remove the service registration ─────────────────────────────────────
Filename: "{app}\FishbowlPBIAgent.exe"; \
    Parameters: "remove"; \
    Flags: runhidden waituntilterminated; \
    RunOnceId: "RemoveService"

[UninstallDelete]
; Remove the entire install folder (includes log, config.ini, and all binaries)
Type: filesandordirs; Name: "{app}"

[Code]
// Stop the running service before files are overwritten on upgrade.
// This runs before [Files] are copied, so the exe can be replaced cleanly.
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssInstall then
  begin
    Exec(ExpandConstant('{app}\FishbowlPBIAgent.exe'), 'stop',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    // Ignore ResultCode — service may already be stopped
  end;
end;

// Warn the user that config.ini and agent.log will also be removed.
function InitializeUninstall(): Boolean;
var
  Response: Integer;
begin
  Response := MsgBox(
    'This will stop and remove the Fishbowl Power BI Agent service ' +
    'and delete all installed files, including config.ini and agent.log.' + #13#10 + #13#10 +
    'Continue with uninstall?',
    mbConfirmation, MB_YESNO
  );
  Result := (Response = IDYES);
end;
