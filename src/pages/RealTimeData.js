// src/pages/RealTimeData.js
import React, { useEffect, useState, useMemo } from 'react';
import MetricCard from '../components/MetricCard';
import { api, socket } from '../config/api';
import { 
  ResponsiveContainer, LineChart, Line, CartesianGrid, Tooltip, XAxis, YAxis, 
  Legend, Brush
} from 'recharts';

const flattenReading = (payload) => (payload?.metrics
  ? { ...payload.metrics, timestamp: payload.timestamp, location: payload.location }
  : payload || {});

// Calculate AQI from PM2.5
const calculateAQI = (pm25) => {
  if (pm25 <= 12) return Math.round((50 / 12) * pm25);
  if (pm25 <= 35.4) return Math.round(((100 - 51) / (35.4 - 12.1)) * (pm25 - 12.1) + 51);
  if (pm25 <= 55.4) return Math.round(((150 - 101) / (55.4 - 35.5)) * (pm25 - 35.5) + 101);
  if (pm25 <= 150.4) return Math.round(((200 - 151) / (150.4 - 55.5)) * (pm25 - 55.5) + 151);
  if (pm25 <= 250.4) return Math.round(((300 - 201) / (250.4 - 150.5)) * (pm25 - 150.5) + 201);
  return Math.round(((500 - 301) / (500.4 - 250.5)) * (pm25 - 250.5) + 301);
};

const getAQICategory = (aqi) => {
  if (aqi <= 50) return { label: 'Good', color: '#00e400' };
  if (aqi <= 100) return { label: 'Moderate', color: '#ffff00' };
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: '#ff7e00' };
  if (aqi <= 200) return { label: 'Unhealthy', color: '#ff0000' };
  if (aqi <= 300) return { label: 'Very Unhealthy', color: '#8f3f97' };
  return { label: 'Hazardous', color: '#7e0023' };
};

