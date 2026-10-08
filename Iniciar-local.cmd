@echo off
rem Versao local: painel e jogos rodam neste computador, sem servidor remoto.
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js LTS para abrir a versao local.
  pause
  exit /b 1
)
if not exist "server\node_modules\ws\package.json" (
  call npm --prefix server ci --omit=dev --no-audit --no-fund
  if errorlevel 1 goto install_failed
)
if not exist "launcher\node_modules\electron\package.json" (
  call npm --prefix launcher ci --no-audit --no-fund
  if errorlevel 1 goto install_failed
)
set ELECTRON_RUN_AS_NODE=
call npm --prefix launcher run local
if errorlevel 1 pause
exit /b 0
:install_failed
echo Nao foi possivel instalar as dependencias. Verifique a conexao.
pause
exit /b 1
