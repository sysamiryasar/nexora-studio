@echo off
REM Builds the installer (.exe) and portable .exe into the "release" folder.
REM Requires Node.js 18+ (https://nodejs.org). Run once: double-click this file.
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org then run this again. & pause & exit /b 1)
call npm install || (echo npm install failed & pause & exit /b 1)
call npm run dist || (echo build failed & pause & exit /b 1)
echo.
echo Done! Installers are in the "release" folder.
pause
