// src/pages/FullDashboard.js
import React, { useEffect, useState, useMemo, useCallback } from "react";
import MetricCard from "../components/MetricCard";
import { api, socket } from "../config/api";

const LIMITS = {
  pm1: 50, pm25: 35.4, pm10: 150,
  co: 9, co2: 1000, o3: 0.07,
  temperature: 40, humidity: 90,
  voc_index: 250, nox_index: 250,
};

const SEVERITY_COLORS = {
  GOOD:      "linear-gradient(180deg,#10b981,#06b6d4)",
  MODERATE:  "linear-gradient(180deg,#f59e0b,#f97316)",
  BAD:       "linear-gradient(180deg,#f97316,#ef4444)",
  HAZARDOUS: "linear-gradient(180deg,#ef4444,#7f1d1d)",
};

const STATUS_BADGE = {
  GOOD:      { label: 'Good',       bg: 'rgba(16,185,129,0.15)',  border: '#10b981', text: '#34d399' },
  MODERATE:  { label: 'Moderate',   bg: 'rgba(245,158,11,0.15)',  border: '#f59e0b', text: '#fcd34d' },
  BAD:       { label: 'Unhealthy',  bg: 'rgba(249,115,22,0.15)',  border: '#f97316', text: '#fdba74' },
  HAZARDOUS: { label: 'Hazardous',  bg: 'rgba(239,68,68,0.15)',   border: '#ef4444', text: '#fca5a5' },
};

const METRICS_LIST = [
  { label: "PM1.0",       key: "pm1",         unit: "µg/m³" },
  { label: "PM2.5",       key: "pm25",         unit: "µg/m³" },
  { label: "PM10",        key: "pm10",         unit: "µg/m³" },
  { label: "CO",          key: "co",           unit: "ppm" },
  { label: "CO₂",         key: "co2",          unit: "ppm" },
  { label: "O₃",          key: "o3",           unit: "ppm" },
  { label: "Temperature", key: "temperature",  unit: "°C" },
  { label: "Humidity",    key: "humidity",     unit: "%" },
  { label: "VOC",         key: "voc_index",    unit: "index" },
  { label: "NOx",         key: "nox_index",    unit: "index" },
];

const flattenReading = (payload) =>
  payload?.metrics
    ? { ...payload.metrics, timestamp: payload.timestamp, location: payload.location }
    : payload || {};

