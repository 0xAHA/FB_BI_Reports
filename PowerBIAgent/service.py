"""
Windows Service entry point.

Subcommands (passed as first argument):
    wizard          — open the config wizard GUI
    install         — install the Windows Service
    start           — start the service
    stop            — stop the service
    remove          — remove the service
    debug           — run the service loop in the console (no service install needed)

When invoked with no arguments the Service Control Manager takes over.

Build & install:
    pyinstaller FishbowlPBIAgent.spec
    dist\\FishbowlPBIAgent\\FishbowlPBIAgent.exe install
    dist\\FishbowlPBIAgent\\FishbowlPBIAgent.exe start
"""

import configparser
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

import servicemanager
import win32event
import win32service
import win32serviceutil

# Resolve the install directory whether frozen (PyInstaller) or running in dev
BASE_DIR    = os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.ini")


def _setup_logging(log_path: str, level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
            # Rotate at ~1 MB, keep 5 old files (~6 MB total) so the log never
            # grows unbounded — old lines roll into agent.log.1..5, oldest deleted.
            RotatingFileHandler(log_path, maxBytes=1_000_000, backupCount=5,
                                encoding="utf-8"),
        ],
    )


def _read_config() -> dict:
    # interpolation=None: the Power BI push URL contains '%' characters
    # (URL-encoded key) that would otherwise break configparser interpolation.
    cfg = configparser.ConfigParser(interpolation=None)
    cfg.read(CONFIG_PATH)
    return {
        "base_url": cfg.get("fishbowl", "base_url",  fallback="http://localhost:2456"),
        "app_name": cfg.get("fishbowl", "app_name",  fallback="PowerBI Agent"),
        "app_id":   cfg.getint("fishbowl", "app_id", fallback=200),
        "username": cfg.get("fishbowl", "username",  fallback=""),
        "enc_pass": cfg.get("secrets",  "password_enc", fallback=""),
        "push_url": cfg.get("powerbi",  "push_url",  fallback=""),
        "interval": cfg.getint("agent", "sync_interval_minutes", fallback=15),
        "log_file": cfg.get("agent",    "log_file",
                            fallback=os.path.join(BASE_DIR, "agent.log")),
        # INFO = one summary line per cycle (default). Set to DEBUG in config.ini
        # under [agent] for the full step-by-step, or WARNING for errors only.
        "log_level": cfg.get("agent",   "log_level", fallback="INFO"),
    }


class FishbowlPBIService(win32serviceutil.ServiceFramework):
    _svc_name_         = "FishbowlPowerBIAgent"
    _svc_display_name_ = "Fishbowl Power BI Agent"
    _svc_description_  = "Syncs Fishbowl data to a Power BI streaming dataset on a schedule."

    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)
        self._stop_event = win32event.CreateEvent(None, 0, 0, None)

    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        win32event.SetEvent(self._stop_event)

    def SvcDoRun(self):
        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STARTED,
            (self._svc_name_, ""),
        )
        _run_loop(self._stop_event)


def _run_loop(stop_event=None) -> None:
    """
    Main sync loop — shared between the Windows Service and --debug mode.
    stop_event: a win32event handle (service mode) or None (debug/console mode).
    """
    try:
        cfg = _read_config()
    except Exception:
        # config.ini missing/malformed — log to the default location and exit
        # cleanly rather than crashing the service with no diagnostic.
        _setup_logging(os.path.join(BASE_DIR, "agent.log"))
        logging.getLogger(__name__).exception(
            "Could not read config.ini — run the wizard (Configure Agent) to set it up")
        return

    level = getattr(logging, str(cfg["log_level"]).upper(), logging.INFO)
    _setup_logging(cfg["log_file"], level)
    logger = logging.getLogger(__name__)

    import credentials
    from fishbowl_client import FishbowlClient
    from powerbi_client  import PowerBIClient
    from sync            import run_all

    if not cfg["enc_pass"]:
        logger.error("No password found in config.ini — run the wizard first.")
        return
    if not cfg["push_url"]:
        logger.error("No Power BI push URL in config.ini — run the wizard first.")
        return

    try:
        password = credentials.decrypt(cfg["enc_pass"])
    except Exception:
        logger.exception(
            "Could not decrypt the stored password. config.ini/agent.key may have "
            "been copied from another machine or are corrupt — re-run the wizard "
            "(Configure Agent) to re-enter credentials.")
        return

    fb  = FishbowlClient(cfg["base_url"], cfg["app_name"], cfg["app_id"],
                         credentials=(cfg["username"], password))
    pbi = PowerBIClient(cfg["push_url"])

    # Clamp to >= 1 minute so a misconfigured 0/negative interval can't spin the
    # loop into a busy-wait that hammers Fishbowl and Power BI.
    interval = max(1, cfg["interval"])
    interval_ms = interval * 60 * 1000

    logger.info("Fishbowl → Power BI Agent started  (interval: %d min)", interval)

    while True:
        try:
            run_all(fb, pbi)
        except Exception:
            logger.exception("Sync failed — will retry at next interval")

        if stop_event is not None:
            # Service mode: block until interval elapses or stop is signalled
            rc = win32event.WaitForSingleObject(stop_event, interval_ms)
            if rc == win32event.WAIT_OBJECT_0:
                break
        else:
            # Debug / console mode: plain sleep
            import time
            time.sleep(interval * 60)

    logger.info("Agent stopped")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "wizard":
        import wizard
        wizard.run()
        sys.exit(0)

    if len(sys.argv) > 1 and sys.argv[1] == "debug":
        # Run the loop in the console without installing a service
        _run_loop(stop_event=None)
        sys.exit(0)

    if len(sys.argv) == 1:
        # Invoked by the Service Control Manager
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(FishbowlPBIService)
        servicemanager.StartServiceCtrlDispatcher()
    else:
        # install / start / stop / remove / update
        win32serviceutil.HandleCommandLine(FishbowlPBIService)
