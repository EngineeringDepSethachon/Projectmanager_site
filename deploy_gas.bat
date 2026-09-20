@echo off
chcp 65001 >nul
echo [1/2] Pushing code to Google Apps Script...
call npx @google/clasp push -f
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to push code.
    exit /b %ERRORLEVEL%
)

echo [2/3] Deploying to existing deployment ID (URL will NOT change)...
call npx @google/clasp deploy -i AKfycbzT9MF8xOPiiGZvGbZRZB1T3erYYrOLGxhgfegsnJySMIlRlyNmIWmfNCOI_fdVicKjow -d "Auto-deploy update"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to deploy.
    exit /b %ERRORLEVEL%
)

echo [3/3] Initializing and synchronizing Google Sheets schema...
call node -e "fetch('https://script.google.com/macros/s/AKfycbzT9MF8xOPiiGZvGbZRZB1T3erYYrOLGxhgfegsnJySMIlRlyNmIWmfNCOI_fdVicKjow/exec?action=init_sheets', {redirect: 'follow'}).then(r=>r.json()).then(d=>console.log('  -> ' + d.message)).catch(e=>console.error(e));"

echo.
echo [SUCCESS] GAS Web App and all Google Sheets tables successfully updated without changing URL!
