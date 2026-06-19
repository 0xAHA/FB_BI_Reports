# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for the Fishbowl → Power BI Agent.
#
# Prerequisites:
#   pip install pyinstaller pywin32 keyring requests schedule
#
# Build:
#   pyinstaller FishbowlPBIAgent.spec
#
# Output: dist\FishbowlPBIAgent\FishbowlPBIAgent.exe
# Feed that folder to installer.iss to produce the setup exe.

block_cipher = None

a = Analysis(
    ['service.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=[
        # pywin32 — required for service framework and DPAPI
        'win32timezone',
        'win32api',
        'win32con',
        'win32security',
        'win32event',
        'win32service',
        'win32serviceutil',
        'win32crypt',
        'pywintypes',
        'servicemanager',
        # keyring — fallback for dev/standalone mode
        'keyring',
        'keyring.backends.Windows',
        'keyring.backends.null',
        # agent modules
        'credentials',
        'wizard',
        'fishbowl_client',
        'powerbi_client',
        'sync',
        # stdlib / third-party
        'configparser',
        'tkinter',
        'tkinter.messagebox',
        'requests',
        'schedule',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='FishbowlPBIAgent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,    # must be True — Windows Services require a console executable
    icon=None,       # replace with 'icon.ico' if you have one
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='FishbowlPBIAgent',
)
