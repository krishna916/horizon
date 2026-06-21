# Windows PowerShell Script for Horizon Local Environment Startup

Write-Host "=== Starting Horizon Local Environment ===" -ForegroundColor Cyan

# 1. Start postgres database
Write-Host "Starting PostgreSQL container..." -ForegroundColor Yellow
Push-Location "$PSScriptRoot/server"
docker compose up -d
Pop-Location

# 2. Start Backend API
Write-Host "Starting backend Spring Boot application in a new window (http://localhost:8081)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", ".\mvnw.cmd spring-boot:run" -WorkingDirectory "$PSScriptRoot/server"

# 3. Start Frontend Client
Write-Host "Starting frontend React Vite application in a new window (http://localhost:5173)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev" -WorkingDirectory "$PSScriptRoot/client"

Write-Host "`nHorizon application is starting up!" -ForegroundColor Green
Write-Host "- Backend API: http://localhost:8081" -ForegroundColor Gray
Write-Host "- Frontend Dev Server: http://localhost:5173" -ForegroundColor Gray
Write-Host "Please check the newly opened PowerShell windows for service logs." -ForegroundColor Green
