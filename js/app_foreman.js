/**
 * app_foreman.js - Foreman Daily Report Controller (LV1 - Mobile-First)
 * กฎเหล็ก: รายการงานในแต่ละวัน "ต้องมาจากแผนงานที่หัวหน้าผู้รับเหมาสร้างและ PM อนุมัติล่วงหน้ามาแล้วเท่านั้น"
 */

import { gasService } from './gas_service.js';
import { firebaseService } from './firebase_service.js';

// App State สำหรับโฟร์แมน
const state = {
  activeShift: 'morning', // 'morning' | 'evening'
  project: {
    id: localStorage.getItem('site_project_id') || '-',
    name: localStorage.getItem('site_project_name') || '-'
  },
  availableProjects: [],
  lineUser: {
    uid: localStorage.getItem('site_line_uid') || '-',
    name: localStorage.getItem('site_line_name') || '-',
    role: 'โฟร์แมน (LV1)',
    level: 'lv1',
    avatar: localStorage.getItem('site_line_avatar') || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80',
    liffId: localStorage.getItem('site_liff_id') || '',
    isLiff: false
  },
  reportDate: new Date().toISOString().slice(0, 10),
  subcontractor: {
    id: localStorage.getItem('site_sub_id') || '-',
    name: localStorage.getItem('site_sub_name') || '-'
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
  // รายการงานที่ดึงมาจากแผนที่ PM อนุมัติแล้วเท่านั้น
  morningPlannedTasks: [],
  eveningActualTasks: [],
  approvedTasksToday: [],
  existingMorningReport: null,
  existingEveningReport: null,
  photos: [],
  eveningPhotos: [],
  machinery: [],
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
      'รถโม่คอนกรีต'
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
document.addEventListener('DOMContentLoaded', () => {
  // 1. Instant First Paint (0ms) - using cached LocalStorage state immediately
  parseUrlParams();
  initDateDisplay();
  renderProjectInfo();
  renderLineProfile();
  renderShiftUI();
  renderWeather();
  renderWorkforce();
  renderPhotos();
  renderMachinery();
  renderIssues();
  bindEventHandlers();
  setupModals();

  // 2. Setup Real-time Firebase & local tab listeners (<10ms)
  setupForemanRealtimeSync();

  // 3. Fast Non-blocking Data Hydration (Cache 0ms -> Firestore <100ms -> GAS fallback)
  loadApprovedTasksForToday();
  checkExistingReportForToday();
  loadProjectsList();

  // 4. Background profile sync
  if (state.lineUser.liffId || (typeof liff !== 'undefined')) {
    initLiff().then(() => syncUserProfileFromGAS());
  } else {
    syncUserProfileFromGAS();
  }
});

// ==========================================
// URL Query Parameter Parsing
// ==========================================
function parseUrlParams() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const uid = urlParams.get('uid');
    const name = urlParams.get('name');
    const prj = urlParams.get('prj') || urlParams.get('projectId');
    const prjName = urlParams.get('prjName') || urlParams.get('projectName');
    const company = urlParams.get('company');

    if (uid) {
      state.lineUser.uid = uid;
      localStorage.setItem('site_line_uid', uid);
    }
    if (name) {
      state.lineUser.name = decodeURIComponent(name);
      localStorage.setItem('site_line_name', state.lineUser.name);
    }
    if (prj) {
      state.project.id = decodeURIComponent(prj);
      localStorage.setItem('site_project_id', state.project.id);
    }
    if (prjName) {
      state.project.name = decodeURIComponent(prjName);
      localStorage.setItem('site_project_name', state.project.name);
    }
    if (company) {
      state.subcontractor.name = decodeURIComponent(company);
      localStorage.setItem('site_sub_name', state.subcontractor.name);
    }
  } catch (e) {
    console.warn('parseUrlParams error:', e);
  }
}

// ==========================================
// Date & Calendar Strip
// ==========================================
// Date Locking (ล็อคเฉพาะวันปัจจุบันเท่านั้น ห้ามเลือกย้อนหลัง/ล่วงหน้า)
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
}

// ==========================================
// Core: Load Approved Tasks for Today
// (ดึงงานที่หัวหน้าผู้รับเหมาสร้าง และ PM อนุมัติล่วงหน้าแล้วเท่านั้น)
// ==========================================
function applyApprovedTasks(approvedList) {
  const banner = document.getElementById('plan-source-status-banner');
  state.approvedTasksToday = approvedList || [];

  if (state.approvedTasksToday.length > 0) {
    const fromPlanTasks = state.approvedTasksToday.map((at, idx) => ({
      id: 'TASK-' + (at.taskId || at.id || ('P-' + idx)),
      source_task_id: at.taskId || at.id || ('TASK-' + idx),
      from_plan: at.from_plan !== undefined ? at.from_plan : true,
      company: at.company || state.subcontractor.name || '-',
      name: at.name || at.taskName || at.category || 'งานตามแผน',
      category: at.category || 'ทั่วไป',
      workArea: at.workArea || at.work_area || '',
      description: at.description || at.taskDesc || '',
      quantity: at.quantity || at.targetQty || '',
      plannedWorkers: at.plannedWorkers || 0,
      progress: at.progress !== undefined ? at.progress : 0,
      isPlanned: at.isPlanned !== undefined ? at.isPlanned : true
    }));

    const extraMorning = state.morningPlannedTasks.filter(t => !t.from_plan);
    const extraEvening = state.eveningActualTasks.filter(t => !t.from_plan);

    state.morningPlannedTasks = [...fromPlanTasks, ...extraMorning];

    if (state.eveningActualTasks.length > 0) {
      state.eveningActualTasks = [
        ...state.eveningActualTasks.filter(t => t.from_plan),
        ...extraEvening
      ];
    }

    if (banner) {
      banner.className = 'approved-tasks-banner approved-active';
      banner.style.display = 'flex';
      banner.innerHTML = `
        <div class="approved-banner-left">
          <span class="banner-icon">🎯</span>
          <div class="banner-content">
            <strong>มี ${state.approvedTasksToday.length} รายการงานตามแผนที่ได้รับอนุมัติจาก PM วันนี้</strong>
            <p>ระบบโหลดเป้าหมายจากแผนงานของหัวหน้าผู้รับเหมาให้อัตโนมัติแล้ว</p>
          </div>
        </div>
        <span class="badge-status-approved" style="font-size: 0.72rem;">✓ อนุมัติแล้ว</span>
      `;
    }
  } else {
    const extraMorning = state.morningPlannedTasks.filter(t => !t.from_plan);
    const extraEvening = state.eveningActualTasks.filter(t => !t.from_plan);
    state.morningPlannedTasks = extraMorning;
    if (state.eveningActualTasks.length > 0) {
      state.eveningActualTasks = extraEvening;
    }

    if (banner) {
      banner.className = 'approved-tasks-banner unapproved-warning';
      banner.style.display = 'flex';
      banner.innerHTML = `
        <div class="approved-banner-left">
          <span class="banner-icon">⚠️</span>
          <div class="banner-content">
            <strong style="color: #b45309;">ยังไม่มีแผนงานที่ได้รับการอนุมัติจาก PM สำหรับวันนี้</strong>
            <p>โปรดรอหัวหน้าผู้รับเหมายื่นแผนงานรายสัปดาห์ และรอ PM กดอนุมัติ</p>
          </div>
        </div>
      `;
    }
  }

  renderDynamicTasks();
}

async function loadApprovedTasksForToday() {
  const cacheKey = `cpm_cache_tasks_${state.project.id}_${state.reportDate}_${state.subcontractor.name}`;

  // 1. Instant check: ถ้ามี existingMorningReport และมีรายการงาน ให้ใช้ทันที (0ms)
  if (state.existingMorningReport) {
    if (Array.isArray(state.existingMorningReport.task_progress) && state.existingMorningReport.task_progress.length > 0) {
      applyApprovedTasks(state.existingMorningReport.task_progress);
      return;
    }
  }

  // 2. Instant Cache Display (0ms)
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        applyApprovedTasks(parsed);
      }
    }
  } catch (e) {}

  // 3. Fast Firestore Fetch in parallel (<100ms)
  if (firebaseService.isConfigured()) {
    try {
      const fbTasks = await firebaseService.getApprovedTasks(state.reportDate, state.project.id);
      if (Array.isArray(fbTasks)) {
        const mySub = state.subcontractor.name;
        const filtered = (mySub && mySub !== '-') 
          ? fbTasks.filter(t => !t.company || t.company === '-' || t.company.includes(mySub) || mySub.includes(t.company))
          : fbTasks;
        if (filtered.length > 0) {
          applyApprovedTasks(filtered);
          try { localStorage.setItem(cacheKey, JSON.stringify(filtered)); } catch(e) {}
          return; // ดึงจาก Firestore สำเร็จแล้ว ไม่ต้องรอ GAS
        } else {
          // ฐานข้อมูลใน Firestore ว่างเปล่า (หรือถูกเคลียร์) -> ล้างแคชและอัปเดตสถานะเป็นไม่มีงานทันที
          try { localStorage.removeItem(cacheKey); } catch(e) {}
          applyApprovedTasks([]);
        }
      }
    } catch (e) {
      console.warn('[Foreman] Firestore getApprovedTasks error:', e);
    }
  }

  // 4. Background GAS Fetch (fallback & master sync)
  if (gasService.isConfigured() && state.project.id && state.project.id !== '-') {
    gasService.fetchApprovedTasksForDate(state.reportDate, state.subcontractor.name, state.project.id).then(gasTasks => {
      if (Array.isArray(gasTasks)) {
        if (gasTasks.length > 0) {
          applyApprovedTasks(gasTasks);
          try { localStorage.setItem(cacheKey, JSON.stringify(gasTasks)); } catch(e) {}
        } else {
          try { localStorage.removeItem(cacheKey); } catch(e) {}
          applyApprovedTasks([]);
        }
      }
    }).catch(e => console.warn('[Foreman] GAS fetchApprovedTasks error:', e));
  }
}

