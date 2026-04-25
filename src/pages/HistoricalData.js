// src/pages/HistoricalData.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { api } from '../config/api';
import {
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  Bar
} from 'recharts';

// Color palette from aqmrg-frontend
const metrics = [
  { label: 'PM1.0', key: 'pm1', stroke: '#ec4899', unit: 'µg/m³', threshold: 50, category: 'air' },
  { label: 'PM2.5', key: 'pm25', stroke: '#f43f5e', unit: 'µg/m³', threshold: 35, category: 'air' },
  { label: 'PM10', key: 'pm10', stroke: '#fbbf24', unit: 'µg/m³', threshold: 150, category: 'air' },
  { label: 'CO', key: 'co', stroke: '#f59e0b', unit: 'ppm', threshold: 9, category: 'air' },
  { label: 'CO₂', key: 'co2', stroke: '#10b981', unit: 'ppm', threshold: 1000, category: 'air' },
  { label: 'Temperature', key: 'temperature', stroke: '#3b82f6', unit: '°C', threshold: null, category: 'env' },
  { label: 'Humidity', key: 'humidity', stroke: '#06b6d4', unit: '%', threshold: null, category: 'env' },
  { label: 'VOC Index', key: 'voc_index', stroke: '#8b5cf6', unit: '', threshold: 250, category: 'air' },
  { label: 'NOx Index', key: 'nox_index', stroke: '#ec4899', unit: '', threshold: 250, category: 'air' }
];

