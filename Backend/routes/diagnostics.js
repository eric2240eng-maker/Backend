// Backend/routes/diagnostics.js
/**
 * Diagnostics & Sensor Health Routes
 * Provides real-time sensor status and health information
 */
const express = require('express');
const Reading = require('../models/reading');
const router = express.Router();

// Sensor Configuration
const CRITICAL_SENSORS = ['pm1', 'pm25', 'pm10', 'co2', 'temperature', 'humidity'];
const SENSOR_RANGES = {
    pm1: { min: 0, max: 1000, unit: 'µg/m³' },
    pm25: { min: 0, max: 1000, unit: 'µg/m³' },
    pm10: { min: 0, max: 1500, unit: 'µg/m³' },
    co: { min: 0, max: 100, unit: 'ppm' },
    co2: { min: 300, max: 5000, unit: 'ppm' },
    no2: { min: 0, max: 500, unit: 'ppb' },
    o3: { min: 0, max: 200, unit: 'ppb' },
    voc_index: { min: 0, max: 500, unit: '' },
    nox_index: { min: 0, max: 500, unit: '' },
    temperature: { min: -50, max: 60, unit: '°C' },
    humidity: { min: 0, max: 100, unit: '%' },
    pressure: { min: 900, max: 1100, unit: 'hPa' }
};

/**
 * GET /api/diagnostics/sensor-status
 * Returns real-time sensor health status
 */
router.get('/sensor-status', async (req, res) => {
    try {
        const latest = await Reading.findOne().sort({ timestamp: -1 });
        const history = await Reading.find().sort({ timestamp: -1 }).limit(50);

        if (!latest) {
            return res.json({
                status: 'NO_DATA',
                message: 'No readings available',
                sensors: {},
                issues: []
            });
        }

        const sensorStatus = {};
        const issues = [];

        // 1. Check data staleness
        const age = (Date.now() - new Date(latest.timestamp)) / 60000;
        if (age > 30) {
            issues.push({
                type: 'STALE_DATA',
                severity: age > 60 ? 'CRITICAL' : 'WARNING',
                message: `Data is ${age.toFixed(1)} minutes old`,
                age_minutes: age
            });
        }

        // 2. Check each critical sensor
        for (const sensor of CRITICAL_SENSORS) {
            const value = latest[sensor];
            const range = SENSOR_RANGES[sensor];
            let status = 'OK';
            let issue = null;

            if (value === null || value === undefined) {
                status = 'MISSING';
                issue = {
                    type: 'MISSING_SENSOR',
                    severity: 'CRITICAL',
                    sensor,
                    message: `${sensor} - No data received`
                };
            } else {
                const numValue = parseFloat(value);

                // Check out of range
                if (numValue < range.min || numValue > range.max) {
                    status = 'INVALID';
                    issue = {
                        type: 'OUT_OF_RANGE',
                        severity: 'WARNING',
                        sensor,
                        value: numValue,
                        range: { min: range.min, max: range.max },
                        message: `${sensor} = ${numValue} ${range.unit} (outside range [${range.min}-${range.max}])`
                    };
                }
                // Check for suspicious zero (PM sensors)
                else if ((sensor === 'pm25' || sensor === 'pm10') && numValue === 0) {
                    status = 'SUSPICIOUS';
                    issue = {
                        type: 'SUSPICIOUS_ZERO',
                        severity: 'WARNING',
                        sensor,
                        value: numValue,
                        message: `${sensor} reading zero - sensor may be disconnected`
                    };
                }
                // Check if stuck (repeating same value)
                else if (history.length >= 5) {
                    const recent = history.slice(0, 5).map(h => h[sensor]).filter(v => v !== null);
                    if (recent.length === 5 && new Set(recent).size === 1) {
                        status = 'STUCK';
                        issue = {
                            type: 'STUCK_SENSOR',
                            severity: 'WARNING',
                            sensor,
                            value: numValue,
                            message: `${sensor} reporting constant value: ${numValue} (5 consecutive readings)`
                        };
                    }
                }
            }

            sensorStatus[sensor] = {
                status,
                value: latest[sensor],
                unit: range.unit,
                range: range.unit ? `${range.min}-${range.max}` : 'N/A'
            };

            if (issue) {
                issues.push(issue);
            }
        }

        // 3. Check for optional sensors
        const optionalSensors = ['co', 'no2', 'o3', 'voc_index', 'nox_index', 'pressure'];
        for (const sensor of optionalSensors) {
            const value = latest[sensor];
            const range = SENSOR_RANGES[sensor];
            
            if (value !== null && value !== undefined) {
                const numValue = parseFloat(value);
                const status = (numValue < range.min || numValue > range.max) ? 'INVALID' : 'OK';
                
                sensorStatus[sensor] = {
                    status,
                    value: numValue,
                    unit: range.unit,
                    range: `${range.min}-${range.max}`
                };
            }
        }

        // Determine overall system status
        const criticalIssues = issues.filter(i => i.severity === 'CRITICAL');
        const overallStatus = criticalIssues.length > 0 ? 'CRITICAL' : 
                            issues.length > 0 ? 'WARNING' : 'HEALTHY';

        res.json({
            status: overallStatus,
            lastUpdate: latest.timestamp,
            dataAge: age,
            sensorStatus,
            issues,
            issueCount: {
                critical: criticalIssues.length,
                warning: issues.filter(i => i.severity === 'WARNING').length,
                total: issues.length
            },
            activeSensors: CRITICAL_SENSORS.filter(s => latest[s] !== null).length,
            totalCriticalSensors: CRITICAL_SENSORS.length
        });
    } catch (err) {
        res.status(500).json({ 
            error: err.message,
            status: 'ERROR'
        });
    }
});

