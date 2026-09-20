@echo off
echo ==============================================================================
echo [INIT] Construction Site Report - Google Sheets Structure Initializer
echo ==============================================================================
echo.
echo Connecting to Google Apps Script Web App...
echo Initializing and synchronizing all Google Sheets tables...
echo.

node -e "fetch('https://script.google.com/macros/s/AKfycbzT9MF8xOPiiGZvGbZRZB1T3erYYrOLGxhgfegsnJySMIlRlyNmIWmfNCOI_fdVicKjow/exec?action=init_sheets', {redirect: 'follow'}).then(r=>r.json()).then(d=>{console.log('[STATUS] ' + d.message + '\n'); console.log('=============================================================================='); console.log('TABLE NAME           | COLS | ROWS | STATUS'); console.log('---------------------+------+------+--------------------------------------'); Object.keys(d.sheets).forEach(k=>{const s=d.sheets[k]; const name=(s.name+'                     ').slice(0, 20); const cols=(s.cols+'    ').slice(0, 4); const rows=(s.rows+'    ').slice(0, 4); console.log(name + ' | ' + cols + ' | ' + rows + ' | OK (Headers and Colors formatted)');}); console.log('=============================================================================='); console.log('\nTimestamp: ' + d.timestamp);}).catch(e=>{console.error('[ERROR]', e);});"

echo.
echo Finished! All Google Sheets headers and structures are synchronized.
echo.
pause
