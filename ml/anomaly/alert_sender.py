# ml/anomaly/alert_sender.py
import smtplib
from email.message import EmailMessage
from twilio.rest import Client as TwilioClient
import requests
from config import Config
from datetime import datetime

def send_email(subject: str, body: str):
    if not Config.SMTP_HOST or not Config.SMTP_USER or not Config.SMTP_PASSWORD:
        print("SMTP not configured; skipping email.")
        return False
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = Config.ALERT_EMAIL_FROM
    msg['To'] = Config.ALERT_EMAIL_TO
    msg.set_content(body)

    try:
        with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT) as s:
            s.starttls()
            s.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
            s.send_message(msg)
        print("Email sent to", Config.ALERT_EMAIL_TO)
        return True
    except Exception as e:
        print("Failed to send email:", e)
        return False

def send_sms(body: str):
    if not Config.USE_TWILIO:
        print("Twilio disabled; skipping SMS.")
        return False
    if not Config.TWILIO_ACCOUNT_SID or not Config.TWILIO_AUTH_TOKEN or not Config.TWILIO_FROM_PHONE:
        print("Twilio not configured; skipping SMS.")
        return False
    try:
        client = TwilioClient(Config.TWILIO_ACCOUNT_SID, Config.TWILIO_AUTH_TOKEN)
        message = client.messages.create(
            body=body,
            from_=Config.TWILIO_FROM_PHONE,
            to=Config.ALERT_SMS_TO
        )
        print("SMS sent:", message.sid)
        return True
    except Exception as e:
        print("Failed to send SMS:", e)
        return False

def post_alert_to_backend(alert_payload: dict):
    url = Config.BACKEND_ALERT_URL
    if not url:
        return False
    try:
        resp = requests.post(url, json=alert_payload, timeout=5)
        print("Posted alert to backend, status:", resp.status_code)
        return True
    except Exception as e:
        print("Failed to post alert to backend:", e)
        return False

# AQI Alert Thresholds (EPA Standards)
AQI_THRESHOLDS = {
    'GOOD': (0, 50, '#00e400'),
    'MODERATE': (51, 100, '#ffff00'),
    'USG': (101, 150, '#ff7e00'),  # Unhealthy for Sensitive Groups
    'UNHEALTHY': (151, 200, '#ff0000'),
    'VERY_UNHEALTHY': (201, 300, '#8f3f97'),
    'HAZARDOUS': (301, 500, '#7e0023')
}

# AQI Alert Thresholds (when to send alerts)
AQI_ALERT_LEVELS = {
    'WARNING': 100,      # Moderate or above
    'CRITICAL': 150,     # Unhealthy for Sensitive Groups or above
    'SEVERE': 200        # Unhealthy or above
}

def calculate_aqi_from_pm25(pm25: float) -> int:
    """Calculate AQI from PM2.5 using EPA formula"""
    if pm25 <= 12:
        return int(round((50 / 12) * pm25))
    elif pm25 <= 35.4:
        return int(round(((100 - 51) / (35.4 - 12.1)) * (pm25 - 12.1) + 51))
    elif pm25 <= 55.4:
        return int(round(((150 - 101) / (55.4 - 35.5)) * (pm25 - 35.5) + 101))
    elif pm25 <= 150.4:
        return int(round(((200 - 151) / (150.4 - 55.5)) * (pm25 - 55.5) + 151))
    elif pm25 <= 250.4:
        return int(round(((300 - 201) / (250.4 - 150.5)) * (pm25 - 150.5) + 201))
    else:
        return int(round(((500 - 301) / (500.4 - 250.5)) * (pm25 - 250.5) + 301))

def get_aqi_category(aqi: int) -> tuple:
    """Get AQI category and color"""
    for category, (low, high, color) in AQI_THRESHOLDS.items():
        if low <= aqi <= high:
            return category, color
    return 'HAZARDOUS', '#7e0023'

