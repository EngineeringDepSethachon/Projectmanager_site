@echo off
chcp 65001 >nul
echo [1/3] Pushing code to Google Apps Script...
call npx @google/clasp push -f
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to push code.
    exit /b %ERRORLEVEL%
)

echo [2/3] Creating new version...
call npx @google/clasp version "Auto-deploy update"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to create version.
    exit /b %ERRORLEVEL%
)

echo [3/3] Redeploying to existing deployment ID (URL will NOT change)...
call npx @google/clasp redeploy AKfycbzT9MF8xOPiiGZvGbZRZB1T3erYYrOLGxhgfegsnJySMIlRlyNmIWmfNCOI_fdVicKjow -d "Auto-deploy update"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to redeploy.
    exit /b %ERRORLEVEL%
)

echo [SUCCESS] GAS Web App successfully updated without changing URL!
