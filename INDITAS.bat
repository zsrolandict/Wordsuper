@echo off
setlocal
cd /d "%~dp0"
title Word Writer - ICT Europa Legal

rem --- Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo A Node.js nincs telepitve. Toltsd le innen: https://nodejs.org  ^(LTS valtozat^), telepitsd, majd inditsd ujra ezt a fajlt.
  pause
  exit /b 1
)

rem --- Legfrissebb valtozat: ha van git es ez egy git mappa, lehuzza (a .env es a kulcsok nem erintettek) ---
set "OLDHEAD="
set "NEWHEAD="
set "NEED_INSTALL="
where git >nul 2>nul
if not errorlevel 1 if exist .git (
  for /f %%h in ('git rev-parse HEAD 2^>nul') do set "OLDHEAD=%%h"
  echo Frissites keresese...
  git pull --ff-only
  if errorlevel 1 echo Nem sikerult frissiteni ^(nincs internet, vagy helyi modositas van^). A mostani valtozattal megyek tovabb.
  for /f %%h in ('git rev-parse HEAD 2^>nul') do set "NEWHEAD=%%h"
)
if not "%OLDHEAD%"=="%NEWHEAD%" (
  git diff --name-only %OLDHEAD% %NEWHEAD% -- package.json package-lock.json | findstr "package" >nul
  if not errorlevel 1 set "NEED_INSTALL=1"
)
if not exist node_modules set "NEED_INSTALL=1"
if defined NEED_INSTALL (
  echo Fuggosegek telepitese ^(par perc^)...
  call npm ci
  if errorlevel 1 goto hiba
)
if exist .git for /f %%v in ('git log -1 --format^=%%h 2^>nul') do echo Verzio: %%v

rem --- Kulcsok: .env ---
if not exist .env (
  copy .env.example .env >nul
  echo.
  echo Elso inditas: ki kell tolteni a .env fajlt:
  echo   GEMINI_API_KEY = a Gemini API kulcsod
  echo   APP_ACCESS_KEY = egy legalabb 16 karakteres sajat jelszo ^(ezt kell a bovitmeny Beallitasaiba is beirni^)
  echo Most megnyitom a Jegyzettombben. Mentsd el, zard be, es inditsd ujra ezt a fajlt.
  notepad .env
  pause
  exit /b 0
)

rem --- A .env meg a mintaertekeket tartalmazza? ---
findstr /C:"MY_APP_ACCESS_KEY" /C:"MY_GEMINI_API_KEY" /C:"IDE_MASOLD" .env >nul
if not errorlevel 1 (
  echo.
  echo A .env fajlban meg mintaertek van ^(MY_GEMINI_API_KEY / MY_APP_ACCESS_KEY^).
  echo Most megnyitom: ird be a kulcsokat, MENTSD ^(Ctrl+S^), zard be, es inditsd ujra ezt a fajlt.
  notepad .env
  pause
  exit /b 0
)

rem --- Helyi HTTPS tanusitvany (az elso inditaskor a Windows rakerdez: IGEN) ---
echo Helyi HTTPS tanusitvany ellenorzese...
call npx --yes office-addin-dev-certs install --days 365
if errorlevel 1 goto hiba

rem --- A regi szerver leallitasa: mindig a friss kod fusson, ne a memoriaban maradt regi ---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3444" ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>nul

rem --- A Word gyorsitotara: kulonben a regi oldalt mutathatja az uj helyett ---
powershell -NoProfile -Command "Remove-Item -Path ($env:LOCALAPPDATA + '\Microsoft\Office\16.0\Wef\*') -Recurse -Force -ErrorAction SilentlyContinue"

rem --- Szerver ---
echo Szerver inditasa: https://localhost:3444
start "Word Writer szerver" cmd /k "npm run word:server"
echo Varok, amig a szerver elindul...
powershell -NoProfile -Command "$i=0; while ($i -lt 90) { try { (New-Object Net.Sockets.TcpClient('127.0.0.1', 3444)).Close(); exit 0 } catch { Start-Sleep 1; $i++ } }; exit 1"
if errorlevel 1 (
  echo A szerver nem indult el 90 masodperc alatt. Nezd meg a "Word Writer szerver" ablakot.
  goto hiba
)

rem --- Word megnyitasa a bovitmennyel ---
echo Word megnyitasa a bovitmennyel...
call npm run word:sideload
if errorlevel 1 goto hiba
echo.
echo Kesz. A Word Kezdolap szalagjan kattints a "Word Writer" gombra.
echo A bovitmeny Beallitasai alatt latszik a verzio: ha a felulet es a szerver verzioja megegyezik, minden friss.
echo A szerver ablakot hagyd nyitva, amig hasznalod. Eltavolitas: npm run word:remove
pause
exit /b 0

:hiba
echo.
echo Hiba tortent, lasd fent. Ha elakadtal, kuldd el a fenti uzeneteket.
pause
exit /b 1
