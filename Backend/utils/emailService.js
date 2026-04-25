// Backend/utils/emailService.js
// Sends beautiful HTML emails via Gmail SMTP (App Password)
'use strict';

const nodemailer = require('nodemailer');

// ── Transport ──────────────────────────────────────────────────────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const provider = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();

  if (provider === 'brevo') {
    // Brevo (Sendinblue) SMTP — works without App Passwords
    _transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp-relay.brevo.com',
      port: Number(process.env.EMAIL_PORT || 587),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  } else {
    // Gmail SMTP — requires App Password
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  return _transporter;
}

// ── AQI helpers ────────────────────────────────────────────────────────────
function calculateAQI(pm25) {
  if (!pm25 || isNaN(pm25)) return 0;
  if (pm25 <= 12)    return Math.round((50 / 12) * pm25);
  if (pm25 <= 35.4)  return Math.round(((100 - 51) / (35.4 - 12.1)) * (pm25 - 12.1) + 51);
  if (pm25 <= 55.4)  return Math.round(((150 - 101) / (55.4 - 35.5)) * (pm25 - 35.5) + 101);
  if (pm25 <= 150.4) return Math.round(((200 - 151) / (150.4 - 55.5)) * (pm25 - 55.5) + 151);
  if (pm25 <= 250.4) return Math.round(((300 - 201) / (250.4 - 150.5)) * (pm25 - 150.5) + 201);
  return Math.round(((500 - 301) / (500.4 - 250.5)) * (pm25 - 250.5) + 301);
}

function aqiCategory(aqi) {
  if (aqi <= 50)  return { label: 'Good',                      color: '#10b981', bg: '#d1fae5' };
  if (aqi <= 100) return { label: 'Moderate',                  color: '#f59e0b', bg: '#fef3c7' };
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive',   color: '#f97316', bg: '#ffedd5' };
  if (aqi <= 200) return { label: 'Unhealthy',                 color: '#ef4444', bg: '#fee2e2' };
  if (aqi <= 300) return { label: 'Very Unhealthy',            color: '#8b5cf6', bg: '#ede9fe' };
  return            { label: 'Hazardous',                      color: '#7f1d1d', bg: '#fecaca' };
}