// ==========================================
// Render Dynamic Tasks
// ==========================================
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
      <div style="text-align: center; font-size: 0.82rem; color: var(--text-muted); padding: 2rem 1rem; border: 2px dashed var(--border-subtle); border-radius: var(--radius-sm); margin: 0.5rem 0;">
        <div style="font-size: 1.8rem; margin-bottom: 0.4rem;">📭</div>
        <strong>ไม่มีรายการงานตามแผนที่อนุมัติในวันนี้</strong>
        <p style="font-size: 0.74rem; margin-top: 0.25rem;">เมื่อหัวหน้าผู้รับเหมาสร้างแผนและ PM กดอนุมัติ งานจะปรากฏที่นี่ทันที</p>
      </div>
    `;
    return;
  }

  container.innerHTML = tasks.map((t, idx) => {
    // ============ MORNING CARD ============
    if (isMorning) {
      return `
        <div class="dynamic-task-card plan-card" data-task-id="${t.id}">
          <div class="dynamic-task-top">
            <div class="task-tag-group">
              <span class="task-index-badge">งานที่ ${idx + 1}</span>
              <span class="shift-phase-badge plan">🎯 คาดการณ์</span>
              ${t.from_plan ? `
                <span class="task-plan-badge" style="background:#ecfdf5; color:#065f46; border:1px solid #10b981; font-size:0.68rem; font-weight:700; padding:2px 6px; border-radius:4px;">🎯 ตามแผน</span>
              ` : `
                <span class="task-plan-badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd; font-size:0.68rem; font-weight:700; padding:2px 6px; border-radius:4px;">📝 รายงานเพิ่มเติม (โฟร์แมน)</span>
              `}
            </div>
            ${!t.from_plan ? `<button type="button" class="btn-delete-task" onclick="window.removeDynamicTask('${t.id}')">🗑️ ลบ</button>` : ''}
          </div>
          <div style="margin-bottom: 0.4rem;">
            <label style="font-size: 0.7rem; color: var(--text-muted); display: block; margin-bottom: 2px;">${t.from_plan ? 'ชื่องานตามแผน:' : 'ชื่องานรายงานเพิ่มเติม:'}</label>
            <div style="font-size: 0.88rem; font-weight: 800; color: var(--text-heading);">${escapeHtml(t.name)}</div>
            ${t.workArea ? `<div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 2px;">📍 ${escapeHtml(t.workArea)}</div>` : ''}
          </div>
          ${t.description ? `<div style="font-size: 0.74rem; color: var(--text-main); background: #f8fafc; padding: 4px 8px; border-radius: 4px; margin-bottom: 0.5rem; border: 1px solid var(--border-subtle);">📝 ${escapeHtml(t.description)}</div>` : ''}
          <div class="task-metrics-grid">
            <div>
              <label style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px; display: block;">เป้าหมายปริมาณงาน:</label>
              <input type="text" class="form-input" style="font-size: 0.78rem;" value="${escapeHtml(t.quantity || '')}" placeholder="เช่น 8 ต้น, 35 ตร.ม." oninput="window.updateTaskField('${t.id}', 'quantity', this.value)">
            </div>
            <div>
              <label style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px; display: block;">เป้าหมายความคืบหน้า (%):</label>
              <div class="progress-control-block">
                <div class="progress-input-wrapper">
                  <input type="number" class="form-input progress-num-input" min="0" max="100" inputmode="numeric" value="${t.progress !== undefined ? t.progress : 0}" placeholder="0" onfocus="this.select()" oninput="window.updateTaskField('${t.id}', 'progress', this.value, this)">
                  <span class="progress-unit-badge">%</span>
                </div>
                <div class="progress-pills-row">
                  ${[25, 50, 75, 100].map(pct => `<button type="button" data-pct="${pct}" class="pill-pct morning ${Number(t.progress) === pct ? 'active' : ''}" onclick="window.updateTaskProgress('${t.id}', ${pct})">${pct}%</button>`).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // ============ EVENING COMPARISON CARD (Forecast vs Actual) ============
    const planPct = t.planned_progress !== undefined ? Number(t.planned_progress) : 0;
    const planQty = t.planned_quantity || t.quantity || '';
    const actualPct = t.progress !== undefined ? Number(t.progress) : 0;
    const actualQty = (t.quantity && t.quantity !== '-') ? t.quantity : (planQty !== '-' ? planQty : '');
    const diff = actualPct - planPct;
    const diffColor = diff > 0 ? '#059669' : (diff === 0 ? '#047857' : '#dc2626');
    const diffBg = diff > 0 ? '#dcfce7' : (diff === 0 ? '#ecfdf5' : '#fee2e2');
    const diffBadge = diff > 0 ? `📈 +${diff}% เกินเป้า` : (diff === 0 ? `🎯 ตรงเป้าหมาย` : `⚠️ ${diff}% ช้ากว่าเป้า`);
    const statusIcon = actualPct >= 100 ? '✅' : actualPct >= planPct && planPct > 0 ? '🟢' : actualPct >= planPct * 0.8 ? '🟡' : '🔴';

    return `
      <div class="dynamic-task-card evening-compare-card" data-task-id="${t.id}">
        <!-- Header -->
        <div class="dynamic-task-top">
          <div class="task-tag-group">
            <span class="task-index-badge">งานที่ ${idx + 1}</span>
            <span class="shift-phase-badge actual">${statusIcon} ยืนยันผลงานปิดงาน</span>
            ${t.from_plan ? `
              <span class="task-plan-badge" style="background:#ecfdf5; color:#065f46; border:1px solid #10b981; font-size:0.68rem; font-weight:700; padding:2px 6px; border-radius:4px;">🎯 ตามแผน</span>
            ` : `
              <span class="task-plan-badge" style="background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd; font-size:0.68rem; font-weight:700; padding:2px 6px; border-radius:4px;">📝 รายงานเพิ่มเติม (โฟร์แมน)</span>
            `}
          </div>
          ${!t.from_plan ? `<button type="button" class="btn-delete-task" onclick="window.removeDynamicTask('${t.id}')">🗑️ ลบ</button>` : ''}
        </div>

        <!-- Task Name & Work Area -->
        <div style="margin-bottom: 0.55rem;">
          <div style="font-size: 0.92rem; font-weight: 800; color: var(--text-heading); line-height: 1.3;">
            ${escapeHtml(t.name)}
          </div>
          ${t.workArea ? `<div style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">📍 โซนทำงาน: <strong>${escapeHtml(t.workArea)}</strong></div>` : ''}
          ${t.description ? `<div style="font-size:0.72rem; color:#4b5563; background:#f8fafc; padding:3px 6px; border-radius:4px; margin-top:4px; border:1px solid #e2e8f0;">📝 ${escapeHtml(t.description)}</div>` : ''}
        </div>

        <!-- Comparison Row: เช้า (คาดการณ์) vs เย็น (ผลงานจริง) -->
        <div class="evening-compare-grid">
          <!-- เช้า (คาดการณ์ / Forecast) -->
          <div class="compare-col morning-col">
            <div class="compare-col-label">🌅 เช้า (คาดการณ์)</div>
            <div class="compare-qty-val">
              <input type="text" class="form-input compare-qty-input" value="${escapeHtml(planQty)}" placeholder="เป้าหมายเช้า" oninput="window.updateEveningPlanField('${t.id}', 'planned_quantity', this.value)" style="font-size:0.75rem; margin-bottom:4px; text-align:center;">
            </div>
            <div class="compare-pct-big morning-pct">
              <input type="number" min="0" max="100" class="plan-pct-inline-input" value="${planPct}" oninput="window.updateEveningPlanPct('${t.id}', this.value)" title="แตะเพื่อแก้ไข % เป้าหมายเช้าหากต้องการ">
              <span style="font-size:0.7rem; font-weight:700;">%</span>
            </div>
            <div class="compare-progress-bar">
              <div class="compare-bar-fill morning-fill" id="compare-plan-bar-${t.id}" style="width: ${Math.min(planPct, 100)}%"></div>
            </div>
          </div>

          <!-- Arrow -->
          <div class="compare-arrow">→</div>

          <!-- เย็น (ผลงานจริง / Actual) -->
          <div class="compare-col evening-col">
            <div class="compare-col-label">🌆 ปิดงาน (ผลจริง)</div>
            <div class="compare-qty-val">
              <input type="text" class="form-input compare-qty-input" value="${escapeHtml(String(actualQty))}" placeholder="ปริมาณจริงที่ได้" oninput="window.updateTaskField('${t.id}', 'quantity', this.value)" style="font-size:0.75rem; margin-bottom:4px; text-align:center;">
            </div>
            <div class="compare-pct-big evening-pct" id="compare-pct-${t.id}">${actualPct}<span style="font-size:0.7rem">%</span></div>
            <div class="compare-progress-bar">
              <div class="compare-bar-fill evening-fill" id="compare-bar-${t.id}" style="width: ${Math.min(actualPct, 100)}%"></div>
            </div>
            <!-- Diff badge -->
            <div class="diff-badge-status" id="compare-diff-${t.id}" style="color:${diffColor}; background:${diffBg};">
              ${diffBadge}
            </div>
          </div>
        </div>

        <!-- Controls: ยืนยัน % ผลงานจริง -->
        <div style="margin-top:0.6rem; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:6px 8px;">
          <label style="font-size:0.72rem; font-weight:700; color:var(--text-heading); display:block; margin-bottom:4px;">
            ✏️ ยืนยัน % ผลงานจริงสะสมตอนปิดงาน:
          </label>
          <div class="progress-control-block">
            <div class="progress-input-wrapper">
              <input type="number" class="form-input progress-num-input" min="0" max="100" inputmode="numeric" value="${actualPct}" placeholder="0" onfocus="this.select()" oninput="window.updateEveningCompare('${t.id}', this.value, this)">
              <span class="progress-unit-badge">%</span>
            </div>
            <div class="progress-pills-row">
              ${[25, 50, 75, 100].map(pct => `<button type="button" data-pct="${pct}" class="pill-pct ${Number(actualPct) === pct ? 'active' : ''}" onclick="window.updateEveningCompare('${t.id}', ${pct}, null)">${pct}%</button>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Global Tasks Handlers
window.updateTaskField = function(id, field, value, inputEl) {
  const list = getActiveTasksList();
  const task = list.find(t => t.id === id);
  if (!task) return;

  if (field === 'progress') {
    let num = value === '' ? 0 : parseInt(value, 10);
    if (isNaN(num)) num = 0;
    if (num < 0) num = 0;
    if (num > 100) {
      num = 100;
      if (inputEl) inputEl.value = 100;
    }
    task.progress = num;

    const card = document.querySelector(`[data-task-id="${id}"]`);
    if (card) {
      card.querySelectorAll('.pill-pct').forEach(btn => {
        const btnPct = parseInt(btn.dataset.pct, 10);
        if (btnPct === num) btn.classList.add('active');
        else btn.classList.remove('active');
      });
    }
  } else {
    task[field] = value;
  }
};

window.updateTaskProgress = function(id, progress) {
  const list = getActiveTasksList();
  const task = list.find(t => t.id === id);
  if (!task) return;

  const val = parseInt(progress, 10) || 0;
  task.progress = val;

  const card = document.querySelector(`[data-task-id="${id}"]`);
  if (card) {
    const input = card.querySelector('.progress-num-input');
    if (input) input.value = val;
    card.querySelectorAll('.pill-pct').forEach(btn => {
      const btnPct = parseInt(btn.dataset.pct, 10);
      if (btnPct === val) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }
};

window.removeDynamicTask = function(id) {
  const list = getActiveTasksList();
  const idx = list.findIndex(t => t.id === id);
  if (idx > -1) {
    list.splice(idx, 1);
    renderDynamicTasks();
    showToast('ลบรายการงานรายงานเพิ่มเติมแล้ว', 'info');
  }
};

// อัปเดต % ผลงานจริงใน Evening Compare Card (realtime bar + pct display)
window.updateEveningCompare = function(id, value, inputEl) {
  const list = getActiveTasksList();
  const task = list.find(t => t.id === id);
  if (!task) return;

  let num = value === '' ? 0 : parseInt(value, 10);
  if (isNaN(num)) num = 0;
  if (num < 0) num = 0;
  if (num > 100) { num = 100; if (inputEl) inputEl.value = 100; }
  task.progress = num;

  // อัปเดต UI ของ card โดยตรง (ไม่ re-render ทั้งหมดเพื่อความลื่นไหล)
  const card = document.querySelector(`[data-task-id="${id}"]`);
  if (card) {
    // pill active state
    card.querySelectorAll('.pill-pct').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.pct, 10) === num);
    });
    // number input sync
    if (inputEl === null) {
      const inp = card.querySelector('.progress-num-input');
      if (inp) inp.value = num;
    }
    // progress bar
    const bar = card.querySelector(`#compare-bar-${id}`);
    if (bar) bar.style.width = Math.min(num, 100) + '%';
    // pct display
    const pctEl = card.querySelector(`#compare-pct-${id}`);
    if (pctEl) pctEl.innerHTML = `${num}<span style="font-size:0.7rem">%</span>`;

    // diff badge recalculation
    const planPct = task.planned_progress !== undefined ? Number(task.planned_progress) : 0;
    const diff = num - planPct;
    const diffColor = diff > 0 ? '#059669' : (diff === 0 ? '#047857' : '#dc2626');
    const diffBg = diff > 0 ? '#dcfce7' : (diff === 0 ? '#ecfdf5' : '#fee2e2');
    const diffBadge = diff > 0 ? `📈 +${diff}% เกินเป้า` : (diff === 0 ? `🎯 ตรงเป้าหมาย` : `⚠️ ${diff}% ช้ากว่าเป้า`);
    const diffEl = card.querySelector(`#compare-diff-${id}`);
    if (diffEl) {
      diffEl.style.color = diffColor;
      diffEl.style.background = diffBg;
      diffEl.innerText = diffBadge;
    }

    // header phase badge icon update
    const statusIcon = num >= 100 ? '✅' : num >= planPct && planPct > 0 ? '🟢' : num >= planPct * 0.8 ? '🟡' : '🔴';
    const phaseBadge = card.querySelector('.shift-phase-badge.actual');
    if (phaseBadge) {
      phaseBadge.innerText = `${statusIcon} ยืนยันผลงานปิดงาน`;
    }
  }
};

// อัปเดต % เป้าหมายรอบเช้าจากในการ์ดปิดงาน (หากตอนเช้าลืมใส่หรือต้องการปรับ)
window.updateEveningPlanPct = function(id, value) {
  const list = getActiveTasksList();
  const task = list.find(t => t.id === id);
  if (!task) return;

  let num = value === '' ? 0 : parseInt(value, 10);
  if (isNaN(num)) num = 0;
  if (num < 0) num = 0;
  if (num > 100) num = 100;
  task.planned_progress = num;

  const card = document.querySelector(`[data-task-id="${id}"]`);
  if (card) {
    const planBar = card.querySelector(`#compare-plan-bar-${id}`);
    if (planBar) planBar.style.width = Math.min(num, 100) + '%';

    // diff badge recalculation
    const actualPct = task.progress !== undefined ? Number(task.progress) : 0;
    const diff = actualPct - num;
    const diffColor = diff > 0 ? '#059669' : (diff === 0 ? '#047857' : '#dc2626');
    const diffBg = diff > 0 ? '#dcfce7' : (diff === 0 ? '#ecfdf5' : '#fee2e2');
    const diffBadge = diff > 0 ? `📈 +${diff}% เกินเป้า` : (diff === 0 ? `🎯 ตรงเป้าหมาย` : `⚠️ ${diff}% ช้ากว่าเป้า`);
    const diffEl = card.querySelector(`#compare-diff-${id}`);
    if (diffEl) {
      diffEl.style.color = diffColor;
      diffEl.style.background = diffBg;
      diffEl.innerText = diffBadge;
    }
  }
};

window.updateEveningPlanField = function(id, field, value) {
  const list = getActiveTasksList();
  const task = list.find(t => t.id === id);
  if (!task) return;
  task[field] = value;
};

// ==========================================
// Shift Switcher (เช้า <-> จบงาน)
// ==========================================
function switchShift(shift) {
  if (state.activeShift === shift) return;
  state.activeShift = shift;

  if (shift === 'evening') {
    // ตรวจสอบว่ามีรายงานเปิดงานรอบเช้าหรือยัง
    if (!state.existingMorningReport) {
      showToast('⚠️ ยังไม่มีการส่งรายงานเปิดงานรอบเช้าของวันนี้ กรุณาบันทึกรอบเช้าก่อน', 'warning');
    } else {
      // ดึงงานและข้อมูลที่เปิดไว้ช่วงเช้ามาเป็น Baseline ในช่วงเย็น
      if (state.eveningActualTasks.length === 0) {
        let sourceTasks = [];
        if (state.morningPlannedTasks && state.morningPlannedTasks.length > 0) {
          sourceTasks = state.morningPlannedTasks;
        }

        // ดึง % เป้าหมายและปริมาณจาก existingMorningReport.task_summary
        const summaryMap = {};
        if (state.existingMorningReport && state.existingMorningReport.task_summary) {
          const items = String(state.existingMorningReport.task_summary).split(' | ').filter(Boolean);
          items.forEach((it, idx) => {
            let pProg = 0;
            const m = it.match(/\((\d+)%\)/);
            if (m) pProg = Number(m[1]);
            const mQty = it.match(/\[(?:ผลงาน|เป้าหมาย|ปริมาณ):\s*([^\]]+)\]/);
            const pQty = mQty ? mQty[1].trim() : '';
            const cleanName = it.replace(/^\d+\.\s*/, '').replace(/\(\d+%\)\s*:?/, '').replace(/\[[^\]]+\]/, '').split(':')[0].trim();
            if (cleanName) summaryMap[cleanName] = { progress: pProg, quantity: pQty };
            summaryMap[idx] = { progress: pProg, quantity: pQty, name: cleanName, raw: it };
          });
        }

        if (sourceTasks.length > 0) {
          state.eveningActualTasks = sourceTasks.map((t, idx) => {
            const summaryMatch = summaryMap[t.name] || summaryMap[idx] || {};
            const planP = (t.progress !== undefined && Number(t.progress) > 0)
              ? Number(t.progress)
              : (summaryMatch.progress !== undefined ? Number(summaryMatch.progress) : 0);
            const planQ = (t.quantity && t.quantity !== '-')
              ? t.quantity
              : (summaryMatch.quantity || '');

            return {
              ...t,
              id: 'ACT-' + (t.id || Date.now()) + '-' + idx,
              source_task_id: t.source_task_id || t.id || '',
              from_plan: !!t.from_plan,
              company: t.company || state.subcontractor.name || '',
              planned_quantity: planQ,
              planned_progress: planP,
              quantity: planQ,
              progress: planP,
              isPlanned: false
            };
          });
        } else if (state.existingMorningReport && state.existingMorningReport.task_summary) {
          const items = String(state.existingMorningReport.task_summary).split(' | ').filter(Boolean);
          state.eveningActualTasks = items.map((it, idx) => {
            let pProg = 0;
            const m = it.match(/\((\d+)%\)/);
            if (m) pProg = Number(m[1]);
            const mQty = it.match(/\[(?:ผลงาน|เป้าหมาย|ปริมาณ):\s*([^\]]+)\]/);
            const pQty = mQty ? mQty[1].trim() : '';
            const cleanName = it.replace(/^\d+\.\s*/, '').replace(/\(\d+%\)\s*:?/, '').replace(/\[[^\]]+\]/, '').split(':')[0].trim();
            return {
              id: 'ACT-MORN-' + (idx + 1),
              name: cleanName || ('งานที่ ' + (idx + 1)),
              description: it,
              planned_quantity: pQty,
              planned_progress: pProg,
              quantity: pQty,
              progress: pProg,
              isPlanned: false
            };
          });
        }
      }

      // ถ่ายโอนยอดกำลังพลและเครื่องจักรจากรอบเช้ามาเป็นค่าตั้งต้นรอบเย็น
      const em = state.existingMorningReport;
      if (em.foreman_count !== undefined) {
        state.workforce.foreman = Number(em.foreman_count || 1);
        state.workforce.skilled_workers = Number(em.skilled_count || 0);
        state.workforce.general_labor = Number(em.labor_count || 0);
        state.workforce.safety_officer = Number(em.safety_count || 0);
        renderWorkforce();
      }
      if (em.machinery && em.machinery !== '-' && (!state.machinery || state.machinery.length === 0)) {
        state.machinery = String(em.machinery).split(',').map(s => s.trim()).filter(Boolean);
        renderMachinery();
      }

      showToast('🌆 สลับสู่โหมด: รายงานสรุปจบงานประจำวัน (เชื่อมต่อจากรอบเช้า)', 'info');
    }
  } else {
    showToast('🌅 สลับสู่โหมด: เปิดงานตอนเช้า', 'info');
  }

  renderShiftUI();
}

