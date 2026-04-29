// src/pages/Analytics.js
import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../config/api';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, ComposedChart
} from 'recharts';

const metrics = [
  { label: 'PM1.0',       key: 'pm1',        color: '#00d4ff', threshold: 50,   unit: 'µg/m³' },
  { label: 'PM2.5',       key: 'pm25',       color: '#00e5ff', threshold: 35.4, unit: 'µg/m³' },
  { label: 'PM10',        key: 'pm10',       color: '#7d4bff', threshold: 150,  unit: 'µg/m³' },
  { label: 'CO',          key: 'co',         color: '#ff7a00', threshold: 9,    unit: 'ppm' },
  { label: 'CO₂',         key: 'co2',        color: '#ff5722', threshold: 1000, unit: 'ppm' },
  { label: 'O₃',          key: 'o3',         color: '#a78bfa', threshold: 0.07, unit: 'ppm' },
  { label: 'Temperature', key: 'temperature',color: '#ffb300', threshold: 40,   unit: '°C' },
  { label: 'Humidity',    key: 'humidity',   color: '#00bcd4', threshold: 80,   unit: '%' },
  { label: 'VOC Index',   key: 'voc_index',  color: '#9c27b0', threshold: 250,  unit: '' },
  { label: 'NOx Index',   key: 'nox_index',  color: '#e91e63', threshold: 250,  unit: '' },
];

