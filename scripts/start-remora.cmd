@echo off
setlocal
cd /d "%~dp0.."
call npm start -- %*
if errorlevel 1 (
  echo.
  echo Remora did not start. Review the message above.
  pause
)