// Expose switchShift to window for onclick handlers
window.switchShiftTab = function(shift) {
  switchShift(shift);
};

// เปิดโหมดแก้ไขรายงานเช้า (เรียกจากปุ่ม "✏️ แก้ไข" ใน syncBanner)
window.enableMorningEditMode = function() {
  const syncBanner = document.getElementById('shift-sync-status-banner');
  const submitBtn = document.getElementById('btn-submit-daily-report');
  const submitText = document.getElementById('btn-submit-text');
  const tasksSection = document.getElementById('tasks-card-section');

  if (syncBanner) {
    syncBanner.className = 'shift-sync-status-banner morning-edit';
    syncBanner.innerHTML = `
      <div>
        <strong>✏️ โหมดแก้ไขรายงานเปิดงานตอนเช้า</strong><br>
        <span style="font-size: 0.72rem; opacity: 0.9;">แก้ไขยอดคน สภาพอากาศ หรืองาน แล้วกด "บันทึกการแก้ไข" ด้านล่าง</span>
      </div>
      <span style="font-size: 0.72rem; font-weight: 700; background: #2563eb; color: #fff; padding: 2px 8px; border-radius: 4px; white-space: nowrap;">โหมดแก้ไข</span>
    `;
  }
  if (submitBtn) {
    submitBtn.style.display = '';
    submitBtn.disabled = false;
    submitBtn.className = 'btn-submit-report morning';
    submitText.innerText = '✏️ บันทึกการแก้ไขรายงานเปิดงานตอนเช้า';
  }
  if (tasksSection) {
    tasksSection.style.opacity = '1';
    tasksSection.style.pointerEvents = '';
  }
  showToast('🔓 เปิดโหมดแก้ไขรายงานเปิดงานเช้าแล้ว', 'info');
};

