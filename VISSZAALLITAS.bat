@echo off
setlocal
rem Ideiglenes masolatbol fut: valtaskor a mappaban levo fajl lecserelodhet vagy eltunhet
if "%~1"=="" (
  copy /y "%~f0" "%TEMP%\ww-visszaallitas.bat" >nul
  "%TEMP%\ww-visszaallitas.bat" "%~dp0"
  exit /b
)
cd /d "%~1"
title Word Writer - visszaallitas
rem Valtas a rogzitett stabil valtozat es a legfrissebb valtozat kozott. A .env es a kulcsok nem erintettek.

where git >nul 2>nul
if errorlevel 1 (
  echo A git nincs telepitve, igy nem tudok valtozatot valtani.
  pause
  exit /b 1
)

rem A stabil valtozat: a 2026-10-03-i allapot, a formazas-egysegesites es a ketnyelvu forditas elott
set "STABIL=97690efa91a7ff08f9efc2da8cf1e5302c559814"
for /f %%h in ('git rev-parse HEAD 2^>nul') do set "OLDHEAD=%%h"

echo.
echo 1 - Vissza a stabil valtozatra (2026-10-03, 97690ef), ha az uj funkciok nem valnak be
echo 2 - Vissza a legfrissebb valtozatra (phase-1)
echo.
choice /c 12 /n /m "Valassz (1 vagy 2): "
if errorlevel 2 goto legfrissebb

git checkout -q %STABIL%
if errorlevel 1 goto hiba
rem A stabil valtozatban ez a fajl meg nincs benne: visszateszem, hogy vissza is lehessen jonni
copy /y "%TEMP%\ww-visszaallitas.bat" "VISSZAALLITAS.bat" >nul
echo Kesz: a stabil valtozat van beallitva.
goto telepites

:legfrissebb
rem A visszatett masolat ne akadalyozza a valtast (a legfrissebb valtozat a sajatjat hozza)
git ls-files --error-unmatch VISSZAALLITAS.bat >nul 2>nul
if errorlevel 1 del /q VISSZAALLITAS.bat >nul 2>nul
git checkout -q phase-1
if errorlevel 1 goto hiba
git pull --ff-only
echo Kesz: a legfrissebb valtozat van beallitva.

:telepites
for /f %%h in ('git rev-parse HEAD 2^>nul') do set "NEWHEAD=%%h"
git diff --name-only %OLDHEAD% %NEWHEAD% -- package.json package-lock.json | findstr "package" >nul
if errorlevel 1 goto vege
echo Fuggosegek telepitese ^(par perc^)...
call npm ci
if errorlevel 1 goto hiba

:vege
echo.
echo Zard be a Wordot, majd inditsd az INDITAS.bat-ot.
pause
exit /b 0

:hiba
echo.
echo Nem sikerult a valtas. Ha helyi modositas van a mappaban, kuldd el a fenti uzenetet.
pause
exit /b 1