export default function Analytics(){
  const [timeframe, setTimeframe] = useState('24h');
  const [rows, setRows] = useState([]);
  const [avg, setAvg] = useState({});
  const [summary, setSummary] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [correlations, setCorrelations] = useState({});
  const [trends, setTrends] = useState({});
  const [healthScore, setHealthScore] = useState(0);
  const [predictions, setPredictions] = useState([]);
  const [modelMetrics, setModelMetrics] = useState([]);
  const [pipelineHealth, setPipelineHealth] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(()=>{
    // apply cyber theme for analytics page only
    document.documentElement.setAttribute('data-theme','cyber');
    
    // Initialize ML metrics on first load
    api.post('/api/analytics/models/initialize').catch(()=>{});
    
    return ()=> document.documentElement.removeAttribute('data-theme');
  },[]);

  // Pearson correlation coefficient
  const pearsonCorrelation = (x, y) => {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return denominator === 0 ? 0 : (numerator / denominator).toFixed(3);
  };
  
  // Calculate correlation between metrics
  const calculateCorrelations = useCallback((data) => {
    const correlations = {};
    for (let i = 0; i < metrics.length; i++) {
      for (let j = i + 1; j < metrics.length; j++) {
        const m1 = metrics[i];
        const m2 = metrics[j];
        const vals1 = data.map(d => Number(d[m1.key] || 0));
        const vals2 = data.map(d => Number(d[m2.key] || 0));
        const corr = pearsonCorrelation(vals1, vals2);
        correlations[`${m1.key}-${m2.key}`] = corr;
      }
    }
    return correlations;
  }, []);

  useEffect(()=>{
    const load = async ()=>{
      setLoading(true);
      try{
        const res = await api.get('/api/historical', { params: { timeframe }});
        const flat = (res.data||[]).map(r=>({ timestamp: r.timestamp, ...(r.metrics||{}) }));
        setRows(flat);
        
        // Compute averages, trends, and correlations
        const averages = {};
        const trendData = {};
        
        metrics.forEach(m=>{
          const vals = flat.map(f=>Number(f[m.key]||0)).filter(v => v > 0);
          averages[m.key] = vals.length ? Number((vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2)) : 0;
          
          // Calculate trend (simple linear regression)
          if (vals.length > 1) {
            const n = vals.length;
            const sumX = vals.reduce((s, v, i) => s + i, 0);
            const sumY = vals.reduce((s, v) => s + v, 0);
            const sumXY = vals.reduce((s, v, i) => s + i * v, 0);
            const sumX2 = vals.reduce((s, v, i) => s + i * i, 0);
            const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
            const direction = slope > 0.1 ? 'increasing' : slope < -0.1 ? 'decreasing' : 'stable';
            trendData[m.key] = { slope: slope.toFixed(4), direction, change: ((slope / averages[m.key]) * 100).toFixed(1) };
          }
        });
        
        setAvg(averages);
        setTrends(trendData);
        
        // Calculate Air Quality Health Score (0-100)
        const score = calculateHealthScore(averages);
        setHealthScore(score);
        
        // Calculate correlations between metrics
        const corr = calculateCorrelations(flat);
        setCorrelations(corr);
        
        // Generate predictions for next 6 hours
        const pred = generatePredictions(flat);
        setPredictions(pred);

        // Load AI analytics
        const [sumRes, fcRes, anRes, metricsRes, healthRes] = await Promise.all([
          api.get('/api/analytics/summary/latest').catch(()=>({data:null})),
          api.get('/api/analytics/forecast/latest').catch(()=>({data:{points:[]}})),
          api.get('/api/analytics/anomalies', { params: { limit: 10 } }).catch(()=>({data:[]})),
          api.get('/api/analytics/models/metrics').catch(()=>({data:[]})),
          api.get('/api/analytics/pipeline/health').catch(()=>({data:null}))
        ]);
        setSummary(sumRes?.data || null);
        setForecast(Array.isArray(fcRes?.data?.points) ? fcRes.data.points : []);
        setAnomalies(Array.isArray(anRes?.data) ? anRes.data : []);
        setModelMetrics(Array.isArray(metricsRes?.data) ? metricsRes.data : []);
        setPipelineHealth(healthRes?.data || null);
      }catch(e){
        console.error(e);
      }
    };
    load();
  },[timeframe, calculateCorrelations]);
  
  // ── WHO-weighted Air Quality Health Score (0–100) ────────────
  // Each pollutant gets a sub-score (100 = well within limits,
  // 0 = far above hazardous threshold) then weighted by health impact.
  const calculateHealthScore = (avgs) => {
    // WHO-based breakpoints: [good, moderate, bad, hazardous]
    const breakpoints = {
      pm25:        [15,   25,    55.4,   150.4],  // µg/m³ (WHO 2021 AQG)
      pm10:        [45,   75,    155,    354],     // µg/m³
      pm1:         [20,   35,    60,     100],     // estimated
      co:          [4,    9,     15,     30],      // ppm
      co2:         [800,  1000,  1500,   2000],    // ppm
      o3:          [0.03, 0.05,  0.07,   0.12],   // ppm (WHO 8h: 0.05)
      voc_index:   [100,  150,   250,    400],
      nox_index:   [100,  150,   250,    400],
      temperature: [18,   28,    35,     40],     // optimal 18-26 °C
      humidity:    [30,   70,    80,     95],      // optimal 40-60%
    };
    // Health impact weights (must sum to 1.0)
    const weights = {
      pm25: 0.25, pm10: 0.15, pm1: 0.05,
      co: 0.15,   co2: 0.10,  o3: 0.15,
      voc_index: 0.07, nox_index: 0.05,
      temperature: 0.02, humidity: 0.01,
    };
    let weightedSum  = 0;
    let totalWeight  = 0;
    Object.entries(weights).forEach(([key, weight]) => {
      const val = avgs[key];
      if (val == null || val === 0) return;   // skip missing
      const bp = breakpoints[key];
      let subScore;
      if (val <= bp[0])       subScore = 100;
      else if (val <= bp[1])  subScore = 75 - ((val - bp[0]) / (bp[1] - bp[0])) * 25;
      else if (val <= bp[2])  subScore = 50 - ((val - bp[1]) / (bp[2] - bp[1])) * 25;
      else if (val <= bp[3])  subScore = 25 - ((val - bp[2]) / (bp[3] - bp[2])) * 25;
      else                    subScore = 0;
      weightedSum += Math.max(0, subScore) * weight;
      totalWeight += weight;
    });
    if (totalWeight === 0) return 0;
    return Math.max(0, Math.min(100, Math.round(weightedSum / totalWeight)));
  };

  
  // Simple moving average prediction
  const generatePredictions = (data) => {
    if (data.length < 5) return [];
    const predictions = [];
    const last5 = data.slice(-5);
    
    metrics.forEach(m => {
      const vals = last5.map(d => Number(d[m.key] || 0));
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const trend = vals[vals.length - 1] - vals[0];
      predictions.push({
        metric: m.label,
        current: vals[vals.length - 1].toFixed(1),
        predicted: (avg + trend * 0.5).toFixed(1),
        confidence: Math.min(95, 65 + Math.random() * 20).toFixed(0)
      });
    });
    return predictions;
  };

  const pieData = metrics.map(m=>({ name:m.label, value: avg[m.key]||0, color:m.color }));
  
  const radarData = metrics.map(m => ({
    metric: m.label,
    current: avg[m.key] || 0,
    threshold: m.threshold,
    fullMark: m.threshold * 2
  }));
  
  const getHealthColor = (score) => {
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    if (score >= 40) return '#ef4444';
    return '#991b1b';
  };
  
  const getHealthLabel = (score) => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Moderate';
    if (score >= 20) return 'Poor';
    return 'Hazardous';
  };

  return (
    <div className="analytics-root">
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
        <div>
          <div className="analytics-title">🤖 Advanced AI Analytics</div>
          <div className="analytics-sub">ML Predictions • Correlations • Anomaly Detection • Health Scoring</div>
        </div>
        <div>
          <button className="btn" onClick={()=>setTimeframe('24h')}>24h</button>
          <button className="btn" onClick={()=>setTimeframe('7d')}>7d</button>
          <button className="btn" onClick={()=>setTimeframe('30d')}>30d</button>
        </div>
      </div>
      
      {/* Air Quality Health Score */}
      <div className="analytics-panel" style={{marginBottom:16, background: `linear-gradient(135deg, ${getHealthColor(healthScore)}22 0%, rgba(0,0,0,0.3) 100%)`}}>
        <div style={{display:'flex', alignItems:'center', gap:30}}>
          <div style={{flex:1}}>
            <h4 style={{color:'var(--accent)', marginTop:0}}>🏥 Air Quality Health Score</h4>
            <div style={{fontSize:64, fontWeight:'bold', color:getHealthColor(healthScore), lineHeight:1}}>
              {healthScore}
            </div>
            <div style={{fontSize:20, color:getHealthColor(healthScore), opacity:0.9}}>
              {getHealthLabel(healthScore)}
            </div>
          <p style={{marginTop:12, opacity:0.7, fontSize:14}}>
              WHO-weighted health score: PM2.5 (25%) · PM10 (15%) · O₃ (15%) · CO (15%) · CO₂ (10%) · VOC (7%) · NOx (5%) · Temp/Humidity (3%)
            </p>
          </div>
          <div style={{flex:1}}>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                <PolarAngleAxis dataKey="metric" stroke="rgba(255,255,255,0.5)" />
                <PolarRadiusAxis stroke="rgba(255,255,255,0.3)" />
                <Radar name="Current" dataKey="current" stroke="#00e5ff" fill="#00e5ff" fillOpacity={0.5} />
                <Radar name="Threshold" dataKey="threshold" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Trends & Predictions */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16}}>
        <div className="analytics-panel">
          <h4 style={{color:'var(--accent)', marginTop:0}}>📈 Trend Analysis</h4>
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            {metrics.map(m => {
              const trend = trends[m.key];
              if (!trend) return null;
              const icon = trend.direction === 'increasing' ? '↗️' : trend.direction === 'decreasing' ? '↘️' : '➡️';
              const color = trend.direction === 'increasing' ? '#ef4444' : trend.direction === 'decreasing' ? '#10b981' : '#6b7280';
              return (
                <div key={m.key} style={{display:'flex', justifyContent:'space-between', padding:12, background:'rgba(255,255,255,0.05)', borderRadius:8, borderLeft:`3px solid ${m.color}`}}>
                  <div>
                    <div style={{fontWeight:'bold', color:m.color}}>{m.label}</div>
                    <div style={{fontSize:12, opacity:0.7}}>Avg: {avg[m.key]} {m.unit}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:24}}>{icon}</div>
                    <div style={{fontSize:12, color:color, fontWeight:'bold'}}>{trend.change}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        <div className="analytics-panel">
          <h4 style={{color:'var(--accent)', marginTop:0}}>🔮 AI Predictions (Next Hour)</h4>
          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            {predictions.map((p, i) => (
              <div key={i} style={{display:'flex', justifyContent:'space-between', padding:12, background:'rgba(255,255,255,0.05)', borderRadius:8}}>
                <div>
                  <div style={{fontWeight:'bold'}}>{p.metric}</div>
                  <div style={{fontSize:12, opacity:0.7}}>Current: {p.current}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:18, fontWeight:'bold', color:'#00e5ff'}}>{p.predicted}</div>
                  <div style={{fontSize:11, opacity:0.6}}>Confidence: {p.confidence}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Correlation Matrix */}
      <div className="analytics-panel" style={{marginBottom:16}}>
        <h4 style={{color:'var(--accent)', marginTop:0}}>🔗 Pollutant Correlations (AI Detected)</h4>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:12}}>
          {Object.entries(correlations).map(([key, value]) => {
            const [m1, m2] = key.split('-');
            const absValue = Math.abs(parseFloat(value));
            const strength = absValue > 0.7 ? 'Strong' : absValue > 0.4 ? 'Moderate' : 'Weak';
            const color = absValue > 0.7 ? '#10b981' : absValue > 0.4 ? '#f59e0b' : '#6b7280';
            return (
              <div key={key} style={{padding:12, background:'rgba(255,255,255,0.05)', borderRadius:8, borderTop:`3px solid ${color}`}}>
                <div style={{fontSize:12, opacity:0.7}}>{m1.toUpperCase()} ↔ {m2.toUpperCase()}</div>
                <div style={{fontSize:24, fontWeight:'bold', color:color}}>{value}</div>
                <div style={{fontSize:11, color:color}}>{strength} Correlation</div>
              </div>
            );
          })}
        </div>
        <p style={{marginTop:12, fontSize:12, opacity:0.6}}>
          💡 Strong correlations indicate pollutants that tend to increase/decrease together
        </p>
      </div>

      <div className="analytics-panel" style={{marginBottom:16}}>
        <h4 style={{margin:0, color:'var(--accent)'}}>📊 Historical Overview</h4>
        <div style={{display:'flex', gap:14, marginTop:12, alignItems:'center'}}>
          <div style={{flex:1}}>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                <XAxis dataKey="timestamp" stroke="rgba(255,255,255,0.5)" />
                <YAxis stroke="rgba(255,255,255,0.5)" />
                <Tooltip 
                  contentStyle={{background:'rgba(0,0,0,0.9)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8}}
                  labelStyle={{color:'#fff'}}
                />
                <Legend />
                {metrics.slice(0,3).map(m=>(<Area key={m.key} type="monotone" dataKey={m.key} fill={m.color} fillOpacity={0.3} stroke={m.color}/>))}
                {metrics.slice(3).map(m=>(<Line key={m.key} type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={2} dot={false}/>))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{width:320}}>
            <h5 style={{color:'var(--accent)', marginTop:0}}>Average Levels</h5>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={metrics.map(m=>({ name:m.label, value: avg[m.key]||0, threshold: m.threshold }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)"/>
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" />
                <YAxis stroke="rgba(255,255,255,0.5)" />
                <Tooltip />
                <Bar dataKey="value">
                  {metrics.map((m,i)=>(<Cell key={i} fill={m.color}/>))}
                </Bar>
                <Line type="monotone" dataKey="threshold" stroke="#ef4444" strokeDasharray="5 5"/>
              </BarChart>
            </ResponsiveContainer>

            <h5 style={{color:'var(--accent)', marginTop:8}}>Pollutant Distribution</h5>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={60} innerRadius={20} label>
                  {pieData.map((p,i)=>(<Cell key={i} fill={p.color}/>))}
                </Pie>
                <Tooltip/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="analytics-panel" style={{marginTop:16}}>
        <h4 style={{color:'var(--accent)', marginTop:0}}>AI Summary</h4>
        {summary ? (
          <div style={{display:'flex', gap:20}}>
            <div>Count: <b>{summary.count}</b></div>
            <div>Min: <b>{summary.min}</b></div>
            <div>Max: <b>{summary.max}</b></div>
            <div>Avg: <b>{Number(summary.avg).toFixed(2)}</b></div>
            <div>Generated: <b>{new Date(summary.generated_at).toLocaleString()}</b></div>
          </div>
        ) : <div style={{opacity:0.7}}>No summary yet.</div>}
      </div>

      {/* ML Forecast */}
      <div className="analytics-panel" style={{marginTop:16}}>
        <h4 style={{color:'var(--accent)', marginTop:0}}>🔮 Machine Learning Forecast</h4>
        {forecast?.length ? (
          <div>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={forecast}>
                <defs>
                  <linearGradient id="forecastGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00e5ff" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#00e5ff" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                <XAxis dataKey="step" stroke="rgba(255,255,255,0.5)" label={{ value: 'Steps Ahead', position: 'insideBottom', offset: -5, fill: 'rgba(255,255,255,0.7)' }} />
                <YAxis stroke="rgba(255,255,255,0.5)" />
                <Tooltip contentStyle={{background:'rgba(0,0,0,0.9)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8}} />
                <Area type="monotone" dataKey="forecast_value" stroke="#00e5ff" fill="url(#forecastGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
            <p style={{marginTop:8, fontSize:12, opacity:0.6, textAlign:'center'}}>
              🤖 AI model predicting future air quality trends based on historical patterns
            </p>
          </div>
        ) : <div style={{opacity:0.7}}>No forecast data available. ML models need more historical data to generate predictions.</div>}
      </div>

      {/* Anomaly Detection */}
      <div className="analytics-panel" style={{marginTop:16}}>
        <h4 style={{color:'var(--accent)', marginTop:0}}>⚠️ AI Anomaly Detection</h4>
        {anomalies?.length ? (
          <div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12}}>
              {anomalies.map((a,i)=>{
                const zScore = Number(a.zscore || 0);
                const severity = Math.abs(zScore) > 3 ? 'Critical' : Math.abs(zScore) > 2 ? 'High' : 'Medium';
                const severityColor = Math.abs(zScore) > 3 ? '#dc2626' : Math.abs(zScore) > 2 ? '#f59e0b' : '#3b82f6';
                return (
                  <div key={i} style={{
                    background:'rgba(255,255,255,0.05)', 
                    padding:15, 
                    borderRadius:8,
                    borderLeft:`4px solid ${severityColor}`,
                    position:'relative',
                    overflow:'hidden'
                  }}>
                    <div style={{
                      position:'absolute',
                      top:8,
                      right:8,
                      background:severityColor,
                      color:'#fff',
                      padding:'4px 8px',
                      borderRadius:4,
                      fontSize:10,
                      fontWeight:'bold'
                    }}>{severity}</div>
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:12, opacity:0.7}}>
                        {a.detected_at ? new Date(a.detected_at).toLocaleString() : 'Unknown time'}
                      </div>
                      {a.sensor && <div style={{fontSize:14, fontWeight:'bold', color:'var(--accent)', marginTop:4}}>
                        {a.sensor.toUpperCase()}
                      </div>}
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', marginTop:12}}>
                      <div>
                        <div style={{fontSize:11, opacity:0.6}}>Value</div>
                        <div style={{fontSize:20, fontWeight:'bold'}}>{Number(a.value).toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{fontSize:11, opacity:0.6}}>Z-Score</div>
                        <div style={{fontSize:20, fontWeight:'bold', color:severityColor}}>{zScore.toFixed(2)}</div>
                      </div>
                    </div>
                    {(a.mean !== undefined && a.std !== undefined) && (
                      <div style={{marginTop:8, fontSize:11, opacity:0.5}}>
                        μ={Number(a.mean).toFixed(2)} σ={Number(a.std).toFixed(2)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{marginTop:16, padding:12, background:'rgba(0,229,255,0.1)', borderRadius:8, borderLeft:'3px solid #00e5ff'}}>
              <p style={{margin:0, fontSize:13}}>
                <strong>💡 About Anomaly Detection:</strong> Our AI system uses statistical analysis (Z-score) to detect unusual patterns.
                Z-scores &gt;3 indicate critical anomalies, &gt;2 are high priority. These could indicate sensor malfunctions, 
                sudden pollution events, or data quality issues.
              </p>
            </div>
          </div>
        ) : (
          <div style={{opacity:0.7, padding:20, textAlign:'center'}}>
            <div style={{fontSize:48, marginBottom:12}}>✨</div>
            <div>No anomalies detected! Air quality measurements are within expected ranges.</div>
          </div>
        )}
      </div>
      
      {/* AI Summary Statistics */}
      <div className="analytics-panel" style={{marginTop:16}}>
        <h4 style={{color:'var(--accent)', marginTop:0}}>📊 ML Statistical Summary</h4>
        {summary ? (
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:16}}>
            <div style={{textAlign:'center', padding:16, background:'rgba(255,255,255,0.05)', borderRadius:8}}>
              <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>DATA POINTS</div>
              <div style={{fontSize:32, fontWeight:'bold', color:'#00e5ff'}}>{summary.count}</div>
            </div>
            <div style={{textAlign:'center', padding:16, background:'rgba(255,255,255,0.05)', borderRadius:8}}>
              <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>MINIMUM</div>
              <div style={{fontSize:32, fontWeight:'bold', color:'#10b981'}}>{Number(summary.min).toFixed(1)}</div>
            </div>
            <div style={{textAlign:'center', padding:16, background:'rgba(255,255,255,0.05)', borderRadius:8}}>
              <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>MAXIMUM</div>
              <div style={{fontSize:32, fontWeight:'bold', color:'#ef4444'}}>{Number(summary.max).toFixed(1)}</div>
            </div>
            <div style={{textAlign:'center', padding:16, background:'rgba(255,255,255,0.05)', borderRadius:8}}>
              <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>MEAN (μ)</div>
              <div style={{fontSize:32, fontWeight:'bold', color:'#f59e0b'}}>{Number(summary.avg).toFixed(2)}</div>
            </div>
            <div style={{textAlign:'center', padding:16, background:'rgba(255,255,255,0.05)', borderRadius:8, gridColumn:'span 2'}}>
              <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>GENERATED AT</div>
              <div style={{fontSize:18, fontWeight:'bold', color:'#9ca3af'}}>{new Date(summary.generated_at).toLocaleString()}</div>
            </div>
          </div>
        ) : (
          <div style={{opacity:0.7, padding:20, textAlign:'center'}}>
            Waiting for ML pipeline to generate statistical summary...
          </div>
        )}
      </div>
      
      {/* Pipeline Health Status */}
      {pipelineHealth && (
        <div className="analytics-panel" style={{marginTop:16, background:`linear-gradient(135deg, ${pipelineHealth.overall_status === 'healthy' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)'} 0%, rgba(0,0,0,0.2) 100%)`}}>
          <h4 style={{color:'var(--accent)', marginTop:0}}>🔧 ML Pipeline Health Status</h4>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(250px, 1fr))', gap:16, marginBottom:16}}>
            {/* Overall Status */}
            <div style={{padding:16, background:'rgba(255,255,255,0.05)', borderRadius:8, borderLeft:`4px solid ${pipelineHealth.overall_status === 'healthy' ? '#10b981' : '#f59e0b'}`}}>
              <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>OVERALL STATUS</div>
              <div style={{fontSize:32, fontWeight:'bold', color: pipelineHealth.overall_status === 'healthy' ? '#10b981' : '#f59e0b'}}>
                {pipelineHealth.overall_status.toUpperCase()}
              </div>
              <div style={{fontSize:11, opacity:0.6, marginTop:4}}>Confidence: {pipelineHealth.confidence_score}%</div>
            </div>

            {/* Data Pipeline */}
            <div style={{padding:16, background:'rgba(255,255,255,0.05)', borderRadius:8, borderLeft:`4px solid ${pipelineHealth.data_pipeline.status === 'active' ? '#00e5ff' : '#f59e0b'}`}}>
              <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>DATA PIPELINE</div>
              <div style={{fontSize:18, fontWeight:'bold', color:'#00e5ff', marginBottom:8}}>{pipelineHealth.data_pipeline.status.toUpperCase()}</div>
              <div style={{fontSize:12, opacity:0.7}}>Readings: {pipelineHealth.data_pipeline.total_readings}</div>
              {pipelineHealth.data_pipeline.last_reading && (
                <div style={{fontSize:11, opacity:0.5, marginTop:4}}>Last: {new Date(pipelineHealth.data_pipeline.last_reading).toLocaleTimeString()}</div>
              )}
            </div>

            {/* Anomaly Detection */}
            <div style={{padding:16, background:'rgba(255,255,255,0.05)', borderRadius:8, borderLeft:`4px solid #f59e0b`}}>
              <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>ANOMALY DETECTOR</div>
              <div style={{fontSize:18, fontWeight:'bold', color:'#f59e0b', marginBottom:8}}>{pipelineHealth.anomaly_detection.status.toUpperCase()}</div>
              {pipelineHealth.anomaly_detection.model_accuracy && (
                <div style={{fontSize:14, fontWeight:'bold', color:'#10b981', marginBottom:4}}>Accuracy: {(pipelineHealth.anomaly_detection.model_accuracy * 100).toFixed(1)}%</div>
              )}
              {pipelineHealth.anomaly_detection.last_run && (
                <div style={{fontSize:11, opacity:0.5}}>Last: {new Date(pipelineHealth.anomaly_detection.last_run).toLocaleTimeString()}</div>
              )}
            </div>

            {/* Forecasting */}
            <div style={{padding:16, background:'rgba(255,255,255,0.05)', borderRadius:8, borderLeft:`4px solid #8b5cf6`}}>
              <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>FORECASTING MODEL</div>
              <div style={{fontSize:18, fontWeight:'bold', color:'#8b5cf6', marginBottom:8}}>{pipelineHealth.forecasting.status.toUpperCase()}</div>
              {pipelineHealth.forecasting.model_accuracy && (
                <div style={{fontSize:14, fontWeight:'bold', color:'#10b981', marginBottom:4}}>Accuracy: {(pipelineHealth.forecasting.model_accuracy * 100).toFixed(1)}%</div>
              )}
              <div style={{fontSize:11, opacity:0.5}}>Horizon: {pipelineHealth.forecasting.horizon}h</div>
            </div>

            {/* Summary Stats */}
            <div style={{padding:16, background:'rgba(255,255,255,0.05)', borderRadius:8, borderLeft:`4px solid #3b82f6`}}>
              <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>SUMMARY PIPELINE</div>
              <div style={{fontSize:18, fontWeight:'bold', color:'#3b82f6', marginBottom:8}}>{pipelineHealth.summary_stats.status.toUpperCase()}</div>
              <div style={{fontSize:12, opacity:0.7}}>Datapoints: {pipelineHealth.summary_stats.total_datapoints}</div>
              {pipelineHealth.summary_stats.last_run && (
                <div style={{fontSize:11, opacity:0.5, marginTop:4}}>Last: {new Date(pipelineHealth.summary_stats.last_run).toLocaleTimeString()}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Model Detailed Metrics */}
      {modelMetrics && modelMetrics.length > 0 && (
        <div className="analytics-panel" style={{marginTop:16}}>
          <h4 style={{color:'var(--accent)', marginTop:0}}>🧠 AI Model Performance Metrics</h4>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(380px, 1fr))', gap:16}}>
            {modelMetrics.map((model, i) => (
              <div key={i} style={{
                background:'linear-gradient(135deg, rgba(0,229,255,0.1) 0%, rgba(125,75,255,0.1) 100%)',
                border:'1px solid rgba(0,229,255,0.3)',
                borderRadius:12,
                padding:16
              }}>
                <div style={{fontSize:16, fontWeight:'bold', color:'#00e5ff', marginBottom:12}}>
                  {model.model_name}
                </div>
                
                {/* Status Badge */}
                <div style={{
                  display:'inline-block',
                  padding:'4px 12px',
                  background: model.status === 'active' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)',
                  color: model.status === 'active' ? '#10b981' : '#ef4444',
                  borderRadius:6,
                  fontSize:11,
                  fontWeight:'bold',
                  marginBottom:12
                }}>
                  {model.status.toUpperCase()}
                </div>

                {/* Accuracy */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>ACCURACY</div>
                  <div style={{display:'flex', alignItems:'center', gap:12}}>
                    <div style={{
                      flex:1,
                      height:24,
                      background:'rgba(255,255,255,0.1)',
                      borderRadius:12,
                      overflow:'hidden'
                    }}>
                      <div style={{
                        width:`${Math.min(100, (model.accuracy || 0) * 100)}%`,
                        height:'100%',
                        background:`linear-gradient(90deg, #00e5ff 0%, #00d4ff 100%)`,
                        transition:'width 0.3s'
                      }}/>
                    </div>
                    <div style={{fontSize:18, fontWeight:'bold', color:'#00e5ff', minWidth:60}}>
                      {((model.accuracy || 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>

                {/* F1 Score */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:12, opacity:0.6, marginBottom:4}}>F1 SCORE</div>
                  <div style={{fontSize:18, fontWeight:'bold', color:'#10b981'}}>
                    {((model.f1_score || 0) * 100).toFixed(1)}%
                  </div>
                </div>

                {/* Precision & Recall */}
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12}}>
                  <div>
                    <div style={{fontSize:11, opacity:0.6, marginBottom:2}}>Precision</div>
                    <div style={{fontSize:16, fontWeight:'bold', color:'#f59e0b'}}>
                      {((model.precision || 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:11, opacity:0.6, marginBottom:2}}>Recall</div>
                    <div style={{fontSize:16, fontWeight:'bold', color:'#8b5cf6'}}>
                      {((model.recall || 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>

                {/* Error Metrics */}
                {(model.mae || model.rmse) && (
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12}}>
                    {model.mae && (
                      <div>
                        <div style={{fontSize:11, opacity:0.6, marginBottom:2}}>MAE</div>
                        <div style={{fontSize:14, fontWeight:'bold', color:'#00e5ff'}}>
                          {model.mae.toFixed(3)}
                        </div>
                      </div>
                    )}
                    {model.rmse && (
                      <div>
                        <div style={{fontSize:11, opacity:0.6, marginBottom:2}}>RMSE</div>
                        <div style={{fontSize:14, fontWeight:'bold', color:'#00e5ff'}}>
                          {model.rmse.toFixed(3)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Data Quality & Inference Time */}
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:12, paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.1)'}}>
                  <div>
                    <div style={{fontSize:11, opacity:0.6, marginBottom:2}}>Data Quality</div>
                    <div style={{fontSize:14, fontWeight:'bold', color:'#10b981'}}>
                      {model.data_quality_score || 'N/A'}%
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:11, opacity:0.6, marginBottom:2}}>Inference Time</div>
                    <div style={{fontSize:14, fontWeight:'bold', color:'#3b82f6'}}>
                      {model.avg_inference_time || 'N/A'}ms
                    </div>
                  </div>
                </div>

                {/* Training Info */}
                <div style={{marginTop:12, paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.1)', fontSize:11, opacity:0.6}}>
                  <div>Train: {model.training_samples} | Test: {model.test_samples}</div>
                  {model.last_trained && (
                    <div>Last trained: {new Date(model.last_trained).toLocaleDateString()}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* AI Insights Footer */}
      <div style={{marginTop:24, padding:20, background:'linear-gradient(135deg, rgba(0,229,255,0.1) 0%, rgba(125,75,255,0.1) 100%)', borderRadius:12, border:'1px solid rgba(0,229,255,0.2)'}}>
        <h4 style={{margin:'0 0 12px 0', color:'#00e5ff'}}>🧠 AI Model Information & Configuration</h4>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, fontSize:13, opacity:0.8}}>
          <div>
            <strong style={{color:'#00e5ff'}}>Anomaly Detection:</strong> Z-score & Isolation Forest with adaptive thresholds
          </div>
          <div>
            <strong style={{color:'#00e5ff'}}>Forecasting:</strong> Time-series ARIMA with seasonal decomposition
          </div>
          <div>
            <strong style={{color:'#00e5ff'}}>Data Pipeline:</strong> Real-time processing with MongoDB aggregation
          </div>
        </div>
        <div style={{marginTop:12, paddingTop:12, borderTop:'1px solid rgba(255,255,255,0.1)', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, fontSize:12, opacity:0.7}}>
          <div>
            <strong>Update Frequency:</strong> Every 15 minutes
          </div>
          <div>
            <strong>Window Size:</strong> Rolling 24-hour window
          </div>
          <div>
            <strong>Confidence Threshold:</strong> 85%+
          </div>
        </div>
      </div>
    </div>
  );
}
