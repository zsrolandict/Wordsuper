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

rem --- Fuggosegek (csak az elso inditaskor) ---
if not exist node_modules (
  echo Fuggosegek telepitese ^(elso inditas, par perc^)...
  call npm ci
  if errorlevel 1 goto hiba
)

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

rem --- Helyi HTTPS tanusitvany (az elso inditaskor a Windows rakerdez: IGEN) ---
echo Helyi HTTPS tanusitvany ellenorzese...
call npx --yes office-addin-dev-certs install --days 365
if errorlevel 1 goto hiba

rem --- Szerver ---
netstat -ano | findstr ":3443" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo Szerver inditasa: https://localhost:3443
  start "Word Writer szerver" cmd /k "npm run word:server"
  echo Varok, amig a szerver elindul...
  powershell -NoProfile -Command "$i=0; while ($i -lt 60) { try { Invoke-WebRequest -UseBasicParsing https://localhost:3443/ -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep 1; $i++ } }; exit 1"
  if errorlevel 1 (
    echo A szerver nem indult el 60 masodperc alatt. Nezd meg a "Word Writer szerver" ablakot.
    goto hiba
  )
) else (
  echo A szerver mar fut, nem inditok ujat.
)

rem --- Word megnyitasa a bovitmennyel ---
echo Word megnyitasa a bovitmennyel...
call npm run word:sideload
if errorlevel 1 goto hiba
echo.
echo Kesz. A Word Kezdolap szalagjan kattints az "Open AI Writer" gombra.
echo A szerver ablakot hagyd nyitva, amig hasznalod. Eltavolitas: npm run word:remove
pause
exit /b 0

:hiba
echo.
echo Hiba tortent, lasd fent. Ha elakadtal, kuldd el a fenti uzeneteket.
pause
exit /b 1
