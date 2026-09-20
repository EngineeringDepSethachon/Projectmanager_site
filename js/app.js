/**
 * app.js - Foreman Daily Report Controller (Projectmanager_site)
 * รองรับระบบรายงาน 2 จังหวะ:
 * 1. 🌅 เปิดงานตอนเช้า (Morning Shift) - ยอดคนงานเข้างาน, งานที่คาดการณ์วันนี้ (Plan)
 * 2. 🌆 รายงานจบงาน (Evening Shift) - ดึงแผนงานเช้ามาเทียบผลงานจริง (Actual vs Plan)
 */

import { gasService } from './gas_service.js';

// ล้างค่า dummy เก่าออกจาก LocalStorage เพื่อให้ผู้ใช้ใหม่เริ่มต้นเป็น '-' เสมอ
try {
  if (localStorage.getItem('site_sub_name') === 'หจก. นครพิงค์โครงสร้าง') {
    localStorage.setItem('site_sub_name', '-');
  }
  if (localStorage.getItem('site_line_role') === 'โฟร์แมนหน้างาน' || localStorage.getItem('site_line_role') === 'โฟร์แมน') {
    localStorage.setItem('site_line_role', '-');
  }
  if (localStorage.getItem('site_project_name') === 'อาคารสำนักงาน 8 ชั้น') {
    localStorage.setItem('site_project_name', '-');
  }
} catch (e) {}

// ==========================================
// App State
// ==========================================
const state = {
  activeShift: 'morning', // 'morning' | 'evening'
  project: {
    id: localStorage.getItem('site_project_id') || '-',
    name: (localStorage.getItem('site_project_name') && localStorage.getItem('site_project_name') !== 'อาคารสำนักงาน 8 ชั้น') ? localStorage.getItem('site_project_name') : '-'
  },
  lineUser: {
    uid: localStorage.getItem('site_line_uid') || '-',
    name: localStorage.getItem('site_line_name') || '-',
    role: (localStorage.getItem('site_line_role') && localStorage.getItem('site_line_role') !== 'โฟร์แมนหน้างาน' && localStorage.getItem('site_line_role') !== 'โฟร์แมน') ? localStorage.getItem('site_line_role') : '-',
    level: localStorage.getItem('site_line_level') || '-',
    avatar: localStorage.getItem('site_line_avatar') || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80',
    liffId: localStorage.getItem('site_liff_id') || '',
    isLiff: false
  },
  reportDate: new Date().toISOString().slice(0, 10),
  subcontractor: {
    id: localStorage.getItem('site_sub_id') || '-',
    name: (localStorage.getItem('site_sub_name') && localStorage.getItem('site_sub_name') !== 'หจก. นครพิงค์โครงสร้าง') ? localStorage.getItem('site_sub_name') : '-'
  },
  weather: {
    type: 'sunny',
    text: '☀️ ท้องฟ้าแจ่มใส แดดจัดทั้งวัน',
    rainDelayHours: 0
  },
  workforce: {
    foreman: 1,
    skilled_workers: 0,
    general_labor: 0,
    safety_officer: 0
  },
  // รายการงานช่วงเช้า (งานที่คาดการณ์) - เริ่มต้นเป็นค่าว่าง ไม่ hard code
  morningPlannedTasks: [],
  // รายการงานช่วงจบงาน (ผลงานจริงเทียบแผน)
  eveningActualTasks: [],
  photos: [],
  // เครื่องจักรที่พร้อมใช้งานวันนี้ (รายการที่ติ๊กเลือก)
  machinery: [],
  // รายการเครื่องจักรที่มีให้เลือก (โฟร์แมนพิมพ์เพิ่มเองได้ บันทึกลง localStorage)
  availableMachinery: (() => {
    try {
      const saved = localStorage.getItem('site_custom_machinery');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch(e) {}
    return [
      'รถขุดแบคโฮ PC200',
      'เครื่องสกัดลมตัดหัวเข็ม',
      'เครื่องสูบน้ำ 4 นิ้ว',
      'รถเครน 25 ตัน',
      'รถโม่คอนกรีต',
      'เครื่องปั่นไฟ 100kVA',
      'เครื่องดัดเหล็กไฟฟ้า'
    ];
  })(),
  issues: []
};

const QUICK_ISSUES = [
  '✅ งานราบรื่นตามแผน',
  '🌧️ ฝนตกชะลอการเทปูน',
  '⚡ ระดับน้ำใต้ดินสูง ต้องสูบน้ำ',
  '🚚 รอเหล็กเส้นเข้าหน้างาน'
];

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  parseUrlParamsUser();
  initDateDisplay();
  loadSavedMorningPlan();
  renderProjectInfo();
  await initLiff();
  await syncUserProfileFromGAS();
  renderProjectInfo();
  renderLineProfile();
  renderGasStatus();
  renderShiftUI();
  renderWeather();
  renderWorkforce();
  renderDynamicTasks();
  renderPhotos();
  renderMachinery();
  renderIssues();
  bindEventHandlers();
});

