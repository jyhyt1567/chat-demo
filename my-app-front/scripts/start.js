#!/usr/bin/env node
const { spawn } = require('child_process');

const backendPort = process.env.BACKEND_PORT || process.env.npm_config_backend_port;
const backendBaseUrl = process.env.REACT_APP_BACKEND_BASE_URL;

if (!backendBaseUrl && backendPort) {
  process.env.REACT_APP_BACKEND_BASE_URL = `http://localhost:${backendPort}`;
  console.log(`Using backend port ${backendPort}`);
} else if (backendBaseUrl) {
  console.log(`Using backend URL ${backendBaseUrl}`);
} else {
  console.log('Using default backend URL http://localhost:8080');
}

const child = spawn('react-scripts', ['start'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
