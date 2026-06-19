import logging
import urllib.parse

import keyring
import requests

logger = logging.getLogger(__name__)

SERVICE_NAME = "fishbowl-powerbi-agent"


class FishbowlClient:
    """
    Authenticated client for the Fishbowl Advanced REST API.

    Auth:  POST /api/login  →  Bearer token
    Query: GET  /api/data-query?query=<sql>  (same SQL you'd use in a BI report)

    The app (FISHBOWL_APP_NAME / FISHBOWL_APP_ID from config.py) must be
    registered and approved in Fishbowl → Maintenance → Integrated Applications
    before the first login will succeed.

    Token has no server-advertised expiry, so 401 responses trigger a single
    re-auth retry automatically.
    """

    def __init__(self, base_url: str, app_name: str, app_id: int):
        self.base_url = base_url.rstrip("/")
        self.app_name = app_name
        self.app_id   = app_id
        self.session  = requests.Session()
        self._token: str | None = None

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def _load_credentials(self) -> tuple[str, str]:
        username = keyring.get_password(SERVICE_NAME, "username")
        password = keyring.get_password(SERVICE_NAME, "password")
        if not username or not password:
            raise RuntimeError(
                "Credentials not found in Windows Credential Manager. "
                "Run setup_credentials.py first."
            )
        return username, password

    def authenticate(self) -> None:
        """Login and cache the Bearer token. Called automatically on first use or after 401."""
        username, password = self._load_credentials()
        response = self.session.post(
            f"{self.base_url}/api/login",
            json={
                "appName":  self.app_name,
                "appId":    self.app_id,
                "username": username,
                "password": password,
            },
            timeout=30,
        )
        if response.status_code == 401:
            data = {}
            try:
                data = response.json()
            except Exception:
                pass
            msg = data.get("message") or data.get("Message") or "Unauthorized"
            if "approval" in msg.lower():
                raise RuntimeError(
                    f'App "{self.app_name}" (id={self.app_id}) is registered but not yet approved. '
                    "An admin must approve it in Fishbowl → Maintenance → Integrated Applications."
                )
            raise RuntimeError(f"Login failed (401): {msg}")
        response.raise_for_status()
        data = response.json()
        token = data.get("token") or data.get("Token") or data.get("access_token")
        if not token:
            raise RuntimeError(
                f"Login succeeded but response contained no token. Fields: {list(data.keys())}"
            )
        self._token = token
        logger.info("Authenticated to Fishbowl REST API as %s", username)

    def _get_token(self) -> str:
        if not self._token:
            self.authenticate()
        return self._token  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # SQL query  (mirrors runQueryAsync in BI reports)
    # ------------------------------------------------------------------

    def query(self, sql: str) -> list[dict]:
        """
        Run a SELECT query via /api/data-query. Returns a list of dicts with
        lowercase keys — identical behaviour to runQueryAsync in a BI report.
        Automatically re-auths once on 401.
        """
        return self._do_query(sql, retry=True)

    def _do_query(self, sql: str, retry: bool) -> list[dict]:
        url = f"{self.base_url}/api/data-query"
        headers = {"Authorization": f"Bearer {self._get_token()}"}
        response = self.session.get(
            url,
            params={"query": sql},
            headers=headers,
            timeout=60,
        )
        if response.status_code == 401 and retry:
            logger.info("Token rejected (401) — re-authenticating")
            self._token = None
            self.authenticate()
            return self._do_query(sql, retry=False)
        response.raise_for_status()
        rows = response.json()
        return rows if isinstance(rows, list) else rows.get("results", [])
