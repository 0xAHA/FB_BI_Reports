"""
Machine-scope DPAPI credential storage.

Encrypts the Fishbowl password with the LOCAL_MACHINE key so it can be
decrypted by any process on this machine — including a Windows Service
running as SYSTEM. The encrypted blob is stored as base64 in config.ini.

This is different from keyring (which uses the current *user* scope and is
inaccessible to SYSTEM or other service accounts).
"""

import base64
import win32crypt

_DESCRIPTION = "FishbowlPBIAgent"
_LOCAL_MACHINE_FLAG = 0x04   # CRYPTPROTECT_LOCAL_MACHINE


def encrypt(plaintext: str) -> str:
    """Return a base64 string suitable for storing in config.ini."""
    blob = win32crypt.CryptProtectData(
        plaintext.encode("utf-8"),
        _DESCRIPTION,
        None, None, None,
        _LOCAL_MACHINE_FLAG,
    )
    return base64.b64encode(blob).decode("ascii")


def decrypt(encrypted_b64: str) -> str:
    """Decrypt a value previously encrypted with encrypt()."""
    blob = base64.b64decode(encrypted_b64)
    _, plaintext_bytes = win32crypt.CryptUnprotectData(
        blob, None, None, None, 0
    )
    return plaintext_bytes.decode("utf-8")
