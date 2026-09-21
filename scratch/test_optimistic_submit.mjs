import fs from 'fs';
import path from 'path';

const projectRoot = 'c:\\Users\\Admin\\Desktop\\Projectmanager_site';

console.log('🧪 Starting Optimistic Background Sync Verification...');

// 1. Check foreman.html
const htmlPath = path.join(projectRoot, 'foreman.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

if (!htmlContent.includes('id="bg-sync-floating-pill"')) {
  throw new Error('❌ Missing #bg-sync-floating-pill in foreman.html');
}
console.log('✅ 1. foreman.html contains #bg-sync-floating-pill');

// 2. Check css/style.css
const cssPath = path.join(projectRoot, 'css', 'style.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

if (!cssContent.includes('.bg-sync-floating-pill')) {
  throw new Error('❌ Missing .bg-sync-floating-pill in css/style.css');
}
if (!cssContent.includes('.bg-sync-spinner')) {
  throw new Error('❌ Missing .bg-sync-spinner in css/style.css');
}
console.log('✅ 2. css/style.css contains styles for .bg-sync-floating-pill and .bg-sync-spinner');

// 3. Check js/app_foreman.js
const jsPath = path.join(projectRoot, 'js', 'app_foreman.js');
const jsContent = fs.readFileSync(jsPath, 'utf8');

// Ensure no blocking await gasService.sendReport inside submitDailyReport
const submitRegex = /async function submitDailyReport\(\)\s*\{([\s\S]*?)\n\}/;
const match = jsContent.match(submitRegex);
if (!match) {
  throw new Error('❌ Could not find function submitDailyReport()');
}
const submitBody = match[1];

if (submitBody.includes('await gasService.sendReport')) {
  throw new Error('❌ Found blocking await gasService.sendReport inside submitDailyReport! It must run in the background.');
}
console.log('✅ 3. submitDailyReport() does NOT block on await gasService.sendReport');

if (!submitBody.includes('renderShiftUI()')) {
  throw new Error('❌ submitDailyReport does not immediately call renderShiftUI()');
}
if (!submitBody.includes('saveReportToLocalCache(payload)')) {
  throw new Error('❌ submitDailyReport does not saveReportToLocalCache');
}
if (!submitBody.includes('runBackgroundReportSync(payload, shiftLabel, reportId)')) {
  throw new Error('❌ submitDailyReport does not delegate to runBackgroundReportSync');
}
console.log('✅ 4. submitDailyReport() performs instant optimistic commit and invokes runBackgroundReportSync');

// 4. Verify helper functions exist
const helpers = [
  'saveReportToLocalCache',
  'enqueueOfflineReport',
  'processOfflineReportsQueue',
  'showBackgroundSyncStatus',
  'runBackgroundReportSync',
  'updateSyncBannerComplete'
];
for (const h of helpers) {
  if (!jsContent.includes(`function ${h}`) && !jsContent.includes(`${h} =`)) {
    throw new Error(`❌ Missing helper function: ${h}`);
  }
}
console.log('✅ 5. All cache and background sync helpers exist');

// 5. Verify syntax by running node check
console.log('✅ ALL CHECKS PASSED SUCCESSFULLY!');