/**
 * GET /api/diagnostics/sensor-history/:sensor
 * Returns recent readings for a specific sensor
 */
router.get('/sensor-history/:sensor', async (req, res) => {
    try {
        const { sensor } = req.params;
        const { limit = 50 } = req.query;

        const readings = await Reading.find(
            { [sensor]: { $ne: null } },
            { timestamp: 1, [sensor]: 1 }
        ).sort({ timestamp: -1 }).limit(parseInt(limit));

        const history = readings.reverse().map(r => ({
            timestamp: r.timestamp,
            value: r[sensor]
        }));

        const range = SENSOR_RANGES[sensor];
        const stats = {
            sensor,
            unit: range.unit,
            count: history.length,
            min: Math.min(...history.map(h => h.value)),
            max: Math.max(...history.map(h => h.value)),
            avg: (history.reduce((a, b) => a + b.value, 0) / history.length).toFixed(2),
            range: { min: range.min, max: range.max }
        };

        res.json({
            sensor,
            stats,
            history
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/diagnostics/health-summary
 * Quick health check for monitoring dashboards
 */
router.get('/health-summary', async (req, res) => {
    try {
        const latest = await Reading.findOne().sort({ timestamp: -1 });

        if (!latest) {
            return res.json({
                healthy: false,
                activeSensors: 0,
                message: 'No data available'
            });
        }

        const age = (Date.now() - new Date(latest.timestamp)) / 1000; // seconds
        const activeSensors = CRITICAL_SENSORS.filter(s => latest[s] !== null).length;
        const missingCritical = CRITICAL_SENSORS.length - activeSensors;

        const healthy = age < 900 && missingCritical === 0;

        res.json({
            healthy,
            timestamp: latest.timestamp,
            dataAgeSeconds: Math.floor(age),
            activeSensors,
            missingCritical,
            icon: healthy ? '✅' : missingCritical > 0 ? '⚠️' : '🔴'
        });
    } catch (err) {
        res.status(500).json({ 
            healthy: false,
            error: err.message
        });
    }
});

module.exports = router;