def send_aqi_alert(pm25: float, location: str = "Unknown Location", severity: str = "WARNING"):
    """Send email alert when AQI exceeds threshold"""
    aqi = calculate_aqi_from_pm25(pm25)
    category, color = get_aqi_category(aqi)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Build email subject and body
    subject = f"🚨 Air Quality Alert: AQI {aqi} ({category}) at {location}"
    
    body = f"""
Air Quality Alert - {severity}

Location: {location}
Timestamp: {timestamp}

Current AQI: {aqi}
Category: {category}
PM2.5 Level: {pm25:.1f} µg/m³

AQI Category Guide:
- 0-50: Good (Green)
- 51-100: Moderate (Yellow)
- 101-150: Unhealthy for Sensitive Groups (Orange)
- 151-200: Unhealthy (Red)
- 201-300: Very Unhealthy (Purple)
- 301+: Hazardous (Maroon)

Health Recommendations:
"""
    if aqi <= 50:
        body += "✓ Air quality is satisfactory. No restrictions."
    elif aqi <= 100:
        body += "⚠️ Unusually sensitive people should consider limiting outdoor exposure."
    elif aqi <= 150:
        body += "⚠️ Sensitive individuals (children, elderly, those with respiratory/heart conditions) should limit outdoor exposure."
    elif aqi <= 200:
        body += "❌ General public should limit outdoor exposure. Sensitive groups should avoid outdoor activities."
    elif aqi <= 300:
        body += "❌❌ All groups should limit outdoor exposure. Indoor activities recommended."
    else:
        body += "❌❌❌ SEVERE: Avoid outdoor activities. Stay indoors with air purifier if possible."
    
    body += f"""

Alert Severity: {severity}

This is an automated alert from your Air Quality Monitoring System.
Monitor your local conditions and take appropriate action.

Dashboard: https://your-dashboard-url.com
"""
    
    # Send email
    success = send_email(subject, body)
    
    # Also send SMS for critical/severe alerts
    if severity in ['CRITICAL', 'SEVERE']:
        sms_body = f"🚨 Air Quality ALERT: AQI {aqi} ({category}) at {location}. Check dashboard for details."
        send_sms(sms_body)
    
    return success

def check_aqi_and_alert(readings: list):
    """Check readings for high AQI and send alerts if needed"""
    if not readings:
        return False
    
    # Get latest reading
    latest = readings[-1]
    pm25 = latest.get('pm25')
    location = latest.get('location', 'Unknown Location')
    
    if pm25 is None:
        return False
    
    aqi = calculate_aqi_from_pm25(pm25)
    
    # Determine alert severity
    alert_severity = None
    if aqi >= AQI_ALERT_LEVELS['SEVERE']:
        alert_severity = 'SEVERE'
    elif aqi >= AQI_ALERT_LEVELS['CRITICAL']:
        alert_severity = 'CRITICAL'
    elif aqi >= AQI_ALERT_LEVELS['WARNING']:
        alert_severity = 'WARNING'
    
    # Send alert if threshold exceeded
    if alert_severity:
        print(f"AQI Alert triggered: {alert_severity} - AQI {aqi}")
        return send_aqi_alert(pm25, location, alert_severity)
    
    return False

# Sensor health monitoring integration
def process_with_sensor_health(latest_reading: dict, history: list):
    """Enhanced processing with sensor health checks"""
    from sensor_health import check_and_alert_sensor_health
    
    # Check sensor health first
    issues, sensor_status = check_and_alert_sensor_health(latest_reading, history)
    
    return sensor_status, issues


# Optionally call run_once after anomaly alerts to refresh analytics (lazy import to avoid circulars)
def process_and_alert(anomalies, latest_reading=None, history=None):
    """Process anomalies and check sensor health"""
    
    # Check sensor health if data provided
    if latest_reading is not None and history is not None:
        process_with_sensor_health(latest_reading, history)
    
    for anomaly in anomalies:
        # ...existing code...
        post_alert_to_backend(anomaly)
    
    # After anomalies, refresh analytics snapshot
    try:
        from analytics.pipeline import run_once as refresh_analytics
        refresh_analytics()
    except Exception as e:
        print("Analytics refresh failed:", e)