function renderMorningBaselineCard() {
  const container = document.getElementById('morning-baseline-card-container');
  if (!container) return;

  const em = state.existingMorningReport;
  if (!em || state.activeShift !== 'evening') {
    container.style.display = 'none';
    return;
  }

  const mId = em.id || em['รหัสรายงาน'] || em['รหัสรายงาน (Report ID)'] || '-';
  const mTime = em.timestamp || em['เวลาบันทึก (Timestamp)'] || '-';
  const mWf = (em.totalWorkforce !== undefined && em.totalWorkforce !== null && em.totalWorkforce !== '')
    ? em.totalWorkforce
    : (em['ยอดคนงานรวม (คน)'] || (Number(em.foreman_count || 1) + Number(em.skilled_count || 0) + Number(em.labor_count || 0) + Number(em.safety_count || 0)));
  const mForeman = em.foreman_count !== undefined ? em.foreman_count : (em['โฟร์แมน (คน)'] || 1);
  const mSkilled = em.skilled_count !== undefined ? em.skilled_count : (em['ช่างฝีมือ (คน)'] || 0);
  const mLabor = em.labor_count !== undefined ? em.labor_count : (em['แรงงานทั่วไป (คน)'] || 0);
  const mSafety = em.safety_count !== undefined ? em.safety_count : (em['จป.ความปลอดภัย (คน)'] || 0);
  const mWeather = em.weather || em['สภาพอากาศ'] || '-';
  const mMachinery = em.machinery || em['เครื่องจักรที่ใช้งาน'] || '-';

  // รายการงานที่วางแผนไว้ตอนเช้า
  let tasksList = [];
  if (state.morningPlannedTasks && state.morningPlannedTasks.length > 0) {
    tasksList = state.morningPlannedTasks;
  } else if (em.task_summary) {
    tasksList = String(em.task_summary).split(' | ').filter(Boolean).map(t => {
      let p = 0;
      const matchP = t.match(/\((\d+)%\)/);
      if (matchP) p = Number(matchP[1]);
      return {
        name: t.replace(/^\d+\.\s*/, '').replace(/\(\d+%\)\s*:?/, '').trim(),
        quantity: '',
        progress: p
      };
    });
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div class="morning-baseline-card">
      <div class="morning-baseline-header">
        <div class="morning-baseline-title">
          <span>🌅 ข้อมูลเปิดงานรอบเช้า (Baseline ที่ต้องรายงานต่อ)</span>
        </div>
        <span class="morning-connected-badge">🔗 รหัส: ${escapeHtml(mId)}</span>
      </div>

      <div class="morning-meta-grid">
        <div class="morning-meta-box">
          <label>👷 กำลังพลเปิดงานรอบเช้า:</label>
          <strong>รวม ${mWf} คน</strong>
          <div style="font-size:0.68rem; color:var(--text-muted); margin-top:2px;">
            โฟร์แมน ${mForeman}, ช่าง ${mSkilled}, แรงงาน ${mLabor}, จป. ${mSafety}
          </div>
        </div>

        <div class="morning-meta-box">
          <label>☀️ สภาพอากาศรอบเช้า:</label>
          <strong style="font-size:0.76rem; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(mWeather)}">${escapeHtml(mWeather)}</strong>
          <div style="font-size:0.68rem; color:var(--text-muted); margin-top:2px;">
            🚜 เครื่องจักร: ${escapeHtml(mMachinery)}
          </div>
        </div>
      </div>

      ${tasksList.length > 0 ? `
        <div class="morning-tasks-connected-hint">
          <div class="m-hint-left">
            <span class="m-hint-icon">⚡</span>
            <div>
              <strong style="font-size:0.8rem; color:#14532d;">เชื่อมโยงงานตามแผน ${tasksList.length} รายการจากรอบเช้าแล้ว</strong>
              <div style="font-size:0.68rem; color:#15803d; margin-top:2px;">เปรียบเทียบและระบุผลงานจริงที่การ์ดด้านล่าง 👇</div>
            </div>
          </div>
          <span class="m-hint-badge">พร้อมรายงาน</span>
        </div>
      ` : ''}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; font-size:0.72rem;">
        <span style="color:var(--text-muted);">🕒 บันทึกเปิดงานเมื่อ: ${escapeHtml(mTime)}</span>
        <span class="morning-switch-link" onclick="window.switchShiftTab('morning')">
          ✏️ แก้ไขยอดคน/ข้อมูลเช้า
        </span>
      </div>
    </div>
  `;
}

function renderShiftUI() {
  const isMorning = state.activeShift === 'morning';
  const tabMorning = document.getElementById('tab-morning-shift');
  const tabEvening = document.getElementById('tab-evening-shift');
  const topBadge = document.getElementById('shift-badge-top');
  const rainHoursBox = document.getElementById('rain-hours-box');
  const submitBtn = document.getElementById('btn-submit-daily-report');
  const submitText = document.getElementById('btn-submit-text');
  const syncBanner = document.getElementById('shift-sync-status-banner');
  const reqBanner = document.getElementById('morning-required-banner');
  const tasksSection = document.getElementById('tasks-card-section');
  const photoMergeHint = document.getElementById('photo-merge-hint');

  // ตรวจสอบให้แน่ใจว่าปุ่ม Submit แสดงผลเสมอ ไม่ถูกซ่อนค้าง
  if (submitBtn) {
    submitBtn.style.display = '';
  }

  if (tabMorning && tabEvening) {
    if (isMorning) {
      tabMorning.classList.add('active');
      tabEvening.classList.remove('active');
      if (topBadge) {
        topBadge.className = 'header-badge';
        topBadge.innerText = '🌅 รอบเช้า';
      }
      if (rainHoursBox) rainHoursBox.style.display = 'none';
      if (reqBanner) reqBanner.style.display = 'none';
      if (photoMergeHint) photoMergeHint.style.display = 'none';
      if (tasksSection) {
        tasksSection.style.opacity = '1';
        tasksSection.style.pointerEvents = '';
      }

      // Hide baseline card in morning mode
      const baseContainer = document.getElementById('morning-baseline-card-container');
      if (baseContainer) baseContainer.style.display = 'none';

      // Reset tasks section title
      const tasksSecTitle = document.getElementById('tasks-section-title');
      const tasksBadgeHint = document.getElementById('tasks-badge-hint');
      if (tasksSecTitle) tasksSecTitle.innerText = '🎯 งานตามแผนที่ได้รับอนุมัติวันนี้ (เปิดงานเช้า)';
      if (tasksBadgeHint) {
        tasksBadgeHint.className = 'badge-hint morning';
        tasksBadgeHint.innerText = 'เป้าหมายตามแผน';
      }

      // Reset photo section labels กลับเป็นรอบเช้า
      const photoTitle = document.getElementById('photo-section-title');
      const camTitle = document.getElementById('camera-trigger-title');
      const camDesc = document.getElementById('camera-trigger-desc');
      if (photoTitle) photoTitle.innerText = 'ภาพถ่ายแถวเปิดงาน / Safety Talk';
      if (camTitle) camTitle.innerText = 'แตะถ่ายรูปแถวคนงาน หรือประชุม Safety';
      if (camDesc) camDesc.innerText = 'ประทับเวลาเปิดงานรอบเช้า และ LINE UID';

      if (state.existingMorningReport) {
        // รายงานเช้าส่งแล้ว → แสดง "สำเร็จ" พร้อมปุ่มลัดไปรอบเย็น และปุ่มบันทึกการแก้ไข
        const em = state.existingMorningReport;
        const mTime = em.timestamp || em['เวลาบันทึก (Timestamp)'] || '';
        const mWorkers = em.totalWorkforce ||
          (Number(em.foreman_count || 1) + Number(em.skilled_count || 0) +
           Number(em.labor_count || 0) + Number(em.safety_count || 0));

        if (syncBanner) {
          syncBanner.className = 'shift-sync-status-banner morning-done';
          syncBanner.style.display = 'flex';
          syncBanner.innerHTML = `
            <div style="flex:1">
              <div style="font-size:0.95rem; font-weight:800; color:#065f46; margin-bottom:4px;">✅ บันทึกรายงานเปิดงานรอบเช้าแล้ว</div>
              <div style="font-size:0.75rem; color:#047857; line-height:1.5;">
                🕐 เวลา: <strong>${escapeHtml(String(mTime))}</strong>
                &nbsp;|&nbsp; 👷 ยอดคน: <strong>${mWorkers} คน</strong>
                &nbsp;|&nbsp; 📋 รหัส: <strong>${escapeHtml(String(em.id || '-'))}</strong>
              </div>
              <div style="font-size:0.72rem; color:#6b7280; margin-top:4px;">ท่านสามารถแก้ไขข้อมูลแล้วกดปุ่มอัปเดต หรือกดสลับไปรายงานปิดงานรอบเย็น</div>
              <div id="morning-sync-cloud-status" style="font-size:0.72rem; color:#047857; margin-top:3px; font-weight:600;">
                ☁️ สถานะคลาวด์: <span id="cloud-sync-text">${em._bgSyncing ? 'กำลังบันทึกข้อมูลเบื้องหลัง...' : 'บันทึกในระบบเรียบร้อย'}</span>
              </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px; flex-shrink:0;">
              <button type="button" onclick="window.switchShiftTab('evening')" style="background:#059669; color:#fff; border:none; border-radius:6px; padding:6px 12px; font-size:0.75rem; font-weight:700; cursor:pointer; white-space:nowrap; box-shadow:0 1px 3px rgba(0,0,0,0.1);">🌆 ไปปิดงานรอบเย็น 👉</button>
              <button type="button" onclick="window.enableMorningEditMode()" style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:6px; padding:4px 8px; font-size:0.72rem; font-weight:600; cursor:pointer; white-space:nowrap;">✏️ แก้ไขรอบเช้า</button>
            </div>
          `;
        }
        // ปุ่ม submit ต้องมองเห็นเสมอ เพื่อให้กดอัปเดตข้อมูลรอบเช้าได้
        if (submitBtn) {
          submitBtn.style.display = '';
          submitBtn.disabled = false;
          submitBtn.className = 'btn-submit-report morning';
          submitText.innerText = '✏️ บันทึกการแก้ไขรายงานเปิดงานตอนเช้า';
        }
        if (tasksSection) {
          tasksSection.style.opacity = '1';
          tasksSection.style.pointerEvents = '';
        }
      } else {
        if (syncBanner) syncBanner.style.display = 'none';
        if (submitBtn) {
          submitBtn.style.display = '';
          submitBtn.disabled = false;
          submitBtn.className = 'btn-submit-report morning';
          submitText.innerText = '🌅 ส่งรายงานเปิดงานตอนเช้า';
        }
        if (tasksSection) {
          tasksSection.style.opacity = '1';
          tasksSection.style.pointerEvents = '';
        }
      }

    } else {
      // EVENING SHIFT (รอบปิดงาน / จบงาน)
      tabMorning.classList.remove('active');
      tabEvening.classList.add('active');
      if (topBadge) {
        topBadge.className = 'header-badge evening';
        topBadge.innerText = '🌆 รอบเย็น';
      }
      if (rainHoursBox) rainHoursBox.style.display = 'flex';

      // เงื่อนไขสำคัญ: ตรวจสอบว่ามีรายงานเปิดงานรอบเช้าแล้วหรือไม่
      if (!state.existingMorningReport) {
        // ยังไม่มีรายงานรอบเช้า -> บังคับให้ส่งรอบเช้าก่อน
        if (reqBanner) {
          reqBanner.style.display = 'block';
          reqBanner.innerHTML = `
            <div class="morning-required-icon">⚠️</div>
            <div class="morning-required-title">ยังไม่มีการส่งรายงานเปิดงานตอนเช้าของวันนี้</div>
            <div class="morning-required-desc">
              ตามระเบียบงานวิศวกรรมก่อสร้าง การรายงานปิดงานจำเป็นต้องอ้างอิงและบันทึกผลงานต่อจากรายงานเปิดงานรอบเช้า<br>
              กรุณากดปุ่มด้านล่างเพื่อไปบันทึกเปิดงานรอบเช้าก่อน
            </div>
            <button type="button" class="btn-goto-morning" onclick="window.switchShiftTab('morning')">
              <span>🌅 ไปบันทึกเปิดงานตอนเช้าทันที</span>
            </button>
          `;
        }
        if (syncBanner) syncBanner.style.display = 'none';
        if (photoMergeHint) photoMergeHint.style.display = 'none';
        if (tasksSection) tasksSection.style.opacity = '0.4';

        const baseContainer = document.getElementById('morning-baseline-card-container');
        if (baseContainer) baseContainer.style.display = 'none';

        if (submitBtn) {
          submitBtn.style.display = '';
          submitBtn.disabled = true;
          submitBtn.className = 'btn-submit-report evening';
          submitText.innerText = '⚠️ กรุณาบันทึกเปิดงานเช้าก่อนปิดงาน';
        }
      } else {
        // มีรายงานรอบเช้าแล้ว -> แสดง Morning Baseline Card และฟอร์มกรอกผลงานจริงต่อจากรอบเช้า
        if (reqBanner) reqBanner.style.display = 'none';
        if (tasksSection) {
          tasksSection.style.opacity = '1';
          tasksSection.style.pointerEvents = '';
        }

        // Update tasks section title to emphasis comparison
        const tasksSecTitle = document.getElementById('tasks-section-title');
        const tasksBadgeHint = document.getElementById('tasks-badge-hint');
        if (tasksSecTitle) tasksSecTitle.innerText = '⚡ ยืนยันผลงานจริงเปรียบเทียบรอบเช้า (Forecast vs Actual)';
        if (tasksBadgeHint) {
          tasksBadgeHint.className = 'badge-hint evening';
          tasksBadgeHint.innerText = '🌆 สรุปผลงานปิดงาน';
        }

        renderMorningBaselineCard();

        // อัปเดต photo section สำหรับรอบเย็น
        const photoTitle = document.getElementById('photo-section-title');
        const camTitle = document.getElementById('camera-trigger-title');
        const camDesc = document.getElementById('camera-trigger-desc');
        if (photoTitle) photoTitle.innerText = 'ภาพถ่ายผลงานหน้างานตอนปิดงาน (บังคับ)';
        if (camTitle) camTitle.innerText = 'แตะถ่ายภาพหน้างานตอนปิดงาน / ความคืบหน้าจริง';
        if (camDesc) camDesc.innerText = 'ประทับเวลาปิดงาน — แนบเป็นหลักฐานผลงานประจำวันสมบูรณ์';

        if (photoMergeHint) {
          photoMergeHint.style.display = 'block';
          photoMergeHint.innerHTML = '🔗 <strong>ระบบรวมภาพอัตโนมัติ:</strong> ภาพถ่ายผลงานปิดงานนี้จะถูกนำไปรวมกับภาพแถวเปิดงานตอนเช้า เพื่อส่งเป็นรายงานประจำวันฉบับสมบูรณ์ให้ PM';
        }

        if (state.existingEveningReport) {
          if (syncBanner) {
            syncBanner.className = 'shift-sync-status-banner morning-edit';
            syncBanner.style.display = 'flex';
            syncBanner.innerHTML = `
              <div style="flex:1;">
                <strong style="color: #065f46; font-size: 0.88rem;">✅ คุณได้ส่งรายงานปิดงานแล้ว (${escapeHtml(state.existingEveningReport.id)})</strong><br>
                <span style="font-size: 0.72rem; opacity: 0.9;">ท่านสามารถปรับปรุง % ผลงานจริง แล้วกดบันทึกการแก้ไขได้</span>
                <div id="evening-sync-cloud-status" style="font-size:0.72rem; color:#047857; margin-top:3px; font-weight:600;">
                  ☁️ สถานะคลาวด์: <span id="cloud-sync-text-evening">${state.existingEveningReport._bgSyncing ? 'กำลังบันทึกข้อมูลเบื้องหลัง...' : 'บันทึกในระบบเรียบร้อย'}</span>
                </div>
              </div>
              <span style="font-size: 0.72rem; font-weight: 700; background: #059669; color: #fff; padding: 3px 8px; border-radius: 4px; white-space: nowrap;">ส่งแล้ว</span>
            `;
          }
          if (submitBtn) {
            submitBtn.style.display = '';
            submitBtn.disabled = false;
            submitBtn.className = 'btn-submit-report evening';
            submitText.innerText = '✏️ บันทึกการแก้ไขรายงานปิดงานประจำวัน';
          }
        } else {
          if (syncBanner) {
            syncBanner.className = 'shift-sync-status-banner evening-connected';
            syncBanner.style.display = 'flex';
            syncBanner.innerHTML = `
              <div>
                <strong>🔗 เชื่อมโยงข้อมูลจากรายงานรอบเช้าแล้ว (${escapeHtml(state.existingMorningReport.id)})</strong><br>
                <span style="font-size: 0.72rem; opacity: 0.9;">รายการงานและยอดคนถูกดึงมาจากรอบเช้าให้อัตโนมัติ — โปรดระบุ % ผลงานจริงและเวลาหยุดงานจากฝนตก</span>
              </div>
              <span style="font-size: 0.72rem; font-weight: 700; background: #10b981; color: #fff; padding: 2px 8px; border-radius: 4px; white-space: nowrap;">ต่อเนื่องรอบเช้า</span>
            `;
          }
          if (submitBtn) {
            submitBtn.style.display = '';
            submitBtn.disabled = false;
            submitBtn.className = 'btn-submit-report evening';
            submitText.innerText = '🌆 ส่งรายงานปิดงานประจำวัน (รวมผลงานต่อจากรอบเช้า)';
          }
        }
      }
    }
  }

  renderPhotos();
  renderDynamicTasks();
}

function clearTodayReportState() {
  state.existingMorningReport = null;
  state.existingEveningReport = null;
  state.photos = [];
  state.eveningPhotos = [];
  state.workforce = {
    foreman: 1,
    skilled_workers: 0,
    general_labor: 0,
    safety_officer: 0
  };
  state.weather = {
    type: 'sunny',
    text: '☀️ ท้องฟ้าแจ่มใส แดดจัดทั้งวัน',
    rainDelayHours: 0
  };
  state.machinery = [];
  state.issues = [];

  const cacheKey = `cpm_cache_reports_${state.project.id}_${state.reportDate}`;
  try { localStorage.removeItem(cacheKey); } catch(e) {}

  renderWeather();
  renderWorkforce();
  renderPhotos();
  renderMachinery();
  renderIssues();
  renderShiftUI();
}

function applyExistingReports(list) {
  const today = state.reportDate;
  const mySub = state.subcontractor.name;
  const myUid = state.lineUser.uid;

  // หากฐานข้อมูลว่างเปล่า (เช่น เคลียร์ Database) ให้ล้างสถานะหน้าจอทั้งหมดทันที
  if (!Array.isArray(list) || list.length === 0) {
    if (!state.existingMorningReport || !state.existingMorningReport._bgSyncing) {
      clearTodayReportState();
    }
    return;
  }

  // Find morning report for today (or already completed report)
  const mReport = list.find(r => {
    const rDate = r.report_date || r['วันที่รายงาน (Date)'];
    const rShift = String(r.shift_label || '');
    const rSub = r.sub_name || r.company || r['บริษัทผู้รับเหมา'];
    const rUid = r.line_uid || r['LINE UID'];
    const isMatchUser = (mySub && mySub !== '-' && rSub === mySub) || (myUid && myUid !== '-' && rUid === myUid);
    const isCompleted = rShift.includes('เช้า-จบงาน') || r.status === 'day_completed';
    const isMorn = isCompleted || rShift.includes('เช้า') || String(r.id || '').startsWith('MORN');
    return rDate === today && isMatchUser && isMorn;
  }) || null;

  if (!mReport) {
    if (!state.existingMorningReport || !state.existingMorningReport._bgSyncing) {
      state.existingMorningReport = null;
      state.photos = [];
    }
  } else {
    state.existingMorningReport = mReport;
    if (mReport.foreman_count !== undefined) {
      state.workforce.foreman = Number(mReport.foreman_count || 1);
      state.workforce.skilled_workers = Number(mReport.skilled_count || 0);
      state.workforce.general_labor = Number(mReport.labor_count || 0);
      state.workforce.safety_officer = Number(mReport.safety_count || 0);
      renderWorkforce();
    }
    if (mReport.weather) {
      const matchW = ['sunny', 'cloudy', 'rain_light', 'rain_heavy'].find(t => mReport.weather.includes(t));
      if (matchW) state.weather.type = matchW;
      state.weather.text = mReport.weather;
      renderWeather();
    }
    if (mReport.machinery && mReport.machinery !== '-') {
      state.machinery = String(mReport.machinery).split(',').map(s => s.trim()).filter(Boolean);
      renderMachinery();
    }

    // Hydrate tasks immediately from morning report if empty (0ms)
    if (state.morningPlannedTasks.length === 0) {
      if (Array.isArray(mReport.task_progress) && mReport.task_progress.length > 0) {
        applyApprovedTasks(mReport.task_progress);
      } else if (mReport.task_summary) {
        const parsedTasks = String(mReport.task_summary).split(' | ').filter(Boolean).map((it, idx) => {
          let p = 0;
          const matchP = it.match(/\((\d+)%\)/);
          if (matchP) p = Number(matchP[1]);
          const mQty = it.match(/\[(?:ผลงาน|เป้าหมาย|ปริมาณ):\s*([^\]]+)\]/);
          const pQty = mQty ? mQty[1].trim() : '';
          const cleanName = it.replace(/^\d+\.\s*/, '').replace(/\(\d+%\)\s*:?/, '').replace(/\[[^\]]+\]/, '').trim();
          return {
            taskId: 'TASK-MORN-' + (idx + 1),
            name: cleanName || ('งานที่ ' + (idx + 1)),
            targetQty: pQty,
            progress: p,
            category: 'ทั่วไป',
            from_plan: true
          };
        });
        if (parsedTasks.length > 0) {
          applyApprovedTasks(parsedTasks);
        }
      }
    }

    // Hydrate morning photos if available
    const rawM = mReport.morning_photos || mReport.photos || mReport.photoUrls || mReport['ลิงก์รูปภาพหน้างาน (Drive)'];
    if (Array.isArray(rawM)) {
      state.photos = rawM.map((p, i) => typeof p === 'string' ? { id: 'PH-M-'+i, url: p, timestamp: '🌅 เปิดงานเช้า' } : p).filter(p => p && p.url);
    } else if (typeof rawM === 'string' && rawM.trim()) {
      state.photos = rawM.split(',').map((u, i) => ({ id: 'PH-M-'+i, url: u.trim(), timestamp: '🌅 เปิดงานเช้า' })).filter(p => p.url);
    }
  }

  // Find evening report for today
  const eReport = list.find(r => {
    const rDate = r.report_date || r['วันที่รายงาน (Date)'];
    const rShift = String(r.shift_label || '');
    const rSub = r.sub_name || r.company || r['บริษัทผู้รับเหมา'];
    const rUid = r.line_uid || r['LINE UID'];
    const isMatchUser = (mySub && mySub !== '-' && rSub === mySub) || (myUid && myUid !== '-' && rUid === myUid);
    const isCompleted = rShift.includes('เช้า-จบงาน') || r.status === 'day_completed';
    const isEve = isCompleted || rShift.includes('เย็น') || rShift.includes('จบงาน') || String(r.id || '').startsWith('EVEN');
    return rDate === today && isMatchUser && isEve;
  }) || null;

  if (!eReport) {
    if (!state.existingEveningReport || !state.existingEveningReport._bgSyncing) {
      state.existingEveningReport = null;
      state.eveningPhotos = [];
    }
  } else {
    state.existingEveningReport = eReport;
    const rawE = eReport.evening_photos || (eReport !== mReport ? (eReport.photos || eReport.photoUrls || eReport['ลิงก์รูปภาพหน้างาน (Drive)']) : null);
    if (Array.isArray(rawE)) {
      state.eveningPhotos = rawE.map((p, i) => typeof p === 'string' ? { id: 'PH-E-'+i, url: p, timestamp: '🌆 ปิดงาน' } : p).filter(p => p && p.url);
    } else if (typeof rawE === 'string' && rawE.trim()) {
      state.eveningPhotos = rawE.split(',').map((u, i) => ({ id: 'PH-E-'+i, url: u.trim(), timestamp: '🌆 ปิดงาน' })).filter(p => p.url);
    }
  }

  renderPhotos();
  renderShiftUI();
}

async function checkExistingReportForToday() {
  if (!state.project.id || state.project.id === '-') return;
  const cacheKey = `cpm_cache_reports_${state.project.id}_${state.reportDate}`;

  // 1. Instant Cache Load (0ms) - optimistic first paint
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        applyExistingReports(parsed);
      }
    }
  } catch(e) {}

  // 2. Fast Firestore fetch (<100ms)
  if (firebaseService.isConfigured()) {
    try {
      const fbList = await firebaseService.getDailyReports(state.project.id);
      if (Array.isArray(fbList)) {
        if (fbList.length > 0) {
          applyExistingReports(fbList);
          try { localStorage.setItem(cacheKey, JSON.stringify(fbList)); } catch(e) {}
          const hasToday = fbList.some(r => (r.report_date || r['วันที่รายงาน (Date)']) === state.reportDate);
          if (hasToday) return; // พบรายงานวันนี้จาก Firestore แล้ว ไม่ต้องรอ GAS
        } else {
          // Firestore ว่างเปล่า (เคลียร์ DB แล้ว) -> เคลียร์รายงานหน้าจอทันที
          if (!state.existingMorningReport || !state.existingMorningReport._bgSyncing) {
            clearTodayReportState();
          }
        }
      }
    } catch (e) {
      console.warn('[Foreman] Firebase getDailyReports error:', e);
    }
  }

  // 3. Background GAS fetch (fallback)
  if (gasService.isConfigured() && state.project.id && state.project.id !== '-') {
    gasService.fetchDailyReports(state.project.id).then(gasList => {
      if (Array.isArray(gasList)) {
        if (gasList.length > 0) {
          applyExistingReports(gasList);
          try { localStorage.setItem(cacheKey, JSON.stringify(gasList)); } catch(e) {}
        } else {
          if (!state.existingMorningReport || !state.existingMorningReport._bgSyncing) {
            clearTodayReportState();
          }
        }
      }
    }).catch(e => console.warn('[Foreman] GAS fetchDailyReports error:', e));
  }
}

// ==========================================
// Weather & Workforce & UI Helpers
// ==========================================
function renderWeather() {
  document.querySelectorAll('.weather-btn').forEach(btn => {
    if (btn.dataset.type === state.weather.type) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  const rainHoursEl = document.getElementById('rain-hours-val');
  if (rainHoursEl) rainHoursEl.innerText = `${state.weather.rainDelayHours} ชม.`;
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

function renderPhotos() {
  // 1. Update overall photo counter badge
  const totalCount = (state.photos ? state.photos.length : 0) + (state.eveningPhotos ? state.eveningPhotos.length : 0);
  const countEl = document.getElementById('photo-counter');
  if (countEl) countEl.innerText = `รวม ${totalCount} รูป`;

  // 2. Render Left Slot: Morning Photos (รูปเปิดงานเช้า)
  const mCountEl = document.getElementById('morning-photo-count');
  if (mCountEl) mCountEl.innerText = `${state.photos.length} รูป`;
  const mGrid = document.getElementById('morning-photos-preview-grid');
  if (mGrid) {
    if (state.photos.length === 0) {
      mGrid.innerHTML = `
        <div class="slot-empty-hint">
          📷 ยังไม่มีรูปเปิดงานเช้า
        </div>
      `;
    } else {
      mGrid.innerHTML = state.photos.map((p, idx) => `
        <div class="photo-card-equal">
          <img src="${p.url}" alt="รูปเปิดงานเช้า ${idx+1}">
          <div class="photo-stamp">${p.timestamp || '🌅 เปิดงานเช้า'}</div>
          <button type="button" class="btn-remove-photo" onclick="window.removePhoto('morning', ${idx})" title="ลบรูป">&times;</button>
        </div>
      `).join('');
    }
  }

  // 3. Render Right Slot: Evening Photos (รูปปิดงานเย็น)
  const eCountEl = document.getElementById('evening-photo-count');
  if (eCountEl) eCountEl.innerText = `${state.eveningPhotos.length} รูป`;
  const eGrid = document.getElementById('evening-photos-preview-grid');
  if (eGrid) {
    if (state.eveningPhotos.length === 0) {
      eGrid.innerHTML = `
        <div class="slot-empty-hint">
          📸 ยังไม่มีรูปปิดงานเย็น
        </div>
      `;
    } else {
      eGrid.innerHTML = state.eveningPhotos.map((p, idx) => `
        <div class="photo-card-equal">
          <img src="${p.url}" alt="รูปปิดงานเย็น ${idx+1}">
          <div class="photo-stamp">${p.timestamp || '🌆 ปิดงาน'}</div>
          <button type="button" class="btn-remove-photo" onclick="window.removePhoto('evening', ${idx})" title="ลบรูป">&times;</button>
        </div>
      `).join('');
    }
  }
}

window.removePhoto = function(shift, idx) {
  if (shift === 'morning') {
    state.photos.splice(idx, 1);
  } else {
    state.eveningPhotos.splice(idx, 1);
  }
  renderPhotos();
  showToast('ลบรูปภาพแล้ว', 'info');
};

function renderMachinery() {
  const grid = document.getElementById('machinery-chips-grid');
  const counterBadge = document.getElementById('machinery-counter-badge');
  if (counterBadge) counterBadge.innerText = `เลือกแล้ว ${state.machinery.length} เครื่อง`;
  if (!grid) return;

  const defaultMachinery = [
    'รถขุดแบคโห PC200',
    'เครื่องสกัดลมตัดหัวเข็ม',
    'เครื่องสูบน้ำ 4 นิ้ว',
    'รถเครน 25 ตัน',
    'รถโม่คอนกรีต'
  ];

  grid.innerHTML = state.availableMachinery.map(item => {
    const isSelected = state.machinery.includes(item);
    const isCustom = !defaultMachinery.includes(item);
    const escaped = escapeHtml(item);
    return `
      <div class="chip-item ${isSelected ? 'active' : ''}">
        <span onclick="window.toggleMachinery('${escaped}')" style="display:flex;align-items:center;gap:0.3rem;flex:1;cursor:pointer;">
          <span>${isSelected ? '✓' : '🛠️'}</span>
          <span>${escaped}</span>
        </span>
        <span class="chip-remove-btn" onclick="window.removeMachinery('${escaped}')" title="ลบออก">×</span>
      </div>
    `;
  }).join('');
}

window.toggleMachinery = function(item) {
  const idx = state.machinery.indexOf(item);
  if (idx > -1) state.machinery.splice(idx, 1);
  else state.machinery.push(item);
  renderMachinery();
};

window.removeMachinery = function(item) {
  // ลบออกจาก availableMachinery
  const ai = state.availableMachinery.indexOf(item);
  if (ai > -1) state.availableMachinery.splice(ai, 1);
  // ลบออกจากรายการที่เลือกไว้ด้วย
  const mi = state.machinery.indexOf(item);
  if (mi > -1) state.machinery.splice(mi, 1);
  // บันทึกลง localStorage
  try {
    localStorage.setItem('site_custom_machinery', JSON.stringify(state.availableMachinery));
  } catch(e) {}
  renderMachinery();
  showToast(`ลบเครื่องจักร: ${item}`, 'info');
};

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

window.toggleIssue = function(tag) {
  const idx = state.issues.indexOf(tag);
  if (idx > -1) state.issues.splice(idx, 1);
  else state.issues.push(tag);
  renderIssues();
};

// ==========================================
// Event Bindings
// ==========================================
function bindEventHandlers() {
  // Shift switchers
  document.getElementById('tab-morning-shift')?.addEventListener('click', () => switchShift('morning'));
  document.getElementById('tab-evening-shift')?.addEventListener('click', () => switchShift('evening'));

  // Weather buttons
  document.querySelectorAll('.weather-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.weather.type = btn.dataset.type;
      state.weather.text = btn.dataset.text || '☀️ แดดจัด';
      renderWeather();
    });
  });

  // Rain delay stepper
  document.getElementById('btn-rain-minus')?.addEventListener('click', () => {
    state.weather.rainDelayHours = Math.max(0, state.weather.rainDelayHours - 1);
    renderWeather();
  });
  document.getElementById('btn-rain-plus')?.addEventListener('click', () => {
    state.weather.rainDelayHours += 1;
    renderWeather();
  });

  // Workforce +/-
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

  // Add foreman extra reporting task (รายงานเพิ่มเติมของโฟร์แมน)
  document.getElementById('btn-add-unplanned-task')?.addEventListener('click', () => {
    const taskName = prompt('ระบุชื่องานที่ต้องการรายงานเพิ่มเติม (โฟร์แมนรายงานเพิ่มนอกเหนือจากแผน):');
    if (!taskName || !taskName.trim()) return;

    const list = getActiveTasksList();
    list.push({
      id: 'EXTRA-' + Date.now(),
      source_task_id: '',
      from_plan: false,
      company: state.subcontractor.name || '-',
      name: taskName.trim(),
      workArea: 'รายงานเพิ่มเติม',
      description: 'งานรายงานเพิ่มเติมของโฟร์แมน',
      quantity: '',
      progress: 0,
      isPlanned: false
    });

    renderDynamicTasks();
    showToast('➕ เพิ่มงานรายงานเพิ่มเติมของโฟร์แมนแล้ว', 'info');
  });

  // Dual Camera upload: Morning and Evening
  const camTriggerMorning = document.getElementById('camera-trigger-morning');
  const fileInputMorning = document.getElementById('camera-file-input-morning');
  if (camTriggerMorning && fileInputMorning) {
    camTriggerMorning.addEventListener('click', () => fileInputMorning.click());
    fileInputMorning.addEventListener('change', (e) => handleFileUpload('morning', e));
  }

  const camTriggerEvening = document.getElementById('camera-trigger-evening');
  const fileInputEvening = document.getElementById('camera-file-input-evening');
  if (camTriggerEvening && fileInputEvening) {
    camTriggerEvening.addEventListener('click', () => fileInputEvening.click());
    fileInputEvening.addEventListener('change', (e) => handleFileUpload('evening', e));
  }

  // Add custom machinery
  document.getElementById('btn-add-machinery')?.addEventListener('click', () => {
    const input = document.getElementById('input-new-machinery');
    const val = input ? input.value.trim() : '';
    if (!val) return;
    if (!state.availableMachinery.includes(val)) {
      state.availableMachinery.unshift(val);
      try {
        localStorage.setItem('site_custom_machinery', JSON.stringify(state.availableMachinery));
      } catch (e) {}
    }
    if (!state.machinery.includes(val)) state.machinery.push(val);
    if (input) input.value = '';
    renderMachinery();
    showToast(`เพิ่มเครื่องจักร: ${val}`, 'info');
  });

  // Submit Daily Report
  document.getElementById('btn-submit-daily-report')?.addEventListener('click', submitDailyReport);
}

// ==========================================
// Photo Compression & Upload (เช้า vs ปิดงาน)
// ==========================================
function handleFileUpload(shift, e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  const file = files[0];
  const reader = new FileReader();
  reader.onload = (event) => {
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
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const labelShift = shift === 'morning' ? '🌅 เปิดงานเช้า' : '🌆 ปิดงานเย็น';

      const photoObj = {
        id: 'PH-' + Date.now(),
        url: compressedBase64,
        base64: compressedBase64,
        timestamp: `${state.reportDate} ${timeStr} (${labelShift})`
      };

      if (shift === 'morning') {
        state.photos.push(photoObj);
      } else {
        state.eveningPhotos.push(photoObj);
      }

      renderPhotos();
      showToast(`📸 บันทึกภาพถ่าย${labelShift}สำเร็จ`, 'success');
      e.target.value = '';
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// ==========================================
// Cache & Background Sync Helpers
// ==========================================
function saveReportToLocalCache(payload) {
  try {
    const cacheKey = `cpm_cache_reports_${payload.project_id}_${payload.report_date}`;
    let list = [];
    try {
      const stored = localStorage.getItem(cacheKey);
      if (stored) list = JSON.parse(stored) || [];
    } catch(e) {}
    const idx = list.findIndex(r => r.id === payload.id);
    if (idx > -1) {
      list[idx] = { ...list[idx], ...payload };
    } else {
      list.unshift(payload);
    }
    localStorage.setItem(cacheKey, JSON.stringify(list));
  } catch(e) {
    console.warn('[Cache] saveReportToLocalCache error:', e);
  }
}

function enqueueOfflineReport(payload) {
  try {
    const queue = JSON.parse(localStorage.getItem('cpm_offline_reports_queue') || '[]');
    const idx = queue.findIndex(r => r.id === payload.id);
    if (idx > -1) {
      queue[idx] = payload;
    } else {
      queue.push(payload);
    }
    localStorage.setItem('cpm_offline_reports_queue', JSON.stringify(queue));
  } catch(e) {
    console.warn('[OfflineQueue] enqueue error:', e);
  }
}

async function processOfflineReportsQueue() {
  if (!navigator.onLine || !gasService.isConfigured()) return;
  let queue = [];
  try {
    queue = JSON.parse(localStorage.getItem('cpm_offline_reports_queue') || '[]');
  } catch(e) { return; }
  if (!queue || queue.length === 0) return;

  console.log(`[OfflineQueue] Syncing ${queue.length} pending report(s)...`);
  const remaining = [];
  for (const item of queue) {
    try {
      const res = await gasService.sendReport(item);
      if (!res || !res.success) {
        remaining.push(item);
      }
    } catch(err) {
      remaining.push(item);
    }
  }
  localStorage.setItem('cpm_offline_reports_queue', JSON.stringify(remaining));
  if (remaining.length === 0) {
    showBackgroundSyncStatus('success', '☁️ ส่งรายงานที่ค้างในระบบเข้า Google Sheets ครบถ้วนแล้ว', 3000);
  }
}

let bgSyncTimer = null;
function showBackgroundSyncStatus(status, htmlMsg, autoHideMs = 3500) {
  const pill = document.getElementById('bg-sync-floating-pill');
  if (!pill) return;

  clearTimeout(bgSyncTimer);
  pill.className = `bg-sync-floating-pill ${status}`;
  pill.innerHTML = htmlMsg;
  pill.style.display = 'inline-flex';
  pill.style.opacity = '1';

  if (autoHideMs > 0) {
    bgSyncTimer = setTimeout(() => {
      pill.style.opacity = '0';
      setTimeout(() => {
        if (pill.style.opacity === '0') pill.style.display = 'none';
      }, 300);
    }, autoHideMs);
  }
}

function updateSyncBannerComplete(reportId) {
  const cloudTextM = document.getElementById('cloud-sync-text');
  if (cloudTextM) cloudTextM.innerText = '☁️ ซิงค์ Google Sheets และส่ง LINE สำเร็จแล้ว';
  const cloudTextE = document.getElementById('cloud-sync-text-evening');
  if (cloudTextE) cloudTextE.innerText = '☁️ ซิงค์ Google Sheets และส่ง LINE สำเร็จแล้ว';
}

async function runBackgroundReportSync(payload, shiftLabel, reportId) {
  // 1. Ultra-fast Firebase Firestore sync (<100ms)
  if (firebaseService.isConfigured()) {
    try {
      await firebaseService.saveDailyReport(payload);
      console.log('[BackgroundSync] Firestore saved successfully for', reportId);
    } catch (err) {
      console.warn('[BackgroundSync] Firestore error:', err);
    }
  }

  // 2. Google Apps Script Sync (asynchronous, never blocks foreman UI)
  if (gasService.isConfigured()) {
    try {
      const result = await gasService.sendReport(payload);
      if (result && result.success) {
        console.log('[BackgroundSync] GAS sendReport succeeded for', reportId);
        showBackgroundSyncStatus('success', `☁️ บันทึกลง Google Sheets เรียบร้อยแล้ว (รหัส ${reportId})`, 3500);
        updateSyncBannerComplete(reportId);
      } else {
        console.warn('[BackgroundSync] GAS response not success:', result);
        showBackgroundSyncStatus('warning', `⚠️ บันทึกในระบบแล้ว (${result?.message || 'รอซิงค์ชีต'})`, 4000);
      }
    } catch (err) {
      console.error('[BackgroundSync] GAS network error:', err);
      enqueueOfflineReport(payload);
      showBackgroundSyncStatus('offline', '📦 บันทึกในเครื่องแล้ว (จะส่งชีตอัตโนมัติเมื่อต่อเน็ต)', 4000);
    }
  } else {
    showBackgroundSyncStatus('success', `💾 บันทึกรายงานในระบบแล้ว (รหัส ${reportId})`, 3000);
  }
}

// ==========================================
// Submit Daily Report (Instant Optimistic Commit + Background Sync)
// ==========================================
async function submitDailyReport() {
  const btn = document.getElementById('btn-submit-daily-report');
  const isMorning = state.activeShift === 'morning';
  const shiftCode = isMorning ? 'morning' : 'evening';
  const shiftLabel = isMorning ? 'เปิดงานตอนเช้า' : 'รายงานปิดงาน';

  // ป้องกันการกดย้ำซ้ำซ้อน (Debounce 1.2s)
  if (state._isSubmitting) return;

  // ตรวจสอบกฎเหล็ก: รายงานปิดงานต้องรายงานต่อจากรายงานตอนเช้า
  if (!isMorning && !state.existingMorningReport) {
    alert('⚠️ ยังไม่มีการส่งรายงานเปิดงานตอนเช้าของวันนี้\n\nตามระเบียบงานก่อสร้าง รายงานปิดงานต้องรายงานต่อจากรายงานตอนเช้า กรุณากดไปที่ "เปิดงานตอนเช้า" เพื่อบันทึกเปิดงานก่อนครับ');
    switchShift('morning');
    return;
  }

  const currentTasks = getActiveTasksList();

  if (currentTasks.length === 0) {
    const proceed = confirm('⚠️ วันนี้ไม่มีรายการงานตามแผนที่บันทึก ต้องการส่งรายงานเฉพาะยอดกำลังพลและสภาพอากาศหรือไม่?');
    if (!proceed) return;
  }

  state._isSubmitting = true;
  setTimeout(() => { state._isSubmitting = false; }, 1200);

  const isEditMorning = isMorning && !!state.existingMorningReport;
  const isEditEvening = !isMorning && !!state.existingEveningReport;
  const isEdit = isEditMorning || isEditEvening;

  const customIssues = document.getElementById('custom-issue-text')?.value || '';
  const finalIssues = [...state.issues];
  if (customIssues.trim()) finalIssues.push(customIssues.trim());

  const totalWorkers = Object.values(state.workforce).reduce((a, b) => a + b, 0);
  const now = new Date();

  let reportId = '';
  if (isEditMorning) {
    reportId = state.existingMorningReport.id;
  } else if (!isMorning && state.existingMorningReport) {
    // ในรอบปิดงาน ให้ใช้รหัสรายงานเดิมจากรอบเช้าเพื่อรวมเป็นรายงานประจำวันฉบับสมบูรณ์
    reportId = state.existingMorningReport.id;
  } else if (isEditEvening) {
    reportId = state.existingEveningReport.id;
  } else {
    const reportPrefix = isMorning ? 'MORN' : 'EVEN';
    reportId = `${reportPrefix}-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
  }

  const payload = {
    id: reportId,
    is_edit: isEdit,
    morning_report_id: state.existingMorningReport ? state.existingMorningReport.id : '',
    shift_type: shiftCode,
    shift_label: isMorning ? shiftLabel : 'รายงานประจำวัน (เช้า-จบงานครบถ้วน)',
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
    task_progress: currentTasks.map(t => ({
      ...t,
      planned_quantity: t.planned_quantity || t.quantity || '',
      planned_progress: t.planned_progress !== undefined ? t.planned_progress : (t.progress !== undefined ? t.progress : 0),
      quantity: t.quantity || '',
      progress: t.progress !== undefined ? t.progress : 0
    })),
    photos: isMorning ? state.photos : (state.eveningPhotos.length > 0 ? [...state.photos, ...state.eveningPhotos] : state.photos),
    morning_photos: state.photos,
    evening_photos: state.eveningPhotos,
    photoUrls: (isMorning ? state.photos : [...state.photos, ...state.eveningPhotos]).map(p => p.url).join(','),
    issues: finalIssues,
    totalWorkforce: totalWorkers,
    task_summary: isMorning 
      ? currentTasks.map((t, idx) => `${idx+1}. ${t.name}${!t.from_plan ? ' [รายงานเพิ่มเติม]' : ''} (เป้า: ${t.progress || 0}%)`).join(' | ')
      : currentTasks.map((t, idx) => `${idx+1}. ${t.name}${!t.from_plan ? ' [รายงานเพิ่มเติม]' : ''} (เป้า: ${t.planned_progress || 0}% -> จริง: ${t.progress || 0}%)`).join(' | '),
    status: isMorning ? 'morning_opened' : 'day_completed',
    _bgSyncing: true
  };

  // ==========================================
  // ⚡ 1. OPTIMISTIC INSTANT COMMIT (<50ms)
  // ==========================================
  if (navigator.vibrate) {
    try { navigator.vibrate([60, 40, 60]); } catch(e) {}
  }

  // อัปเดต state ในเครื่องทันที
  if (isMorning) {
    state.existingMorningReport = {
      ...payload,
      id: reportId,
      task_summary: currentTasks.map((t, idx) => `${idx+1}. ${t.name}${!t.from_plan ? ' [รายงานเพิ่มเติม]' : ''} (${t.progress||0}%)`).join(' | ')
    };
  } else {
    state.existingEveningReport = {
      ...payload,
      id: reportId,
      task_summary: currentTasks.map((t, idx) => `${idx+1}. ${t.name}${!t.from_plan ? ' [รายงานเพิ่มเติม]' : ''} (เป้า: ${t.planned_progress||0}% -> จริง: ${t.progress||0}%)`).join(' | ')
    };
    if (state.existingMorningReport) {
      state.existingMorningReport.status = 'day_completed';
      state.existingMorningReport.shift_label = 'รายงานประจำวัน (เช้า-จบงานครบถ้วน)';
    }
  }

  // บันทึกลง Local Cache ทันที (รีเฟรชหน้าก็ไม่หาย)
  saveReportToLocalCache(payload);

  // สลับสถานะ UI บนหน้าจอเป็น "ส่งแล้ว" ทันที ไม่ต้องรอเน็ต
  renderShiftUI();

  // แสดง Toast แจ้งเตือนผู้ใช้ทันที
  const actionWord = isEdit ? 'อัปเดตการแก้ไข' : 'ส่ง';
  showToast(`✅ ${actionWord}รายงาน${shiftLabel} (รหัส ${reportId}) เรียบร้อยแล้ว!`, 'success');

  // แจ้งเตือนข้ามแท็บและ PM ทันที (Realtime sync)
  broadcastForemanSync('DAILY_REPORT_SUBMITTED', { reportId });

  // แสดงแถบ Floating Sync Pill แจ้งกำลังประมวลผลเบื้องหลัง
  showBackgroundSyncStatus('syncing', '<span class="bg-sync-spinner"></span> กำลังบันทึกข้อมูลเข้า Google Sheets และคลาวด์เบื้องหลัง...', 0);

  // ==========================================
  // ⚡ 2. NON-BLOCKING BACKGROUND WORKER
  // ==========================================
  runBackgroundReportSync(payload, shiftLabel, reportId);
}

