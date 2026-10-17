; Inno Setup 6 script — Fishbowl Power BI Agent
; Download Inno Setup: https://jrsoftware.org/isinfo.php
;
; Build steps:
;   1. pyinstaller FishbowlPBIAgent.spec
;   2. Open this file in Inno Setup Compiler and click Build → Compile
;   3. Distribute the resulting FishbowlPowerBIAgent-Setup.exe

[Setup]
AppName=Fishbowl Power BI Agent
AppVersion=0.0.1
AppPublisher=0xAHA
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
; Shown as a wizard page near the start (Power BI prerequisites the user must
; complete first) and after install completes (Fishbowl app-approval workflow).
InfoBeforeFile=INSTALL_BEFORE.txt
InfoAfterFile=INSTALL_AFTER.txt
; Minimum: Windows 10 (required for modern DPAPI behaviour)
MinVersion=10.0
ArchitecturesInstallIn64BitMode=x64compatible
; Do not allow downgrade installs silently
AppMutex=FishbowlPBIAgent_Setup

[Messages]
; Shown on the final installer page
FinishedLabel=The Fishbowl Power BI Agent has been installed, configured, and started as a Windows service.%n%nYou can change settings any time from Start Menu → Configure Agent.

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
; These run in order during setup. The wizard MUST finish (writing config.ini)
; before the service is installed and started, otherwise the service starts
; with no configuration. skipifsilent lets unattended installs skip the GUI.

; ── Step 1: Configure — opens the wizard; setup waits until it closes ─────
Filename: "{app}\FishbowlPBIAgent.exe"; \
    Parameters: "wizard"; \
    StatusMsg: "Waiting for configuration to be saved..."; \
    Flags: waituntilterminated skipifsilent

; ── Step 2: Lock down the secret-bearing files ──────────────────────────
; config.ini holds the Power BI key + DPAPI blob; agent.key is the DPAPI
; entropy. Remove inherited ACEs (which grant 'Users' read under Program
; Files) and grant only SYSTEM + Administrators, so standard local users
; cannot read either file. Runs after the wizard creates them; harmless and
; ignored if they don't exist (e.g. wizard cancelled). SIDs used for locale
; independence: S-1-5-18 = SYSTEM, S-1-5-32-544 = Administrators.
Filename: "{sys}\icacls.exe"; \
    Parameters: """{app}\config.ini"" /inheritance:r /grant:r ""*S-1-5-18:(F)"" ""*S-1-5-32-544:(F)"""; \
    StatusMsg: "Securing configuration..."; \
    Flags: runhidden waituntilterminated skipifsilent
Filename: "{sys}\icacls.exe"; \
    Parameters: """{app}\agent.key"" /inheritance:r /grant:r ""*S-1-5-18:(F)"" ""*S-1-5-32-544:(F)"""; \
    Flags: runhidden waituntilterminated skipifsilent

; ── Step 3: Install the Windows Service (automatic, delayed start) ───────
; --startup delayed = Automatic (Delayed Start): survives reboots and waits
; for networking to settle before starting, so Fishbowl is reachable.
Filename: "{app}\FishbowlPBIAgent.exe"; \
    Parameters: "--startup delayed install"; \
    StatusMsg: "Installing the Windows service..."; \
    Flags: runhidden waituntilterminated

; ── Step 4: Start the service ────────────────────────────────────────────
Filename: "{app}\FishbowlPBIAgent.exe"; \
    Parameters: "start"; \
    StatusMsg: "Starting the service..."; \
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
