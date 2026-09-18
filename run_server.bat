@echo off
chcp 65001 > nul
echo ========================================================
echo   CPM Site: ระบบรายงานประจำวันหน้างานสำหรับโฟร์แมน
echo   (Projectmanager_site - Mobile UI & LINE LIFF)
echo ========================================================
echo.
echo กำลังเริ่มรัน Web Server ที่พอร์ต 8081...
echo หน้าเว็บจะเปิดขึ้นอัตโนมัติที่: http://localhost:8081
echo.
start http://localhost:8081
python -m http.server 8081
pause
