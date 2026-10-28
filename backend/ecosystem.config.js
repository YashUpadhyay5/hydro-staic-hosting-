module.exports = {
  apps: [
    {
      name: 'hydro-express-backend',
      script: 'src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      restart_delay: 2000,
      kill_timeout: 4000,
      min_uptime: '10s',
      max_restarts: 20,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 8000,
        DB_DIALECT: 'postgres',
        DATABASE_URL: 'postgres://hydro_admin:hydro_secure_pass_2026@127.0.0.1:5432/hydro_hrms'
      }
    }
  ]
};
