@echo off
rem Batch wrapper to run start.ps1 with execution policy bypass
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1"
