# ml/anomaly/sensor_health.py
"""
Sensor Health Monitoring Module
Detects sensor failures, data staleness, invalid values, and stuck readings
"""
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple
import json

# Sensor Configuration
CRITICAL_SENSORS = ['pm25', 'pm10', 'co2', 'temperature', 'humidity']

# Valid value ranges for each sensor
SENSOR_RANGES = {
    'pm1': (0, 1000),
    'pm25': (0, 1000),
    'pm10': (0, 1500),
    'co': (0, 100),
    'co2': (300, 5000),
    'no2': (0, 500),
    'o3': (0, 200),
    'voc_index': (0, 500),
    'nox_index': (0, 500),
    'temperature': (-50, 60),
    'humidity': (0, 100),
    'pressure': (900, 1100)
}

class SensorHealthChecker:
    """Comprehensive sensor health monitoring"""
    
    def __init__(self, stale_threshold_minutes: int = 15, 
                 stuck_threshold: int = 5):
        self.stale_threshold = stale_threshold_minutes
        self.stuck_threshold = stuck_threshold
    
    def check_all_sensors(self, latest_reading: Dict, history: List[Dict]) -> Tuple[List[Dict], Dict]:
        """
        Comprehensive sensor health check
        Returns: (issues list, sensor_status dict)
        """
        issues = []
        sensor_status = {sensor: 'OK' for sensor in CRITICAL_SENSORS}
        
        if not latest_reading:
            return [{'type': 'NO_DATA', 'severity': 'CRITICAL', 'message': 'No reading received'}], sensor_status
        
        # Check 1: Data Staleness
        stale_issue = self._check_staleness(latest_reading)
        if stale_issue:
            issues.append(stale_issue)
        
        # Check 2: Missing critical sensors
        missing_issue = self._check_missing_sensors(latest_reading)
        if missing_issue:
            issues.append(missing_issue)
            for sensor in missing_issue.get('sensors', []):
                sensor_status[sensor] = 'MISSING'
        
        # Check 3: Invalid/Out-of-range values
        invalid_issues = self._check_invalid_values(latest_reading)
        for issue in invalid_issues:
            issues.append(issue)
            sensor = issue.get('sensor')
            if sensor and sensor in sensor_status:
                sensor_status[sensor] = 'INVALID'
        
        # Check 4: Stuck sensor (repeating same value)
        if history and len(history) >= 5:
            stuck_issues = self._check_stuck_sensors(history, latest_reading)
            for issue in stuck_issues:
                issues.append(issue)
                sensor = issue.get('sensor')
                if sensor and sensor in sensor_status:
                    sensor_status[sensor] = 'STUCK'
        
        # Check 5: Unrealistic changes (sudden spikes/drops)
        if history and len(history) >= 2:
            spike_issues = self._check_anomalous_changes(history, latest_reading)
            for issue in spike_issues:
                issues.append(issue)
                sensor = issue.get('sensor')
                if sensor and sensor in sensor_status:
                    sensor_status[sensor] = 'ANOMALY'
        
        return issues, sensor_status
    
    def _check_staleness(self, latest_reading: Dict) -> Dict:
        """Check if data is older than threshold"""
        timestamp = latest_reading.get('timestamp')
        if not timestamp:
            return {'type': 'NO_TIMESTAMP', 'severity': 'WARNING', 'message': 'No timestamp in reading'}
        
        try:
            if isinstance(timestamp, str):
                last_update = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            else:
                last_update = timestamp
            
            age_minutes = (datetime.now(last_update.tzinfo) if last_update.tzinfo else datetime.now() - last_update).total_seconds() / 60
            
            if age_minutes > self.stale_threshold:
                severity = 'CRITICAL' if age_minutes > 60 else 'WARNING'
                return {
                    'type': 'STALE_DATA',
                    'severity': severity,
                    'message': f'Data is {age_minutes:.0f} minutes old (threshold: {self.stale_threshold}min)',
                    'sensor': 'system',
                    'age_minutes': age_minutes
                }
        except Exception as e:
            return {'type': 'TIMESTAMP_ERROR', 'severity': 'WARNING', 'message': str(e)}
        
        return None
    
    def _check_missing_sensors(self, latest_reading: Dict) -> Dict:
        """Alert if critical sensors return null"""
        missing = [s for s in CRITICAL_SENSORS if latest_reading.get(s) is None]
        
        if missing:
            return {
                'type': 'MISSING_SENSORS',
                'severity': 'CRITICAL' if len(missing) > 2 else 'WARNING',
                'message': f'Missing sensors: {", ".join(missing)}',
                'sensors': missing
            }
        return None
    
    def _check_invalid_values(self, latest_reading: Dict) -> List[Dict]:
        """Detect out-of-range or unrealistic values"""
        issues = []
        
        for sensor, (min_val, max_val) in SENSOR_RANGES.items():
            value = latest_reading.get(sensor)
            
            if value is None:
                continue
            
            try:
                value = float(value)
            except (ValueError, TypeError):
                issues.append({
                    'type': 'INVALID_FORMAT',
                    'severity': 'WARNING',
                    'sensor': sensor,
                    'value': value,
                    'message': f'{sensor} has non-numeric value: {value}'
                })
                continue
            
            # Check range
            if value < min_val or value > max_val:
                issues.append({
                    'type': 'OUT_OF_RANGE',
                    'severity': 'WARNING',
                    'sensor': sensor,
                    'value': value,
                    'expected_range': (min_val, max_val),
                    'message': f'{sensor}={value} outside expected range [{min_val}, {max_val}]'
                })
            
            # Special check: Zero values for PM sensors (unlikely)
            if sensor in ['pm25', 'pm10'] and value == 0:
                issues.append({
                    'type': 'SUSPICIOUS_ZERO',
                    'severity': 'WARNING',
                    'sensor': sensor,
                    'value': value,
                    'message': f'{sensor} reading zero - sensor may be disconnected'
                })
        
        return issues
    
    def _check_stuck_sensors(self, history: List[Dict], latest_reading: Dict) -> List[Dict]:
        """Detect if sensor is stuck (reporting constant value)"""
        issues = []
        
        for sensor in CRITICAL_SENSORS + ['co', 'no2', 'o3']:
            recent_values = [h.get(sensor) for h in history[-self.stuck_threshold:]]
            recent_values.append(latest_reading.get(sensor))
            
            # Filter out None values
            recent_values = [v for v in recent_values if v is not None]
            
            if len(recent_values) >= self.stuck_threshold:
                # Check if all recent values are identical
                unique_values = set(recent_values)
                if len(unique_values) == 1:
                    issues.append({
                        'type': 'STUCK_SENSOR',
                        'severity': 'WARNING',
                        'sensor': sensor,
                        'value': recent_values[0],
                        'message': f'{sensor} reporting constant value for {len(recent_values)} readings: {recent_values[0]}'
                    })
        
        return issues
    
    def _check_anomalous_changes(self, history: List[Dict], latest_reading: Dict) -> List[Dict]:
        """Detect unrealistic sudden changes in sensor values"""
        issues = []
        
        if len(history) < 2:
            return issues
        
        prev_reading = history[0]
        current_reading = latest_reading
        
        # Thresholds for sudden changes (adjust based on sensor)
        change_thresholds = {
            'pm25': 200,      # 200 µg/m³ jump is suspicious
            'pm10': 300,
            'temperature': 10,  # 10°C in one reading
            'humidity': 30,      # 30% change
            'co2': 500
        }
        
        for sensor, threshold in change_thresholds.items():
            prev_val = prev_reading.get(sensor)
            curr_val = current_reading.get(sensor)
            
            if prev_val is not None and curr_val is not None:
                try:
                    prev_val = float(prev_val)
                    curr_val = float(curr_val)
                    
                    change = abs(curr_val - prev_val)
                    if change > threshold:
                        issues.append({
                            'type': 'SUDDEN_CHANGE',
                            'severity': 'INFO',
                            'sensor': sensor,
                            'previous_value': prev_val,
                            'current_value': curr_val,
                            'change': change,
                            'threshold': threshold,
                            'message': f'{sensor} jumped from {prev_val} to {curr_val} (Δ={change})'
                        })
                except (ValueError, TypeError):
                    pass
        
        return issues