export default function FullDashboard() {
  const [metrics, setMetrics]     = useState({});
  const [airStatus, setAirStatus] = useState("GOOD");
  const [causes, setCauses]       = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isLive, setIsLive]       = useState(false);

  const getSeverity = useCallback((key, value) => {
    const limit = LIMITS[key];
    if (value == null || !limit) return "GOOD";
    if (value < limit * 0.5) return "GOOD";
    if (value < limit)       return "MODERATE";
    if (value < limit * 2)   return "BAD";
    return "HAZARDOUS";
  }, []);

  const evaluateAirQuality = useCallback((data) => {
    let worstLevel = "GOOD";
    const pollutantCauses = [];
    const rank = ["GOOD", "MODERATE", "BAD", "HAZARDOUS"];

    for (const key in LIMITS) {
      const value = data[key];
      if (value === undefined) continue;
      const level = getSeverity(key, value);
      if (level === "BAD" || level === "HAZARDOUS") {
        pollutantCauses.push({ key, value, level });
      }
      if (rank.indexOf(level) > rank.indexOf(worstLevel)) worstLevel = level;
    }
    setAirStatus(worstLevel);
    setCauses(pollutantCauses);
  }, [getSeverity]);

  useEffect(() => {
    let isMounted = true;
    let sensorTimeout;

    const hydrateFromLatest = async () => {
      try {
        const resp = await api.get("/api/sensor-data/latest");
        if (!isMounted || !resp?.data) return;
        const flat = flattenReading(resp.data);
        setMetrics(prev => ({ ...prev, ...flat }));
        evaluateAirQuality(flat);
        setLastUpdate(new Date());
        setIsLoading(false);
      } catch {
        setIsLoading(false);
      }
    };

    hydrateFromLatest();
    if (!socket.connected) socket.connect();

    const handleSensor = (payload) => {
      const flat = flattenReading(payload);
      setMetrics(prev => ({ ...prev, ...flat }));
      evaluateAirQuality(flat);
      setLastUpdate(new Date());
      setIsLive(true);
      clearTimeout(sensorTimeout);
      sensorTimeout = setTimeout(() => { if (isMounted) setIsLive(false); }, 5000);
    };

    socket.on("sensorData", handleSensor);
    return () => {
      isMounted = false;
      clearTimeout(sensorTimeout);
      socket.off("sensorData", handleSensor);
    };
  }, [evaluateAirQuality]);

  const badge = STATUS_BADGE[airStatus] || STATUS_BADGE.GOOD;

  // Active sensor count
  const activeSensors = useMemo(() =>
    METRICS_LIST.filter(m => metrics[m.key] != null).length,
    [metrics]
  );

  return (
    <div className="fade-in">
      {/* ── Page Header ── */}
      <div className="header-row">
        <div>
          <h2 className="header-title">Live Air Quality Dashboard</h2>
          <p className="header-sub">
            Sensor readings updated in real-time via WebSocket
            {lastUpdate && ` · Last update: ${lastUpdate.toLocaleTimeString()}`}
          </p>
        </div>
        <div className="header-controls">
          {/* Live indicator */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8, padding: '6px 12px',
            fontSize: 12, fontWeight: 500,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: isLive ? '#10b981' : '#94a3b8',
              boxShadow: isLive ? '0 0 8px #10b981' : 'none',
              animation: isLive ? 'pulse 2s infinite' : 'none',
            }} />
            {isLive ? 'Receiving Data' : 'Standby'}
          </div>

          {/* Sensors count */}
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8, padding: '6px 12px',
            fontSize: 12, fontWeight: 600,
          }}>
            {activeSensors}/{METRICS_LIST.length} Sensors
          </div>
        </div>
      </div>

      {/* ── Air Quality Status Banner ── */}
      <div style={{
        background: badge.bg,
        border: `1px solid ${badge.border}`,
        borderRadius: 14,
        padding: '18px 24px',
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        flexWrap: 'wrap',
      }}>
        {/* Status icon/badge */}
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: badge.border,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, flexShrink: 0,
          boxShadow: `0 4px 16px ${badge.border}55`,
        }}>
          {airStatus === 'GOOD' ? '✓' : airStatus === 'MODERATE' ? '~' : airStatus === 'BAD' ? '!' : '✕'}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: badge.text, marginBottom: 4 }}>
            Overall Air Quality
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: badge.text, letterSpacing: '-0.02em', lineHeight: 1 }}>
            {badge.label}
          </div>
          {causes.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
              Elevated: {causes.map(c => c.key.toUpperCase()).join(' · ')}
            </div>
          )}
        </div>

        {/* Pollutants causing issues */}
        {causes.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {causes.map((c, i) => (
              <div key={i} style={{
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '6px 12px',
                fontSize: 12, textAlign: 'center',
              }}>
                <div style={{ fontWeight: 700, color: badge.text }}>{c.key.toUpperCase()}</div>
                <div style={{ opacity: 0.6, marginTop: 2 }}>{typeof c.value === 'number' ? c.value.toFixed(1) : c.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Loading State ── */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: 60, opacity: 0.5 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⟳</div>
          <div>Loading sensor data…</div>
        </div>
      )}

      {/* ── Metric Cards Grid ── */}
      {!isLoading && (
        <div className="cards-grid">
          {METRICS_LIST.map(item => {
            const sev   = getSeverity(item.key, metrics[item.key]);
            const color = SEVERITY_COLORS[sev];
            return (
              <MetricCard
                key={item.key}
                title={item.label}
                value={metrics[item.key] ?? null}
                unit={item.unit}
                color={color}
              />
            );
          })}
        </div>
      )}

      {/* Pulse animation style */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
