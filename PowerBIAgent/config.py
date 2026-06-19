# Non-sensitive configuration — safe to commit.
# Secrets (username/password) are stored in Windows Credential Manager via setup_credentials.py

FISHBOWL_BASE_URL = "http://localhost:2456"   # change if Fishbowl runs on a different host/port

POWERBI_PUSH_URL = ""   # paste your streaming dataset push URL from app.powerbi.com here

SYNC_INTERVAL_MINUTES = 15

LOG_FILE = "agent.log"
