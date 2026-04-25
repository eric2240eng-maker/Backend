// src/pages/RealTimeData.js
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import MetricCard from '../components/MetricCard';
import { api, socket } from '../config/api';
import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, Line,
  CartesianGrid, Tooltip, XAxis, YAxis, Legend, ReferenceLine
} from 'recharts';

/* ─── helpers ─────────────────────────────────────────────────── */
const flatten = p => p?.metrics ? { ...p.metrics, timestamp: p.timestamp } : (p || {});

const calcAQI = pm25 => {
  if (!pm25) return 0;
  if (pm25 <= 12)    return Math.round((50/12)*pm25);
  if (pm25 <= 35.4)  return Math.round(((100-51)/(35.4-12.1))*(pm25-12.1)+51);
  if (pm25 <= 55.4)  return Math.round(((150-101)/(55.4-35.5))*(pm25-35.5)+101);
  if (pm25 <= 150.4) return Math.round(((200-151)/(150.4-55.5))*(pm25-55.5)+151);
  if (pm25 <= 250.4) return Math.round(((300-201)/(250.4-150.5))*(pm25-150.5)+201);
  return Math.round(((500-301)/(500.4-250.5))*(pm25-250.5)+301);
};

const aqiInfo = aqi => {
  if (aqi <= 50)  return { label:'Good',                     color:'#10b981', glow:'rgba(16,185,129,0.3)' };
  if (aqi <= 100) return { label:'Moderate',                 color:'#f59e0b', glow:'rgba(245,158,11,0.3)' };
  if (aqi <= 150) return { label:'Unhealthy for Sensitive',  color:'#f97316', glow:'rgba(249,115,22,0.3)' };
  if (aqi <= 200) return { label:'Unhealthy',                color:'#ef4444', glow:'rgba(239,68,68,0.3)'  };
  if (aqi <= 300) return { label:'Very Unhealthy',           color:'#8b5cf6', glow:'rgba(139,92,246,0.3)' };
  return           { label:'Hazardous',                      color:'#7f1d1d', glow:'rgba(127,29,29,0.3)'  };
};

const fmtAge = ms => {
  if (ms < 60000)  return `${Math.round(ms/1000)}s ago`;
  if (ms < 3600000)return `${Math.round(ms/60000)}m ago`;
  return `${Math.round(ms/3600000)}h ago`;
};

const METRICS_CFG = [
  { key:'pm25',        label:'PM2.5',      unit:'µg/m³', color:'#ef4444', threshold:35.4  },
  { key:'pm10',        label:'PM10',       unit:'µg/m³', color:'#f97316', threshold:154   },
  { key:'pm1',         label:'PM1.0',      unit:'µg/m³', color:'#f59e0b', threshold:50    },
  { key:'co',          label:'CO',         unit:'ppm',   color:'#8b5cf6', threshold:9     },
  { key:'co2',         label:'CO₂',        unit:'ppm',   color:'#06b6d4', threshold:1000  },
  { key:'temperature', label:'Temp',       unit:'°C',    color:'#00e5a0', threshold:null  },
  { key:'humidity',    label:'Humidity',   unit:'%',     color:'#3b82f6', threshold:null  },
  { key:'voc_index',   label:'VOC',        unit:'idx',   color:'#ec4899', threshold:250   },
  { key:'nox_index',   label:'NOx',        unit:'idx',   color:'#a78bfa', threshold:250   },
];

const BUCKET_SEC = 60; // 1-minute buckets

/* ─── time-bucket aggregator ──────────────────────────────────── */
function bucketSeries(raw) {
  if (!raw.length) return [];
  const groups = {};
  raw.forEach(r => {
    const key = Math.floor(r.ts / (BUCKET_SEC * 1000)) * BUCKET_SEC * 1000;
    if (!groups[key]) groups[key] = { ts: key, _n: 0, aqi: 0 };
    groups[key]._n++;
    METRICS_CFG.forEach(m => {
      if (r[m.key] != null) {
        groups[key][m.key] = (groups[key][m.key] || 0) + Number(r[m.key]);
        groups[key][`_c_${m.key}`] = (groups[key][`_c_${m.key}`] || 0) + 1;
      }
    });
    groups[key].aqi += (r.aqi || 0);
  });
  return Object.values(groups).sort((a,b)=>a.ts-b.ts).map(g => {
    const out = { ts: g.ts, aqi: +(g.aqi/g._n).toFixed(1) };
    METRICS_CFG.forEach(m => {
      const c = g[`_c_${m.key}`] || 0;
      out[m.key] = c ? +(g[m.key]/c).toFixed(2) : null;
    });
    return out;
  });
}

