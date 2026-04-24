import os
from pathlib import Path
try:
    from dotenv import load_dotenv
except ImportError:
    # if dotenv isn't installed, skip loading .env silently
    def load_dotenv(*args, **kwargs):
        return False


# Attempt to load the anomaly .env if present so we reuse the same Mongo config
_root = Path(__file__).resolve().parent
_anomaly_env = _root / 'anomaly' / '.env'
if _anomaly_env.exists():
    load_dotenv(_anomaly_env.as_posix())
else:
    load_dotenv()  # fallback to any default .env on path


class Config:
    # Mongo (prefer environment vars; fallback to local)
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/airquality")
    MONGO_DB = os.getenv("MONGO_DB", "airquality")
    MONGO_COLLECTION = os.getenv("MONGO_COLLECTION", "readings")

    # Analytics
    POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", 60))
    MONITOR_WINDOW_SECONDS = int(os.getenv("MONITOR_WINDOW_SECONDS", 300))
    ANOMALY_ZSCORE_THRESHOLD = float(os.getenv("ANOMALY_ZSCORE_THRESHOLD", 3.0))
    FORECAST_HORIZON = int(os.getenv("FORECAST_HORIZON", 12))          # number of future intervals
    SUMMARY_INTERVAL_MINUTES = int(os.getenv("SUMMARY_INTERVAL_MINUTES", 15))  # aggregation bucket size

    # AQI Thresholds (EPA Standards)
    AQI_ALERT_WARNING = int(os.getenv("AQI_ALERT_WARNING", 100))       # Moderate level
    AQI_ALERT_CRITICAL = int(os.getenv("AQI_ALERT_CRITICAL", 150))     # Unhealthy for Sensitive Groups
    AQI_ALERT_SEVERE = int(os.getenv("AQI_ALERT_SEVERE", 200))         # Unhealthy level