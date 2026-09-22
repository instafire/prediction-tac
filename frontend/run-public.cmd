@echo off
REM Public site server for tac.chaty.lol (Cloudflare tunnel -> 127.0.0.1:8791)
cd /d "%~dp0"
set PORT=8791
set ADMIN=0
"C:\Python314\pythonw.exe" serve_prod.py >> "%~dp0serve-public.log" 2>&1
