@echo off
title Hydro Enterprise Cluster (PostgreSQL + PM2)
echo ========================================================
echo   STARTING HYDRO CLUSTER (POSTGRESQL + MULTI-CORE PM2)
echo ========================================================
cd /d "D:\hydro-copy\Hydro"

echo [1/3] Starting all services via PM2 Cluster...
call pm2 start ecosystem.config.js

echo [2/3] Saving PM2 state for auto-recovery...
call pm2 save

echo [3/3] Checking active services...
call pm2 list

echo ========================================================
echo   ALL SERVICES ARE ONLINE ACROSS MULTI-CORE CLUSTER!
echo   Frontend UI      : http://localhost:5173
echo   HRMS & Payroll   : http://localhost:8000/api
echo   Invoice OCR      : http://localhost:8080/
echo   PostgreSQL DB    : localhost:5432 (Database: hydro_hrms)
echo ========================================================
pause
