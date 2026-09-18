/**
 * gas_service.js - Google Apps Script Client API for Projectmanager_site
 * จัดการการเชื่อมต่อ ส่งข้อมูลรายงาน และรูปภาพไปยัง Google Apps Script (GAS) Web App
 */

const GAS_STORAGE_KEY = 'cpm_gas_webapp_url';

export const gasService = {
  /**
   * ดึง URL ของ Google Apps Script ที่บันทึกไว้ใน LocalStorage
   */
  getUrl() {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(GAS_STORAGE_KEY) || '';
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
  }
};
