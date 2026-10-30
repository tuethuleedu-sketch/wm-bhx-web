@echo off
REM ============================================================
REM  run_daily.bat — Cập nhật BHX → tính WM+/BHX → ghi CSV cho Power BI
REM  Chạy tay (double-click = "1 nút bấm") hoặc đặt lịch bằng Task Scheduler.
REM  LUU Y: file phai luu UTF-8 + xuong dong CRLF. Neu luu LF, cmd.exe doc lech dong (loi 'nh'/'xist').
REM ============================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist logs mkdir logs

REM ---- CẤU HÌNH (sửa 3 dòng này) -------------------------------------------
set "WM_FILE=%~dp0MASTER_backup.xlsx"
set "WM_SHEET=MnM ĐBSH"
set "RADIUS_MAX_KM=5"
REM  Tính 1 lần với R_max; Power BI lọc "Khoảng cách (km) <= xx" bằng slicer/What-if.
REM ---------------------------------------------------------------------------

if exist ".venv\Scripts\activate.bat" call ".venv\Scripts\activate.bat"

echo [%date% %time%] === START === >> logs\daily.log

python bhx_fetch.py >> logs\daily.log 2>&1
set "FETCH_RC=%errorlevel%"
if not "%FETCH_RC%"=="0" (
    echo [%date% %time%] CANH BAO: bhx_fetch exit=%FETCH_RC% — dung snapshot BHX cu >> logs\daily.log
)

REM  Dong bo len web (Google Sheet) neu co file .env (GAS_URL + SYNC_SECRET) - du phong khi GitHub Action bi chan
if "%FETCH_RC%"=="0" if exist ".env" (
    python bhx_sync.py --skip-fetch >> logs\daily.log 2>&1
    if errorlevel 1 echo [%date% %time%] CANH BAO: dong bo Google Sheet that bai >> logs\daily.log
)

if not exist "data\bhx_stores.csv" (
    echo [%date% %time%] LOI: chua co data\bhx_stores.csv >> logs\daily.log
    exit /b 2
)

python wm_bhx_match.py --wm-file "%WM_FILE%" --wm-sheet "%WM_SHEET%" --radius %RADIUS_MAX_KM% --unit km --wide >> logs\daily.log 2>&1
if errorlevel 1 (
    echo [%date% %time%] LOI: wm_bhx_match that bai >> logs\daily.log
    exit /b 1
)

echo [%date% %time%] === DONE (fetch_rc=%FETCH_RC%) === >> logs\daily.log
exit /b %FETCH_RC%