// ── Shared HTML wrapper ────────────────────────────────────────────────────
function htmlWrapper(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
  body{margin:0;padding:0;background:#f0f4f8;font-family:Inter,sans-serif;color:#1e293b}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .hdr{background:linear-gradient(135deg,#0b1328 0%,#0f2044 100%);padding:28px 32px;text-align:center}
  .hdr-logo{display:inline-flex;align-items:center;gap:10px}
  .hdr-dot{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#00e5a0,#06b6d4);display:inline-block}
  .hdr h1{margin:0;font-size:20px;font-weight:700;color:#e8eef8;letter-spacing:-0.02em}
  .hdr p{margin:4px 0 0;font-size:12px;color:rgba(232,238,248,0.5);letter-spacing:0.06em;text-transform:uppercase}
  .body{padding:28px 32px}
  .metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}
  .metric-card{text-align:center;padding:14px 8px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0}
  .metric-val{font-size:22px;font-weight:700;color:#0f2044;margin-bottom:2px}
  .metric-lbl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8}
  .aqi-badge{display:inline-block;padding:10px 24px;border-radius:40px;font-size:18px;font-weight:700;margin:8px 0}
  .alert-box{border-radius:10px;padding:16px;margin:16px 0}
  .alert-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(0,0,0,0.05);font-size:13px}
  .alert-row:last-child{border-bottom:none}
  .tip{background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#1d4ed8;margin:16px 0}
  .footer{background:#f8fafc;padding:20px 32px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0}
  .footer a{color:#3b82f6;text-decoration:none}
  h2{font-size:18px;font-weight:700;margin:0 0 4px;color:#0f2044}
  p{font-size:14px;line-height:1.6;color:#475569;margin:8px 0}
  .divider{height:1px;background:#e2e8f0;margin:20px 0}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <div class="hdr-logo">
      <span class="hdr-dot"></span>
      <div style="text-align:left">
        <h1>AirQuality Pro</h1>
        <p>Intelligent Monitoring System</p>
      </div>
    </div>
  </div>
  <div class="body">
    ${bodyHtml}
  </div>
  <div class="footer">
    <p>© ${new Date().getFullYear()} AirQuality Pro Monitor · Nairobi, Kenya<br/>
    You are receiving this because you have an active account.<br/>
    <a href="#">Manage notification preferences</a></p>
  </div>
</div>
</body>
</html>`;
}

// ── 1. HIGH AQI ALERT EMAIL ────────────────────────────────────────────────
async function sendAQIAlert({ to, name, metrics, aqi, triggeredMetrics }) {
  const cat = aqiCategory(aqi);
  const m   = metrics || {};

  const alertRows = triggeredMetrics.map(t =>
    `<div class="alert-row">
       <span><strong>${t.metric.toUpperCase()}</strong></span>
       <span style="color:#ef4444;font-weight:600">${Number(t.value).toFixed(1)} ${t.unit || ''}</span>
       <span style="color:#94a3b8">Limit: ${t.threshold} ${t.unit || ''}</span>
     </div>`
  ).join('');

  const tips = aqi > 150
    ? 'Avoid all outdoor activities. Keep windows and doors closed. Run air purifiers if available.'
    : aqi > 100
    ? 'Sensitive groups should limit outdoor activity. Consider wearing a mask if going outside.'
    : 'Air quality is declining. Monitor closely and reduce prolonged outdoor exposure.';

  const body = `
    <h2>🚨 Air Quality Alert</h2>
    <p>Hello ${name || 'there'}, an air quality threshold has been exceeded at your monitored location.</p>

    <div style="text-align:center;margin:20px 0">
      <div class="aqi-badge" style="background:${cat.bg};color:${cat.color}">
        AQI ${aqi} — ${cat.label}
      </div>
    </div>

    <div class="alert-box" style="background:${cat.bg};border:1px solid ${cat.color}30">
      <div style="font-size:12px;font-weight:700;color:${cat.color};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px">
        ⚠ Exceeded Thresholds
      </div>
      ${alertRows}
    </div>

    <div class="metric-grid">
      ${[
        ['PM2.5', (m.pm25 ?? '—') + ' µg/m³'],
        ['PM10',  (m.pm10  ?? '—') + ' µg/m³'],
        ['CO',    (m.co    ?? '—') + ' ppm'],
        ['CO₂',   (m.co2   ?? '—') + ' ppm'],
        ['Temp',  (m.temperature ?? '—') + '°C'],
        ['Humidity', (m.humidity ?? '—') + '%'],
      ].map(([l, v]) => `
        <div class="metric-card">
          <div class="metric-val">${v}</div>
          <div class="metric-lbl">${l}</div>
        </div>`).join('')}
    </div>

    <div class="tip">💡 <strong>Health Recommendation:</strong> ${tips}</div>

    <div class="divider"></div>
    <p style="font-size:12px;color:#94a3b8">
      Alert triggered at ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })} EAT
    </p>
  `;

  return getTransporter().sendMail({
    from: `"AirQuality Pro" <${process.env.EMAIL_USER}>`,
    to,
    subject: `🚨 AQI Alert: ${cat.label} (${aqi}) — Action Required`,
    html: htmlWrapper('AQI Alert', body),
  });
}

// ── 2. DAILY DIGEST EMAIL ──────────────────────────────────────────────────
async function sendDailyDigest({ to, name, stats, todayReadings }) {
  const aqi = calculateAQI(stats.avgPM25);
  const cat = aqiCategory(aqi);
  const prevAqi = calculateAQI(stats.prevAvgPM25 || stats.avgPM25);
  const aqiDiff = aqi - prevAqi;
  const trend   = aqiDiff > 5 ? '📈 Worsening' : aqiDiff < -5 ? '📉 Improving' : '➡ Stable';

  const body = `
    <h2>📋 Daily Air Quality Report</h2>
    <p>Hello ${name || 'there'}, here is your air quality summary for <strong>${new Date().toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Nairobi' })}</strong>.</p>

    <div style="text-align:center;margin:20px 0">
      <div class="aqi-badge" style="background:${cat.bg};color:${cat.color}">
        Daily Average AQI: ${aqi} — ${cat.label}
      </div>
      <div style="font-size:13px;color:#64748b;margin-top:4px">
        ${trend} vs yesterday · ${todayReadings} readings collected
      </div>
    </div>

    <div class="metric-grid">
      ${[
        ['Avg PM2.5',  (stats.avgPM25  ?? '—').toFixed ? Number(stats.avgPM25).toFixed(1)  + ' µg/m³' : '—'],
        ['Max PM2.5',  (stats.maxPM25  ?? '—').toFixed ? Number(stats.maxPM25).toFixed(1)  + ' µg/m³' : '—'],
        ['Min PM2.5',  (stats.minPM25  ?? '—').toFixed ? Number(stats.minPM25).toFixed(1)  + ' µg/m³' : '—'],
        ['Avg PM10',   (stats.avgPM10  ?? '—').toFixed ? Number(stats.avgPM10).toFixed(1)  + ' µg/m³' : '—'],
        ['Avg Temp',   (stats.avgTemp  ?? '—').toFixed ? Number(stats.avgTemp).toFixed(1)  + '°C'     : '—'],
        ['Avg Humidity',(stats.avgHumidity ?? '—').toFixed ? Number(stats.avgHumidity).toFixed(0) + '%' : '—'],
      ].map(([l, v]) => `
        <div class="metric-card">
          <div class="metric-val" style="font-size:16px">${v}</div>
          <div class="metric-lbl">${l}</div>
        </div>`).join('')}
    </div>

    <div class="divider"></div>

    <h2 style="font-size:15px">📊 24-Hour Breakdown</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:8px 12px;text-align:left;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Period</th>
          <th style="padding:8px 12px;text-align:center;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">AQI</th>
          <th style="padding:8px 12px;text-align:center;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">PM2.5</th>
          <th style="padding:8px 12px;text-align:center;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Status</th>
        </tr>
      </thead>
      <tbody>
        ${(stats.hourlyBreakdown || []).map((h, i) => {
          const hAqi = calculateAQI(h.pm25);
          const hCat = aqiCategory(hAqi);
          return `<tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${h.period}</td>
            <td style="padding:8px 12px;text-align:center;font-weight:700;color:${hCat.color};border-bottom:1px solid #f1f5f9">${hAqi}</td>
            <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #f1f5f9">${Number(h.pm25).toFixed(1)} µg/m³</td>
            <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #f1f5f9">
              <span style="background:${hCat.bg};color:${hCat.color};padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600">${hCat.label}</span>
            </td>
          </tr>`;
        }).join('') || '<tr><td colspan="4" style="text-align:center;padding:16px;color:#94a3b8">No hourly breakdown available</td></tr>'}
      </tbody>
    </table>

    <div class="divider"></div>

    <div class="tip">
      💡 <strong>Today's Tip:</strong>
      ${aqi <= 50 ? 'Great day for outdoor activities! Air quality is excellent.' :
        aqi <= 100 ? 'Air quality is acceptable. Sensitive individuals may want to limit extended outdoor time.' :
        aqi <= 150 ? 'Consider reducing outdoor activities, especially strenuous exercise.' :
        'Stay indoors as much as possible. Keep windows closed and run air purifiers.'}
    </div>
  `;

  return getTransporter().sendMail({
    from: `"AirQuality Pro" <${process.env.EMAIL_USER}>`,
    to,
    subject: `📋 Daily AQI Report — ${new Date().toLocaleDateString('en-KE', { month: 'short', day: 'numeric', timeZone: 'Africa/Nairobi' })} · AQI ${aqi} (${cat.label})`,
    html: htmlWrapper('Daily Air Quality Report', body),
  });
}

// ── 3. WELCOME EMAIL ───────────────────────────────────────────────────────
async function sendWelcomeEmail({ to, name }) {
  const body = `
    <h2>👋 Welcome to AirQuality Pro!</h2>
    <p>Hi <strong>${name}</strong>, your account has been created successfully.</p>
    <p>You are now enrolled in our automated notification system. Here's what you'll receive:</p>

    <div style="margin:20px 0">
      ${[
        ['🚨', 'Real-time AQI Alerts', 'Instant email when pollutant levels exceed safety thresholds'],
        ['📋', 'Daily Digest Reports', 'Every morning at 7:00 AM EAT with yesterday\'s full air quality summary'],
        ['📊', 'Trend Notifications', 'When air quality trends show significant improvement or deterioration'],
      ].map(([icon, title, desc]) => `
        <div style="display:flex;gap:14px;padding:14px;background:#f8fafc;border-radius:10px;margin-bottom:10px">
          <div style="font-size:28px;flex-shrink:0">${icon}</div>
          <div>
            <div style="font-weight:700;font-size:14px;color:#0f2044">${title}</div>
            <div style="font-size:13px;color:#64748b;margin-top:2px">${desc}</div>
          </div>
        </div>`).join('')}
    </div>

    <div class="tip">
      💡 <strong>Get Started:</strong> Log in to your dashboard at any time to view real-time data, 
      historical trends, and AI-powered analytics.
    </div>
  `;

  return getTransporter().sendMail({
    from: `"AirQuality Pro" <${process.env.EMAIL_USER}>`,
    to,
    subject: '👋 Welcome to AirQuality Pro — Notifications Active',
    html: htmlWrapper('Welcome', body),
  });
}

// ── Verify transport connection ────────────────────────────────────────────
async function verifyEmailConfig() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('[Email] EMAIL_USER or EMAIL_PASS not set — email features disabled');
    return false;
  }
  try {
    await getTransporter().verify();
    console.log('[Email] ✅ SMTP connection verified');
    return true;
  } catch (err) {
    console.error('[Email] ❌ SMTP verification failed:', err.message);
    return false;
  }
}

module.exports = { sendAQIAlert, sendDailyDigest, sendWelcomeEmail, verifyEmailConfig, calculateAQI, aqiCategory };
