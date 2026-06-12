const express = require('express');
const {
  requestHandler,
  assertProductionConfig,
  ensureDataFile,
  canSendMail,
  PORT,
  IS_PRODUCTION,
  ADMIN_PASS,
  DEFAULT_LOCAL_ADMIN_PASS
} = require('./server');

const app = express();
app.disable('x-powered-by');

// Hostinger detects this as a standard Express.js app.
// The requestHandler keeps the existing secure public pages, admin CRM and API routes unchanged.
app.use((req, res) => requestHandler(req, res));

assertProductionConfig();

app.listen(PORT, () => {
  ensureDataFile();
  if (!IS_PRODUCTION && ADMIN_PASS === DEFAULT_LOCAL_ADMIN_PASS) {
    console.warn('Local fallback admin password is active. Set ADMIN_PASS in .env before any live use.');
  }
  if (!canSendMail()) {
    console.warn('Email not configured yet. Leads will save, but automatic emails will not send until SMTP variables are added.');
  }
  console.log(`ADWALAA Express app running at http://localhost:${PORT}`);
  console.log('Admin login URL: /admin-login.html');
});

module.exports = app;
