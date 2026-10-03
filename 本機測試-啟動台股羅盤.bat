@echo off
setlocal
cd /d "%~dp0"
title 台股羅盤公開版 - 本機測試
echo 台股羅盤公開版 - 本機測試
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js
  pause
  exit /b 1
)
if not exist node_modules (
  echo 第一次使用，安裝套件...
  call npm.cmd install
  if errorlevel 1 (
    echo [錯誤] npm install 失敗
    pause
    exit /b 1
  )
)
start "" "http://localhost:4174/"
call npm.cmd run dev
pause
