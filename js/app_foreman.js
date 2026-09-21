/**
 * app_foreman.js - Foreman Daily Report Controller (LV1 - Mobile-First)
 * กฎเหล็ก: รายการงานในแต่ละวัน "ต้องมาจากแผนงานที่หัวหน้าผู้รับเหมาสร้างและ PM อนุมัติล่วงหน้ามาแล้วเท่านั้น"
 */

import { gasService } from './gas_service.js';

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
  photos: [],
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
document.addEventListener('DOMContentLoaded', async () => {
  parseUrlParams();
  initDateDisplay();
  renderProjectInfo();
  await initLiff();
  await syncUserProfileFromGAS();
  await loadProjectsList();
  renderLineProfile();
  renderShiftUI();
  renderWeather();
  renderWorkforce();
  renderPhotos();
  renderMachinery();
  renderIssues();
  bindEventHandlers();
  setupModals();

  // โหลดงานย่อยที่ PM อนุมัติล่วงหน้าสำหรับวันนี้
  await loadApprovedTasksForToday();
  setupForemanRealtimeSync();
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
  const dayOfWeek = today.getDay();
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
      <div class="date-item ${isToday ? 'active' : ''}" data-date="${dateStr}">
        <span class="day-name">${dayName}</span>
        <span class="day-number">${dayNum}</span>
      </div>
    `;
  }

  container.innerHTML = html;

  // เปลี่ยนวันที่รายงาน
  container.querySelectorAll('.date-item').forEach(el => {
    el.addEventListener('click', async () => {
      container.querySelectorAll('.date-item').forEach(d => d.classList.remove('active'));
      el.classList.add('active');
      const chosenDate = el.getAttribute('data-date');
      state.reportDate = chosenDate;

      const [y, m, d] = chosenDate.split('-');
      const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      const dateEl = document.getElementById('display-report-date');
      if (dateEl) {
        dateEl.innerText = `${parseInt(d, 10)} ${thMonths[parseInt(m, 10)-1]} ${y}`;
      }

      showToast(`📅 เปลี่ยนวันที่: ${chosenDate}`, 'info');
      await loadApprovedTasksForToday();
    });
  });
}

// ==========================================
// Core: Load Approved Tasks for Today
// (ดึงงานที่หัวหน้าผู้รับเหมาสร้าง และ PM อนุมัติล่วงหน้าแล้วเท่านั้น)
// ==========================================
async function loadApprovedTasksForToday() {
  const banner = document.getElementById('plan-source-status-banner');
  const tasksContainer = document.getElementById('dynamic-tasks-container');

  if (tasksContainer) {
    tasksContainer.innerHTML = `
      <div style="text-align: center; padding: 2rem 0; color: var(--text-muted); font-size: 0.8rem;">
        ⏳ กำลังตรวจสอบแผนงานที่ได้รับอนุมัติจาก PM...
      </div>
    `;
  }

  try {
    const approved = await gasService.fetchApprovedTasksForDate(
      state.reportDate,
      state.subcontractor.name,
      state.project.id
    );
    state.approvedTasksToday = approved || [];

    if (state.approvedTasksToday.length > 0) {
      // มีงานที่ PM อนุมัติไว้ล่วงหน้า ➔ บรรจุเข้าตารางงานเช้าอัตโนมัติ
      state.morningPlannedTasks = state.approvedTasksToday.map((at, idx) => ({
        id: 'TASK-' + Date.now() + '-' + idx,
        source_task_id: at.taskId,
        from_plan: true,
        company: at.company || state.subcontractor.name || '-',
        name: at.name || at.taskName || at.category || 'งานตามแผน',
        category: at.category || 'ทั่วไป',
        workArea: at.workArea || at.work_area || '',
        description: at.description || at.taskDesc || '',
        quantity: at.quantity || at.targetQty || '',
        plannedWorkers: at.plannedWorkers || 0,
        progress: 0,
        isPlanned: true
      }));

      // ถ้าสลับมาดูช่วงเย็น ให้ล้าง baseline ใหม่ตามแผนเช้า
      state.eveningActualTasks = [];

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
      // ไม่มีงานที่ PM อนุมัติสำหรับวันนี้
      state.morningPlannedTasks = [];
      state.eveningActualTasks = [];

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
  } catch (err) {
    console.warn('loadApprovedTasksForToday error:', err);
    state.morningPlannedTasks = [];
  }

  renderDynamicTasks();
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

  container.innerHTML = tasks.map((t, idx) => `
    <div class="dynamic-task-card ${isMorning ? 'plan-card' : 'actual-card'}" data-task-id="${t.id}">
      <div class="dynamic-task-top">
        <div class="task-tag-group">
          <span class="task-index-badge">งานที่ ${idx + 1}</span>
          <span class="shift-phase-badge ${isMorning ? 'plan' : 'actual'}">
            ${isMorning ? '🎯 คาดการณ์' : '⚡ ผลงานจริง'}
          </span>
          ${t.from_plan ? `
            <span class="task-plan-badge" style="background:#ecfdf5; color:#065f46; border:1px solid #10b981; font-size:0.68rem; font-weight:700; padding:2px 6px; border-radius:4px;">
              🎯 ตามแผน: ${escapeHtml(t.company || 'สัปดาห์')}
            </span>
          ` : `
            <span class="task-plan-badge" style="background:#fffbeb; color:#b45309; border:1px solid #f59e0b; font-size:0.68rem; font-weight:700; padding:2px 6px; border-radius:4px;">
              ⚡ นอกแผน
            </span>
          `}
        </div>
        ${!t.from_plan ? `
          <button type="button" class="btn-delete-task" onclick="window.removeDynamicTask('${t.id}')">
            🗑️ ลบ
          </button>
        ` : ''}
      </div>

      <!-- Task Title & Area -->
      <div style="margin-bottom: 0.4rem;">
        <label style="font-size: 0.7rem; color: var(--text-muted); display: block; margin-bottom: 2px;">ชื่องานตามแผน:</label>
        <div style="font-size: 0.88rem; font-weight: 800; color: var(--text-heading);">${escapeHtml(t.name)}</div>
        ${t.workArea ? `<div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 2px;">📍 โซนพื้นที่: <strong>${escapeHtml(t.workArea)}</strong></div>` : ''}
      </div>

      <!-- Description -->
      ${t.description ? `
        <div style="font-size: 0.74rem; color: var(--text-main); background: #f8fafc; padding: 4px 8px; border-radius: 4px; margin-bottom: 0.5rem; border: 1px solid var(--border-subtle);">
          📝 ${escapeHtml(t.description)}
        </div>
      ` : ''}

      <!-- Target vs Actual Metrics -->
      <div class="task-metrics-grid">
        <div>
          <label style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px; display: block;">
            ${isMorning ? 'เป้าหมายปริมาณงาน:' : 'ปริมาณงานจริงที่ทำได้:'}
          </label>
          <input 
            type="text" 
            class="form-input" 
            style="font-size: 0.78rem;" 
            value="${escapeHtml(t.quantity || '')}" 
            placeholder="เช่น 8 ต้น, 35 ตร.ม." 
            oninput="window.updateTaskField('${t.id}', 'quantity', this.value)"
          >
        </div>

        <div>
          <label style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px; display: block;">
            ${isMorning ? 'เป้าหมายความคืบหน้า (%):' : 'ผลงานจริงสะสม (%):'}
          </label>
          <div class="progress-control-block">
            <div class="progress-input-wrapper">
              <input 
                type="number" 
                class="form-input progress-num-input" 
                min="0" 
                max="100" 
                inputmode="numeric"
                value="${t.progress !== undefined ? t.progress : 0}" 
                placeholder="0" 
                onfocus="this.select()"
                oninput="window.updateTaskField('${t.id}', 'progress', this.value, this)"
              >
              <span class="progress-unit-badge">%</span>
            </div>
            <div class="progress-pills-row">
              ${[25, 50, 75, 100].map(pct => `
                <button 
                  type="button" 
                  data-pct="${pct}" 
                  class="pill-pct ${isMorning ? 'morning' : ''} ${Number(t.progress) === pct ? 'active' : ''}" 
                  onclick="window.updateTaskProgress('${t.id}', ${pct})"
                >
                  ${pct}%
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `).join('');
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
    showToast('ลบงานนอกแผนแล้ว', 'info');
  }
};

// ==========================================
// Shift Switcher (เช้า <-> จบงาน)
// ==========================================
function switchShift(shift) {
  if (state.activeShift === shift) return;
  state.activeShift = shift;

  if (shift === 'evening') {
    // ดึงงานที่เปิดไว้ช่วงเช้ามาเป็น Baseline ในช่วงเย็น
    if (state.eveningActualTasks.length === 0) {
      state.eveningActualTasks = state.morningPlannedTasks.map(t => ({
        ...t,
        id: 'ACT-' + t.id,
        source_task_id: t.source_task_id || '',
        from_plan: !!t.from_plan,
        company: t.company || '',
        planned_quantity: t.quantity,
        progress: t.progress !== undefined ? t.progress : 0,
        isPlanned: false
      }));
    }
    showToast('🌆 สลับสู่โหมด: รายงานสรุปจบงานประจำวัน', 'info');
  } else {
    showToast('🌅 สลับสู่โหมด: เปิดงานตอนเช้า', 'info');
  }

  renderShiftUI();
}

function renderShiftUI() {
  const isMorning = state.activeShift === 'morning';
  const tabMorning = document.getElementById('tab-morning-shift');
  const tabEvening = document.getElementById('tab-evening-shift');
  const topBadge = document.getElementById('shift-badge-top');
  const rainHoursBox = document.getElementById('rain-hours-box');
  const submitBtn = document.getElementById('btn-submit-daily-report');
  const submitText = document.getElementById('btn-submit-text');

  if (tabMorning && tabEvening) {
    if (isMorning) {
      tabMorning.classList.add('active');
      tabEvening.classList.remove('active');
      if (topBadge) {
        topBadge.className = 'header-badge';
        topBadge.innerText = '🌅 รอบเช้า';
      }
      if (rainHoursBox) rainHoursBox.style.display = 'none';
      if (submitBtn) {
        submitBtn.className = 'btn-submit-report morning';
        submitText.innerText = 'ส่งรายงานเปิดงานตอนเช้า';
      }
    } else {
      tabMorning.classList.remove('active');
      tabEvening.classList.add('active');
      if (topBadge) {
        topBadge.className = 'header-badge evening';
        topBadge.innerText = '🌆 รอบเย็น';
      }
      if (rainHoursBox) rainHoursBox.style.display = 'flex';
      if (submitBtn) {
        submitBtn.className = 'btn-submit-report evening';
        submitText.innerText = 'ส่งรายงานสรุปจบงานประจำวัน';
      }
    }
  }

  renderDynamicTasks();
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
  const countEl = document.getElementById('photo-counter');
  if (countEl) countEl.innerText = `${state.photos.length} รูป`;

  const gridEl = document.getElementById('photos-preview-grid');
  if (!gridEl) return;

  gridEl.innerHTML = state.photos.map((p, idx) => `
    <div class="photo-card">
      <img src="${p.url}" alt="รูปหน้างาน">
      <div class="photo-stamp">${p.timestamp || ''}</div>
      <button type="button" class="btn-remove-photo" onclick="window.removePhoto(${idx})">&times;</button>
    </div>
  `).join('');
}

window.removePhoto = function(idx) {
  state.photos.splice(idx, 1);
  renderPhotos();
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

  // Fallback: Add unplanned task
  document.getElementById('btn-add-unplanned-task')?.addEventListener('click', () => {
    const taskName = prompt('ระบุชื่องานฉุกเฉินนอกแผน:');
    if (!taskName || !taskName.trim()) return;

    const list = getActiveTasksList();
    list.push({
      id: 'UNPLAN-' + Date.now(),
      source_task_id: '',
      from_plan: false,
      company: state.subcontractor.name || '-',
      name: taskName.trim(),
      workArea: 'นอกแผน',
      description: 'งานฉุกเฉินเพิ่มเติม',
      quantity: '',
      progress: 0,
      isPlanned: false
    });

    renderDynamicTasks();
    showToast('เพิ่มงานฉุกเฉินนอกแผนแล้ว', 'info');
  });

  // Camera upload
  const camTrigger = document.getElementById('camera-trigger-btn');
  const fileInput = document.getElementById('camera-file-input');
  if (camTrigger && fileInput) {
    camTrigger.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);
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
// Photo Compression & Upload
// ==========================================
function handleFileUpload(e) {
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

      state.photos.unshift({
        id: 'PH-' + Date.now(),
        url: compressedBase64,
        base64: compressedBase64,
        timestamp: `${state.reportDate} ${timeStr}`
      });

      renderPhotos();
      showToast('📸 ถ่ายรูปและประทับเวลาสำเร็จ', 'success');
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// ==========================================
// Submit Daily Report (Closed-Loop Sync)
// ==========================================
async function submitDailyReport() {
  const btn = document.getElementById('btn-submit-daily-report');
  const isMorning = state.activeShift === 'morning';
  const shiftCode = isMorning ? 'morning' : 'evening';
  const shiftLabel = isMorning ? 'เปิดงานตอนเช้า' : 'รายงานจบงาน';

  const currentTasks = getActiveTasksList();

  if (currentTasks.length === 0) {
    const proceed = confirm('⚠️ วันนี้ไม่มีรายการงานตามแผนที่บันทึก ต้องการส่งรายงานเฉพาะยอดกำลังพลและสภาพอากาศหรือไม่?');
    if (!proceed) return;
  }

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
  const reportId = `${reportPrefix}-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;

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

  let result = null;
  if (gasService.isConfigured()) {
    result = await gasService.sendReport(payload);
  }

  if (btn) {
    btn.disabled = false;
    renderShiftUI();
  }

  if (result && result.success) {
    showToast(`✅ บันทึกรายงาน ${shiftLabel} (รหัส ${reportId}) ลง Google Sheets สำเร็จ!`, 'success');
    broadcastForemanSync('DAILY_REPORT_SUBMITTED', { reportId });
  } else {
    showToast(`⚠️ ส่งข้อมูลแล้ว: ${result?.message || 'โปรดตรวจสอบ'}`, 'info');
    broadcastForemanSync('DAILY_REPORT_SUBMITTED', { reportId });
  }
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
    await syncUserProfileFromGAS();
    await loadApprovedTasksForToday();
    showToast('ซิงก์ข้อมูลสำเร็จ', 'success');
  });
}

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
  // Listen for PM approval or plan update to reload approved tasks automatically
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

  // Storage listener fallback
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

  // Background auto-polling every 15s to keep approved tasks up-to-date
  setInterval(async () => {
    if (!document.hidden) {
      await loadApprovedTasksForToday();
    }
  }, 15000);
}

