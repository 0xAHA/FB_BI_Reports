"""
Run this script once (as the user who will run the agent) to store Fishbowl
credentials securely in Windows Credential Manager.

    python setup_credentials.py

Credentials are encrypted by Windows DPAPI and tied to the current Windows user
account. They are never written to disk as plaintext.

To update credentials later, just run this script again.
To view stored credentials: Windows Credential Manager → Windows Credentials → fishbowl-powerbi-agent
"""

import getpass
import sys

import keyring

SERVICE_NAME = "fishbowl-powerbi-agent"


def setup():
    print("Fishbowl → Power BI Agent — Credential Setup")
    print("Credentials will be stored encrypted in Windows Credential Manager.\n")

    username = input("Fishbowl username: ").strip()
    if not username:
        print("Username cannot be empty.")
        sys.exit(1)

    password = getpass.getpass("Fishbowl password: ")
    if not password:
        print("Password cannot be empty.")
        sys.exit(1)

    keyring.set_password(SERVICE_NAME, "username", username)
    keyring.set_password(SERVICE_NAME, "password", password)

    print("\nCredentials stored successfully.")
    print("Verify in: Windows Credential Manager → Windows Credentials → fishbowl-powerbi-agent")


if __name__ == "__main__":
    setup()
