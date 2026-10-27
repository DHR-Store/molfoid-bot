// src/utils/proxy.js
require('dotenv').config();

// Example format: http://username:password@proxy-ip:port
// Or: http://proxy-ip:port (if no auth required)
const PROXY_URL = process.env.PROXY_URL || null;

module.exports = { PROXY_URL };