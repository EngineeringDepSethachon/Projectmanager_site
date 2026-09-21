/**
 * gas_service.js - Google Apps Script Client API for Projectmanager_site
 * จัดการการเชื่อมต่อ ส่งข้อมูลรายงาน และรูปภาพไปยัง Google Apps Script (GAS) Web App
 */

const GAS_STORAGE_KEY = 'cpm_gas_webapp_url';
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbzT9MF8xOPiiGZvGbZRZB1T3erYYrOLGxhgfegsnJySMIlRlyNmIWmfNCOI_fdVicKjow/exec';

export const gasService = {
  /**
   * ดึง URL ของ Google Apps Script ที่บันทึกไว้ใน LocalStorage
   */
  getUrl() {
    if (typeof localStorage === 'undefined') return DEFAULT_GAS_URL;
    return localStorage.getItem(GAS_STORAGE_KEY) || DEFAULT_GAS_URL;
  },

  /**
   * บันทึก URL ของ Google Apps Script
   */
  setUrl(url) {
    if (typeof localStorage === 'undefined') return;
    if (!url) {
      localStorage.removeItem(GAS_STORAGE_KEY);
      return;
    }
    const cleanUrl = url.trim();
    localStorage.setItem(GAS_STORAGE_KEY, cleanUrl);
  },

  /**
   * ตรวจสอบว่ามีการตั้งค่า GAS URL ที่ถูกต้องหรือไม่
   */
  isConfigured() {
    const url = this.getUrl();
    return Boolean(url && url.includes('script.google.com'));
  },

  /**
   * ทดสอบเชื่อมต่อ Google Apps Script Web App (Ping Health Check)
   */
  async testConnection(customUrl = null) {
    const url = (customUrl || this.getUrl()).trim();
    if (!url) {
      return { success: false, message: 'ยังไม่ได้ระบุ URL ของ Google Apps Script' };
    }

    try {
      const pingUrl = url + (url.includes('?') ? '&' : '?') + 'action=ping&_t=' + Date.now();
      const res = await fetch(pingUrl, { method: 'GET', mode: 'cors' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      return {
        success: true,
        message: data.message || 'เชื่อมต่อ Google Apps Script สำเร็จ',
        sheetName: data.sheetName || 'Google Sheets'
      };
    } catch (err) {
      // In some browser setups, Google Apps Script redirects trigger CORS block on GET ping,
      // but POST requests work cleanly.
      return {
        success: false,
        message: 'ไม่สามารถทดสอบแบบ GET ได้: ' + err.message + ' (โปรดตรวจดูว่าตั้งค่าสิทธิ์เข้าถึงเป็น "ทุกคน (Anyone)" หรือยัง)'
      };
    }
  },

  /**
   * ส่งข้อมูลรายงานประจำวันหน้างานไปยัง Google Apps Script
   * @param {Object} reportData - Payload รายงานประจำวันพร้อม LINE UID, กำลังพล, งาน, รูปภาพ
   */
  async sendReport(reportData) {
    const url = this.getUrl();
    if (!this.isConfigured()) {
      return {
        success: false,
        isConfigured: false,
        message: 'ยังไม่ได้ตั้งค่า Google Apps Script Web App URL (บันทึกข้อมูลในเครื่องแล้ว)'
      };
    }

    try {
      // ใช้ Content-Type: text/plain เพื่อเลี่ยง Browser CORS Preflight (OPTIONS)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(reportData)
      });

      if (response.ok) {
        const result = await response.json().catch(() => null);
        return {
          success: true,
          isConfigured: true,
          message: result?.message || 'ส่งข้อมูลลง Google Sheets และแจ้งเตือน LINE สำเร็จ',
          data: result
        };
      } else {
        throw new Error(`HTTP Status ${response.status}`);
      }
    } catch (err) {
      // Fallback: ส่งแบบ no-cors เมื่อ Google Apps Script ตอบกลับ redirect 302
      try {
        await fetch(url, {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify(reportData)
        });
        return {
          success: true,
          isConfigured: true,
          message: 'ส่งข้อมูลไปยัง Google Apps Script สำเร็จ (โหมด no-cors)',
          fallback: true
        };
      } catch (fallbackErr) {
        console.error('GAS Post error:', fallbackErr);
        return {
          success: false,
          isConfigured: true,
          message: 'ไม่สามารถบันทึกลง Google Sheets ได้: ' + fallbackErr.message
        };
      }
    }
  },

  /**
   * ดึงรายชื่อบริษัทผู้รับเหมาจากชีต Subcontractors ใน Google Sheets
   */
  async fetchSubcontractors() {
    const url = this.getUrl();
    if (!this.isConfigured()) return null;

    try {
      const queryUrl = url + (url.includes('?') ? '&' : '?') + 'action=get_subcontractors&_t=' + Date.now();
      const res = await fetch(queryUrl, { method: 'GET' });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.status === 'success' && Array.isArray(data.subcontractors)) {
        return data.subcontractors;
      }
      return null;
    } catch (err) {
      console.warn('fetchSubcontractors error:', err);
      return null;
    }
  },

  /**
   * ดึงข้อมูลโปรไฟล์ผู้ใช้จากชีต Site_Users ใน Google Sheets ด้วย UID
   */
  async fetchUserProfile(uid) {
    const url = this.getUrl();
    if (!this.isConfigured() || !uid) return null;

    try {
      const queryUrl = url + (url.includes('?') ? '&' : '?') + 'action=get_user&uid=' + encodeURIComponent(uid) + '&_t=' + Date.now();
      const res = await fetch(queryUrl, { method: 'GET' });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.status === 'success' && data.user) {
        return data.user;
      }
      return null;
    } catch (err) {
      console.warn('fetchUserProfile error:', err);
      return null;
    }
  },

  /**
   * ดึงรายการโครงการจากชีต Projects ใน Google Sheets
   */
  async fetchProjects() {
    const url = this.getUrl();
    if (!this.isConfigured()) return null;

    try {
      const queryUrl = url + (url.includes('?') ? '&' : '?') + 'action=get_projects&_t=' + Date.now();
      const res = await fetch(queryUrl, { method: 'GET' });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.status === 'success' && Array.isArray(data.projects)) {
        return data.projects;
      }
      return null;
    } catch (err) {
      console.warn('fetchProjects error:', err);
      return null;
    }
  },

  /**
   * สั่งซิงก์โครงสร้างชีตและหัวตารางทั้งหมดใน Google Sheets ผ่าน Web App API
   */
  async triggerInitSheets() {
    const url = this.getUrl();
    if (!this.isConfigured()) return null;

    try {
      const queryUrl = url + (url.includes('?') ? '&' : '?') + 'action=init_sheets&_t=' + Date.now();
      const res = await fetch(queryUrl, { method: 'GET' });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn('triggerInitSheets error:', err);
      return null;
    }
  },

  /**
   * ดึงรายการแผนงานสัปดาห์จากชีต Weekly_Plans
   */
  async fetchWeeklyPlans(projectId = '', subId = '', company = '') {
    const url = this.getUrl();
    if (!this.isConfigured()) return [];

    try {
      let queryUrl = url + (url.includes('?') ? '&' : '?') + 'action=get_weekly_plans&_t=' + Date.now();
      if (projectId && projectId !== '-') queryUrl += `&projectId=${encodeURIComponent(projectId)}`;
      if (subId && subId !== '-') queryUrl += `&subId=${encodeURIComponent(subId)}`;
      if (company && company !== '-') queryUrl += `&company=${encodeURIComponent(company)}`;

      const res = await fetch(queryUrl, { method: 'GET' });
      if (!res.ok) return [];
      const data = await res.json();
      if (data && data.status === 'success' && Array.isArray(data.plans)) {
        return data.plans;
      }
      return [];
    } catch (err) {
      console.warn('fetchWeeklyPlans error:', err);
      return [];
    }
  },

  /**
   * ดึงรายการงานย่อยจากชีต Plan_Daily_Tasks
   */
  async fetchDailyTasks(planId = '', date = '') {
    const url = this.getUrl();
    if (!this.isConfigured()) return [];

    try {
      let queryUrl = url + (url.includes('?') ? '&' : '?') + 'action=get_daily_tasks&_t=' + Date.now();
      if (planId) queryUrl += `&planId=${encodeURIComponent(planId)}`;
      if (date) queryUrl += `&date=${encodeURIComponent(date)}`;

      const res = await fetch(queryUrl, { method: 'GET' });
      if (!res.ok) return [];
      const data = await res.json();
      if (data && data.status === 'success' && Array.isArray(data.tasks)) {
        return data.tasks;
      }
      return [];
    } catch (err) {
      console.warn('fetchDailyTasks error:', err);
      return [];
    }
  },

  /**
   * ดึงรายการงานย่อยที่ PM อนุมัติแล้วสำหรับวันที่กำหนด เพื่อให้โฟร์แมนดึงไปเปิดงานเช้า
   */
  async fetchApprovedTasksForDate(date = '', company = '', projectId = '') {
    const url = this.getUrl();
    if (!this.isConfigured()) return [];

    // Smart fallback if company argument was mistakenly passed as projectId
    let finalCompany = company;
    let finalProjectId = projectId;
    if (company && (company.startsWith('PRJ-') || company === 'all') && !projectId) {
      finalProjectId = company;
      finalCompany = '';
    }

    try {
      let queryUrl = url + (url.includes('?') ? '&' : '?') + 'action=get_approved_tasks_for_date&_t=' + Date.now();
      if (date) queryUrl += `&date=${encodeURIComponent(date)}`;
      if (finalCompany && finalCompany !== '-' && finalCompany !== 'ผู้รับเหมา') queryUrl += `&company=${encodeURIComponent(finalCompany)}`;
      if (finalProjectId && finalProjectId !== '-') queryUrl += `&projectId=${encodeURIComponent(finalProjectId)}`;

      const res = await fetch(queryUrl, { method: 'GET' });
      if (!res.ok) return [];
      const data = await res.json();
      if (data && data.status === 'success' && Array.isArray(data.tasks)) {
        return data.tasks;
      }
      return [];
    } catch (err) {
      console.warn('fetchApprovedTasksForDate error:', err);
      return [];
    }
  },

  /**
   * บันทึกแผนงานสัปดาห์และงานย่อย (สำหรับหัวหน้าผู้รับเหมา)
   */
  async saveWeeklyPlan(planPayload) {
    const url = this.getUrl();
    if (!this.isConfigured()) {
      return { success: false, message: 'ไม่ได้ตั้งค่า Google Apps Script Web App' };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify({
          action: 'save_weekly_plan',
          ...planPayload
        })
      });

      if (response.ok) {
        const result = await response.json().catch(() => null);
        return {
          success: true,
          message: result?.message || 'บันทึกแผนงานสัปดาห์สำเร็จ',
          data: result
        };
      }
      return { success: false, message: `HTTP Error: ${response.status}` };
    } catch (err) {
      return { success: false, message: 'ส่งข้อมูลล้มเหลว: ' + err.message };
    }
  },

  /**
   * บันทึกผลการพิจารณาอนุมัติของ PM
   */
  async approveWeeklyPlanPM(planId, status = 'Approved', pmName = '', pmComment = '', pmUid = '', pmRole = '') {
    const url = this.getUrl();
    if (!this.isConfigured()) {
      return { success: false, message: 'ไม่ได้ตั้งค่า Google Apps Script Web App' };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify({
          action: 'approve_weekly_plan_pm',
          plan_id: planId,
          status: status,
          pm_name: pmName,
          pm_comment: pmComment,
          pm_uid: pmUid,
          pm_role: pmRole
        })
      });

      if (response.ok) {
        const result = await response.json().catch(() => null);
        return {
          success: true,
          message: result?.message || 'บันทึกการพิจารณาของ PM เรียบร้อยแล้ว',
          data: result
        };
      }
      return { success: false, message: `HTTP Error: ${response.status}` };
    } catch (err) {
      return { success: false, message: 'ส่งข้อมูลล้มเหลว: ' + err.message };
    }
  },

  /**
   * ดึงประวัติ Log การอนุมัติและการดำเนินการ (Audit Trail)
   */
  async fetchPlanLogs(planId = '') {
    const url = this.getUrl();
    if (!this.isConfigured()) return [];

    try {
      let queryUrl = url + (url.includes('?') ? '&' : '?') + 'action=get_plan_logs&_t=' + Date.now();
      if (planId) {
        queryUrl += '&planId=' + encodeURIComponent(planId);
      }
      const res = await fetch(queryUrl, { method: 'GET' });
      if (!res.ok) return [];
      const data = await res.json();
      if (data && data.status === 'success' && Array.isArray(data.logs)) {
        return data.logs;
      }
      return [];
    } catch (err) {
      console.warn('fetchPlanLogs error:', err);
      return [];
    }
  },

  /**
   * ดึงประวัติรายงานประจำวันทั้งหมดจากชีต Daily_Reports สำหรับ PM เรียกดูย้อนหลัง
   */
  async fetchDailyReports(projectId = '') {
    const url = this.getUrl();
    if (!this.isConfigured()) return [];

    try {
      let queryUrl = url + (url.includes('?') ? '&' : '?') + 'action=get_reports&_t=' + Date.now();
      if (projectId && projectId !== '-') {
        queryUrl += '&projectId=' + encodeURIComponent(projectId);
      }
      const res = await fetch(queryUrl, { method: 'GET' });
      if (!res.ok) return [];
      const data = await res.json();
      if (data && data.status === 'success' && Array.isArray(data.reports)) {
        return data.reports;
      }
      return [];
    } catch (err) {
      console.warn('fetchDailyReports error:', err);
      return [];
    }
  }
};