// ==========================================
// Parse LINE UID & Name from URL Query Parameters
// (เมื่อเปิดเว็บผ่านลิงก์จาก LINE Webhook Bot เช่น ?uid=Uxxxxxx&name=...)
// ==========================================
function parseUrlParamsUser() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const uid = urlParams.get('uid');
    const name = urlParams.get('name');
    const role = urlParams.get('role');
    const lv = urlParams.get('lv');
    const company = urlParams.get('company');
    const avatar = urlParams.get('avatar');
    const prj = urlParams.get('prj') || urlParams.get('projectId');
    const prjName = urlParams.get('prjName') || urlParams.get('projectName');

    if (uid && (uid.startsWith('U') || uid.startsWith('u'))) {
      state.lineUser.uid = uid;
      localStorage.setItem('site_line_uid', uid);

      if (name) {
        state.lineUser.name = decodeURIComponent(name);
        localStorage.setItem('site_line_name', state.lineUser.name);
      }
      if (role) {
        const decodedRole = decodeURIComponent(role);
        state.lineUser.role = (decodedRole !== 'โฟร์แมนหน้างาน' && decodedRole !== 'โฟร์แมน') ? decodedRole : '-';
        localStorage.setItem('site_line_role', state.lineUser.role);
      } else if (!state.lineUser.role || state.lineUser.role === 'โฟร์แมนหน้างาน' || state.lineUser.role === 'โฟร์แมน') {
        state.lineUser.role = '-';
        localStorage.setItem('site_line_role', '-');
      }
      if (lv) {
        state.lineUser.level = decodeURIComponent(lv);
        localStorage.setItem('site_line_level', state.lineUser.level);
      }
      if (avatar) {
        state.lineUser.avatar = decodeURIComponent(avatar);
        localStorage.setItem('site_line_avatar', state.lineUser.avatar);
      }
      if (company) {
        const decodedCompany = decodeURIComponent(company);
        state.subcontractor.name = (decodedCompany !== 'หจก. นครพิงค์โครงสร้าง') ? decodedCompany : '-';
        localStorage.setItem('site_sub_name', state.subcontractor.name);
      } else if (!state.subcontractor.name || state.subcontractor.name === 'หจก. นครพิงค์โครงสร้าง') {
        state.subcontractor.name = '-';
        localStorage.setItem('site_sub_name', '-');
      }
      if (prj) {
        state.project.id = decodeURIComponent(prj);
        localStorage.setItem('site_project_id', state.project.id);
      }
      if (prjName) {
        const decodedPrjName = decodeURIComponent(prjName);
        state.project.name = (decodedPrjName !== 'อาคารสำนักงาน 8 ชั้น') ? decodedPrjName : '-';
        localStorage.setItem('site_project_name', state.project.name);
      }
      renderProjectInfo();

      setTimeout(() => {
        const dispName = state.lineUser.name !== '-' ? state.lineUser.name : 'ผู้ใช้ใหม่';
        const dispRole = (state.lineUser.role && state.lineUser.role !== '-') ? ` (${state.lineUser.role})` : '';
        showToast(`🔗 เข้าสู่ระบบ: ${dispName}${dispRole}`, 'success');
      }, 500);

      // คลีน URL ใน Address Bar ให้สะอาด ไม่ติด Query String
      if (window.history && window.history.replaceState) {
        const cleanUrl = window.location.protocol + '//' + window.location.host + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    }
  } catch (err) {
    console.warn('Parse URL parameters error:', err);
  }
}

// ==========================================
// Sync Latest User Profile & Subcontractor from Site_Users Sheet
// ==========================================
async function syncUserProfileFromGAS() {
  const uid = state.lineUser.uid;
  if (!uid || uid === '-' || !gasService.isConfigured()) return;

  try {
    const user = await gasService.fetchUserProfile(uid);
    if (user) {
      if (user.displayName) {
        state.lineUser.name = user.displayName;
        localStorage.setItem('site_line_name', user.displayName);
      }
      const syncRole = user.role || '-';
      state.lineUser.role = (syncRole !== 'โฟร์แมนหน้างาน' && syncRole !== 'โฟร์แมน') ? syncRole : '-';
      localStorage.setItem('site_line_role', state.lineUser.role);

      if (user.level) {
        state.lineUser.level = user.level;
        localStorage.setItem('site_line_level', user.level);
      }

      const syncComp = user.company || '-';
      state.subcontractor.name = (syncComp !== 'หจก. นครพิงค์โครงสร้าง') ? syncComp : '-';
      localStorage.setItem('site_sub_name', state.subcontractor.name);

      if (user.avatar) {
        state.lineUser.avatar = user.avatar;
        localStorage.setItem('site_line_avatar', user.avatar);
      }

      if (user.projectId) {
        state.project.id = user.projectId;
        localStorage.setItem('site_project_id', user.projectId);
      }

      if (user.projectName) {
        const syncPrjName = user.projectName || '-';
        state.project.name = (syncPrjName !== 'อาคารสำนักงาน 8 ชั้น') ? syncPrjName : '-';
        localStorage.setItem('site_project_name', state.project.name);
      }

      renderProjectInfo();
      renderLineProfile();
    }
  } catch (err) {
    console.warn('syncUserProfileFromGAS error:', err);
  }
}

// ==========================================
// Render Project Info (แสดงชื่อโครงการแบบไดนามิก)
// ==========================================
function renderProjectInfo() {
  const prjElem = document.getElementById('display-project-name');
  if (prjElem) {
    const disp = (state.project.name && state.project.name !== '-')
      ? state.project.name
      : ((state.project.id && state.project.id !== '-') ? state.project.id : '-');
    prjElem.textContent = disp;
  }
}

