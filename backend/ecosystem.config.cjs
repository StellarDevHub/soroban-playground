module.exports = {
  apps: [
    {
      name: 'soroban-playground-backend',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      exp_backoff_restart_delay: 200,
      kill_timeout: 5000,
      listen_timeout: 8000,
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || '768M',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
      },
    },
  ],
};
