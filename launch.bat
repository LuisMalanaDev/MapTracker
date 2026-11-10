@echo off
echo Starting CraveNav Live Restaurant Tracker on http://localhost:4000 ...
start "" "http://localhost:4000"
cd /d "%~dp0"
node server.js
