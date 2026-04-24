const express = require('express');
const app = express();
const analyticsRouter = require('./routes/analytics');
const diagnosticsRouter = require('./routes/diagnostics');
// const authRouter = require('./routes/auth');
app.use('/api/analytics', analyticsRouter);
app.use('/api/diagnostics', diagnosticsRouter);
// app.use('/api/auth', authRouter);

module.exports = app;