// ==========================================
// Project Selector & LIFF
// ==========================================
async function loadProjectsList() {
  try {
    const list = await gasService.fetchProjects();
    if (list && list.length > 0) {
      state.availableProjects = list;
      if (!state.project.id || state.project.id === '-') {
        state.project.id = list[0].id;
        state.project.name = list[0].name;
        localStorage.setItem('site_project_id', list[0].id);
        localStorage.setItem('site_project_name', list[0].name);
      }
      renderProjectInfo();
    }
  } catch (e) {}
}

function renderProjectInfo() {
  const pName = document.getElementById('display-project-name');
  if (pName) pName.innerText = state.project.name || 'แตะเลือกโครงการ';
}

function renderLineProfile() {
  const avatarEl = document.getElementById('line-avatar');
  const nameEl = document.getElementById('line-display-name');
  const uidEl = document.getElementById('line-uid-text');
  const companyEl = document.getElementById('line-company-text');

  if (avatarEl && state.lineUser.avatar) avatarEl.src = state.lineUser.avatar;
  if (nameEl) nameEl.innerText = state.lineUser.name || '-';
  if (uidEl) uidEl.innerText = state.lineUser.uid || '-';
  if (companyEl) companyEl.innerText = state.subcontractor.name || '-';
}

async function syncUserProfileFromGAS() {
  if (!state.lineUser.uid || state.lineUser.uid === '-') return;
  try {
    const u = await gasService.fetchUserProfile(state.lineUser.uid);
    if (u) {
      if (u.displayName && u.displayName !== '-') state.lineUser.name = u.displayName;
      if (u.company && u.company !== '-') state.subcontractor.name = u.company;
      if (u.projectId && u.projectId !== '-') {
        state.project.id = u.projectId;
        state.project.name = u.projectName;
      }
      renderLineProfile();
      renderProjectInfo();
    }
  } catch (e) {}
}

