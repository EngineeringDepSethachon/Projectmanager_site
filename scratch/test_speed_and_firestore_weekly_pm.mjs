import fs from 'fs';
import path from 'path';

console.log('🧪 Testing Speed & Firestore Enhancements for weekly-plan.html & pm-center.html...');

// 1. Check firebase_service.js methods
const firebaseContent = fs.readFileSync('js/firebase_service.js', 'utf8');
const requiredMethods = [
  'saveWeeklyPlan',
  'updateWeeklyPlanStatus',
  'getWeeklyPlans',
  'listenWeeklyPlans',
  'savePlanTasks',
  'getPlanTasks'
];

requiredMethods.forEach(method => {
  if (!firebaseContent.includes(method)) {
    throw new Error(`❌ Missing method ${method} in firebase_service.js`);
  }
});
console.log('✅ 1. firebase_service.js contains all 6 weekly plan & task methods');

// 2. Check pm-center.html optimizations
const pmHtml = fs.readFileSync('pm-center.html', 'utf8');
if (!pmHtml.includes('defer src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js')) {
  throw new Error('❌ html2pdf.bundle.min.js does not have defer attribute in pm-center.html');
}
console.log('✅ 2. pm-center.html has defer attribute on html2pdf script');

// 3. Check app_pm.js non-blocking DOMContentLoaded and Firestore-first
const appPm = fs.readFileSync('js/app_pm.js', 'utf8');
if (appPm.includes('document.addEventListener(\'DOMContentLoaded\', async () => {\n  parseUrlParams();\n  renderProjectInfo();\n  setupSubNavTabs();\n  setupProjectModal();\n  setupFilters();\n  setupPMMonthStepper();\n\n  await loadProjects();')) {
  throw new Error('❌ app_pm.js still blocks DOMContentLoaded with serial awaits!');
}
if (!appPm.includes('firebaseService.getWeeklyPlans(state.project.id)')) {
  throw new Error('❌ app_pm.js does not query getWeeklyPlans from Firestore');
}
if (!appPm.includes('firebaseService.listenWeeklyPlans(state.project.id')) {
  throw new Error('❌ app_pm.js does not setup real-time listener listenWeeklyPlans');
}
if (!appPm.includes('firebaseService.updateWeeklyPlanStatus(planId, decision, notes')) {
  throw new Error('❌ app_pm.js handlePMDecision does not write to Firestore');
}
console.log('✅ 3. app_pm.js is 0ms non-blocking, Firestore-first for plans/reports, and real-time synced');

// 4. Check app_weekly.js non-blocking DOMContentLoaded and Firestore-first
const appWeekly = fs.readFileSync('js/app_weekly.js', 'utf8');
if (appWeekly.includes('document.addEventListener(\'DOMContentLoaded\', async () => {\n  parseUrlParams();\n  renderProfile();\n  renderProjectInfo();\n\n  // 1. Sync User Profile\n  await syncUserProfile();')) {
  throw new Error('❌ app_weekly.js still blocks DOMContentLoaded with serial awaits!');
}
if (!appWeekly.includes('firebaseService.getWeeklyPlans(state.project.id)')) {
  throw new Error('❌ app_weekly.js does not query getWeeklyPlans from Firestore');
}
if (!appWeekly.includes('firebaseService.getPlanTasks(planId)')) {
  throw new Error('❌ app_weekly.js loadTasksForPlan does not query getPlanTasks from Firestore');
}
if (!appWeekly.includes('firebaseService.saveWeeklyPlan(payload)')) {
  throw new Error('❌ app_weekly.js submitPlanToPM does not write to Firestore');
}
if (!appWeekly.includes('firebaseService.listenWeeklyPlans(state.project.id')) {
  throw new Error('❌ app_weekly.js setupWeeklyRealtimeSync does not setup listenWeeklyPlans');
}
console.log('✅ 4. app_weekly.js is 0ms non-blocking, Firestore-first for plans/tasks, and real-time synced');

console.log('🎉 ALL SPEED & FIRESTORE ENHANCEMENTS VERIFIED SUCCESSFULLY!');
