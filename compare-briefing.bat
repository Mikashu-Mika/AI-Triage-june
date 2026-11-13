@echo off
chcp 65001 >nul
title Compare morning briefing with BO (read-only)
cd /d "%~dp0"
set PATH=C:\Users\ThisPC\nodejs\PFiles64\nodejs;%PATH%

echo ==========================================================
echo    Compare morning briefing numbers with the BO dashboard
echo    (read-only - nothing in the database is changed)
echo ==========================================================
echo.
set "TARGET_DATE="
set /p "TARGET_DATE=Date to check YYYY-MM-DD (Enter = yesterday): "
echo.

if defined TARGET_DATE (
  node scripts\compareBriefingWithBO.js --date %TARGET_DATE%
) else (
  node scripts\compareBriefingWithBO.js
)
echo.
echo Done. Tell Claude to read data\compare_briefing_*.txt
pause