def send_sensor_health_alert(issues: List[Dict], latest_reading: Dict = None):
    """Send alert for sensor issues"""
    if not issues:
        return False
    
    from alert_sender import send_email, send_sms, post_alert_to_backend
    
    critical_issues = [i for i in issues if i.get('severity') == 'CRITICAL']
    warning_issues = [i for i in issues if i.get('severity') == 'WARNING']
    
    severity = 'CRITICAL' if critical_issues else 'WARNING'
    subject = f"🔧 Sensor Health Alert - {severity}"
    
    body = f"""
Sensor Health Report - {severity}
Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

Issues Found: {len(issues)} ({len(critical_issues)} critical, {len(warning_issues)} warnings)

"""
    
    if critical_issues:
        body += "CRITICAL ISSUES:\n"
        for issue in critical_issues:
            body += f"  🔴 [{issue['type']}] {issue['message']}\n"
            if 'sensor' in issue and issue['sensor'] != 'system':
                body += f"     Sensor: {issue['sensor']}\n"
            if 'value' in issue:
                body += f"     Value: {issue['value']}\n"
    
    if warning_issues:
        body += "\nWARNING ISSUES:\n"
        for issue in warning_issues[:5]:  # Limit to first 5
            body += f"  ⚠️  [{issue['type']}] {issue['message']}\n"
    
    body += """

ACTION REQUIRED:
1. Check physical connections (USB/Serial cables)
2. Verify power supply to sensors
3. Check sensor logs for communication errors
4. Restart affected sensors if necessary
5. Visit diagnostics page for detailed status

Dashboard: Check Real-Time Data page for sensor status
"""
    
    try:
        send_email(subject, body)
    except Exception as e:
        print(f"Failed to send email alert: {e}")
    
    # Send SMS for critical
    if severity == 'CRITICAL':
        try:
            critical_sensors = list(set([i.get('sensor') for i in critical_issues if i.get('sensor') != 'system']))
            sms_msg = f"🔧 CRITICAL: {len(critical_issues)} sensor(s) down: {', '.join(critical_sensors[:3])}"
            send_sms(sms_msg)
        except Exception as e:
            print(f"Failed to send SMS alert: {e}")
    
    # Post to backend
    alert_payload = {
        'type': 'SENSOR_HEALTH',
        'severity': severity,
        'timestamp': datetime.now().isoformat(),
        'issues_count': len(issues),
        'critical_count': len(critical_issues),
        'issues': issues[:10],  # Limit to first 10
        'sensor_status': {i.get('sensor'): i.get('type') for i in critical_issues + warning_issues if i.get('sensor')}
    }
    
    try:
        post_alert_to_backend(alert_payload)
    except Exception as e:
        print(f"Failed to post sensor health alert to backend: {e}")
    
    return True


# Convenience function
def check_and_alert_sensor_health(latest_reading: Dict, history: List[Dict], 
                                   stale_threshold: int = 15,
                                   stuck_threshold: int = 5):
    """One-line sensor health check and alert"""
    checker = SensorHealthChecker(stale_threshold, stuck_threshold)
    issues, sensor_status = checker.check_all_sensors(latest_reading, history)
    
    if issues:
        send_sensor_health_alert(issues, latest_reading)
    
    return issues, sensor_status
