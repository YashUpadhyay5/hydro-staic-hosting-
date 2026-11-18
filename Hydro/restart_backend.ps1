# Restarts the Express backend cleanly on Windows.
# pm2 sometimes leaves the old node process holding port 8000; the new one then cannot start (crash loop)
# while the old code keeps serving. This stops pm2's copy, removes such a leftover, starts fresh and checks
# that exactly one backend (the one pm2 tracks) is listening.
# Usage:  powershell -ExecutionPolicy Bypass -File D:\hydro-copy\Hydro\restart_backend.ps1
$port = 8000

pm2 stop hydro-express-backend | Out-Null
Start-Sleep -Seconds 3

# Only leftover pm2 backend processes (node ProcessContainerFork) on the port are stopped; anything else aborts.
$holders = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $holders) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
    if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match 'ProcessContainerFork') {
        Write-Host "Stopping leftover backend process $procId (started $($p.CreationDate))"
        Stop-Process -Id $procId -Force
    } else {
        Write-Host "Port $port is held by $($p.Name) (PID $procId), which is not a backend process. Nothing started."
        exit 1
    }
}
Start-Sleep -Seconds 2
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    Write-Host "Port $port is still busy. Nothing started."
    exit 1
}

pm2 start hydro-express-backend | Out-Null
$listeners = @()
for ($i = 0; $i -lt 30 -and -not $listeners; $i++) {
    Start-Sleep -Seconds 2
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}
$pm2Pid = (pm2 pid hydro-express-backend | Select-Object -Last 1).Trim()
if ($listeners.Count -eq 1 -and "$($listeners[0])" -eq $pm2Pid) {
    Write-Host "OK: backend running as PID $pm2Pid on port $port."
} else {
    Write-Host "Check needed: listeners on port $port = $($listeners -join ', '); pm2 PID = $pm2Pid."
    exit 1
}