async function initLiff() {
  if (typeof liff !== 'undefined' && state.lineUser.liffId) {
    try {
      await liff.init({ liffId: state.lineUser.liffId });
      if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        state.lineUser.uid = profile.userId;
        state.lineUser.name = profile.displayName;
        if (profile.pictureUrl) state.lineUser.avatar = profile.pictureUrl;
      }
    } catch (e) {}
  }
}

function setupModals() {
  const modal = document.getElementById('modal-project-selector');
  const btnOpen = document.getElementById('project-pill');
  const btnClose = document.getElementById('btn-close-project-modal');

  if (btnOpen && modal) {
    btnOpen.addEventListener('click', () => {
      modal.classList.add('active');
      renderProjectsModalList();
    });
  }
  if (btnClose && modal) {
    btnClose.addEventListener('click', () => modal.classList.remove('active'));
  }

  document.getElementById('btn-sync-profile')?.addEventListener('click', async () => {
    showToast('🔄 กำลังล้างแคชและซิงก์ข้อมูลสดจากฐานข้อมูล...', 'info');
    
    // ล้างแคชใน LocalStorage ทั้งหมดที่เกี่ยวกับรายงานและรายการงาน
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('cpm_cache_') || key.startsWith('site_morning_plan_') || key.startsWith('cpm_site_reports_history') || key.startsWith('cpm_offline_reports_queue'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    clearTodayReportState();
    applyApprovedTasks([]);

    await syncUserProfileFromGAS();
    await loadApprovedTasksForToday();
    await checkExistingReportForToday();
    showToast('✨ ล้างแคชหน้าจอและซิงก์ข้อมูลสดเรียบร้อยแล้ว', 'success');
  });
}

window.clearSiteCache = function() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('cpm_cache_') || key.startsWith('site_morning_plan_') || key.startsWith('cpm_site_reports_history') || key.startsWith('cpm_offline_reports_queue') || key.startsWith('draft_mplan_') || key.startsWith('wplan_draft_'))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
  clearTodayReportState();
  applyApprovedTasks([]);
  showToast('🧹 ล้างแคชในเครื่องทั้งหมดเรียบร้อยแล้ว', 'success');
  setTimeout(() => window.location.reload(), 400);
};

