/**
 * Lightweight Report Generator - Returns formatted JSON report
 * Handles both flat readings {pm1, pm25,...} and nested {metrics:{pm1,...}}
 */

class ReportGenerator {
  constructor(readings, location = 'Lab Sensor A') {
    this.readings = readings;
    // Flatten nested metrics so we always work with {pm1, pm25, ..., timestamp}
    this.flat = readings.map(r => ({
      timestamp: r.timestamp,
      ...(r.metrics || r),
    }));
  }

  async generateReport(granularity, startDate, endDate) {
    const aggregatedData = this._aggregateByGranularity(granularity);

    return {
      header: {
        title: 'Air Quality Report',
        type: granularity.charAt(0).toUpperCase() + granularity.slice(1),
        location: this.location,
        period: `${startDate.toDateString()} to ${endDate.toDateString()}`,
        generated: new Date().toLocaleString(),
      },
      executiveSummary:   this._generateExecutiveSummary(aggregatedData),
      pollutantAnalysis:  this._generatePollutantAnalysis(),
      environmental:      this._generateEnvironmental(),
      healthCompliance:   this._generateHealthCompliance(),
      sensorHealth:       this._generateSensorHealth(),
    };
  }

  _aggregateByGranularity(granularity) {
    const aggregated = {};
    this.flat.forEach((r) => {
      const date = new Date(r.timestamp);
      let key;
      if      (granularity === 'hourly')  key = date.toISOString().slice(0, 13);
      else if (granularity === 'daily')   key = date.toISOString().slice(0, 10);
      else if (granularity === 'weekly')  key = `Week ${Math.ceil(date.getDate() / 7)}`;
      else if (granularity === 'monthly') key = date.toISOString().slice(0, 7);
      else if (granularity === 'yearly')  key = date.getFullYear().toString();
      if (!aggregated[key]) aggregated[key] = [];
      aggregated[key].push(r);
    });
    return aggregated;
  }

  _getStats(values) {
    if (!values.length) return { min: 0, max: 0, mean: 0, median: 0, std: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mean   = values.reduce((a, b) => a + b, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const std    = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
    return { min: sorted[0], max: sorted[sorted.length - 1], mean, median, std };
  }

  _generateExecutiveSummary(aggregatedData) {
    const totalReadings = this.flat.length;
    const periods = Object.keys(aggregatedData).length || 1;

    // Use PM2.5 as the headline pollutant for summary
    const pm25vals = this.flat.map(r => Number(r.pm25 || 0)).filter(v => v > 0);
    const avgPM25  = pm25vals.length ? (pm25vals.reduce((a,b)=>a+b,0)/pm25vals.length).toFixed(1) : 'N/A';
    const maxPM25  = pm25vals.length ? Math.max(...pm25vals).toFixed(1) : 'N/A';

    return {
      totalReadings,
      dataCompleteness:   `${Math.min(100, Math.round((totalReadings / (periods * 12)) * 100))}%`,
      averagePM25:        `${avgPM25} µg/m³`,
      peakPM25:           `${maxPM25} µg/m³`,
      monitoringPeriods:  periods,
    };
  }

  _generatePollutantAnalysis() {
    const pollutants = [
      { key: 'pm1',  label: 'PM1.0',  unit: 'µg/m³' },
      { key: 'pm25', label: 'PM2.5',  unit: 'µg/m³' },
      { key: 'pm10', label: 'PM10',   unit: 'µg/m³' },
      { key: 'co',   label: 'CO',     unit: 'ppm'   },
      { key: 'co2',  label: 'CO₂',    unit: 'ppm'   },
      { key: 'o3',   label: 'O₃',     unit: 'ppm'   },
    ];

    const analysis = {};
    pollutants.forEach(({ key, label, unit }) => {
      const values = this.flat
        .map(r => Number(r[key]))
        .filter(v => !isNaN(v) && v > 0);
      if (!values.length) return;
      const s = this._getStats(values);
      analysis[`${label} (${unit})`] = {
        min:               s.min.toFixed(3),
        max:               s.max.toFixed(3),
        average:           s.mean.toFixed(3),
        median:            s.median.toFixed(3),
        standardDeviation: s.std.toFixed(3),
        samples:           values.length,
      };
    });
    return analysis;
  }

  _generateEnvironmental() {
    const params = [
      { key: 'temperature', label: 'Temperature (°C)' },
      { key: 'humidity',    label: 'Humidity (%)'     },
      { key: 'voc_index',   label: 'VOC Index'        },
      { key: 'nox_index',   label: 'NOx Index'        },
    ];
    const env = {};
    params.forEach(({ key, label }) => {
      const values = this.flat
        .map(r => Number(r[key]))
        .filter(v => !isNaN(v) && v > 0);
      if (!values.length) return;
      const s = this._getStats(values);
      env[label] = {
        min:     s.min.toFixed(2),
        max:     s.max.toFixed(2),
        average: s.mean.toFixed(2),
      };
    });
    return env;
  }

  _generateHealthCompliance() {
    // Use PM2.5 to infer AQI category
    const categories = { Good: 0, Moderate: 0, 'Unhealthy (Sensitive)': 0, Unhealthy: 0, 'Very Unhealthy': 0, Hazardous: 0 };
    this.flat.forEach(r => {
      const v = Number(r.pm25 || 0);
      if      (v <= 12)   categories.Good++;
      else if (v <= 35.4) categories.Moderate++;
      else if (v <= 55.4) categories['Unhealthy (Sensitive)']++;
      else if (v <= 150.4)categories.Unhealthy++;
      else if (v <= 250.4)categories['Very Unhealthy']++;
      else                categories.Hazardous++;
    });
    const total = this.flat.length || 1;
    const breakdown = {};
    Object.entries(categories).forEach(([cat, count]) => {
      breakdown[cat] = { count, percentage: `${((count / total) * 100).toFixed(1)}%` };
    });
    return breakdown;
  }

  _generateSensorHealth() {
    const recent = this.flat.slice(-10);
    if (!recent.length) return { status: 'No data', missingFields: 'N/A' };

    const times = recent.map(r => new Date(r.timestamp).getTime()).filter(t => !isNaN(t));
    const spanMin = times.length > 1
      ? Math.ceil((Math.max(...times) - Math.min(...times)) / 60000)
      : 0;

    const allKeys = ['pm1','pm25','pm10','co','co2','o3','temperature','humidity','voc_index','nox_index'];
    const missing = allKeys.filter(k => recent.some(r => r[k] == null || r[k] === ''));

    return {
      lastReadingSpan: `${spanMin} minutes`,
      latestTimestamp: recent[recent.length - 1]?.timestamp || 'N/A',
      missingFields:   missing.length ? missing.join(', ') : 'None',
      status:          missing.length ? '⚠ Some sensors missing data' : '✓ All sensors healthy',
    };
  }
}

module.exports = ReportGenerator;