/* ─── styled sub-components ───────────────────────────────────── */
const S = {
  page:    { padding:'20px 24px', maxWidth:1440, margin:'0 auto', fontFamily:"'Inter',sans-serif" },
  panel:   { background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:14, padding:'18px 20px', marginBottom:16 },
  btn:     (active,accent) => ({ padding:'7px 14px', borderRadius:8, border:`1px solid ${active?accent:'rgba(255,255,255,0.12)'}`, background:active?`${accent}22`:'transparent', color:active?accent:'rgba(255,255,255,0.65)', cursor:'pointer', fontSize:12, fontWeight:600, transition:'all .15s', fontFamily:'inherit' }),
  chip:    (color) => ({ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:20, border:`1px solid ${color}55`, background:`${color}15`, color, fontSize:11, fontWeight:600 }),
  dot:     (color,pulse) => ({ width:7, height:7, borderRadius:'50%', background:color, boxShadow:`0 0 6px ${color}`, animation:pulse?'rt-pulse 1.8s ease-in-out infinite':'none' }),
};

/* ═══════════════════════════════════════════════════════════════ */
export default function RealTimeData() {
  const [metrics, setMetrics]   = useState({});
  const [rawSeries, setRaw]     = useState([]);
  const [connected, setConn]    = useState(false);
  const [sensorLive, setSensorLive] = useState(false);
  const [lastTs, setLastTs]     = useState(null);   // Date object of last reading
  const [age, setAge]           = useState(null);    // ms since last reading
  const [updateCount, setCount] = useState(0);
  const [autoRefresh, setAuto]  = useState(true);
  const [alerts, setAlerts]     = useState([]);
  const [chartMetric, setChartMetric] = useState('pm25');
  const [showAll, setShowAll]   = useState(false);
  const sensorTmo = useRef(null);
  const ageTmo    = useRef(null);

  /* live age counter */
  useEffect(() => {
    ageTmo.current = setInterval(() => {
      setAge(lastTs ? Date.now() - lastTs.getTime() : null);
    }, 1000);
    return () => clearInterval(ageTmo.current);
  }, [lastTs]);

  const handleData = useCallback(payload => {
    if (!autoRefresh) return;
    const flat = flatten(payload);
    const ts   = flat.timestamp ? new Date(flat.timestamp).getTime() : Date.now();
    const aqi  = flat.pm25 ? calcAQI(flat.pm25) : null;
    setMetrics(prev => ({ ...prev, ...flat }));
    setRaw(prev => [...prev.slice(-299), { ...flat, ts, aqi }]);
    setLastTs(new Date());
    setSensorLive(true);
    setCount(c => c+1);
    clearTimeout(sensorTmo.current);
    sensorTmo.current = setTimeout(() => setSensorLive(false), 8000);
    // alerts
    METRICS_CFG.filter(m => m.threshold && flat[m.key] > m.threshold).forEach(m => {
      setAlerts(prev => [{
        id: Date.now()+m.key, metric: m.label,
        value: flat[m.key], threshold: m.threshold,
        time: new Date().toLocaleTimeString()
      }, ...prev].slice(0,5));
    });
  }, [autoRefresh]);

  useEffect(() => {
    let alive = true;
    api.get('/api/sensor-data/latest').then(r => {
      if (!alive || !r?.data) return;
      handleData(r.data);
    }).catch(()=>{});
    if (!socket.connected) socket.connect();
    const onConn  = () => setConn(true);
    const onDisc  = () => { setConn(false); setSensorLive(false); };
    socket.on('connect',    onConn);
    socket.on('disconnect', onDisc);
    socket.on('sensorData', handleData);
    if (socket.connected) setConn(true);
    return () => {
      alive = false;
      clearTimeout(sensorTmo.current);
      socket.off('connect',    onConn);
      socket.off('disconnect', onDisc);
      socket.off('sensorData', handleData);
    };
  }, [handleData]);

  const bucketed = useMemo(() => bucketSeries(rawSeries), [rawSeries]);
  const aqi      = useMemo(() => metrics.pm25 ? (() => { const v=calcAQI(metrics.pm25); return { value:v, ...aqiInfo(v) }; })() : null, [metrics.pm25]);

  const stats = useMemo(() => {
    if (!rawSeries.length) return {};
    const out = {};
    METRICS_CFG.forEach(m => {
      const vals = rawSeries.map(r=>r[m.key]).filter(v=>v!=null);
      if (!vals.length) return;
      out[m.key] = {
        min: Math.min(...vals).toFixed(2),
        max: Math.max(...vals).toFixed(2),
        avg: (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2),
      };
    });
    return out;
  }, [rawSeries]);

  const exportCSV = () => {
    const h = ['Timestamp','PM1','PM2.5','PM10','CO','CO2','Temp','Humidity','VOC','NOx','AQI'];
    const rows = rawSeries.map(s=>[new Date(s.ts).toLocaleString(),s.pm1,s.pm25,s.pm10,s.co,s.co2,s.temperature,s.humidity,s.voc_index,s.nox_index,s.aqi]);
    const blob = new Blob([[h,...rows].map(r=>r.join(',')).join('\n')],{type:'text/csv'});
    Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:`airquality-${Date.now()}.csv`}).click();
  };

  const cfg = METRICS_CFG.find(m=>m.key===chartMetric)||METRICS_CFG[0];

  return (
    <div style={S.page}>
      <style>{`
        @keyframes rt-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.3)} }
        @keyframes rt-slideIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        .rt-btn:hover { opacity:.85; transform:translateY(-1px); }
      `}</style>

      {/* ── Header ── */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:18}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:'#e8eef8',letterSpacing:'-.02em'}}>
            Real-Time Monitoring
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,marginTop:6,flexWrap:'wrap'}}>
            {/* Server status */}
            <span style={S.chip(connected?'#10b981':'#ef4444')}>
              <span style={S.dot(connected?'#10b981':'#ef4444',false)}/>
              {connected?'Server Online':'Server Offline'}
            </span>
            {/* Sensor live */}
            <span style={S.chip(sensorLive?'#00e5a0':'#f59e0b')}>
              <span style={S.dot(sensorLive?'#00e5a0':'#f59e0b', sensorLive)}/>
              {sensorLive?'Receiving Data':'Awaiting Sensor'}
            </span>
            {/* Updates */}
            <span style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>
              {updateCount} updates this session
            </span>
          </div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button className="rt-btn" style={S.btn(autoRefresh,'#00e5a0')} onClick={()=>setAuto(a=>!a)}>
            {autoRefresh?'⏸ Pause':'▶ Resume'}
          </button>
          <button className="rt-btn" style={S.btn(false,'#06b6d4')} onClick={exportCSV}>
            ⬇ CSV
          </button>
        </div>
      </div>

      {/* ── LAST DATA RECEIVED BANNER ── */}
      <div style={{
        ...S.panel,
        background: age == null ? 'rgba(255,255,255,0.04)' :
                    age < 30000 ? 'rgba(16,185,129,0.08)' :
                    age < 120000 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)',
        border: `1px solid ${age==null?'rgba(255,255,255,0.08)':age<30000?'rgba(16,185,129,0.25)':age<120000?'rgba(245,158,11,0.25)':'rgba(239,68,68,0.25)'}`,
        display:'flex', alignItems:'center', gap:16, flexWrap:'wrap',
      }}>
        <div style={{
          width:48, height:48, borderRadius:12, flexShrink:0,
          background: age==null?'rgba(255,255,255,0.06)':age<30000?'rgba(16,185,129,0.2)':age<120000?'rgba(245,158,11,0.2)':'rgba(239,68,68,0.2)',
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:22,
        }}>
          {age==null?'📡':age<30000?'✅':age<120000?'⏳':'🔴'}
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:'.07em',textTransform:'uppercase',
            color:age==null?'rgba(255,255,255,0.4)':age<30000?'#10b981':age<120000?'#f59e0b':'#ef4444', marginBottom:3}}>
            Last Data Received
          </div>
          <div style={{fontSize:20,fontWeight:700,color:'#e8eef8'}}>
            {lastTs ? fmtAge(age) : 'No data yet'}
          </div>
          {lastTs && (
            <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:2}}>
              {lastTs.toLocaleString()} · {rawSeries.length} readings buffered
            </div>
          )}
        </div>
        {/* Session stats */}
        {rawSeries.length > 0 && (
          <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
            {[['PM2.5 Avg', stats.pm25?.avg+' µg/m³'], ['PM2.5 Max', stats.pm25?.max+' µg/m³'], ['Updates', updateCount]].map(([l,v])=>(
              <div key={l} style={{textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:700,color:'#e8eef8'}}>{v||'—'}</div>
                <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'.06em'}}>{l}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── AQI Hero ── */}
      {aqi && (
        <div style={{
          ...S.panel,
          background:`linear-gradient(135deg,${aqi.color}22,${aqi.color}0a)`,
          border:`1px solid ${aqi.color}44`,
          boxShadow:`0 0 32px ${aqi.glow}`,
          display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12,
          animation:'rt-slideIn .3s ease',
        }}>
          <div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',color:aqi.color,marginBottom:4}}>
              Air Quality Index
            </div>
            <div style={{fontSize:52,fontWeight:800,color:'#e8eef8',lineHeight:1}}>{aqi.value}</div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:20,fontWeight:700,color:aqi.color}}>{aqi.label}</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:4}}>
              Based on PM2.5: {metrics.pm25} µg/m³
            </div>
          </div>
        </div>
      )}

      {/* ── Alerts ── */}
      {alerts.length > 0 && (
        <div style={{...S.panel, borderColor:'rgba(239,68,68,0.25)', background:'rgba(239,68,68,0.06)', marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:'#ef4444',marginBottom:10}}>
            ⚠ Active Threshold Alerts
          </div>
          {alerts.map(a=>(
            <div key={a.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:'1px solid rgba(255,255,255,0.05)',fontSize:13}}>
              <span><strong style={{color:'#fca5a5'}}>{a.metric}</strong>: {Number(a.value).toFixed(1)} <span style={{color:'rgba(255,255,255,0.4)'}}>/ limit {a.threshold}</span></span>
              <span style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>{a.time}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Metric cards ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12,marginBottom:16}}>
        {METRICS_CFG.map(m=>(
          <MetricCard key={m.key} title={m.label} value={metrics[m.key]} unit={m.unit}
            trend={rawSeries.length>1?(rawSeries[rawSeries.length-1][m.key]||0)-(rawSeries[rawSeries.length-2][m.key]||0):0}
          />
        ))}
      </div>

      {/* ── Time-bucketed Chart ── */}
      <div style={S.panel}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,marginBottom:16}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:'#e8eef8'}}>
              {cfg.label} — {BUCKET_SEC}s Bucket Averages
            </div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:2}}>
              {bucketed.length} buckets · {rawSeries.length} raw readings
            </div>
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {METRICS_CFG.map(m=>(
              <button key={m.key} className="rt-btn"
                style={{...S.btn(chartMetric===m.key, m.color), fontSize:11, padding:'5px 10px'}}
                onClick={()=>setChartMetric(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={bucketed} margin={{top:5,right:10,left:0,bottom:5}}>
            <defs>
              <linearGradient id="rtGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.35}/>
                <stop offset="95%" stopColor={cfg.color} stopOpacity={0.02}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
            <XAxis dataKey="ts" type="number" scale="time" domain={['auto','auto']}
              tickFormatter={v=>new Date(v).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
              stroke="rgba(255,255,255,0.3)" tick={{fontSize:10}} interval="preserveStartEnd"/>
            <YAxis stroke="rgba(255,255,255,0.3)" tick={{fontSize:10}} width={40}/>
            <Tooltip
              contentStyle={{background:'rgba(7,13,28,0.95)',border:`1px solid ${cfg.color}44`,borderRadius:8,fontSize:12}}
              labelStyle={{color:'#00e5ff',fontWeight:600}}
              labelFormatter={v=>new Date(v).toLocaleTimeString()}
              formatter={(v,n)=>[v!=null?Number(v).toFixed(2):'—',n]}
            />
            {cfg.threshold && <ReferenceLine y={cfg.threshold} stroke="#ef4444" strokeDasharray="4 4"
              label={{value:'Limit',fill:'#ef4444',fontSize:10,position:'right'}}/>}
            <Area type="monotone" dataKey={cfg.key} stroke={cfg.color} fill="url(#rtGrad)"
              strokeWidth={2} dot={false} connectNulls name={cfg.label} activeDot={{r:4}}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── AQI trend chart ── */}
      <div style={S.panel}>
        <div style={{fontSize:15,fontWeight:700,color:'#e8eef8',marginBottom:14}}>
          AQI Trend — {BUCKET_SEC}s Buckets
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={bucketed} margin={{top:5,right:10,left:0,bottom:5}}>
            <defs>
              <linearGradient id="aqiGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#f97316" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#f97316" stopOpacity={0.02}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
            <XAxis dataKey="ts" type="number" scale="time" domain={['auto','auto']}
              tickFormatter={v=>new Date(v).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
              stroke="rgba(255,255,255,0.3)" tick={{fontSize:10}} interval="preserveStartEnd"/>
            <YAxis stroke="rgba(255,255,255,0.3)" tick={{fontSize:10}} width={40}/>
            <Tooltip
              contentStyle={{background:'rgba(7,13,28,0.95)',border:'1px solid rgba(249,115,22,0.3)',borderRadius:8,fontSize:12}}
              labelStyle={{color:'#f97316',fontWeight:600}}
              labelFormatter={v=>new Date(v).toLocaleTimeString()}
              formatter={v=>[v!=null?Number(v).toFixed(0):'—','AQI']}
            />
            <ReferenceLine y={100} stroke="#f59e0b" strokeDasharray="4 4"
              label={{value:'Moderate',fill:'#f59e0b',fontSize:9,position:'right'}}/>
            <ReferenceLine y={150} stroke="#ef4444" strokeDasharray="4 4"
              label={{value:'Unhealthy',fill:'#ef4444',fontSize:9,position:'right'}}/>
            <Area type="monotone" dataKey="aqi" stroke="#f97316" fill="url(#aqiGrad)"
              strokeWidth={2} dot={false} connectNulls name="AQI" activeDot={{r:4}}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Session stats table ── */}
      {Object.keys(stats).length > 0 && (
        <div style={S.panel}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div style={{fontSize:15,fontWeight:700,color:'#e8eef8'}}>Session Statistics</div>
            <button className="rt-btn" style={S.btn(false,'#06b6d4')} onClick={()=>setShowAll(s=>!s)}>
              {showAll?'Show Less':'Show All'}
            </button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10}}>
            {METRICS_CFG.filter((_,i)=>showAll||i<5).map(m=>{
              const s=stats[m.key]; if(!s) return null;
              return (
                <div key={m.key} style={{padding:12,borderRadius:10,background:'rgba(255,255,255,0.04)',borderTop:`3px solid ${m.color}`}}>
                  <div style={{fontSize:11,fontWeight:700,color:m.color,marginBottom:8,textTransform:'uppercase',letterSpacing:'.05em'}}>{m.label}</div>
                  {[['Avg',s.avg],['Min',s.min],['Max',s.max]].map(([l,v])=>(
                    <div key={l} style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}>
                      <span style={{color:'rgba(255,255,255,0.4)'}}>{l}</span>
                      <strong style={{color:'#e8eef8'}}>{v} {m.unit}</strong>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}