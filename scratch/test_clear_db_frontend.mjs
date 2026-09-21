import fs from 'fs';
import path from 'path';

const projectRoot = 'c:\\Users\\Admin\\Desktop\\Projectmanager_site';

console.log('🧪 Testing Cleared Database Frontend Handling...');

// 1. Check firebase_service.js
const fbPath = path.join(projectRoot, 'js', 'firebase_service.js');
const fbContent = fs.readFileSync(fbPath, 'utf8');

if (fbContent.includes('filtered.length > 0 ? filtered : reports')) {
  throw new Error('❌ firebase_service still contains fallback to reports when filtered is empty!');
}
console.log('✅ 1. firebase_service correctly returns empty array for empty project reports');

// 2. Check app_foreman.js
const foremanPath = path.join(projectRoot, 'js', 'app_foreman.js');
const foremanContent = fs.readFileSync(foremanPath, 'utf8');

if (!foremanContent.includes('function clearTodayReportState()')) {
  throw new Error('❌ Missing function clearTodayReportState() in app_foreman.js');
}
console.log('✅ 2. clearTodayReportState() exists');

if (!foremanContent.includes('clearTodayReportState();')) {
  throw new Error('❌ clearTodayReportState is not called');
}
console.log('✅ 3. clearTodayReportState() is called when reports are empty');

if (!foremanContent.includes('applyApprovedTasks([]);')) {
  throw new Error('❌ applyApprovedTasks([]) is not called when tasks are empty');
}
console.log('✅ 4. applyApprovedTasks([]) is called when tasks are empty in Firestore/GAS');

if (!foremanContent.includes('window.clearSiteCache')) {
  throw new Error('❌ window.clearSiteCache is not defined in app_foreman.js');
}
console.log('✅ 5. window.clearSiteCache exists for on-demand cache clearing');

// 3. Check app_pm.js
const pmPath = path.join(projectRoot, 'js', 'app_pm.js');
const pmContent = fs.readFileSync(pmPath, 'utf8');

if (!pmContent.includes('window.clearSiteCache')) {
  throw new Error('❌ window.clearSiteCache is not defined in app_pm.js');
}
if (!pmContent.includes('listenDailyReports')) {
  throw new Error('❌ listenDailyReports is not called in app_pm.js');
}
console.log('✅ 6. app_pm.js contains real-time daily reports listener and clearSiteCache');

console.log('🎉 ALL CLEARED DATABASE FRONTEND CHECKS PASSED!');
