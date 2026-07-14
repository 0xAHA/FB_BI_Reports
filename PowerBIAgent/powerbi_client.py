import logging
import time

import requests

logger = logging.getLogger(__name__)

# Power BI streaming-dataset throughput limits we pace against:
#   - 10,000 rows max per single POST
#   - ~1,000,000 rows/hour per dataset
#   - the real-time dashboard tile warns if rows arrive too fast in a burst
# Pushing smaller chunks with a pause between them keeps the ingestion rate low
# enough that the tile stops complaining, at the cost of a slightly slower load.
ROWS_PER_REQUEST   = 1000   # rows per POST (must stay <= 10,000)
PAUSE_BETWEEN_POSTS = 1.0   # seconds between POSTs — ~1 request/sec


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
            logger.debug("No rows to push — skipping")
            return

        pushed = 0
        for i in range(0, len(rows), ROWS_PER_REQUEST):
            batch = rows[i:i + ROWS_PER_REQUEST]
            response = requests.post(self.push_url, json=batch, timeout=30)
            if not response.ok:
                # raise_for_status() drops the response body, but Power BI puts
                # the real reason there (e.g. a column name/type that doesn't
                # match the dataset schema). Surface it before raising.
                logger.error("Power BI rejected the push — HTTP %s: %s",
                             response.status_code, (response.text or "").strip()[:1000])
                logger.error("Columns sent: %s", list(batch[0].keys()) if batch else [])
                response.raise_for_status()
            pushed += len(batch)
            logger.debug("Pushed %d/%d row(s) to Power BI", pushed, len(rows))
            if i + ROWS_PER_REQUEST < len(rows):
                time.sleep(PAUSE_BETWEEN_POSTS)   # throttle to ~1 request/sec