// ==========================================
// Load Saved Morning Plan
// ==========================================
function loadSavedMorningPlan() {
  try {
    const saved = localStorage.getItem(`site_morning_plan_${state.reportDate}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.morningPlannedTasks = parsed;
      }
    }
  } catch (err) {
    console.warn('Load morning plan error:', err);
  }
}

// ==========================================
// Subcontractors Dynamic Loader (ดึงจากชีต Subcontractors ใน GAS ไม่ hard code)
// ==========================================
async function loadSubcontractorsList() {
  const subSelect = document.getElementById('subcontractor-select');
  if (!subSelect) return;

  // 1. ดึงจาก Local Cache ถ้ามีอยู่แล้ว
  let cached = null;
  try {
    const cachedStr = localStorage.getItem('site_cached_subcontractors');
    if (cachedStr) cached = JSON.parse(cachedStr);
  } catch(e) {}

  if (cached && Array.isArray(cached) && cached.length > 0) {
    renderSubcontractorOptions(cached);
  }

  // 2. ดึงสดจาก Google Apps Script (ชีต Subcontractors)
  try {
    const liveSubs = await gasService.fetchSubcontractors();
    if (liveSubs && Array.isArray(liveSubs) && liveSubs.length > 0) {
      localStorage.setItem('site_cached_subcontractors', JSON.stringify(liveSubs));
      renderSubcontractorOptions(liveSubs);
    }
  } catch (err) {
    console.warn('Fetch live subcontractors error:', err);
  }
}

function renderSubcontractorOptions(subs) {
  const subSelect = document.getElementById('subcontractor-select');
  if (!subSelect || !subs || subs.length === 0) return;

  const currentName = state.subcontractor.name || '';
  subSelect.innerHTML = '';

  let hasSelected = false;
  subs.forEach((sub, idx) => {
    const displayName = sub.scope ? `${sub.name} (${sub.scope})` : sub.name;
    const isMatch = currentName && (currentName.includes(sub.name) || sub.name.includes(currentName));
    const isChosen = isMatch || (!hasSelected && idx === 0);
    const opt = new Option(displayName, sub.id, false, isChosen);
    subSelect.add(opt);

    if (isChosen) {
      hasSelected = true;
      state.subcontractor.id = sub.id;
      state.subcontractor.name = displayName;
    }
  });

  if (!hasSelected && currentName) {
    const customOpt = new Option(currentName, 'SUB-CUSTOM', true, true);
    subSelect.add(customOpt);
  }

  renderLineProfile();
}

// ==========================================
// LINE LIFF Initialization
// ==========================================
async function initLiff() {
  const liffId = state.lineUser.liffId.trim();
  if (typeof liff !== 'undefined' && liffId) {
    try {
      await liff.init({ liffId });
      if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        state.lineUser.uid = profile.userId;
        state.lineUser.name = profile.displayName;
        if (profile.pictureUrl) state.lineUser.avatar = profile.pictureUrl;
        state.lineUser.isLiff = true;

        localStorage.setItem('site_line_uid', profile.userId);
        localStorage.setItem('site_line_name', profile.displayName);
        if (profile.pictureUrl) localStorage.setItem('site_line_avatar', profile.pictureUrl);
      }
    } catch (err) {
      console.warn('LIFF Initialization info:', err);
    }
  }
}

// ==========================================
// Render Functions
// ==========================================
function initDateDisplay() {
  const today = new Date();
  const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const formattedToday = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
  state.reportDate = formattedToday;

  const dateEl = document.getElementById('display-report-date');
  if (dateEl) {
    dateEl.innerText = `${today.getDate()} ${thMonths[today.getMonth()]} ${today.getFullYear()}`;
  }

  renderHorizontalDateStrip();
}

function renderHorizontalDateStrip() {
  const container = document.getElementById('horizontal-date-strip');
  if (!container) return;

  const today = new Date();
  const dayOfWeek = today.getDay(); // 0: Sun, 1: Mon...
  // Calculate Monday of current week
  const mondayDiff = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayDiff);

  const daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayStr = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dayNum = d.getDate();
    const dayName = daysEn[d.getDay()];
    const dateStr = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
    const isToday = dateStr === todayStr;

    html += `
      <div class="date-item ${isToday ? 'active' : ''}" data-date="${dateStr}" title="${isToday ? 'วันนี้' : ''}">
        <span class="day-name">${dayName}</span>
        <span class="day-number">${dayNum}</span>
      </div>
    `;
  }

  container.innerHTML = html;
}

function renderLineProfile() {
  const avatarEl = document.getElementById('line-avatar');
  const nameEl = document.getElementById('line-display-name');
  const uidEl = document.getElementById('line-uid-text');
  const badgeEl = document.getElementById('line-mode-badge');
  const roleEl = document.getElementById('line-role-text');
  const companyEl = document.getElementById('line-company-text');
  const greetingSub = document.getElementById('greeting-sub');

  if (avatarEl && state.lineUser.avatar) avatarEl.src = state.lineUser.avatar;
  if (nameEl) nameEl.innerText = state.lineUser.name || '-';
  if (uidEl) uidEl.innerText = state.lineUser.uid || '-';
  if (badgeEl) {
    const isLiff = state.lineUser.isLiff;
    badgeEl.innerText = isLiff ? '🟢 LINE LIFF' : '🟢 LINE UID';
  }
  if (roleEl) {
    const roleName = state.lineUser.role || '-';
    roleEl.innerText = roleName !== '-' ? roleName : '-';
  }
  if (companyEl) {
    companyEl.innerText = state.subcontractor.name || '-';
  }
  if (greetingSub) {
    const rawName = (state.lineUser.name && state.lineUser.name !== '-') ? state.lineUser.name : 'โฟร์แมน';
    const shortName = rawName.split(' ')[0];
    greetingSub.innerText = `👋 สวัสดีครับ, ${shortName}`;
  }
}

function renderGasStatus() {
  const statusLabel = document.getElementById('gas-status-label');
  const statusDesc = document.getElementById('gas-status-desc');
  if (!statusLabel || !statusDesc) return;

  if (gasService.isConfigured()) {
    statusLabel.innerHTML = '<span style="color:#10b981;">🟢 เชื่อมต่อ GAS แล้ว</span>';
    statusDesc.innerText = 'ข้อมูลจะถูกบันทึกลง Google Sheets และสั่ง LINE Bot แจ้งเตือน';
  } else {
    statusLabel.innerHTML = '<span style="color:#f59e0b;">⚪ ยังไม่ได้ระบุ Web App URL</span>';
    statusDesc.innerText = 'คลิกปุ่มตั้งค่าเพื่อใส่ URL ของ Google Apps Script';
  }
}

/**
 * ปรับเปลี่ยน UI ตามกะการทำงาน (เช้า vs จบงาน)
 */
function renderShiftUI() {
  const isMorning = state.activeShift === 'morning';

  // 1. Shift Tab Active State
  const tabMorning = document.getElementById('tab-morning-shift');
  const tabEvening = document.getElementById('tab-evening-shift');
  const topBadge = document.getElementById('shift-badge-top');
  const morningBanner = document.getElementById('morning-plan-banner');

  if (tabMorning && tabEvening) {
    const greetingTitle = document.getElementById('greeting-title');
    if (isMorning) {
      tabMorning.classList.add('active');
      tabEvening.classList.remove('active');
      if (topBadge) {
        topBadge.className = 'header-badge';
        topBadge.innerText = '🌅 รอบเช้า';
      }
      if (morningBanner) morningBanner.style.display = 'none';
      if (greetingTitle) greetingTitle.innerText = 'รายงานเปิดงานเช้า 🌅';
    } else {
      tabMorning.classList.remove('active');
      tabEvening.classList.add('active');
      if (topBadge) {
        topBadge.className = 'header-badge evening';
        topBadge.innerText = '🌆 รอบเย็น';
      }
      if (morningBanner) morningBanner.style.display = 'flex';
      if (greetingTitle) greetingTitle.innerText = 'รายงานสรุปจบงาน 🌆';
    }
  }

  // 2. Section Titles & Labels
  const weatherTitle = document.getElementById('weather-section-title');
  if (weatherTitle) {
    weatherTitle.innerText = isMorning ? 'สภาพอากาศตอนเปิดงานเช้า' : 'สภาพอากาศตลอดวัน & สรุปเวลาฝนตก';
  }

  // ซ่อนกล่องเวลาหยุดงานในรอบเช้า (เพราะตอนเช้ายังไม่รู้เวลาหยุดล่วงหน้า) และแสดงในรอบจบงาน
  const rainHoursBox = document.getElementById('rain-hours-box');
  if (rainHoursBox) {
    rainHoursBox.style.display = isMorning ? 'none' : 'flex';
  }

  // ปรับข้อความปุ่มสภาพอากาศให้สมจริงตามรอบเช้า vs รอบจบงาน
  const btnSunnyLabel = document.querySelector('.weather-btn[data-type="sunny"] .w-label');
  const btnCloudyLabel = document.querySelector('.weather-btn[data-type="cloudy"] .w-label');
  const btnRainLightLabel = document.querySelector('.weather-btn[data-type="rain_light"] .w-label');
  const btnRainHeavyLabel = document.querySelector('.weather-btn[data-type="rain_heavy"] .w-label');

  if (isMorning) {
    if (btnSunnyLabel) btnSunnyLabel.innerText = 'ฟ้าโปร่ง แดดดี';
    if (btnCloudyLabel) btnCloudyLabel.innerText = 'มีเมฆมาก ลมสงบ';
    if (btnRainLightLabel) btnRainLightLabel.innerText = 'มีฝนตกปรอยๆ เช้า';
    if (btnRainHeavyLabel) btnRainHeavyLabel.innerText = 'ฝนตกหนักเช้า';
    state.weather.rainDelayHours = 0;
  } else {
    if (btnSunnyLabel) btnSunnyLabel.innerText = 'แดดจัดทั้งวัน ทำงานปกติ';
    if (btnCloudyLabel) btnCloudyLabel.innerText = 'มีเมฆมาก ไม่มีฝน';
    if (btnRainLightLabel) btnRainLightLabel.innerText = 'ฝนตกหยุดชั่วคราว';
    if (btnRainHeavyLabel) btnRainHeavyLabel.innerText = 'ฝนตกหนัก น้ำท่วมขัง';
  }

  const workforceTitle = document.getElementById('workforce-section-title');
  if (workforceTitle) {
    workforceTitle.innerText = isMorning ? 'ยอดกำลังพลเข้างานรอบเช้า (ปุ่ม + -)' : 'ยอดกำลังพลเมื่อสิ้นสุดวัน (ปุ่ม + -)';
  }

  const tasksTitle = document.getElementById('tasks-section-title');
  const tasksBadgeHint = document.getElementById('tasks-badge-hint');
  const btnAddTaskText = document.getElementById('btn-add-task-text');
  const btnAddTask = document.getElementById('btn-add-task-row');

  if (tasksTitle) {
    tasksTitle.innerText = isMorning ? 'งานที่คาดการณ์ว่าจะทำวันนี้' : 'ผลงานจริงเทียบกับแผนงานเช้า';
  }
  if (tasksBadgeHint) {
    tasksBadgeHint.className = isMorning ? 'badge-hint morning' : 'badge-hint';
    tasksBadgeHint.innerText = isMorning ? 'เป้าหมายที่คาดการณ์' : 'ผลงานจริงที่ทำได้';
  }
  if (btnAddTaskText) {
    btnAddTaskText.innerText = isMorning ? '➕ กดเพิ่มงานที่คาดการณ์วันนี้' : '➕ กดเพิ่มงานนอกแผนที่ทำเพิ่ม';
  }
  if (btnAddTask) {
    if (isMorning) btnAddTask.classList.add('morning');
    else btnAddTask.classList.remove('morning');
  }

  const photoTitle = document.getElementById('photo-section-title');
  const camTriggerTitle = document.getElementById('camera-trigger-title');
  const camTriggerDesc = document.getElementById('camera-trigger-desc');
  if (photoTitle) {
    photoTitle.innerText = isMorning ? 'ภาพถ่ายแถวเปิดงาน / Safety Talk' : 'ภาพถ่ายผลงานจริงหน้างาน';
  }
  if (camTriggerTitle) {
    camTriggerTitle.innerText = isMorning ? 'แตะถ่ายรูปแถวคนงาน หรือประชุม Safety' : 'แตะถ่ายรูปผลงานจริง หรือหน้างาน';
  }
  if (camTriggerDesc) {
    camTriggerDesc.innerText = isMorning ? 'ประทับเวลาเปิดงานรอบเช้า และ LINE UID' : 'ประทับเวลาจบงาน และผลงานจริง';
  }

  const submitBtn = document.getElementById('btn-submit-daily-report');
  const submitText = document.getElementById('btn-submit-text');
  if (submitBtn && submitText) {
    if (isMorning) {
      submitBtn.className = 'btn-submit-report morning';
      submitText.innerText = 'ส่งรายงานเปิดงานตอนเช้า';
    } else {
      submitBtn.className = 'btn-submit-report evening';
      submitText.innerText = 'ส่งรายงานสรุปจบงานประจำวัน';
    }
  }

  renderDynamicTasks();
}

function renderWeather() {
  document.querySelectorAll('.weather-btn').forEach(btn => {
    if (btn.dataset.type === state.weather.type) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const rainHoursEl = document.getElementById('rain-hours-val');
  if (rainHoursEl) {
    rainHoursEl.innerText = `${state.weather.rainDelayHours} ชม.`;
  }
}

function renderWorkforce() {
  let sum = 0;
  for (const [role, count] of Object.entries(state.workforce)) {
    const el = document.getElementById(`count-${role}`);
    if (el) el.innerText = count;
    sum += count;
  }
  const sumEl = document.getElementById('total-workers-sum');
  if (sumEl) sumEl.innerText = sum;
}

function getActiveTasksList() {
  return state.activeShift === 'morning' ? state.morningPlannedTasks : state.eveningActualTasks;
}

function renderDynamicTasks() {
  const container = document.getElementById('dynamic-tasks-container');
  if (!container) return;

  const isMorning = state.activeShift === 'morning';
  const tasks = getActiveTasksList();

  if (tasks.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; font-size: 0.8rem; color: var(--text-muted); padding: 1.5rem 0;">
        ${isMorning ? 'ยังไม่มีรายการงานที่คาดการณ์วันนี้ กดปุ่มด้านล่างเพื่อเพิ่มแผนงาน' : 'ยังไม่มีรายการงาน กดปุ่มด้านล่างเพื่อเพิ่มงาน'}
      </div>
    `;
    return;
  }

  container.innerHTML = tasks.map((t, idx) => `
    <div class="dynamic-task-card ${isMorning ? 'plan-card' : 'actual-card'}" data-task-id="${t.id}">
      <div class="dynamic-task-top">
        <div class="task-tag-group">
          <span class="task-index-badge">งานที่ ${idx + 1}</span>
          <span class="shift-phase-badge ${isMorning ? 'plan' : 'actual'}">
            ${isMorning ? '🎯 คาดการณ์' : '⚡ ผลงานจริง'}
          </span>
        </div>
        <button type="button" class="btn-delete-task" onclick="window.removeDynamicTask('${t.id}')">
          🗑️ ลบ
        </button>
      </div>

      <!-- Task Title -->
      <div>
        <label style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px; display: block;">ชื่องาน / หมวดงาน:</label>
        <input type="text" class="form-input" value="${escapeHtml(t.name)}" placeholder="เช่น ตัดหัวเข็ม, เทลีน, ผูกเหล็ก..." oninput="window.updateTaskField('${t.id}', 'name', this.value)">
      </div>

      <!-- Description -->
      <div>
        <label style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px; display: block;">
          ${isMorning ? 'รายละเอียดแผนงานที่ตั้งเป้าหมายวันนี้:' : 'รายละเอียดสิ่งที่ทำได้จริงวันนี้:'}
        </label>
        <input type="text" class="form-input" value="${escapeHtml(t.description)}" placeholder="${isMorning ? 'ระบุเป้าหมายที่ต้องทำให้เสร็จในวันนี้...' : 'ระบุผลลัพธ์จริงที่ทำได้เสร็จสิ้น...'}" oninput="window.updateTaskField('${t.id}', 'description', this.value)">
      </div>

      <!-- Quantity & Progress -->
      <div class="task-metrics-grid">
        <div>
          <label style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px; display: block;">
            ${isMorning ? 'เป้าหมายปริมาณงาน:' : 'ปริมาณงานจริงที่ทำได้:'}
          </label>
          <input type="text" class="form-input" style="font-size: 0.76rem;" value="${escapeHtml(t.quantity)}" placeholder="เช่น 8 ต้น, 35 ตร.ม." oninput="window.updateTaskField('${t.id}', 'quantity', this.value)">
        </div>
        <div>
          <label style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px; display: block;">
            ${isMorning ? 'ความคืบหน้าที่คาดหมาย:' : 'ความคืบหน้าสะสมจริง:'}
          </label>
          <div class="progress-pills-row">
            ${[25, 50, 75, 100].map(pct => `
              <button type="button" class="pill-pct ${isMorning ? 'morning' : ''} ${t.progress === pct ? 'active' : ''}" onclick="window.updateTaskProgress('${t.id}', ${pct})">
                ${pct}%
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

function renderPhotos() {
  const countEl = document.getElementById('photo-counter');
  if (countEl) countEl.innerText = `${state.photos.length} รูป`;

  const gridEl = document.getElementById('photos-preview-grid');
  if (!gridEl) return;

  gridEl.innerHTML = state.photos.map((p, idx) => `
    <div class="photo-card">
      <img src="${p.url}" alt="${p.caption || 'รูปหน้างาน'}">
      <div class="photo-stamp">${p.timestamp || '2026-09-18'}</div>
      <button type="button" class="btn-remove-photo" onclick="window.removePhoto(${idx})">&times;</button>
    </div>
  `).join('');
}

function renderMachinery() {
  const grid = document.getElementById('machinery-chips-grid');
  const counterBadge = document.getElementById('machinery-counter-badge');
  if (counterBadge) {
    counterBadge.innerText = `เลือกแล้ว ${state.machinery.length} เครื่อง`;
  }
  if (!grid) return;

  if (!state.availableMachinery || state.availableMachinery.length === 0) {
    grid.innerHTML = '<span style="font-size:0.75rem; color:var(--text-dim); padding:0.4rem 0;">ยังไม่มีรายการเครื่องจักร สามารถพิมพ์ชื่อด้านบนแล้วกดปุ่ม ➕ เพิ่ม ได้ทันที</span>';
    return;
  }

  grid.innerHTML = state.availableMachinery.map(item => {
    const isSelected = state.machinery.includes(item);
    const escaped = escapeHtml(item);
    const jsItem = escaped.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
      <div class="chip-item ${isSelected ? 'active' : ''}" onclick="window.toggleMachinery('${jsItem}')">
        <span>${isSelected ? '✓ ' : '+ '}</span>
        <span>${escaped}</span>
        <span class="chip-remove-btn" title="ลบออกจากรายการ" onclick="event.stopPropagation(); window.removeMachineryFromList('${jsItem}')">&times;</span>
      </div>
    `;
  }).join('');
}

function renderIssues() {
  const grid = document.getElementById('issues-tags-grid');
  if (!grid) return;

  grid.innerHTML = QUICK_ISSUES.map(tag => {
    const isSelected = state.issues.includes(tag);
    return `
      <div class="tag-btn ${isSelected ? 'active' : ''}" onclick="window.toggleIssue('${tag}')">
        ${tag}
      </div>
    `;
  }).join('');
}

// ==========================================
// Event Bindings
// ==========================================
function bindEventHandlers() {
  // 1. Shift Switcher (สลับรอบเช้า vs จบงาน)
  const tabMorning = document.getElementById('tab-morning-shift');
  const tabEvening = document.getElementById('tab-evening-shift');

  if (tabMorning) {
    tabMorning.addEventListener('click', () => switchShift('morning'));
  }
  if (tabEvening) {
    tabEvening.addEventListener('click', () => switchShift('evening'));
  }

  // Subcontractor select
  const subSelect = document.getElementById('subcontractor-select');
  if (subSelect) {
    subSelect.addEventListener('change', (e) => {
      state.subcontractor.id = e.target.value;
      state.subcontractor.name = e.target.options[e.target.selectedIndex].text;
      localStorage.setItem('site_sub_id', state.subcontractor.id);
      localStorage.setItem('site_sub_name', state.subcontractor.name);
      renderLineProfile();
      showToast(`เลือกสังกัด/แผนก: ${state.subcontractor.name}`, 'info');
    });
  }

  // Weather selector buttons
  document.querySelectorAll('.weather-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.weather.type = btn.dataset.type;
      const isMorning = state.activeShift === 'morning';

      if (isMorning) {
        state.weather.rainDelayHours = 0; // รอบเช้ายังไม่มีเวลาหยุดงาน
        if (btn.dataset.type === 'sunny') state.weather.text = '☀️ ท้องฟ้าแจ่มใส ฟ้าโปร่ง';
        else if (btn.dataset.type === 'cloudy') state.weather.text = '⛅ มีเมฆมาก ลมสงบ';
        else if (btn.dataset.type === 'rain_light') state.weather.text = '🌧️ มีฝนตกปรอยๆ ช่วงเช้า';
        else if (btn.dataset.type === 'rain_heavy') state.weather.text = '⛈️ ฝนตกหนักช่วงเช้า';
      } else {
        if (btn.dataset.type === 'rain_heavy') {
          state.weather.text = '⛈️ ฝนตกหนัก น้ำท่วมขังหลุมงาน';
          state.weather.rainDelayHours = 3;
        } else if (btn.dataset.type === 'rain_light') {
          state.weather.text = '🌧️ ฝนตกชั่วคราว (หยุดงานชั่วขณะ)';
          state.weather.rainDelayHours = 1;
        } else if (btn.dataset.type === 'cloudy') {
          state.weather.text = '⛅ มีเมฆมาก ไม่มีฝนรบกวน';
          state.weather.rainDelayHours = 0;
        } else {
          state.weather.text = '☀️ ท้องฟ้าแจ่มใส แดดจัดทั้งวัน';
          state.weather.rainDelayHours = 0;
        }
      }
      renderWeather();
    });
  });

  // Rain delay hours steppers
  const rainMinus = document.getElementById('btn-rain-minus');
  const rainPlus = document.getElementById('btn-rain-plus');
  if (rainMinus) {
    rainMinus.addEventListener('click', () => {
      state.weather.rainDelayHours = Math.max(0, state.weather.rainDelayHours - 1);
      renderWeather();
    });
  }
  if (rainPlus) {
    rainPlus.addEventListener('click', () => {
      state.weather.rainDelayHours += 1;
      renderWeather();
    });
  }

  // Workforce +/- Stepper Buttons
  document.querySelectorAll('.btn-step[data-role]').forEach(btn => {
    btn.addEventListener('click', () => {
      const role = btn.dataset.role;
      const delta = parseInt(btn.dataset.delta, 10);
      if (state.workforce[role] !== undefined) {
        state.workforce[role] = Math.max(0, state.workforce[role] + delta);
        renderWorkforce();
        if (navigator.vibrate) navigator.vibrate(20);
      }
    });
  });

  // Dynamic Tasks: Add row
  const btnAddTask = document.getElementById('btn-add-task-row');
  if (btnAddTask) {
    btnAddTask.addEventListener('click', () => {
      const newId = 'TASK-' + Date.now();
      const isMorning = state.activeShift === 'morning';
      const targetList = isMorning ? state.morningPlannedTasks : state.eveningActualTasks;

      targetList.push({
        id: newId,
        name: isMorning ? 'งานที่คาดการณ์เพิ่มเติม' : 'งานนอกแผนที่ทำเพิ่ม',
        description: '',
        quantity: '',
        progress: isMorning ? 25 : 50,
        isPlanned: isMorning
      });

      renderDynamicTasks();
      showToast(isMorning ? 'เพิ่มแผนงานที่คาดการณ์แล้ว' : 'เพิ่มรายการงานจริงแล้ว', 'info');
    });
  }

  // Camera Capture Input Trigger
  const camTrigger = document.getElementById('camera-trigger-btn');
  const fileInput = document.getElementById('camera-file-input');
  if (camTrigger && fileInput) {
    camTrigger.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);
  }

  // Sample Photos
  const btnSampleMorning = document.getElementById('btn-sample-morning');
  const btnSampleFoundation = document.getElementById('btn-sample-foundation');
  if (btnSampleMorning) {
    btnSampleMorning.addEventListener('click', () => {
      const timeStr = getCurrentTimeString();
      state.photos.unshift({
        id: 'PH-' + Date.now(),
        url: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&auto=format&fit=crop&q=80',
        caption: 'การประชุมแถวความปลอดภัย (Safety Talk) ก่อนเริ่มงาน',
        timestamp: `2026-09-18 ${timeStr}`,
        base64: null
      });
      renderPhotos();
      showToast('เพิ่มรูปแถวความปลอดภัยรอบเช้าแล้ว', 'info');
    });
  }
  if (btnSampleFoundation) {
    btnSampleFoundation.addEventListener('click', () => {
      const timeStr = getCurrentTimeString();
      state.photos.unshift({
        id: 'PH-' + Date.now(),
        url: 'https://images.unsplash.com/photo-1541888946425-d0fbb186156f?w=600&auto=format&fit=crop&q=80',
        caption: 'ผลงานการตัดหัวเข็มและเทลีนคอนกรีตฐานราก F1-F4',
        timestamp: `2026-09-18 ${timeStr}`,
        base64: null
      });
      renderPhotos();
      showToast('เพิ่มรูปผลงานหน้างานแล้ว', 'info');
    });
  }

  // Machinery Add Handler (ปุ่ม + และกด Enter)
  const btnAddMachinery = document.getElementById('btn-add-machinery');
  const inputNewMachinery = document.getElementById('input-new-machinery');
  if (btnAddMachinery) {
    btnAddMachinery.addEventListener('click', window.addCustomMachinery);
  }
  if (inputNewMachinery) {
    inputNewMachinery.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.addCustomMachinery();
      }
    });
  }

  // Submit Daily Report
  const btnSubmit = document.getElementById('btn-submit-daily-report');
  if (btnSubmit) {
    btnSubmit.addEventListener('click', submitReport);
  }

  // Modals Setup
  setupModals();
}

// ==========================================
// Switch Shift Handler (เช้า <-> จบงาน)
// ==========================================
function switchShift(shift) {
  if (state.activeShift === shift) return;
  state.activeShift = shift;

  if (shift === 'evening') {
    // เมื่อสลับมาช่วงจบงาน: ดึงรายการงานที่คาดการณ์ไว้ตอนเช้าขึ้นมาเป็น Baseline
    if (state.eveningActualTasks.length === 0) {
      state.eveningActualTasks = state.morningPlannedTasks.map(t => ({
        ...t,
        id: 'ACT-' + t.id,
        planned_name: t.name,
        planned_quantity: t.quantity,
        progress: 75, // ค่าตั้งต้นสำหรับประเมินผลงานจริง
        isPlanned: false
      }));
    }
    showToast('🌆 สลับสู่โหมด: รายงานสรุปจบงานประจำวัน', 'info');
  } else {
    showToast('🌅 สลับสู่โหมด: เปิดงานตอนเช้า (งานที่คาดการณ์)', 'info');
  }

  renderShiftUI();
}

// ==========================================
// Dynamic Tasks Global Functions
// ==========================================
window.updateTaskField = function(id, field, value) {
  const list = getActiveTasksList();
  const task = list.find(t => t.id === id);
  if (task) {
    task[field] = value;
  }
};

window.updateTaskProgress = function(id, progress) {
  const list = getActiveTasksList();
  const task = list.find(t => t.id === id);
  if (task) {
    task.progress = progress;
    renderDynamicTasks();
  }
};

window.removeDynamicTask = function(id) {
  if (state.activeShift === 'morning') {
    state.morningPlannedTasks = state.morningPlannedTasks.filter(t => t.id !== id);
  } else {
    state.eveningActualTasks = state.eveningActualTasks.filter(t => t.id !== id);
  }
  renderDynamicTasks();
  showToast('ลบรายการงานแล้ว', 'info');
};

// ==========================================
// Machinery & Issues Handlers
// ==========================================
window.toggleMachinery = function(item) {
  if (state.machinery.includes(item)) {
    state.machinery = state.machinery.filter(m => m !== item);
  } else {
    state.machinery.push(item);
  }
  renderMachinery();
};

window.addCustomMachinery = function() {
  const input = document.getElementById('input-new-machinery');
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    showToast('กรุณาพิมพ์ชื่อเครื่องจักรก่อนกดเพิ่ม', 'info');
    return;
  }

  // ถ้ายังไม่มีในรายการ ให้เพิ่มเข้าไป
  if (!state.availableMachinery.includes(val)) {
    state.availableMachinery.push(val);
    try {
      localStorage.setItem('site_custom_machinery', JSON.stringify(state.availableMachinery));
    } catch(e) {}
  }

  // ติ๊กเลือกให้อัตโนมัติ
  if (!state.machinery.includes(val)) {
    state.machinery.push(val);
  }

  input.value = '';
  renderMachinery();
  showToast(`➕ เพิ่มเครื่องจักร: ${val} สำเร็จ`, 'success');
};

window.removeMachineryFromList = function(item) {
  state.availableMachinery = state.availableMachinery.filter(m => m !== item);
  state.machinery = state.machinery.filter(m => m !== item);
  try {
    localStorage.setItem('site_custom_machinery', JSON.stringify(state.availableMachinery));
  } catch(e) {}
  renderMachinery();
  showToast(`ลบ ${item} ออกจากรายการแล้ว`, 'info');
};

window.toggleIssue = function(tag) {
  if (state.issues.includes(tag)) {
    state.issues = state.issues.filter(i => i !== tag);
  } else {
    state.issues.push(tag);
  }
  renderIssues();
};

window.removePhoto = function(idx) {
  state.photos.splice(idx, 1);
  renderPhotos();
};

// ==========================================
// Photo Upload & Canvas Compression
// ==========================================
function handleFileUpload(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  const timeStr = getCurrentTimeString();
  const shiftText = state.activeShift === 'morning' ? 'เปิดงานเช้า' : 'จบงานเย็น';

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1200;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75);

        state.photos.unshift({
          id: 'PH-' + Date.now(),
          url: compressedBase64,
          base64: compressedBase64,
          caption: `ภาพหน้างาน (${shiftText}) โดย ${state.lineUser.name} (${timeStr})`,
          timestamp: `2026-09-18 ${timeStr}`
        });

        renderPhotos();
        showToast(`📸 ถ่ายรูปและประทับเวลารอบ ${shiftText} สำเร็จ`, 'success');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ==========================================
// Submit Report Handler
// ==========================================
async function submitReport() {
  const btn = document.getElementById('btn-submit-daily-report');
  const isMorning = state.activeShift === 'morning';
  const shiftCode = isMorning ? 'morning' : 'evening';
  const shiftLabel = isMorning ? 'เปิดงานตอนเช้า' : 'รายงานจบงาน';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>⏳ กำลังบันทึกรายงานรอบ ${shiftLabel}...</span>`;
  }

  const customIssues = document.getElementById('custom-issue-text')?.value || '';
  const finalIssues = [...state.issues];
  if (customIssues.trim()) finalIssues.push(customIssues.trim());

  const totalWorkers = Object.values(state.workforce).reduce((a, b) => a + b, 0);
  const now = new Date();
  const reportPrefix = isMorning ? 'MORN' : 'EVEN';
  const reportId = `${reportPrefix}-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;

  const currentTasks = getActiveTasksList();

  const payload = {
    id: reportId,
    shift_type: shiftCode,
    shift_label: shiftLabel,
    report_date: state.reportDate,
    timestamp: now.toISOString().replace('T', ' ').slice(0, 19),
    project_id: state.project.id,
    project_name: state.project.name,
    line_uid: state.lineUser.uid,
    line_name: state.lineUser.name,
    line_avatar: state.lineUser.avatar,
    sub_id: state.subcontractor.id,
    sub_name: state.subcontractor.name,
    foreman_name: state.lineUser.name,
    weather: state.weather.text,
    rain_delay_hours: state.weather.rainDelayHours,
    workforce: {
      ...state.workforce,
      total: totalWorkers
    },
    machinery: state.machinery,
    task_progress: currentTasks,
    photos: state.photos,
    issues: finalIssues,
    status: isMorning ? 'morning_opened' : 'evening_closed'
  };

  // 1. ถ้าเป็นรอบเช้า ให้บันทึก morning plan ลง localStorage เพื่อให้รอบเย็นดึงได้อัตโนมัติ
  if (isMorning) {
    try {
      localStorage.setItem(`site_morning_plan_${state.reportDate}`, JSON.stringify(state.morningPlannedTasks));
    } catch (err) {
      console.warn('Save morning plan:', err);
    }
  }

  // 2. เก็บประวัติลงเครื่อง LocalStorage
  try {
    const existing = JSON.parse(localStorage.getItem('cpm_site_reports_history') || '[]');
    existing.unshift(payload);
    localStorage.setItem('cpm_site_reports_history', JSON.stringify(existing.slice(0, 30)));
  } catch (err) {
    console.warn('Storage save:', err);
  }

  // 3. Post ไปยัง Google Apps Script (Web App)
  let result = null;
  if (gasService.isConfigured()) {
    result = await gasService.sendReport(payload);
  }

  if (btn) {
    btn.disabled = false;
    renderShiftUI();
  }

  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

  if (result && result.success) {
    showToast(`✅ บันทึกรายงาน ${shiftLabel} (รหัส ${reportId}) ลง Google Sheets & ส่ง LINE สำเร็จ!`, 'success');
  } else if (!gasService.isConfigured()) {
    showToast(`💾 บันทึกรายงาน ${shiftLabel} ในเครื่องเรียบร้อย (ยังไม่ได้ตั้งค่า Google Apps Script)`, 'info');
  } else {
    showToast(`⚠️ ส่งข้อมูลแล้ว: ${result?.message || 'โปรดตรวจสอบสิทธิ์ชีต'}`, 'info');
  }
}

// ==========================================
// Modals Configuration
// ==========================================
function setupModals() {
  // Modal 1: LINE Profile Config
  const modalLine = document.getElementById('modal-line-config');
  const btnOpenLine = document.getElementById('btn-open-line-modal');
  const btnCloseLine = document.getElementById('btn-close-line-modal');
  const btnCancelLine = document.getElementById('btn-cancel-line-modal');
  const btnSaveLine = document.getElementById('btn-save-line-config');
  const btnGenUid = document.getElementById('btn-generate-test-uid');

  if (btnOpenLine && modalLine) {
    btnOpenLine.addEventListener('click', () => {
      document.getElementById('input-line-uid').value = state.lineUser.uid;
      document.getElementById('input-line-name').value = state.lineUser.name;
      document.getElementById('input-liff-id').value = state.lineUser.liffId;
      document.getElementById('modal-line-avatar').src = state.lineUser.avatar;
      document.getElementById('modal-line-name').innerText = state.lineUser.name;
      document.getElementById('modal-line-uid-preview').innerText = state.lineUser.uid;
      modalLine.classList.add('active');
    });
  }

  const closeLineModal = () => modalLine?.classList.remove('active');
  if (btnCloseLine) btnCloseLine.addEventListener('click', closeLineModal);
  if (btnCancelLine) btnCancelLine.addEventListener('click', closeLineModal);

  if (btnGenUid) {
    btnGenUid.addEventListener('click', () => {
      const chars = '0123456789abcdef';
      let rand = 'U';
      for (let i = 0; i < 32; i++) {
        rand += chars[Math.floor(Math.random() * chars.length)];
      }
      document.getElementById('input-line-uid').value = rand;
      document.getElementById('modal-line-uid-preview').innerText = rand;
    });
  }

  if (btnSaveLine) {
    btnSaveLine.addEventListener('click', () => {
      const uid = document.getElementById('input-line-uid').value.trim();
      const name = document.getElementById('input-line-name').value.trim();
      const liffId = document.getElementById('input-liff-id').value.trim();

      if (uid) state.lineUser.uid = uid;
      if (name) state.lineUser.name = name;
      state.lineUser.liffId = liffId;

      localStorage.setItem('site_line_uid', state.lineUser.uid);
      localStorage.setItem('site_line_name', state.lineUser.name);
      localStorage.setItem('site_liff_id', state.lineUser.liffId);

      renderLineProfile();
      closeLineModal();
      showToast('บันทึกข้อมูลบัญชี LINE สำเร็จ', 'success');
    });
  }


}

// ==========================================
// Utilities
// ==========================================
function getCurrentTimeString() {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} น.`;
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.25s';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
