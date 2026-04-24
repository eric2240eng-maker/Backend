from pymongo import MongoClient
from datetime import datetime, timezone, timedelta
from config import Config
from anomaly.detector import detect_anomalies
from anomaly.alert_sender import check_aqi_and_alert
from analytics.summary import summarize
from analytics.forecast import simple_forecast

def _client():
    return MongoClient(Config.MONGO_URI)

def _fetch(db, since: datetime = None, limit=2000):
    """
    Fetch readings and flatten to a simple structure expected by downstream analytics:
    { value: <numeric>, sensor: <str>, _id: <ObjectId>, timestamp: <datetime> }
    Using pm25 as the representative metric for AI summary/forecast.
    """
    coll = db[Config.MONGO_COLLECTION]
    q = {}
    if since:
        q['timestamp'] = {'$gt': since}
    docs = list(coll.find(q).sort('timestamp', 1).limit(limit))
    out = []
    for d in docs:
        metrics = d.get('metrics') or {}
        val = metrics.get('pm25')
        if isinstance(val, (int, float)):
            out.append({
                'value': float(val),
                'sensor': d.get('location'),
                '_id': d.get('_id'),
                'timestamp': d.get('timestamp')
            })
    return out

def run_once():
    client = _client()
    db = client[Config.MONGO_DB]
    readings = _fetch(db, since=datetime.utcnow() - timedelta(minutes=60))
    
    # Check AQI and send alerts if thresholds exceeded
    if readings:
        check_aqi_and_alert(readings)
    
    # Anomalies
    anomalies = detect_anomalies(readings)
    if anomalies:
        db['analytics_anomalies'].insert_many(anomalies)
    # Summary
    summary_doc = summarize(readings)
    if summary_doc:
        db['analytics_summary'].insert_one(summary_doc)
    # Forecast
    forecast = simple_forecast(readings)
    if forecast:
        db['analytics_forecast'].insert_one({
            'generated_at': datetime.utcnow(),
            'horizon': Config.FORECAST_HORIZON,
            'points': forecast
        })
    client.close()

if __name__ == "__main__":
    run_once()