import logging
import time

import keyring
import requests

logger = logging.getLogger(__name__)

SERVICE_NAME = "fishbowl-powerbi-agent"


class FishbowlClient:
    """
    Authenticated HTTP client for the Fishbowl Advanced REST API.
    Handles login, token caching, and automatic re-auth on expiry.

    Before first use, run setup_credentials.py to store credentials in
    Windows Credential Manager.
    """

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self._token: str | None = None
        self._token_expiry: float = 0.0

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

    def _authenticate(self) -> None:
        username, password = self._load_credentials()

        # TODO: confirm the exact auth endpoint and request body from
        #       http://<your-server>:2456/apidocs
        response = self.session.post(
            f"{self.base_url}/api/login",
            json={"username": username, "password": password},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()

        # TODO: confirm token field name from the actual auth response.
        #       Common names: "token", "access_token", "accessToken"
        self._token = data.get("token") or data.get("access_token") or data.get("accessToken")
        if not self._token:
            raise RuntimeError(
                f"Auth response did not contain a token. "
                f"Fields returned: {list(data.keys())}"
            )

        # Use server-provided expiry if available, otherwise assume 1 hour
        expires_in = (
            data.get("expiresIn")
            or data.get("expires_in")
            or data.get("expiresInSeconds")
            or 3600
        )
        self._token_expiry = time.time() + int(expires_in)
        logger.info("Authenticated to Fishbowl REST API")

    def _get_token(self) -> str:
        if time.time() >= self._token_expiry - 60:   # refresh 60 s before expiry
            self._authenticate()
        return self._token  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------

    def get(self, path: str, params: dict | None = None) -> dict | list:
        """GET request. Returns parsed JSON."""
        headers = {"Authorization": f"Bearer {self._get_token()}"}
        response = self.session.get(
            f"{self.base_url}{path}",
            params=params,
            headers=headers,
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def post(self, path: str, body: dict | None = None) -> dict | list:
        """POST request. Returns parsed JSON."""
        headers = {"Authorization": f"Bearer {self._get_token()}"}
        response = self.session.post(
            f"{self.base_url}{path}",
            json=body,
            headers=headers,
            timeout=60,
        )
        response.raise_for_status()
        return response.json()
