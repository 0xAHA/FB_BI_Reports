# Non-sensitive configuration — safe to commit.
# Secrets (username/password) are stored in Windows Credential Manager via setup_credentials.py

FISHBOWL_BASE_URL = "http://localhost:2456"   # change if Fishbowl runs on a different host/port

# App identity registered in Fishbowl → Setup → Settings → Integrated Apps.
# An admin must approve the app there before the first login will succeed.
FISHBOWL_APP_NAME = "PowerBI Agent"
FISHBOWL_APP_ID   = 200   # any integer not already used by another app in your Fishbowl

POWERBI_PUSH_URL = ""   # paste your streaming dataset push URL from app.powerbi.com here

SYNC_INTERVAL_MINUTES = 15

LOG_FILE = "agent.log"