function renderProjectsModalList() {
  const container = document.getElementById('projects-list-container');
  if (!container) return;

  if (!state.availableProjects || state.availableProjects.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:1rem;">ไม่พบโครงการ</div>';
    return;
  }

  container.innerHTML = state.availableProjects.map(p => `
    <div class="project-card-item ${p.id === state.project.id ? 'selected' : ''}" onclick="window.selectProject('${p.id}', '${escapeHtml(p.name)}')">
      <div class="project-card-title">${escapeHtml(p.name)}</div>
      <div class="project-card-meta">${p.id}</div>
    </div>
  `).join('');
}

window.selectProject = function(id, name) {
  state.project.id = id;
  state.project.name = name;
  localStorage.setItem('site_project_id', id);
  localStorage.setItem('site_project_name', name);
  renderProjectInfo();
  document.getElementById('modal-project-selector')?.classList.remove('active');
  showToast(`สลับโครงการเป็น: ${name}`, 'info');
  loadApprovedTasksForToday();
};

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
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

// ==========================================
// Real-Time Cross-Window & Background Sync
// ==========================================
function broadcastForemanSync(type, details = {}) {
  // 1. Firebase Firestore Real-Time Broadcast (<100ms cross-device)
  if (firebaseService.isConfigured()) {
    firebaseService.broadcastEvent(type, {
      projectId: state.project.id,
      ...details
    }).catch(e => console.warn('[ForemanLiveSync] Firebase broadcast error:', e));
  }

  // 2. Local BroadcastChannel
  try {
    const channel = new BroadcastChannel('cpm_site_sync');
    channel.postMessage({
      type: type,
      projectId: state.project.id,
      timestamp: Date.now(),
      ...details
    });
    channel.close();
  } catch (e) {}

  // 3. LocalStorage trigger
  try {
    localStorage.setItem('cpm_sync_trigger', JSON.stringify({
      type: type,
      projectId: state.project.id,
      time: Date.now(),
      ...details
    }));
  } catch (e) {}
}

