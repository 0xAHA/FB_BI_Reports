"""
Fishbowl → Power BI Agent
--------------------------
Fetches data from the Fishbowl REST API on a schedule and pushes it to a
Power BI streaming dataset.

Setup (run once):
    pip install -r requirements.txt
    python setup_credentials.py

Run:
    python main.py

The agent runs until Ctrl+C. Logs go to console and agent.log.
"""

import logging
import time

import schedule

import config
from fishbowl_client import FishbowlClient
from powerbi_client import PowerBIClient
from sync import run_all

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(config.LOG_FILE, encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


def main() -> None:
    logger.info("Fishbowl → Power BI Agent starting")
    logger.info("Server: %s | Interval: %d min", config.FISHBOWL_BASE_URL, config.SYNC_INTERVAL_MINUTES)

    fb = FishbowlClient(config.FISHBOWL_BASE_URL, config.FISHBOWL_APP_NAME, config.FISHBOWL_APP_ID)
    pbi = PowerBIClient(config.POWERBI_PUSH_URL)

    def job() -> None:
        try:
            run_all(fb, pbi)
        except Exception:
            logger.exception("Sync failed — will retry at next interval")

    # Run immediately on startup, then on schedule
    job()
    schedule.every(config.SYNC_INTERVAL_MINUTES).minutes.do(job)
    logger.info("Press Ctrl+C to stop")

    while True:
        schedule.run_pending()
        time.sleep(10)


if __name__ == "__main__":
    main()
