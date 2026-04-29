// HTTP to HTTPS Proxy for SIM800L
// Accepts HTTP from Arduino, forwards to HTTPS Render backend

const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Backend URL from environment variable or default
// Default to Render backend (stable) instead of Railway backend (timing out)
const BACKEND_URL = 'https://airquality-dashboard-and-ai-analytics.onrender.com';

// Health check - handles both Railway's probe and root requests silently
app.get(['/', '/health'], (req, res) => {
  res.json({ status: 'ok', proxy: 'running', forwards_to: BACKEND_URL });
});

// Proxy endpoint - forwards HTTP to HTTPS
// Rate-limit proxy logs to max 10/min
let proxyLogCount = 0;
let proxyLogReset = Date.now();
function proxyLog(msg) {
  const now = Date.now();
  if (now - proxyLogReset > 60000) { proxyLogCount = 0; proxyLogReset = now; }
  if (proxyLogCount < 10) { proxyLogCount++; console.log(msg); }
}

app.post('/api/sensor-data', async (req, res) => {
  // Reject empty/incomplete payloads before forwarding
  if (!req.body || !req.body.metrics || Object.keys(req.body.metrics).length === 0) {
    return res.status(400).json({ error: 'Invalid or incomplete payload' });
  }

  try {
    const response = await axios.post(`${BACKEND_URL}/api/sensor-data`, req.body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000  // 120s - handles Render free tier DEEP cold starts (~60-90s)
    });
    proxyLog(`✅ Forwarded sensor data → backend ${response.status}`);
    res.json({ success: true, forwarded: true, backendStatus: response.status });
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    proxyLog(`❌ Forward failed: ${error.message}`);
    res.status(status).json({ success: false, error: error.message });
  }
});

// Silent catch-all (no logging - avoids health-check spam)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Keep-alive: ping backend every 3 min to prevent cold starts (silent)
setInterval(async () => {
  try {
    await axios.get(`${BACKEND_URL}/health`, { timeout: 10000 });
  } catch (_) { /* silent - backend may be starting up */ }
}, 180000);  // 3 minutes

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy listening on ${PORT} → ${BACKEND_URL}`);
});
