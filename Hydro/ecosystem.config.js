module.exports = {
  apps: [
    {
      name: 'hydro-postgres',
      script: 'start_postgres.js',
      cwd: 'D:/hydro-copy/pgsql',
      max_memory_restart: '1G'
    },
    {
      name: 'hydro-express-backend',
      script: 'src/server.js',
      cwd: 'D:/hydro-copy/Hydro/backend',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=4096',
      max_memory_restart: '2G',
      kill_timeout: 4000,
      env: {
        NODE_ENV: 'production',
        PORT: 8000,
        DB_DIALECT: 'postgres',
        DATABASE_URL: 'postgres://hydro_admin:hydro_secure_pass_2026@127.0.0.1:5432/hydro_hrms'
      }
    },
    {
      name: 'hydro-invoice-backend',
      script: 'D:/hydro-copy/Hydro/backend/src/modules/invoice/venv/Scripts/python.exe',
      args: '-m uvicorn app:app --host 0.0.0.0 --port 8080 --workers 2',
      cwd: 'D:/hydro-copy/Hydro/backend/src/modules/invoice'
    },
    {
      name: 'hydro-frontend',
      script: 'D:/hydro-copy/Hydro/frontend/prod-server.cjs',
      cwd: 'D:/hydro-copy/Hydro/frontend',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5173
      }
    }
  ]
};
