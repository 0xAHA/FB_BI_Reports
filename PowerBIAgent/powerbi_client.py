import logging

import requests

logger = logging.getLogger(__name__)


class PowerBIClient:
    """
    Pushes rows to a Power BI streaming dataset push URL.

    Create a streaming dataset at app.powerbi.com:
        Workspaces → My workspace → + New → Streaming dataset → API
    Define your columns there, then paste the push URL into config.py.

    The push URL already contains an API key — no OAuth needed.
    """

    def __init__(self, push_url: str):
        if not push_url:
            raise ValueError(
                "POWERBI_PUSH_URL is not set in config.py. "
                "Create a streaming dataset in Power BI and paste the push URL."
            )
        self.push_url = push_url

    def push_rows(self, rows: list[dict]) -> None:
        """
        Push a list of dicts to Power BI. Dict keys must match the column names
        defined in your streaming dataset exactly (case-sensitive).
        """
        if not rows:
            logger.info("No rows to push — skipping")
            return

        response = requests.post(self.push_url, json=rows, timeout=30)
        response.raise_for_status()
        logger.info("Pushed %d row(s) to Power BI", len(rows))
