"""
Machine-scope DPAPI credential storage.

Encrypts the Fishbowl password with the LOCAL_MACHINE key so it can be
decrypted by a Windows Service running as SYSTEM. A per-installation random
secret (agent.key) is mixed in as DPAPI optional-entropy, so the encrypted
blob in config.ini cannot be decrypted without ALSO holding agent.key — even
by another local account on the same machine. The installer restricts both
files' ACLs to SYSTEM + Administrators (see installer.iss).

This is different from keyring (which uses the current *user* scope and is
inaccessible to SYSTEM or other service accounts).
"""

import base64
import os
import sys

import win32crypt

_DESCRIPTION = "FishbowlPBIAgent"
_LOCAL_MACHINE_FLAG = 0x04   # CRYPTPROTECT_LOCAL_MACHINE

# Per-install entropy lives next to config.ini in the install dir. Resolve the
# same way whether frozen (PyInstaller) or running from source.
BASE_DIR     = os.path.dirname(sys.executable if getattr(sys, "frozen", False)
                               else os.path.abspath(__file__))
ENTROPY_PATH = os.path.join(BASE_DIR, "agent.key")


def _load_entropy(create: bool) -> bytes:
    """
    Return the per-install entropy bytes.

    create=True  (encrypt path): generate and persist a new 32-byte secret if
                 the file is missing.
    create=False (decrypt path): the file must already exist; a missing or
                 truncated file raises so the caller can surface a clear
                 "re-run the wizard" error instead of silently using a wrong key.
    """
    if os.path.exists(ENTROPY_PATH):
        with open(ENTROPY_PATH, "rb") as f:
            data = f.read()
        if len(data) >= 16:
            return data
        if not create:
            raise ValueError(f"Entropy file {ENTROPY_PATH} is present but corrupt")

    if not create:
        raise FileNotFoundError(
            f"Entropy file not found: {ENTROPY_PATH}. The stored password cannot "
            f"be decrypted without it — re-run the wizard to reconfigure."
        )

    entropy = os.urandom(32)
    with open(ENTROPY_PATH, "wb") as f:
        f.write(entropy)
    return entropy


def encrypt(plaintext: str) -> str:
    """Return a base64 string suitable for storing in config.ini."""
    entropy = _load_entropy(create=True)
    blob = win32crypt.CryptProtectData(
        plaintext.encode("utf-8"),
        _DESCRIPTION,
        entropy, None, None,
        _LOCAL_MACHINE_FLAG,
    )
    return base64.b64encode(blob).decode("ascii")


def decrypt(encrypted_b64: str) -> str:
    """Decrypt a value previously encrypted with encrypt()."""
    entropy = _load_entropy(create=False)
    blob = base64.b64decode(encrypted_b64)
    _, plaintext_bytes = win32crypt.CryptUnprotectData(
        blob, entropy, None, None, 0
    )
    return plaintext_bytes.decode("utf-8")
