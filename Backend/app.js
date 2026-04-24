const express = require('express');
const app = express();
const analyticsRouter = require('./routes/analytics');
const diagnosticsRouter = require('./routes/diagnostics');
app.use('/api/analytics', analyticsRouter);
app.use('/api/diagnostics', diagnosticsRouter);

module.exports = app;