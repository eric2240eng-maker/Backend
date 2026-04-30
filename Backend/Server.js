/**
 *  AIR QUALITY BACKEND – GSM + DASHBOARD READY
 *  -------------------------------------------
 *  ✓ Accepts GSM/Arduino sensor data
 *  ✓ Stores in MongoDB
 *  ✓ Emits live updates via Socket.IO
 *  ✓ Emits alerts & persists them
 *  ✓ Used by your dashboard frontend
 *  ✓ CORS configured for Vercel production
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

// Models
const Reading = require('./models/reading');
const Alert = require('./models/alert');
const Setting = require('./models/settings');

// Routes
const chatbotRouter = require('./routes/chatbot');
const analyticsRouter = require('./routes/analytics');
const diagnosticsRouter = require('./routes/diagnostics');

const app = express();
app.use(express.json());

// ---------- CORS (Frontend only) ----------
// Default localhost origins for development
const defaultOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

// Allow configuring one or multiple production frontend origins via env
// Supports: FRONTEND_URLS, FRONTEND_URL, or CORS_ORIGIN (from your Render config)
const envOriginsRaw = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || process.env.CORS_ORIGIN || '';
const envOrigins = envOriginsRaw === '*' 
  ? [] // Ignore wildcard, use explicit list instead
  : envOriginsRaw.split(',').map(s => s.trim()).filter(Boolean);

// Production Vercel URL - use base URL to match all deployments (preview, production, etc.)
const productionOrigins = [
  'https://air-quality-dashboard-and-ai.vercel.app',
  'https://air-quality-dashboard-and-ai-git-main',  // Git branch previews
  'https://air-quality-dashboard-and-ai'  // Base match for all Vercel deployments
];

const allowedOrigins = [...defaultOrigins, ...envOrigins, ...productionOrigins];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Postman, etc.)
    if (!origin) return cb(null, true);

    // Check if origin starts with any allowed origin (handles trailing slashes, ports, preview URLs)
    const isAllowed = allowedOrigins.some(allowedOrigin => origin.startsWith(allowedOrigin));
    
    if (isAllowed) {
      return cb(null, true);
    }

    return cb(new Error('CORS blocked: ' + origin));
  },
  credentials: true
}));

// ---------- Server + WebSocket ----------
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// ---------- Connect MongoDB ----------
mongoose.set('strictQuery', false);
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log(" MongoDB Connected"))
  .catch(err => console.error(" MongoDB Error:", err.message));

let latestReadingCache = null;
const inMemoryHistory = [];
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT || 2000);

// ---------- Normalization Utility ----------
function normalizeReading(reading) {
  if (!reading) return null;
  return {
    _id: reading._id || null,
    timestamp: reading.timestamp || new Date(),
    location: reading.location || "Nairobi",
    metrics: reading.metrics || {},
  };
}

function recordReading(r) {
  const n = normalizeReading(r);
  latestReadingCache = n;
  inMemoryHistory.push(n);
  if (inMemoryHistory.length > HISTORY_LIMIT)
    inMemoryHistory.splice(0, inMemoryHistory.length - HISTORY_LIMIT);
  return n;
}

// ---------- ALERT ENGINE ----------
const thresholds = { pm25: 150, pm10: 150, co: 10, o3: 100, no2: 100 };

async function processAlerts(normalized) {
  const alerts = [];
  for (const metric of Object.keys(thresholds)) {
    if (!normalized.metrics[metric]) continue;

    const value = normalized.metrics[metric];
    const limit = thresholds[metric];

    if (value > limit) {
      const alertDoc = new Alert({
        readingId: normalized._id,
        metric,
        value,
        threshold: limit,
        severity: "unhealthy",
      });

      await alertDoc.save();
      io.emit("alert", alertDoc.toObject());
      alerts.push(alertDoc);
    }
  }
  return alerts;
}

// ------------------------------------------------------------
//  🔥 GSM / ARDUINO SENDS DATA HERE
// ------------------------------------------------------------
app.post("/api/sensor-data", async (req, res) => {
  try {
    const payload = req.body;

    // Reject empty or malformed bodies (e.g. fragmented GSM packets)
    if (!payload || typeof payload !== 'object' || !payload.metrics || typeof payload.metrics !== 'object' || Object.keys(payload.metrics).length === 0) {
      return res.status(400).json({ error: "Invalid or incomplete payload" });
    }

    // Normalize location: Arduino fallback may send an object { name, latitude, longitude }
    const rawLoc = payload.location;
    const locationStr = (rawLoc && typeof rawLoc === 'object')
      ? (rawLoc.name || 'Nairobi')
      : (rawLoc || 'Nairobi');

    const savedDoc = await new Reading({
      location: locationStr,
      metrics: payload.metrics || {},
      timestamp: new Date()
    }).save();

    const normalized = recordReading(savedDoc.toObject());

    // Emit live update
    io.emit("sensorData", normalized);

    // Handle alerts
    await processAlerts(normalized);

    res.json({ success: true });
  } catch (err) {
    console.error("Sensor Data Error:", err.message);
    res.status(500).json({ error: "Failed to save sensor data" });
  }
});

// ------------------------------------------------------------
//  AIRDATA ENDPOINT (ALIAS for Arduino compatibility)
// ------------------------------------------------------------
app.post("/api/airdata", async (req, res) => {
  try {
    const payload = req.body;

    // Reject empty or malformed bodies (e.g. fragmented GSM packets)
    if (!payload || typeof payload !== 'object' || !payload.metrics || typeof payload.metrics !== 'object' || Object.keys(payload.metrics).length === 0) {
      return res.status(400).json({ error: "Invalid or incomplete payload" });
    }

    // Normalize location: Arduino fallback may send an object { name, latitude, longitude }
    const rawLoc = payload.location;
    const locationStr = (rawLoc && typeof rawLoc === 'object')
      ? (rawLoc.name || 'Nairobi')
      : (rawLoc || 'Nairobi');

    const savedDoc = await new Reading({
      location: locationStr,
      metrics: payload.metrics || {},
      timestamp: new Date()
    }).save();

    const normalized = recordReading(savedDoc.toObject());

    // Emit live update
    io.emit("sensorData", normalized);

    // Handle alerts
    await processAlerts(normalized);

    res.json({ success: true });
  } catch (err) {
    console.error("Sensor Data Error:", err.message);
    res.status(500).json({ error: "Failed to save sensor data" });
  }
});

app.get("/api/airdata/latest", async (req, res) => {
  if (latestReadingCache) return res.json(latestReadingCache);

  const last = await Reading.findOne().sort({ timestamp: -1 }).lean();
  if (!last) return res.status(404).json({ message: "No data yet" });

  const normalized = recordReading(last);
  res.json(normalized);
});


app.get("/api/sensor-data/latest", async (req, res) => {
  if (latestReadingCache) return res.json(latestReadingCache);

  const last = await Reading.findOne().sort({ timestamp: -1 }).lean();
  if (!last) return res.status(404).json({ message: "No data yet" });

  const normalized = recordReading(last);
  res.json(normalized);
});


app.get("/api/historical", async (req, res) => {
  try {
    let readings = await Reading.find().sort({ timestamp: 1 }).lean();
    res.json(readings);
  } catch (err) {
    res.status(500).json({ error: "Historical load error" });
  }
});

// ------------------------------------------------------------
// SETTINGS ROUTES
// ------------------------------------------------------------
app.post("/api/settings", async (req, res) => {
  const { userId, thresholds } = req.body;
  const doc = await Setting.findOneAndUpdate(
    { userId }, { thresholds }, { new: true, upsert: true }
  );
  res.json(doc);
});

app.get("/api/settings/:userId", async (req, res) => {
  const doc = await Setting.findOne({ userId: req.params.userId });
  res.json(doc || {});
});

// ---------- CHATBOT ROUTES ----------
app.use("/api/chatbot", chatbotRouter);

// ---------- ANALYTICS ROUTES ----------
app.use("/api/analytics", analyticsRouter);

// ---------- DIAGNOSTICS ROUTES ----------
app.use("/api/diagnostics", diagnosticsRouter);

// ---------- SOCKET.IO ----------
io.on("connection", socket => {
  // Suppress per-connection logs to avoid Railway log rate limits
});

// ---------- HEALTH ----------
app.get("/health", (_, res) => res.json({ status: "ok" }));

// ---------- START ----------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(` Server listening on ${PORT}`));
