// src/pages/RealTimeData.js
import React, { useEffect, useState, useMemo, useRef } from 'react';
import MetricCard from '../components/MetricCard';
import { api, socket } from '../config/api';
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid,
  Tooltip, XAxis, YAxis, Legend, Brush
} from 'recharts';

const flattenReading = (payload) => (payload?.metrics
  ? { ...payload.metrics, timestamp: payload.timestamp, location: payload.location }
  : payload || {});

// ── AQI helpers ────────────────────────────────────────────────
const calculateAQI = (pm25) => {
  if (pm25 <= 12)    return Math.round((50 / 12) * pm25);
  if (pm25 <= 35.4)  return Math.round(((100 - 51) / (35.4 - 12.1)) * (pm25 - 12.1) + 51);
  if (pm25 <= 55.4)  return Math.round(((150 - 101) / (55.4 - 35.5)) * (pm25 - 35.5) + 101);
  if (pm25 <= 150.4) return Math.round(((200 - 151) / (150.4 - 55.5)) * (pm25 - 55.5) + 151);
  if (pm25 <= 250.4) return Math.round(((300 - 201) / (250.4 - 150.5)) * (pm25 - 150.5) + 201);
  return Math.round(((500 - 301) / (500.4 - 250.5)) * (pm25 - 250.5) + 301);
};

const getAQICategory = (aqi) => {
  if (aqi <= 50)  return { label: 'Good',                        color: '#00e400', bg: 'rgba(0,228,0,0.08)',   border: 'rgba(0,228,0,0.35)' };
  if (aqi <= 100) return { label: 'Moderate',                    color: '#ff9800', bg: 'rgba(255,152,0,0.08)', border: 'rgba(255,152,0,0.4)' };
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: '#ff7e00', bg: 'rgba(255,126,0,0.08)', border: 'rgba(255,126,0,0.4)' };
  if (aqi <= 200) return { label: 'Unhealthy',                   color: '#ff0000', bg: 'rgba(255,0,0,0.08)',   border: 'rgba(255,0,0,0.35)' };
  if (aqi <= 300) return { label: 'Very Unhealthy',              color: '#8f3f97', bg: 'rgba(143,63,151,0.1)', border: 'rgba(143,63,151,0.4)' };
  return           { label: 'Hazardous',                         color: '#7e0023', bg: 'rgba(126,0,35,0.1)',   border: 'rgba(126,0,35,0.4)' };
};

// ── "time ago" helper ──────────────────────────────────────────
const timeAgo = (date) => {
  if (!date) return null;
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60)  return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
};

