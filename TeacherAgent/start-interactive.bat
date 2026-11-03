@echo off
title TeacherAgent Dev
cd /d "%~dp0"
call npm run tauri:dev
if errorlevel 1 pause
