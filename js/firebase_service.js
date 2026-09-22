/**
 * js/firebase_service.js
 * Firebase Real-time Firestore Sync Service for CPM Construction Management
 * Provides instant (<100ms) cross-device updates for:
 * 1. PM Plan Approvals -> Instant update on Foreman's mobile screen
 * 2. Foreman Daily Reports (Morning/Evening) -> Instant notification on PM Dashboard
 * 3. Weekly Gantt Plans updates
 */

// Import Firebase SDK v10 via ES Modules CDN (no bundler/node required)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Firebase Configuration from Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyDCgu48TNSWbz6PFLrKf9zGXhT53FYaAm0",
  authDomain: "cpm-site-manager.firebaseapp.com",
  projectId: "cpm-site-manager",
  storageBucket: "cpm-site-manager.firebasestorage.app",
  messagingSenderId: "64033745826",
  appId: "1:64033745826:web:3e809a8441570f92b460fb",
  measurementId: "G-SKQYBTSYTF"
};

let app = null;
let db = null;
let isInitialized = false;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  isInitialized = true;
  console.log('[FirebaseService] Firebase Firestore initialized successfully for project:', firebaseConfig.projectId);
} catch (err) {
  console.warn('[FirebaseService] Firebase init error:', err);
}

export const firebaseService = {
  isConfigured() {
    return isInitialized && !!db;
  },

  getDb() {
    return db;
  },

  /**
   * Broadcast a Real-time Sync Event to all connected devices in <100ms
   * @param {string} type - e.g. 'PLAN_APPROVED', 'DAILY_REPORT_SUBMITTED', 'PLAN_SUBMITTED'
   * @param {object} payload - additional event data
   */
  async broadcastEvent(type, payload = {}) {
    if (!this.isConfigured()) return false;
    try {
      const syncDocRef = doc(db, 'cpm_live_sync', 'global_event');
      await setDoc(syncDocRef, {
        type: type,
        timestamp: Date.now(),
        payload: payload,
        updatedAt: serverTimestamp()
      }, { merge: true });
      console.log('[FirebaseService] Broadcast event sent:', type, payload);
      return true;
    } catch (err) {
      console.warn('[FirebaseService] broadcastEvent error:', err);
      return false;
    }
  },

  /**
   * Listen for Real-time Sync Events across all connected clients
   * @param {function} callback - called whenever an event fires: callback(eventType, payload)
   * @returns {function} unsubscribe function
   */
  listenEvents(callback) {
    if (!this.isConfigured()) return () => {};
    try {
      const syncDocRef = doc(db, 'cpm_live_sync', 'global_event');
      return onSnapshot(syncDocRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data && data.type) {
            callback(data.type, data.payload || {}, data.timestamp);
          }
        }
      }, (err) => {
        console.warn('[FirebaseService] listenEvents error:', err);
      });
    } catch (err) {
      console.warn('[FirebaseService] listenEvents setup error:', err);
      return () => {};
    }
  },

  /**
   * Save or update a Daily Report in Firestore in real-time
   * @param {object} report - report payload
   */
  async saveDailyReport(report) {
    if (!this.isConfigured() || !report || !report.id) return false;
    try {
      const reportDocRef = doc(db, 'daily_reports', String(report.id));
      await setDoc(reportDocRef, {
        ...report,
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      // Also broadcast an event so PM Dashboard receives instant push notification
      await this.broadcastEvent('DAILY_REPORT_SUBMITTED', {
        reportId: report.id,
        shift: report.shift_type,
        projectId: report.project_id,
        subName: report.sub_name || report.company,
        foremanName: report.foreman_name || report.line_name
      });

      return true;
    } catch (err) {
      console.warn('[FirebaseService] saveDailyReport error:', err);
      return false;
    }
  },

  /**
   * Fetch Daily Reports for a project from Firestore
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async getDailyReports(projectId) {
    if (!this.isConfigured()) return [];
    try {
      const reportsCol = collection(db, 'daily_reports');
      const snapshot = await getDocs(reportsCol);
      const reports = [];
      snapshot.forEach(docSnap => {
        reports.push({ id: docSnap.id, ...docSnap.data() });
      });
      reports.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
      if (projectId && projectId !== '-' && projectId !== 'all') {
        const filtered = reports.filter(r => {
          const pid = r.project_id || r.projectId;
          return pid === projectId;
        });
        return filtered;
      }
      return reports;
    } catch (err) {
      console.warn('[FirebaseService] getDailyReports error:', err);
      return [];
    }
  },

  /**
   * Listen for Daily Reports for a specific project in real-time
   * @param {string} projectId
   * @param {function} callback - callback(reportsList)
   */
  listenDailyReports(projectId, callback) {
    if (!this.isConfigured()) return () => {};
    try {
      const reportsCol = collection(db, 'daily_reports');
      return onSnapshot(reportsCol, (snapshot) => {
        const reports = [];
        snapshot.forEach(doc => {
          reports.push({ id: doc.id, ...doc.data() });
        });
        // Sort newest first
        reports.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
        if (projectId && projectId !== '-' && projectId !== 'all') {
          const filtered = reports.filter(r => {
            const pid = r.project_id || r.projectId;
            return pid === projectId;
          });
          callback(filtered);
        } else {
          callback(reports);
        }
      }, (err) => {
        console.warn('[FirebaseService] listenDailyReports error:', err);
      });
    } catch (err) {
      console.warn('[FirebaseService] listenDailyReports setup error:', err);
      return () => {};
    }
  },

  /**
   * Save Approved Tasks for a given date in Firestore
   * @param {string} date - 'YYYY-MM-DD'
   * @param {string} projectId
   * @param {Array} tasks - list of approved tasks
   */
  async syncApprovedTasks(date, projectId, tasks = []) {
    if (!this.isConfigured() || !date) return false;
    try {
      const docKey = `${projectId || 'all'}_${date}`;
      const docRef = doc(db, 'approved_tasks_by_date', docKey);
      await setDoc(docRef, {
        date: date,
        projectId: projectId || 'all',
        tasks: tasks,
        updatedAt: serverTimestamp()
      }, { merge: true });

      await this.broadcastEvent('PLAN_APPROVED', {
        date: date,
        projectId: projectId
      });
      return true;
    } catch (err) {
      console.warn('[FirebaseService] syncApprovedTasks error:', err);
      return false;
    }
  },

  /**
   * Fetch Approved Tasks for a given date from Firestore (<100ms)
   * @param {string} date - 'YYYY-MM-DD'
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async getApprovedTasks(date, projectId) {
    if (!this.isConfigured() || !date) return [];
    try {
      const docKey = `${projectId || 'all'}_${date}`;
      const docRef = doc(db, 'approved_tasks_by_date', docKey);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data.tasks) && data.tasks.length > 0) return data.tasks;
      }

      // Smart Fallback: Find approved weekly/monthly plans covering this date
      const plans = await this.getWeeklyPlans(projectId);
      const approvedPlans = plans.filter(p => {
        const status = p.status || p.pmStatus;
        if (status !== 'Approved') return false;
        const s = p.startDate || p.start_date || '';
        const e = p.endDate || p.end_date || s;
        return (!s || !e || (date >= s && date <= e));
      });

      if (approvedPlans.length > 0) {
        const collectedTasks = [];
        for (const plan of approvedPlans) {
          const pTasks = await this.getPlanTasks(plan.planId || plan.id);
          if (Array.isArray(pTasks) && pTasks.length > 0) {
            pTasks.forEach((t, idx) => {
              collectedTasks.push({
                taskId: t.task_id || t.id || t.taskId || ('AP-' + (plan.planId || plan.id) + '-' + idx),
                name: t.task_name || t.name || t.taskName || 'งานตามแผนที่อนุมัติ',
                targetQty: t.quantity || t.targetQty || '',
                quantity: t.quantity || t.targetQty || '',
                progress: 0,
                plannedWorkers: t.planned_workers || t.plannedWorkers || 0,
                workArea: t.work_area || t.workArea || '',
                category: t.category || 'ทั่วไป',
                company: plan.company || plan.company_name || t.company || '-',
                from_plan: true
              });
            });
          }
        }
        if (collectedTasks.length > 0) {
          return collectedTasks;
        }
      }

      return [];
    } catch (err) {
      console.warn('[FirebaseService] getApprovedTasks error:', err);
      return [];
    }
  },

  /**
   * Listen for Approved Tasks for a given date in real-time
   * @param {string} date - 'YYYY-MM-DD'
   * @param {string} projectId
   * @param {function} callback - callback(tasks)
   */
  listenApprovedTasks(date, projectId, callback) {
    if (!this.isConfigured() || !date) return () => {};
    try {
      const docKey = `${projectId || 'all'}_${date}`;
      const docRef = doc(db, 'approved_tasks_by_date', docKey);
      return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (Array.isArray(data.tasks)) {
            callback(data.tasks);
          }
        }
      }, (err) => {
        console.warn('[FirebaseService] listenApprovedTasks error:', err);
      });
    } catch (err) {
      console.warn('[FirebaseService] listenApprovedTasks setup error:', err);
      return () => {};
    }
  },

  /**
   * Save or update a Weekly / Monthly Plan in Firestore (<100ms)
   * @param {object} plan - plan payload
   */
  async saveWeeklyPlan(plan) {
    if (!this.isConfigured() || !plan) return false;
    const planId = plan.plan_id || plan.planId || plan.id;
    if (!planId) return false;
    try {
      const planDocRef = doc(db, 'weekly_plans', String(planId));
      const normalizedPlan = {
        ...plan,
        planId: planId,
        projectId: plan.project_id || plan.projectId || '',
        projectName: plan.project_name || plan.projectName || '',
        company: plan.company_name || plan.company || plan.subcontractor || '',
        weekLabel: plan.week_label || plan.weekLabel || '',
        startDate: plan.start_date || plan.startDate || '',
        endDate: plan.end_date || plan.endDate || '',
        objective: plan.weekly_objective || plan.objective || '',
        status: plan.status || plan.pmStatus || 'Pending',
        pmStatus: plan.pmStatus || plan.status || 'Pending',
        pmName: plan.pmName || plan.pm_name || '',
        pmComment: plan.pmComment || plan.pm_comment || plan.pmNotes || '',
        updatedAt: serverTimestamp()
      };
      await setDoc(planDocRef, normalizedPlan, { merge: true });

      await this.broadcastEvent('PLAN_SUBMITTED', {
        planId: planId,
        projectId: normalizedPlan.projectId,
        company: normalizedPlan.company,
        status: normalizedPlan.status
      });

      return true;
    } catch (err) {
      console.warn('[FirebaseService] saveWeeklyPlan error:', err);
      return false;
    }
  },

  /**
   * Update Weekly Plan approval status in Firestore (<100ms)
   */
  async updateWeeklyPlanStatus(planId, status, pmComment = '', pmName = '') {
    if (!this.isConfigured() || !planId) return false;
    try {
      const planDocRef = doc(db, 'weekly_plans', String(planId));
      const nowStr = new Date().toLocaleString('th-TH');
      await setDoc(planDocRef, {
        planId: planId,
        status: status,
        pmStatus: status,
        pmComment: pmComment,
        pmNotes: pmComment,
        pmName: pmName,
        approvedAt: nowStr,
        updatedAt: serverTimestamp()
      }, { merge: true });

      await this.broadcastEvent('PLAN_STATUS_CHANGED', {
        planId: planId,
        status: status,
        pmComment: pmComment,
        pmName: pmName
      });
      return true;
    } catch (err) {
      console.warn('[FirebaseService] updateWeeklyPlanStatus error:', err);
      return false;
    }
  },

  /**
   * Fetch Weekly Plans from Firestore (<100ms)
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async getWeeklyPlans(projectId) {
    if (!this.isConfigured()) return [];
    try {
      const plansCol = collection(db, 'weekly_plans');
      const snapshot = await getDocs(plansCol);
      const plans = [];
      snapshot.forEach(docSnap => {
        plans.push({ id: docSnap.id, planId: docSnap.id, ...docSnap.data() });
      });
      plans.sort((a, b) => String(b.startDate || b.start_date || '').localeCompare(String(a.startDate || a.start_date || '')));
      if (projectId && projectId !== '-' && projectId !== 'all') {
        return plans.filter(p => {
          const pid = p.projectId || p.project_id;
          return !pid || pid === '-' || pid === projectId;
        });
      }
      return plans;
    } catch (err) {
      console.warn('[FirebaseService] getWeeklyPlans error:', err);
      return [];
    }
  },

  /**
   * Listen for Weekly Plans changes in real-time (<100ms push)
   * @param {string} projectId
   * @param {function} callback - callback(plansList)
   */
  listenWeeklyPlans(projectId, callback) {
    if (!this.isConfigured()) return () => {};
    try {
      const plansCol = collection(db, 'weekly_plans');
      return onSnapshot(plansCol, (snapshot) => {
        const plans = [];
        snapshot.forEach(docSnap => {
          plans.push({ id: docSnap.id, planId: docSnap.id, ...docSnap.data() });
        });
        plans.sort((a, b) => String(b.startDate || b.start_date || '').localeCompare(String(a.startDate || a.start_date || '')));
        if (projectId && projectId !== '-' && projectId !== 'all') {
          const filtered = plans.filter(p => {
            const pid = p.projectId || p.project_id;
            return !pid || pid === '-' || pid === projectId;
          });
          callback(filtered);
        } else {
          callback(plans);
        }
      }, (err) => {
        console.warn('[FirebaseService] listenWeeklyPlans error:', err);
      });
    } catch (err) {
      console.warn('[FirebaseService] listenWeeklyPlans setup error:', err);
      return () => {};
    }
  },

  /**
   * Save daily breakdown tasks of a plan in Firestore (<100ms)
   */
  async savePlanTasks(planId, tasks = []) {
    if (!this.isConfigured() || !planId) return false;
    try {
      const docRef = doc(db, 'plan_tasks', String(planId));
      await setDoc(docRef, {
        planId: planId,
        tasks: tasks,
        updatedAt: serverTimestamp()
      }, { merge: true });
      return true;
    } catch (err) {
      console.warn('[FirebaseService] savePlanTasks error:', err);
      return false;
    }
  },

  /**
   * Fetch daily breakdown tasks of a plan from Firestore (<100ms)
   */
  async getPlanTasks(planId) {
    if (!this.isConfigured() || !planId) return [];
    try {
      const docRef = doc(db, 'plan_tasks', String(planId));
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data.tasks)) return data.tasks;
      }
      return [];
    } catch (err) {
      console.warn('[FirebaseService] getPlanTasks error:', err);
      return [];
    }
  }
};