export default function RealTimeData(){
  const [metrics, setMetrics] = useState({});
  const [series, setSeries] = useState([]);
  const [isServerConnected, setIsServerConnected] = useState(false);
  const [isSensorActive, setIsSensorActive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [updateCount, setUpdateCount] = useState(0);
  const [alerts, setAlerts] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [sensorHealth, setSensorHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Calculate statistics
  const stats = useMemo(() => {
    if (series.length === 0) return null;
    
    const calculate = (key) => {
      const values = series.map(s => s[key]).filter(v => v != null);
      if (values.length === 0) return null;
      
      return {
        current: values[values.length - 1],
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        trend: values.length > 1 ? values[values.length - 1] - values[values.length - 2] : 0
      };
    };

    return {
      pm1: calculate('pm1'),
      pm25: calculate('pm25'),
      pm10: calculate('pm10'),
      co: calculate('co'),
      co2: calculate('co2'),
      o3: calculate('o3'),
      temperature: calculate('temperature'),
      humidity: calculate('humidity'),
      voc_index: calculate('voc_index'),
      nox_index: calculate('nox_index')
    };
  }, [series]);

  // Count active sensors (parameters with data)
  const sensorKeys = ['pm1', 'pm25', 'pm10', 'co', 'co2', 'temperature', 'humidity', 'voc_index', 'nox_index'];
  const activeSensors = useMemo(() => {
    return sensorKeys.filter(key => metrics[key] != null).length;
  }, [metrics]);
  
  const totalSensors = sensorKeys.length;

  // Calculate AQI
  const currentAQI = useMemo(() => {
    if (!metrics.pm25) return null;
    const aqi = calculateAQI(metrics.pm25);
    return { value: aqi, ...getAQICategory(aqi) };
  }, [metrics.pm25]);

  // Check for threshold violations
  const checkAlerts = (data) => {
    const newAlerts = [];
    const thresholds = {
      pm1: { value: 50, label: 'PM1.0' },
      pm25: { value: 35.4, label: 'PM2.5' },
      pm10: { value: 154, label: 'PM10' },
      co: { value: 9, label: 'CO' },
      co2: { value: 1000, label: 'CO₂' },
      voc_index: { value: 250, label: 'VOC Index' },
      nox_index: { value: 250, label: 'NOx Index' }
    };

    Object.keys(thresholds).forEach(key => {
      if (data[key] > thresholds[key].value) {
        newAlerts.push({
          id: Date.now() + key,
          type: 'warning',
          metric: thresholds[key].label,
          value: data[key],
          threshold: thresholds[key].value,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    });

    if (newAlerts.length > 0) {
      setAlerts(prev => [...newAlerts, ...prev].slice(0, 5)); // Keep last 5 alerts
    }
  };

  useEffect(() => {
    let active = true;
    let sensorTimeout;

    const seedLatest = async () => {
      try {
        const resp = await api.get('/api/sensor-data/latest');
        if (!active || !resp?.data) return;
        const flat = flattenReading(resp.data);
        const ts = flat?.timestamp ? new Date(flat.timestamp).getTime() : Date.now();
        setMetrics(prev => ({ ...prev, ...flat }));
        setSeries(prev => [...prev.slice(-49), { ...flat, ts }]);
        setLastUpdate(new Date());
      } catch (err) {
        console.error('Failed to load latest sensor reading:', err);
      }
    };

    const seedData = async () => {
      try {
        const resp = await api.get('/api/sensor-data/latest');
        if (!active || !resp?.data) return;
        const flat = flattenReading(resp.data);
        const ts = flat?.timestamp ? new Date(flat.timestamp).getTime() : Date.now();
        const aqi = flat.pm25 ? calculateAQI(flat.pm25) : null;
        setMetrics(prev => ({ ...prev, ...flat }));
        setSeries(prev => [...prev.slice(-49), { ...flat, ts, aqi }]);
        setLastUpdate(new Date());
      } catch (err) {
        console.error('Failed to load latest sensor reading:', err);
      }
    };
    
    seedData();
    if (!socket.connected) socket.connect();

    const handleConnect = () => setIsServerConnected(true);
    const handleDisconnect = () => {
      setIsServerConnected(false);
      setIsSensorActive(false); 
    };

    const handleSensor = (payload) => {
      if (!autoRefresh || !active) return;
      
      // Data received, mark sensor active and reset watchdog timer
      setIsSensorActive(true);
      clearTimeout(sensorTimeout);
      sensorTimeout = setTimeout(() => {
        if (active) setIsSensorActive(false);
      }, 5000); 

      const flat = flattenReading(payload);
      const ts = flat?.timestamp ? new Date(flat.timestamp).getTime() : Date.now();
      const aqi = flat.pm25 ? calculateAQI(flat.pm25) : null;
      
      setMetrics(prev => ({...prev, ...flat}));
      setSeries(prev => [...prev.slice(-49), {...flat, ts, aqi}]);
      setLastUpdate(new Date());
      setUpdateCount(prev => prev + 1);
      checkAlerts(flat);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('sensorData', handleSensor);

    if (socket.connected) setIsServerConnected(true);

    return () => {
      active = false;
      clearTimeout(sensorTimeout);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('sensorData', handleSensor);
    };
  }, [autoRefresh]);

  // Fetch sensor health status
  useEffect(() => {
    let active = true;
    let healthInterval;

    const fetchSensorHealth = async () => {
      try {
        setHealthLoading(true);
        const resp = await api.get('/api/diagnostics/sensor-status');
        if (active && resp?.data) {
          setSensorHealth(resp.data);
        }
      } catch (err) {
        console.error('Failed to fetch sensor health:', err);
      } finally {
        if (active) setHealthLoading(false);
      }
    };

    fetchSensorHealth();
    // Refresh sensor health every 30 seconds
    healthInterval = setInterval(fetchSensorHealth, 30000);

    return () => {
      active = false;
      clearInterval(healthInterval);
    };
  }, []);

  // Export data functions
  const exportCSV = () => {
    const headers = ['Timestamp', 'PM1.0', 'PM2.5', 'PM10', 'CO', 'CO2', 'Temperature', 'Humidity', 'VOC Index', 'NOx Index'];
    const rows = series.map(s => [
      new Date(s.ts).toLocaleString(),
      s.pm1 || '',
      s.pm25 || '',
      s.pm10 || '',
      s.co || '',
      s.co2 || '',
      s.temperature || '',
      s.humidity || '',
      s.voc_index || '',
      s.nox_index || ''
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `realtime-data-${new Date().toISOString()}.csv`;
    a.click();
  };

  const exportJSON = () => {
    const json = JSON.stringify(series, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `realtime-data-${new Date().toISOString()}.json`;
    a.click();
  };

  const renderChart = () => {
    return (
      <LineChart
        data={series}
        syncId="realtime"
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
        <XAxis 
          dataKey="ts" 
          type="number" 
          scale="time" 
          domain={["auto","auto"]} 
          tickFormatter={v=>new Date(v).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} 
        />
        <YAxis width={52} tickLine={false} />
        <Tooltip 
          labelFormatter={v=>new Date(v).toLocaleString()}
          formatter={(value) => value ? value.toFixed(1) : 'N/A'}
        />
        <Legend />
        <Brush height={14} travellerWidth={8} />
        <Line type="monotone" dataKey="aqi" stroke="#ff7300" strokeWidth={3} dot={false} activeDot={{ r: 5 }} name="AQI" />
      </LineChart>
    );
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header Section */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '600' }}>
            Real-Time Monitoring
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Server Status */}
            <span style={{ 
              fontSize: '14px', 
              color: isServerConnected ? '#00e400' : '#ff0000',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{ 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%', 
                backgroundColor: isServerConnected ? '#00e400' : '#ff0000'
              }}></span>
              {isServerConnected ? 'Server Online' : 'Server Offline'}
            </span>

            {/* Sensor Status */}
            <span style={{ 
              fontSize: '14px', 
              color: isSensorActive ? '#00b3ff' : '#ff9800',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{ 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%', 
                backgroundColor: isSensorActive ? '#00b3ff' : '#ff9800',
                animation: isSensorActive ? 'pulse 2s infinite' : 'none'
              }}></span>
              {isSensorActive ? 'Receiving Data' : 'Waiting for Sensor...'}
            </span>

            {lastUpdate && (
              <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}>
                Last Update: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}>
              Updates: {updateCount}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.1)',
              backgroundColor: autoRefresh ? '#00e400' : 'rgba(255,255,255,0.1)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              transition: 'all 0.3s'
            }}
          >
            {autoRefresh ? 'Pause' : 'Resume'}
          </button>
          <button
            onClick={() => setShowStats(!showStats)}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.1)',
              backgroundColor: 'rgba(255,255,255,0.05)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            {showStats ? 'Hide Stats' : 'Show Stats'}
          </button>
          <button
            onClick={exportCSV}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.1)',
              backgroundColor: '#4CAF50',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            Export CSV
          </button>
          <button
            onClick={exportJSON}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.1)',
              backgroundColor: '#2196F3',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* Active Sensors */}
      <div style={{
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: '12px',
        padding: '16px 20px',
        marginBottom: '20px',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: '16px'
      }}>
        <span style={{
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          backgroundImage: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '22px',
          fontWeight: 'bold'
        }}>
          {activeSensors}/{totalSensors}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Active Sensors</div>
          <div style={{ fontSize: '12px', opacity: '0.7' }}>
            {activeSensors} out of {totalSensors} sensors reporting data
          </div>
        </div>
      </div>

      {/* Sensor Health Status Panel */}
      {sensorHealth && (
        <div style={{
          backgroundColor: sensorHealth.status === 'HEALTHY' ? 'rgba(34, 197, 94, 0.1)' : 
                          sensorHealth.status === 'WARNING' ? 'rgba(245, 158, 11, 0.1)' :
                          'rgba(239, 68, 68, 0.1)',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '20px',
          border: `1px solid ${sensorHealth.status === 'HEALTHY' ? '#22c55e' : 
                            sensorHealth.status === 'WARNING' ? '#f59e0b' :
                            '#ef4444'}`,
          display: 'flex',
          alignItems: 'flex-start',
          gap: '16px'
        }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            backgroundColor: sensorHealth.status === 'HEALTHY' ? '#22c55e' : 
                            sensorHealth.status === 'WARNING' ? '#f59e0b' :
                            '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            flexShrink: 0
          }}>
            {sensorHealth.status === 'HEALTHY' ? '✅' : 
             sensorHealth.status === 'WARNING' ? '⚠️' : '🔴'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '16px' }}>
              Sensor Health: {sensorHealth.status}
            </div>
            <div style={{ fontSize: '12px', opacity: '0.7', lineHeight: '1.5' }}>
              <div>Last Update: {new Date(sensorHealth.lastUpdate).toLocaleTimeString()}</div>
              <div>Data Age: {Math.floor(sensorHealth.dataAge)} minutes</div>
              <div>Active: {sensorHealth.activeSensors}/{sensorHealth.totalCriticalSensors} critical sensors</div>
              {sensorHealth.issueCount.total > 0 && (
                <div style={{ marginTop: '8px', color: '#ef4444' }}>
                  🔧 Issues Found: {sensorHealth.issueCount.critical} critical, {sensorHealth.issueCount.warning} warnings
                </div>
              )}
            </div>
          </div>
          
          {/* Sensor Status Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '8px', minWidth: '300px' }}>
            {Object.entries(sensorHealth.sensorStatus || {}).slice(0, 6).map(([sensor, status]) => (
              <div key={sensor} style={{
                padding: '8px',
                borderRadius: '8px',
                fontSize: '11px',
                textAlign: 'center',
                backgroundColor: status.status === 'OK' ? 'rgba(34, 197, 94, 0.2)' :
                                status.status === 'INVALID' ? 'rgba(245, 158, 11, 0.2)' :
                                status.status === 'MISSING' ? 'rgba(239, 68, 68, 0.2)' :
                                'rgba(156, 163, 175, 0.2)',
                border: `1px solid ${status.status === 'OK' ? '#22c55e' :
                                  status.status === 'INVALID' ? '#f59e0b' :
                                  status.status === 'MISSING' ? '#ef4444' :
                                  '#9ca3af'}`
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>{sensor}</div>
                <div style={{
                  color: status.status === 'OK' ? '#22c55e' :
                       status.status === 'INVALID' ? '#f59e0b' :
                       status.status === 'MISSING' ? '#ef4444' :
                       '#9ca3af'
                }}>
                  {status.status === 'OK' ? '✓' : '✗'}
                </div>
                {status.value !== null && (
                  <div style={{ fontSize: '10px', marginTop: '2px', opacity: 0.7 }}>
                    {typeof status.value === 'number' ? status.value.toFixed(1) : status.value}
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {/* Issues List */}
          {sensorHealth.issues && sensorHealth.issues.length > 0 && (
            <div style={{
              backgroundColor: 'rgba(0,0,0,0.2)',
              borderRadius: '8px',
              padding: '12px',
              minWidth: '300px',
              maxHeight: '150px',
              overflowY: 'auto'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '12px' }}>Issues:</div>
              {sensorHealth.issues.slice(0, 4).map((issue, idx) => (
                <div key={idx} style={{ fontSize: '11px', marginBottom: '4px', color: issue.severity === 'CRITICAL' ? '#ef4444' : '#f59e0b' }}>
                  • {issue.message}
                </div>
              ))}
              {sensorHealth.issues.length > 4 && (
                <div style={{ fontSize: '11px', opacity: 0.7 }}>... and {sensorHealth.issues.length - 4} more</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* AQI Display */}
      {currentAQI && (
        <div style={{
          backgroundColor: currentAQI.color,
          color: '#fff',
          padding: '20px',
          borderRadius: '12px',
          marginBottom: '20px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: '500', marginBottom: '4px' }}>
              Air Quality Index (AQI)
            </div>
            <div style={{ fontSize: '48px', fontWeight: '700' }}>
              {currentAQI.value}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '20px', fontWeight: '600' }}>
              {currentAQI.label}
            </div>
          </div>
        </div>
      )}

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ marginBottom: '12px', fontSize: '18px', fontWeight: '600' }}>
            Recent Alerts
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {alerts.map(alert => (
              <div
                key={alert.id}
                style={{
                  backgroundColor: 'rgba(255,115,0,0.15)',
                  border: '1px solid rgba(255,115,0,0.5)',
                  borderRadius: '8px',
                  padding: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '14px'
                }}
              >
                <span>
                  <strong>{alert.metric}</strong>: {alert.value.toFixed(2)} exceeds threshold of {alert.threshold}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>{alert.timestamp}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Metrics - All 9 Parameters */}
      <div className="cards-grid" style={{ marginBottom: '20px' }}>
        {/* Particulate Matter */}
        <MetricCard 
          title="PM1.0" 
          value={metrics.pm1} 
          unit="µg/m³"
          trend={stats?.pm1?.trend}
        />
        <MetricCard 
          title="PM2.5" 
          value={metrics.pm25} 
          unit="µg/m³"
          trend={stats?.pm25?.trend}
        />
        <MetricCard 
          title="PM10" 
          value={metrics.pm10} 
          unit="µg/m³"
          trend={stats?.pm10?.trend}
        />
        
        {/* Gases */}
        <MetricCard 
          title="CO" 
          value={metrics.co} 
          unit="ppm"
          trend={stats?.co?.trend}
        />
        <MetricCard 
          title="CO₂" 
          value={metrics.co2} 
          unit="ppm"
          trend={stats?.co2?.trend}
        />
        
        {/* Environmental */}
        <MetricCard 
          title="Temperature" 
          value={metrics.temperature} 
          unit="°C"
          trend={stats?.temperature?.trend}
        />
        <MetricCard 
          title="Humidity" 
          value={metrics.humidity} 
          unit="%"
          trend={stats?.humidity?.trend}
        />
        
        {/* VOC & NOx */}
        <MetricCard 
          title="VOC Index" 
          value={metrics.voc_index} 
          unit=""
          trend={stats?.voc_index?.trend}
        />
        <MetricCard 
          title="NOx Index" 
          value={metrics.nox_index} 
          unit=""
          trend={stats?.nox_index?.trend}
        />
      </div>

      {/* Statistics Panel */}
      {showStats && stats && (
        <div style={{
          backgroundColor: 'rgba(255,255,255,0.03)',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.05)'
        }}>
          <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: '600' }}>
            Session Statistics
          </h3>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
            gap: '16px' 
          }}>
            {Object.entries(stats).map(([key, stat]) => {
              if (!stat) return null;
              return (
                <div key={key} style={{ 
                  backgroundColor: 'rgba(255,255,255,0.05)', 
                  padding: '12px', 
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.08)'
                }}>
                  <div style={{ fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                    {key.replace(/([A-Z])/g, ' $1').toUpperCase()}
                  </div>
                  <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
                    <div>Current: <strong>{stat.current.toFixed(2)}</strong></div>
                    <div>Min: {stat.min.toFixed(2)}</div>
                    <div>Max: {stat.max.toFixed(2)}</div>
                    <div>Avg: {stat.avg.toFixed(2)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Chart Section - AQI Only */}
      <div className="charts-row">
        <h3 style={{ marginBottom: '12px', fontSize: '18px', fontWeight: '600' }}>
          Air Quality Index Trend 
        </h3>
        
        <ResponsiveContainer width="100%" height={350}>
          {renderChart()}
        </ResponsiveContainer>
      </div>

      {/* Pulse Animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        @media (max-width: 768px) {
          .cards-grid {
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)) !important;
          }
        }
      `}</style>
    </div>
  );
}