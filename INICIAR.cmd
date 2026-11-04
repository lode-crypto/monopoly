@echo off
cd /d "%~dp0"
echo MONOpoly CEICOM - PostgreSQL
echo Abre http://localhost:3000 en tu navegador.
echo Consulta ACCESO-LOCAL.txt para ingresar como administrador.
call npm.cmd start
pause