export default function HistoricalData() {
  const [timeBucket, setTimeBucket] = useState('daily'); // Granularity: hourly, daily, weekly, monthly, yearly
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [stats, setStats] = useState({});
  const [reportLoading, setReportLoading] = useState(false);
  const [reportStartDate, setReportStartDate] = useState(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [reportEndDate, setReportEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportGranularity, setReportGranularity] = useState('daily');


  // Granularity options
  const granularities = [
    { id: 'hourly', label: 'Hourly' },
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' }
  ];

  // Fetch data with timeframe support
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const resp = await api.get('/api/historical', { params: { timeframe: '90d' } });
        
        const rawData = (resp.data || []).map(r => {
          const rawStr = r.recorded_at || r.timestamp;
          const safeDateStr = typeof rawStr === 'string' ? rawStr.replace(' ', 'T') : rawStr;
          const d = new Date(safeDateStr);
          return {
            ...r,
            _date: d,
            _localDate: formatDateISO(d),
            metrics: r.metrics || r
          };
        });

        setRows(rawData);
        calculateStats(rawData);
      } catch (e) {
        console.error(e);
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  // Helper: Format date to YYYY-MM-DD
  const formatDateISO = (d) => {
    if (!d || isNaN(d)) return '1970-01-01';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  // Calculate statistics
  const calculateStats = (data) => {
    const statistics = {};
    
    metrics.forEach(m => {
      const values = data.map(d => {
        const m_data = d.metrics ? d.metrics[m.key] : d[m.key];
        return Number(m_data || 0);
      }).filter(v => v > 0);
      
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const median = sorted[Math.floor(sorted.length / 2)];
        
        // Standard deviation
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
        const stdDev = Math.sqrt(variance);
        
        // Exceedances (if threshold exists)
        let exceedances = 0;
        let exceedancePercentage = 0;
        if (m.threshold) {
          exceedances = values.filter(v => v > m.threshold).length;
          exceedancePercentage = (exceedances / values.length) * 100;
        }
        
        statistics[m.key] = {
          min: min.toFixed(2),
          max: max.toFixed(2),
          mean: mean.toFixed(2),
          median: median.toFixed(2),
          stdDev: stdDev.toFixed(2),
          count: values.length,
          exceedances,
          exceedancePercentage: exceedancePercentage.toFixed(1)
        };
      }
    });
    
    setStats(statistics);
  };

  // Filter and aggregate data by granularity
  const aggregatedData = useMemo(() => {
    if (rows.length === 0) return [];

    // Apply date filtering
    let filtered = rows;
    if (timeBucket === 'daily') {
      filtered = rows.filter(d => d._localDate === selectedDate);
      // Fallback: if no data for selectedDate, use the most recent day
      if (filtered.length === 0 && rows.length > 0) {
        const availableDates = [...new Set(rows.map(r => r._localDate))].sort().reverse();
        if (availableDates.length > 0) {
          filtered = rows.filter(d => d._localDate === availableDates[0]);
        }
      }
    } else if (timeBucket === 'weekly') {
      filtered = rows.filter(d => {
        const date = d._date;
        const year = date.getFullYear();
        const firstDayOfYear = new Date(year, 0, 1);
        const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
        const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
        const weekStr = `${year}-W${weekNum < 10 ? '0' + weekNum : weekNum}`;
        const selectedWeek = new Date(selectedDate).toISOString().slice(0, 10);
        const selectedWeekNum = Math.ceil((new Date(selectedWeek) - new Date(year, 0, 1)) / 86400000 / 7);
        return weekNum === selectedWeekNum;
      });
    } else if (timeBucket === 'monthly') {
      filtered = rows.filter(d => d._localDate.slice(0, 7) === selectedMonth);
    } else if (timeBucket === 'hourly') {
      filtered = rows.filter(d => d._localDate === selectedDate);
    }

    filtered.sort((a, b) => a._date - b._date);

    // Aggregate based on bucket
    if (timeBucket === 'hourly') {
      return filtered.map((d, i) => {
        const m_data = d.metrics || d;
        const entry = {
          name: d._date.toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })
        };
        metrics.forEach(m => {
          entry[m.key] = m_data[m.key] ?? 0;
          entry[`${m.key}_count`] = 1;
        });
        return entry;
      });
    }

    const groups = {};
    filtered.forEach(item => {
      const date = item._date;
      let key = '';
      let sortKey = 0;

      if (timeBucket === 'daily') {
        key = date.toLocaleDateString([], { hour: '2-digit', minute: '2-digit' });
        sortKey = date.getHours() * 60 + date.getMinutes();
      } else if (timeBucket === 'weekly') {
        key = date.toLocaleDateString([], { day: 'numeric', month: 'short' });
        sortKey = date.getDate();
      } else if (timeBucket === 'monthly') {
        const weekInMonth = Math.ceil(date.getDate() / 7);
        key = `Week ${weekInMonth}`;
        sortKey = date.getDate();
      }

      if (!groups[key]) {
        const group = { name: key, sortKey };
        metrics.forEach(m => {
          group[m.key] = [];
          group[`${m.key}_count`] = 0;
        });
        groups[key] = group;
      }

      const m_data = item.metrics || item;
      metrics.forEach(m => {
        const val = m_data[m.key];
        if (val !== undefined && val !== null) {
          groups[key][m.key].push(Number(val));
          groups[key][`${m.key}_count`]++;
        }
      });
    });

    const result = Object.values(groups).map(g => {
      const entry = { name: g.name, sortKey: g.sortKey };
      metrics.forEach(m => {
        const list = g[m.key];
        const precision = (m.key === 'co' || m.key === 'co2') ? 2 : 1;
        entry[m.key] = list.length ? Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(precision)) : 0;
        entry[`${m.key}_count`] = g[`${m.key}_count`];
      });
      return entry;
    });

    result.sort((a, b) => a.sortKey - b.sortKey);
    return result;
  }, [rows, timeBucket, selectedDate, selectedMonth]);

  // Time formatting
  const timeTickFormatter = (value) => {
    return value;
  };

  // Generate PDF Report using jsPDF + autoTable
  const handleGenerateReport = async () => {
    if (!reportStartDate || !reportEndDate) {
      alert('Please select both start and end dates.');
      return;
    }
    if (new Date(reportStartDate) > new Date(reportEndDate)) {
      alert('Start date must be before end date.');
      return;
    }

    // Verify jsPDF is loaded
    const jsPDFLib = window.jspdf?.jsPDF || window.jsPDF;
    if (!jsPDFLib) {
      alert('PDF library is still loading. Please wait a moment and try again.');
      return;
    }

    try {
      setReportLoading(true);

      // Fetch report data from backend
      let reportData;
      try {
        const response = await api.post('/api/analytics/generate-report', {
          granularity: reportGranularity,
          startDate: new Date(reportStartDate).toISOString(),
          endDate: new Date(reportEndDate).toISOString(),
        });
        reportData = response.data;
      } catch (apiErr) {
        if (apiErr.response?.status === 404) {
          alert('No sensor data found for the selected date range. Please select a period that contains readings.');
          setReportLoading(false);
          return;
        }
        throw apiErr;
      }

      // ── Build PDF ──────────────────────────────────────────
      const doc = new jsPDFLib('p', 'mm', 'a4');
      const PAGE_W  = doc.internal.pageSize.getWidth();
      const PAGE_H  = doc.internal.pageSize.getHeight();
      const MARGIN  = 15;
      const COL_W   = PAGE_W - MARGIN * 2;
      let y = MARGIN;

      const checkPage = (needed = 10) => {
        if (y + needed > PAGE_H - MARGIN) {
          doc.addPage();
          y = MARGIN;
        }
      };

      const addSection = (title) => {
        checkPage(16);
        y += 4;
        doc.setFillColor(11, 19, 40);
        doc.roundedRect(MARGIN, y, COL_W, 8, 2, 2, 'F');
        doc.setTextColor(0, 229, 160);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(title.toUpperCase(), MARGIN + 4, y + 5.5);
        doc.setTextColor(220, 230, 245);
        y += 13;
      };

      const addKeyValue = (label, value, indent = MARGIN + 4) => {
        checkPage(7);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(160, 180, 210);
        doc.text(label + ':', indent, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(220, 230, 245);
        const valLines = doc.splitTextToSize(String(value ?? '—'), COL_W - indent + MARGIN - 40);
        doc.text(valLines, indent + 42, y);
        y += valLines.length * 5 + 1;
      };

      // ── Cover header ────────────────────────────────────────
      doc.setFillColor(7, 13, 28);
      doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

      doc.setFillColor(0, 40, 25);
      doc.rect(0, 0, PAGE_W, 50, 'F');

      doc.setTextColor(0, 229, 160);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text('Air Quality Monitoring', MARGIN, 22);

      doc.setFontSize(14);
      doc.setTextColor(100, 200, 160);
      doc.text('Environmental Report', MARGIN, 32);

      doc.setFontSize(9);
      doc.setTextColor(120, 160, 140);
      doc.text(
        `${reportData.header?.type || reportGranularity.toUpperCase()} REPORT  ·  ${reportData.header?.location || 'Lab Sensor A'}`,
        MARGIN, 42
      );
      doc.text(
        `Period: ${reportData.header?.period || `${reportStartDate} → ${reportEndDate}`}`,
        MARGIN, 48
      );

      doc.setTextColor(60, 100, 80);
      doc.setFontSize(8);
      doc.text(`Generated: ${new Date().toLocaleString()}`, PAGE_W - MARGIN, 48, { align: 'right' });

      y = 58;

      // ── Executive Summary ─────────────────────────────────
      if (reportData.executiveSummary) {
        addSection('Executive Summary');
        Object.entries(reportData.executiveSummary).forEach(([k, v]) => addKeyValue(k, v));
      }

      // ── Pollutant Analysis (table) ─────────────────────────
      if (reportData.pollutantAnalysis) {
        addSection('Pollutant Analysis');
        const rows = Object.entries(reportData.pollutantAnalysis).map(([name, s]) => [
          name,
          s.mean ?? s.average ?? '—',
          s.min   ?? '—',
          s.max   ?? '—',
          s.exceedances != null ? s.exceedances : '—',
          s.exceedancePercentage != null ? `${s.exceedancePercentage}%` : '—',
        ]);

        if (doc.autoTable) {
          doc.autoTable({
            startY: y,
            margin: { left: MARGIN, right: MARGIN },
            head: [['Pollutant', 'Mean', 'Min', 'Max', 'Exceedances', 'Exceed %']],
            body: rows,
            styles: {
              fontSize: 8,
              cellPadding: 3,
              fillColor: [11, 19, 40],
              textColor: [200, 220, 240],
              lineColor: [30, 50, 80],
              lineWidth: 0.3,
            },
            headStyles: {
              fillColor: [0, 80, 50],
              textColor: [0, 229, 160],
              fontStyle: 'bold',
            },
            alternateRowStyles: { fillColor: [15, 25, 50] },
            theme: 'grid',
          });
          y = doc.lastAutoTable.finalY + 8;
        } else {
          rows.forEach(r => addKeyValue(r[0], `Mean: ${r[1]}, Min: ${r[2]}, Max: ${r[3]}`));
        }
      }

      // ── Environmental Parameters ───────────────────────────
      if (reportData.environmental) {
        addSection('Environmental Parameters');
        Object.entries(reportData.environmental).forEach(([param, s]) => {
          const vals = [s.mean ?? s.average, s.min, s.max].filter(Boolean).join(' / ');
          addKeyValue(param, vals || JSON.stringify(s));
        });
      }

      // ── Health & Compliance ────────────────────────────────
      if (reportData.healthCompliance) {
        addSection('Health & Compliance');
        const hRows = Object.entries(reportData.healthCompliance).map(([cat, d]) => [
          cat, d.count ?? '—', d.percentage ?? '—',
        ]);
        if (doc.autoTable) {
          doc.autoTable({
            startY: y,
            margin: { left: MARGIN, right: MARGIN },
            head: [['Category', 'Readings', 'Percentage']],
            body: hRows,
            styles: { fontSize: 8, cellPadding: 3, fillColor: [11, 19, 40], textColor: [200, 220, 240], lineColor: [30, 50, 80], lineWidth: 0.3 },
            headStyles: { fillColor: [0, 80, 50], textColor: [0, 229, 160], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [15, 25, 50] },
            theme: 'grid',
          });
          y = doc.lastAutoTable.finalY + 8;
        } else {
          hRows.forEach(([cat, cnt, pct]) => addKeyValue(cat, `${cnt} readings (${pct})`));
        }
      }

      // ── Sensor Health ──────────────────────────────────────
      if (reportData.sensorHealth) {
        addSection('Sensor Health Status');
        Object.entries(reportData.sensorHealth).forEach(([k, v]) => {
          addKeyValue(k.replace(/([A-Z])/g, ' $1').trim(), v);
        });
      }

      // ── Charts: capture each metric chart from DOM ─────────
      const chartEls = document.querySelectorAll('[data-pdf-chart]');
      if (chartEls.length > 0) {
        addSection('Metric Charts');
        const PAGE_W2 = doc.internal.pageSize.getWidth();
        const MARGIN2 = 15;
        const chartW  = PAGE_W2 - MARGIN2 * 2;

        for (const el of chartEls) {
          const label = el.getAttribute('data-pdf-chart');
          checkPage(70);

          // chart label
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 229, 160);
          doc.text(label, MARGIN2, y);
          y += 4;

          try {
            const canvas = await html2canvas(el, {
              backgroundColor: '#070d1c',
              scale: 1.5,
              useCORS: true,
              logging: false,
            });
            const imgData  = canvas.toDataURL('image/png');
            const imgH     = (canvas.height / canvas.width) * chartW;
            checkPage(imgH + 8);
            doc.addImage(imgData, 'PNG', MARGIN2, y, chartW, imgH);
            y += imgH + 10;
          } catch (chartErr) {
            doc.setFontSize(8);
            doc.setTextColor(200, 100, 100);
            doc.text('[Chart capture failed]', MARGIN2, y);
            doc.setTextColor(220, 230, 245);
            y += 8;
          }
        }
      }

      // ── Footer on every page ───────────────────────────────
      const totalPages = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFontSize(7);
        doc.setTextColor(60, 100, 80);
        doc.text(`AirQuality Pro Monitor · Page ${p} of ${totalPages}`, PAGE_W / 2, PAGE_H - 6, { align: 'center' });
      }

      doc.save(`air-quality-${reportGranularity}-report-${new Date().toISOString().slice(0,10)}.pdf`);
      alert('✅ PDF report downloaded successfully!');
    } catch (err) {
      console.error('Report generation error:', err);
      alert('Failed to generate report: ' + (err.response?.data?.error || err.message));
    } finally {
      setReportLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
        <h3>Processing Time-Series Aggregates...</h3>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Header */}
      <div>
        <h1 style={{ margin: 0, fontSize: '1.8rem', background: 'linear-gradient(135deg, #f8fafc 0%, #cbd5e1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Raw Parameter Analysis
        </h1>
        <p style={{ margin: '8px 0 0 0', opacity: 0.7, fontSize: 14 }}>
          Time-bucketed aggregation for historical trend discovery
        </p>
      </div>

      {/* Filter Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {/* Granularity Selector */}
          <nav style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', padding: 4, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', gap: 0 }}>
            {granularities.map(g => (
              <button 
                key={g.id}
                onClick={() => setTimeBucket(g.id)}
                style={{ 
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: timeBucket === g.id ? '#3b82f6' : 'transparent',
                  color: timeBucket === g.id ? '#fff' : 'rgba(255,255,255,0.6)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  transition: 'all 0.2s ease'
                }}
              >
                {g.label}
              </button>
            ))}
          </nav>

          {/* Date Selectors */}
          {timeBucket === 'daily' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
                Pick a Day
              </label>
              <input 
                type="date" 
                value={selectedDate} 
                onChange={(e) => setSelectedDate(e.target.value)} 
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#fff', padding: '6px 12px', fontSize: '0.85rem', outline: 'none' }}
              />
            </div>
          )}

          {timeBucket === 'weekly' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
                Pick Week Start
              </label>
              <input 
                type="date" 
                value={selectedDate} 
                onChange={(e) => setSelectedDate(e.target.value)} 
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#fff', padding: '6px 12px', fontSize: '0.85rem', outline: 'none' }}
              />
            </div>
          )}

          {timeBucket === 'monthly' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
                Pick a Month
              </label>
              <input 
                type="month" 
                value={selectedMonth} 
                onChange={(e) => setSelectedMonth(e.target.value)} 
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#fff', padding: '6px 12px', fontSize: '0.85rem', outline: 'none' }}
              />
            </div>
          )}
        </div>

        <div style={{ fontSize: 13, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
          📊 {aggregatedData.length} periods | {rows.length} data points
        </div>
      </div>

      {/* Stats Summary */}
      {rows.length > 0 && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', 
          gap: 12
        }}>
          {metrics.map(m => {
            const st = stats[m.key];
            if (!st) return null;
            return (
              <div key={m.key} style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 12,
                padding: 16,
                border: `1px solid rgba(255,255,255,0.08)`,
                backdropFilter: 'blur(10px)'
              }}>
                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginBottom: 8, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
                  {m.label}
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: m.stroke, marginBottom: 8 }}>
                  {st.mean}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
                  <div>Min: {st.min}</div>
                  <div>Max: {st.max}</div>
                  {m.threshold && parseFloat(st.exceedancePercentage) > 0 && (
                    <div style={{ color: '#ef4444', fontWeight: 600, marginTop: 4 }}>
                      ⚠️ {st.exceedancePercentage}% exceeded
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Report Generation Section */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        borderRadius: 16,
        padding: 24,
        backdropFilter: 'blur(10px)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}>
          📊 Generate PDF Report
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
          {/* Report Granularity */}
          <div>
            <label style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 8, fontWeight: 600 }}>
              Report Type
            </label>
            <select 
              value={reportGranularity}
              onChange={(e) => setReportGranularity(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                color: '#fff',
                padding: '10px 12px',
                fontSize: '0.9rem',
                outline: 'none',
                cursor: 'pointer',
                transition: 'border 0.2s'
              }}
            >
              <option value="hourly">Hourly Report</option>
              <option value="daily">Daily Report</option>
              <option value="weekly">Weekly Report</option>
              <option value="monthly">Monthly Report</option>
              <option value="yearly">Yearly Report</option>
            </select>
          </div>

          {/* Start Date */}
          <div>
            <label style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 8, fontWeight: 600 }}>
              Start Date
            </label>
            <input 
              type="date"
              value={reportStartDate}
              onChange={(e) => setReportStartDate(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                color: '#fff',
                padding: '10px 12px',
                fontSize: '0.9rem',
                outline: 'none',
                cursor: 'pointer',
                transition: 'border 0.2s'
              }}
            />
          </div>

          {/* End Date */}
          <div>
            <label style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 8, fontWeight: 600 }}>
              End Date
            </label>
            <input 
              type="date"
              value={reportEndDate}
              onChange={(e) => setReportEndDate(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                color: '#fff',
                padding: '10px 12px',
                fontSize: '0.9rem',
                outline: 'none',
                cursor: 'pointer',
                transition: 'border 0.2s'
              }}
            />
          </div>

          {/* Generate Button */}
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={handleGenerateReport}
              disabled={reportLoading}
              style={{
                width: '100%',
                background: reportLoading ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                padding: '12px 24px',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: reportLoading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                opacity: reportLoading ? 0.6 : 1
              }}
            >
              {reportLoading ? '⏳ Generating...' : '📥 Download PDF'}
            </button>
          </div>
        </div>
      </div>

      {/* No Data State */}
      {!loading && aggregatedData.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, background: 'rgba(255,255,255,0.05)', borderRadius: 12 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
          <p style={{ margin: 0, opacity: 0.7 }}>No data available for the selected period</p>
        </div>
      )}

      {/* Analysis Grid - RawAnalysisTab Style */}
      {aggregatedData.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
          {metrics.map(param => (
            <div key={param.key} style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 20,
              padding: 24,
              backdropFilter: 'blur(10px)'
            }}>
              {/* Card Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 500 }}>
                  {param.label}
                </h3>
                <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: 6, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {param.unit}
                </span>
              </div>

              {/* Two-Chart Layout: Trend + Distribution */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
                {/* Trend Chart (Area) */}
                <div data-pdf-chart={`${param.label} — Trend`}>
                  <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 12 }}>
                    Trend (Line)
                  </label>
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={aggregatedData} margin={{ top: 5, right: 5, bottom: 15, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" hide />
                      <YAxis stroke="#64748b" fontSize={10} />
                      <Tooltip 
                        contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#f8fafc' }}
                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey={param.key} 
                        fill={`${param.stroke}20`} 
                        stroke={param.stroke} 
                        strokeWidth={2} 
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Distribution Chart (Bar) */}
                <div data-pdf-chart={`${param.label} — Distribution`}>
                  <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 12 }}>
                    Distribution (Bar)
                  </label>
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={aggregatedData} margin={{ top: 5, right: 5, bottom: 15, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" hide />
                      <YAxis stroke="#64748b" fontSize={10} />
                      <Tooltip 
                        contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#f8fafc' }}
                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                      />
                      <Bar dataKey={param.key} fill={param.stroke} radius={[4, 4, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Stats Footer */}
              {stats[param.key] && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, fontSize: '0.85rem' }}>
                  <div><span style={{ opacity: 0.6 }}>Mean:</span> <strong style={{ color: param.stroke }}>{stats[param.key].mean}</strong></div>
                  <div><span style={{ opacity: 0.6 }}>Min:</span> <strong>{stats[param.key].min}</strong></div>
                  <div><span style={{ opacity: 0.6 }}>Max:</span> <strong>{stats[param.key].max}</strong></div>
                  <div><span style={{ opacity: 0.6 }}>Std Dev:</span> <strong>{stats[param.key].stdDev}</strong></div>
                  <div><span style={{ opacity: 0.6 }}>Samples:</span> <strong>{stats[param.key].count}</strong></div>
                  {param.threshold && parseFloat(stats[param.key].exceedancePercentage) > 0 && (
                    <div style={{ gridColumn: 'span 1', color: '#ef4444', fontWeight: 600 }}>
                      ⚠️ {stats[param.key].exceedancePercentage}% exceeded
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
