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
        if (Array.isArray(data.tasks)) return data.tasks;
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
  }
};