function setupForemanRealtimeSync() {
  // 1. Firebase Real-Time Firestore Listeners (cross-device: mobile <-> desktop)
  if (firebaseService.isConfigured() && state.project.id && state.project.id !== '-') {
    // A. Listen for Daily Reports collection changes (including deletions/clears in real-time)
    firebaseService.listenDailyReports(state.project.id, (reportsList) => {
      console.log('[ForemanLiveSync] Daily reports real-time snapshot:', reportsList?.length || 0);
      applyExistingReports(reportsList || []);
    });

    // B. Listen for Approved Tasks changes in real-time
    firebaseService.listenApprovedTasks(state.reportDate, state.project.id, (tasks) => {
      console.log('[ForemanLiveSync] Approved tasks real-time snapshot:', tasks?.length || 0);
      const mySub = state.subcontractor.name;
      const filtered = (Array.isArray(tasks) && mySub && mySub !== '-') 
        ? tasks.filter(t => !t.company || t.company === '-' || t.company.includes(mySub) || mySub.includes(t.company))
        : (tasks || []);
      applyApprovedTasks(filtered);
    });

    // C. Listen for broadcast events
    firebaseService.listenEvents(async (type, payload) => {
      if (type === 'PLAN_APPROVED' || type === 'PLAN_SUBMITTED' || type === 'REFRESH_ALL' || type === 'DATABASE_CLEARED') {
        console.log('[ForemanLiveSync] Firebase realtime event received:', type, payload);
        if (type === 'DATABASE_CLEARED') {
          clearTodayReportState();
          applyApprovedTasks([]);
        } else {
          await loadApprovedTasksForToday();
          await checkExistingReportForToday();
        }
      }
    });
  }

  // 2. BroadcastChannel: local tab sync
  try {
    const channel = new BroadcastChannel('cpm_site_sync');
    channel.onmessage = async (event) => {
      const data = event.data;
      if (data && (data.type === 'PLAN_APPROVED' || data.type === 'PLAN_SUBMITTED' || data.type === 'REFRESH_ALL')) {
        console.log('[ForemanLiveSync] Broadcast received:', data.type);
        await loadApprovedTasksForToday();
        showToast('⚡ มีการอัปเดตสถานะแผนงานจาก PM! ปรับปรุงรายการงานให้อัตโนมัติ', 'info');
      }
    };
  } catch (e) {
    console.warn('[ForemanLiveSync] BroadcastChannel error:', e);
  }

  // 3. Storage listener fallback
  window.addEventListener('storage', async (e) => {
    if (e.key === 'cpm_sync_trigger' && e.newValue) {
      try {
        const data = JSON.parse(e.newValue);
        if (data.type === 'PLAN_APPROVED' || data.type === 'PLAN_SUBMITTED') {
          await loadApprovedTasksForToday();
        }
      } catch(err) {}
    }
  });

  // 4. Background auto-polling every 15s to keep approved tasks up-to-date
  setInterval(async () => {
    if (!document.hidden) {
      await loadApprovedTasksForToday();
    }
  }, 15000);

  // 5. Auto retry pending offline reports queue
  window.addEventListener('online', () => {
    processOfflineReportsQueue();
  });
  setInterval(() => {
    processOfflineReportsQueue();
  }, 60000);
  processOfflineReportsQueue();
}

