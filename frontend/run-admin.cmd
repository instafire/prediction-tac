@echo off
REM Admin console server for tac-admin.chaty.lol (HTTP Basic Auth -> 127.0.0.1:8792)
cd /d "%~dp0"
set PORT=8792
set ADMIN=1
"C:\Python314\pythonw.exe" serve_prod.py >> "%~dp0serve-admin.log" 2>&1
