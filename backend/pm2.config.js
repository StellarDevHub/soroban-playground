// pm2.config.js  –  PM2 cluster mode (alternative to Node's built-in cluster module)
//
// Usage:
//   pm2 start pm2.config.js              # start in cluster mode
//   pm2 reload pm2.config.js             # zero-downtime reload
//   pm2 stop pm2.config.js
//   pm2 delete pm2.config.js
//
// Install PM2 globally if needed:  npm install -g pm2

'use strict';

module.exports = {
  apps: [
    {
      name: 'soroban-backend',

      // Point at the original server entry (NOT cluster.js) when using PM2,
      // because PM2 handles the forking itself.
      script: './backend/src/server.js',

      // 'cluster' tells PM2 to use Node's cluster module under the hood
      exec_mode: 'cluster',

      // 'max' = one instance per logical CPU core (same as os.cpus().length)
      instances: process.env.CLUSTER_WORKERS || 'max',

      // Restart a crashed worker automatically
      autorestart: true,

      // Milliseconds to wait before restarting after a crash
      restart_delay: 100,

      // Don't restart if the process exits within 1 second (crash-loop guard)
      min_uptime: '1s',

      // Maximum restart attempts before giving up
      max_restarts: 10,

      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 4000,
        REDIS_URL: 'redis://localhost:6379',
        SESSION_SECRET: 'dev-secret-change-in-prod',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
        REDIS_URL: process.env.REDIS_URL,
        SESSION_SECRET: process.env.SESSION_SECRET,
      },

      // Unified log files aggregated from all workers
      out_file: './logs/app-out.log',
      error_file: './logs/app-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true, // merge all worker logs into the same file

      // Graceful shutdown: send SIGINT and wait up to 10 s before SIGKILL
      kill_timeout: 10000,
      listen_timeout: 8000,

      // Memory threshold – restart the worker if it exceeds 500 MB
      max_memory_restart: '500M',
    },
  ],
};