export default function RealTimeData() {
  const [metrics,         setMetrics]         = useState({});
  const [series,          setSeries]          = useState([]);
  const [isServerConnected, setIsServerConnected] = useState(false);
  const [isSensorActive,  setIsSensorActive]  = useState(false);
  const [lastUpdate,      setLastUpdate]      = useState(null);
  const [updateCount,     setUpdateCount]     = useState(0);
  const [alerts,          setAlerts]          = useState([]);
  const [autoRefresh,     setAutoRefresh]     = useState(true);
  const [sensorHealth,    setSensorHealth]    = useState(null);
  const [tick,            setTick]            = useState(0);

  // re-render every second so "time ago" stays fresh
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Statistics ───────────────────────────────────────────────
  const stats = useMemo(() => {
    if (series.length === 0) return null;
    const calc = (key) => {
      const vals = series.map(s => s[key]).filter(v => v != null);
      if (!vals.length) return null;
      return {
        current: vals[vals.length - 1],
        min: Math.min(...vals),
        max: Math.max(...vals),
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
        trend: vals.length > 1 ? vals[vals.length - 1] - vals[vals.length - 2] : 0,
      };
    };
    return {
      pm1: calc('pm1'), pm25: calc('pm25'), pm10: calc('pm10'),
      co: calc('co'), co2: calc('co2'), o3: calc('o3'),
      temperature: calc('temperature'), humidity: calc('humidity'),
      voc_index: calc('voc_index'), nox_index: calc('nox_index'),
    };
  }, [series]);

  const currentAQI = useMemo(() => {
    if (!metrics.pm25) return null;
    const aqi = calculateAQI(metrics.pm25);
    return { value: aqi, ...getAQICategory(aqi) };
  }, [metrics.pm25]);

  // ── Alert checker ────────────────────────────────────────────
  const checkAlerts = (data) => {
    const thresholds = {
      pm25: { value: 35.4, label: 'PM2.5' },
      pm10: { value: 154,  label: 'PM10'  },
      co:   { value: 9,    label: 'CO'    },
      co2:  { value: 1000, label: 'CO₂'  },
      o3:   { value: 0.07, label: 'O₃'   },
      voc_index: { value: 250, label: 'VOC' },
      nox_index: { value: 250, label: 'NOx' },
    };
    const newAlerts = Object.keys(thresholds)
      .filter(k => data[k] > thresholds[k].value)
      .map(k => ({
        id: Date.now() + k, metric: thresholds[k].label,
        value: data[k], threshold: thresholds[k].value,
        timestamp: new Date().toLocaleTimeString(),
      }));
    if (newAlerts.length) setAlerts(prev => [...newAlerts, ...prev].slice(0, 5));
  };

  // ── Sensor data socket + seed ────────────────────────────────
  useEffect(() => {
    let active = true;
    let sensorTimeout;

    const seed = async () => {
      try {
        const resp = await api.get('/api/sensor-data/latest');
        if (!active || !resp?.data) return;
        const flat = flattenReading(resp.data);
        const ts   = flat?.timestamp ? new Date(flat.timestamp).getTime() : Date.now();
        const aqi  = flat.pm25 ? calculateAQI(flat.pm25) : null;
        setMetrics(prev => ({ ...prev, ...flat }));
        setSeries(prev  => [...prev.slice(-49), { ...flat, ts, aqi }]);
        setLastUpdate(new Date());
      } catch (err) { console.error('Seed error:', err); }
    };

    seed();
    if (!socket.connected) socket.connect();

    const onConnect    = () => setIsServerConnected(true);
    const onDisconnect = () => { setIsServerConnected(false); setIsSensorActive(false); };
    const onSensor     = (payload) => {
      if (!autoRefresh || !active) return;
      setIsSensorActive(true);
      clearTimeout(sensorTimeout);
      sensorTimeout = setTimeout(() => { if (active) setIsSensorActive(false); }, 10000);

      const flat = flattenReading(payload);
      const ts   = flat?.timestamp ? new Date(flat.timestamp).getTime() : Date.now();
      const aqi  = flat.pm25 ? calculateAQI(flat.pm25) : null;
      setMetrics(prev => ({ ...prev, ...flat }));
      setSeries(prev  => [...prev.slice(-49), { ...flat, ts, aqi }]);
      setLastUpdate(new Date());
      setUpdateCount(prev => prev + 1);
      checkAlerts(flat);
    };

    socket.on('connect',    onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('sensorData', onSensor);
    if (socket.connected) setIsServerConnected(true);

    return () => {
      active = false;
      clearTimeout(sensorTimeout);
      socket.off('connect',    onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('sensorData', onSensor);
    };
  }, [autoRefresh]);

  // ── Sensor health ────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    const fetch = async () => {
      try {
        const resp = await api.get('/api/diagnostics/sensor-status');
        if (active && resp?.data) setSensorHealth(resp.data);
      } catch (_) {}
    };
    fetch();
    const iv = setInterval(fetch, 30000);
    return () => { active = false; clearInterval(iv); };
  }, []);

  // ── CSV export ───────────────────────────────────────────────
  const exportCSV = () => {
    const hdr = ['Timestamp','PM1.0','PM2.5','PM10','CO','CO2','O3','Temp','Humidity','VOC','NOx'];
    const rows = series.map(s => [
      new Date(s.ts).toLocaleString(),
      s.pm1||'', s.pm25||'', s.pm10||'', s.co||'', s.co2||'', s.o3||'',
      s.temperature||'', s.humidity||'', s.voc_index||'', s.nox_index||'',
    ]);
    const csv = [hdr, ...rows].map(r => r.join(',')).join('\n');
    const a   = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `realtime-${new Date().toISOString()}.csv`,
    });
    a.click();
  };

  // ── Shared card style ────────────────────────────────────────
  const cardStyle = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
    padding: '20px 24px',
    marginBottom: '16px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
  };

  const agoStr = timeAgo(lastUpdate);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ padding: '28px', maxWidth: '1400px', margin: '0 auto' }}>

      {/* ── HEADER ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'20px', flexWrap:'wrap', gap:'12px' }}>
        <div>
          <h2 style={{ margin:'0 0 10px 0', fontSize:'28px', fontWeight:'700', letterSpacing:'-0.02em' }}>
            Real-Time Monitoring
          </h2>
          <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
            {/* Server pill */}
            <span style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'13px', fontWeight:'600',
              padding:'4px 12px', borderRadius:'20px',
              background: isServerConnected ? 'rgba(0,228,0,0.12)' : 'rgba(239,68,68,0.12)',
              border: `1px solid ${isServerConnected ? 'rgba(0,228,0,0.4)' : 'rgba(239,68,68,0.4)'}`,
              color: isServerConnected ? '#00e400' : '#ef4444' }}>
              <span style={{ width:'7px', height:'7px', borderRadius:'50%', background: isServerConnected ? '#00e400' : '#ef4444',
                boxShadow: `0 0 8px ${isServerConnected ? '#00e400' : '#ef4444'}`,
                animation: isServerConnected ? 'pulse 2s infinite' : 'none' }} />
              {isServerConnected ? 'Server Online' : 'Server Offline'}
            </span>
            {/* Sensor pill */}
            <span style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'13px', fontWeight:'600',
              padding:'4px 12px', borderRadius:'20px',
              background: isSensorActive ? 'rgba(0,179,255,0.12)' : 'rgba(255,152,0,0.12)',
              border: `1px solid ${isSensorActive ? 'rgba(0,179,255,0.4)' : 'rgba(255,152,0,0.4)'}`,
              color: isSensorActive ? '#00b3ff' : '#ff9800' }}>
              <span style={{ width:'7px', height:'7px', borderRadius:'50%',
                background: isSensorActive ? '#00b3ff' : '#ff9800',
                animation: isSensorActive ? 'pulse 1.5s infinite' : 'none' }} />
              {isSensorActive ? 'Receiving Data' : 'Awaiting Sensor'}
            </span>
            <span style={{ fontSize:'13px', color:'rgba(255,255,255,0.4)' }}>
              {updateCount} updates this session
            </span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <button onClick={() => setAutoRefresh(!autoRefresh)}
            style={{ display:'inline-flex', alignItems:'center', gap:'6px', padding:'8px 16px',
              borderRadius:'8px', border:'1px solid rgba(0,229,160,0.5)',
              background: autoRefresh ? 'rgba(0,229,160,0.12)' : 'rgba(255,255,255,0.05)',
              color: autoRefresh ? '#00e5a0' : 'rgba(255,255,255,0.6)', cursor:'pointer', fontSize:'13px', fontWeight:'600' }}>
            {autoRefresh ? '⏸ Pause' : '▶ Resume'}
          </button>
          <button onClick={exportCSV}
            style={{ display:'inline-flex', alignItems:'center', gap:'6px', padding:'8px 16px',
              borderRadius:'8px', border:'1px solid rgba(255,255,255,0.1)',
              background:'rgba(255,255,255,0.05)', color:'rgba(255,255,255,0.7)',
              cursor:'pointer', fontSize:'13px', fontWeight:'600' }}>
            ↓ CSV
          </button>
        </div>
      </div>

      {/* ── LAST DATA RECEIVED card (screenshot style) ── */}
      <div style={{ ...cardStyle, borderColor: lastUpdate ? 'rgba(255,152,0,0.3)' : 'rgba(255,255,255,0.08)',
        display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'16px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'16px' }}>
          {/* Hourglass icon */}
          <div style={{ width:'46px', height:'46px', borderRadius:'12px',
            background:'linear-gradient(135deg,#b45309,#92400e)',
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:'22px', flexShrink:0 }}>
            ⏳
          </div>
          <div>
            <div style={{ fontSize:'11px', fontWeight:'700', letterSpacing:'0.1em',
              textTransform:'uppercase', color:'#ff9800', marginBottom:'4px' }}>
              Last Data Received
            </div>
            <div style={{ fontSize:'28px', fontWeight:'700', lineHeight:1 }}>
              {agoStr || '—'}
            </div>
            {lastUpdate && (
              <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.45)', marginTop:'4px' }}>
                {lastUpdate.toLocaleString()} · {series.length} reading{series.length !== 1 ? 's' : ''} buffered
              </div>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display:'flex', gap:'32px', flexWrap:'wrap' }}>
          {[
            { label:'PM2.5 Avg', value: stats?.pm25?.avg != null ? `${stats.pm25.avg.toFixed(1)} µg/m³` : '—' },
            { label:'PM2.5 Max', value: stats?.pm25?.max != null ? `${stats.pm25.max.toFixed(1)} µg/m³` : '—' },
            { label:'Updates',   value: updateCount },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign:'center' }}>
              <div style={{ fontSize:'18px', fontWeight:'700' }}>{value}</div>
              <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)', textTransform:'uppercase',
                letterSpacing:'0.07em', marginTop:'2px' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── AQI card (screenshot style) ── */}
      {currentAQI ? (
        <div style={{ ...cardStyle, borderColor: currentAQI.border, background: currentAQI.bg }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'12px' }}>
            <div>
              <div style={{ fontSize:'11px', fontWeight:'700', letterSpacing:'0.1em',
                textTransform:'uppercase', color: currentAQI.color, marginBottom:'6px' }}>
                Air Quality Index
              </div>
              <div style={{ fontSize:'56px', fontWeight:'800', lineHeight:1, color:'#fff' }}>
                {currentAQI.value}
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:'24px', fontWeight:'700', color: currentAQI.color }}>
                {currentAQI.label}
              </div>
              <div style={{ fontSize:'13px', color:'rgba(255,255,255,0.45)', marginTop:'4px' }}>
                Based on PM2.5: {metrics.pm25?.toFixed(1) ?? '—'} µg/m³
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ ...cardStyle }}>
          <div style={{ fontSize:'11px', fontWeight:'700', letterSpacing:'0.1em',
            textTransform:'uppercase', color:'rgba(255,152,0,0.8)', marginBottom:'6px' }}>
            Air Quality Index
          </div>
          <div style={{ fontSize:'20px', color:'rgba(255,255,255,0.35)' }}>
            Awaiting PM2.5 data…
          </div>
        </div>
      )}

      {/* ── ALERTS ── */}
      {alerts.length > 0 && (
        <div style={{ marginBottom:'16px' }}>
          {alerts.map(a => (
            <div key={a.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
              background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.35)',
              borderRadius:'8px', padding:'10px 14px', marginBottom:'8px', fontSize:'13px' }}>
              <span>⚠ <strong>{a.metric}</strong>: {a.value.toFixed(2)} exceeds threshold of {a.threshold}</span>
              <span style={{ color:'rgba(255,255,255,0.4)' }}>{a.timestamp}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── SENSOR HEALTH panel ── */}
      {sensorHealth && (
        <div style={{ ...cardStyle,
          borderColor: sensorHealth.status === 'HEALTHY' ? '#22c55e' :
                       sensorHealth.status === 'WARNING'  ? '#f59e0b' : '#ef4444',
          background:  sensorHealth.status === 'HEALTHY' ? 'rgba(34,197,94,0.07)' :
                       sensorHealth.status === 'WARNING'  ? 'rgba(245,158,11,0.07)' : 'rgba(239,68,68,0.07)',
          display:'flex', flexWrap:'wrap', gap:'16px', alignItems:'flex-start' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'12px', flex:'1', minWidth:'200px' }}>
            <div style={{ fontSize:'28px' }}>
              {sensorHealth.status === 'HEALTHY' ? '✅' : sensorHealth.status === 'WARNING' ? '⚠️' : '🔴'}
            </div>
            <div>
              <div style={{ fontWeight:'700', fontSize:'15px', marginBottom:'4px' }}>
                Sensor Health: {sensorHealth.status}
              </div>
              <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.5)', lineHeight:1.6 }}>
                <div>Data age: {Math.floor(sensorHealth.dataAge)} min · Active: {sensorHealth.activeSensors}/{sensorHealth.totalCriticalSensors} critical sensors</div>
                {sensorHealth.issueCount?.total > 0 && (
                  <div style={{ color:'#ef4444', marginTop:'4px' }}>
                    🔧 {sensorHealth.issueCount.critical} critical · {sensorHealth.issueCount.warning} warnings
                  </div>
                )}
              </div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(80px,1fr))', gap:'8px', flex:2, minWidth:'300px' }}>
            {Object.entries(sensorHealth.sensorStatus || {}).slice(0, 8).map(([s, st]) => (
              <div key={s} style={{ padding:'8px', borderRadius:'8px', textAlign:'center', fontSize:'11px',
                background: st.status === 'OK' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                border: `1px solid ${st.status === 'OK' ? '#22c55e' : '#ef4444'}` }}>
                <div style={{ fontWeight:'700', marginBottom:'2px' }}>{s}</div>
                <div style={{ color: st.status === 'OK' ? '#22c55e' : '#ef4444' }}>
                  {st.status === 'OK' ? '✓' : '✗'}
                </div>
                {st.value != null && (
                  <div style={{ fontSize:'10px', opacity:0.7, marginTop:'2px' }}>
                    {typeof st.value === 'number' ? st.value.toFixed(1) : st.value}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── METRIC CARDS GRID ── */}
      <div className="cards-grid" style={{ marginBottom:'20px' }}>
        <MetricCard title="PM1.0"       value={metrics.pm1}        unit="µg/m³" trend={stats?.pm1?.trend} />
        <MetricCard title="PM2.5"       value={metrics.pm25}       unit="µg/m³" trend={stats?.pm25?.trend} />
        <MetricCard title="PM10"        value={metrics.pm10}       unit="µg/m³" trend={stats?.pm10?.trend} />
        <MetricCard title="CO"          value={metrics.co}         unit="ppm"   trend={stats?.co?.trend} />
        <MetricCard title="CO₂"         value={metrics.co2}        unit="ppm"   trend={stats?.co2?.trend} />
        <MetricCard title="O₃"          value={metrics.o3}         unit="ppm"   trend={stats?.o3?.trend} />
        <MetricCard title="Temperature" value={metrics.temperature} unit="°C"   trend={stats?.temperature?.trend} />
        <MetricCard title="Humidity"    value={metrics.humidity}   unit="%"     trend={stats?.humidity?.trend} />
        <MetricCard title="VOC Index"   value={metrics.voc_index}  unit=""      trend={stats?.voc_index?.trend} />
        <MetricCard title="NOx Index"   value={metrics.nox_index}  unit=""      trend={stats?.nox_index?.trend} />
      </div>

      {/* ── AQI TREND CHART ── */}
      <div className="charts-row">
        <h3>Air Quality Index Trend</h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={series} syncId="rt">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
            <XAxis dataKey="ts" type="number" scale="time" domain={['auto','auto']}
              tickFormatter={v => new Date(v).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })} />
            <YAxis width={48} tickLine={false} />
            <Tooltip labelFormatter={v => new Date(v).toLocaleString()}
              formatter={v => (v ? v.toFixed(1) : 'N/A')} />
            <Legend />
            <Brush height={14} travellerWidth={8} />
            <Line type="monotone" dataKey="aqi" stroke="#ff9800" strokeWidth={2.5}
              dot={false} activeDot={{ r: 5 }} name="AQI" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}