/**
 * app_weekly.js - Subcontractor Monthly Lookahead Planning & Interactive Gantt Controller (LV2 - Desktop)
 * หน้าจอสำหรับหัวหน้าผู้รับเหมา:
 * - แผนงานต้องเป็นของ "บริษัทของผู้ใช้งานเท่านั้น" ดึงตรงจากฐานข้อมูล Users_Master / Site_Users
 * - วางแผนงานเป็นรายเดือน (28 - 31 วันตามปฏิทินจริง) มีแถบเลื่อนสลับเดือน
 * - ลากแถบกราฟ Gantt และปรับขอบซ้าย/ขวาเพื่อกำหนดช่วงเวลาตลอดทั้งเดือน
 * - แตกงานย่อย (Subtasks) ใต้แต่ละงานหลัก โดยงานย่อย "ไม่ต้องลงวันที่ จะเป็นไปตามที่โฟร์แมนทำได้จริงหน้างาน"
 * - ยื่นส่งแผนงานประจำเดือนให้ PM อนุมัติล่วงหน้า
 */

import { gasService } from './gas_service.js';
import { firebaseService } from './firebase_service.js';

// ==========================================
// App State
// ==========================================
const state = {
  project: {
    id: localStorage.getItem('site_project_id') || '-',
    name: localStorage.getItem('site_project_name') || '-'
  },
  availableProjects: [],
  subcontractor: {
    id: localStorage.getItem('site_sub_id') || '-',
    name: localStorage.getItem('site_sub_name') || '-'
  },
  user: {
    uid: localStorage.getItem('site_line_uid') || '-',
    name: localStorage.getItem('site_line_name') || 'หัวหน้าผู้รับเหมา',
    avatar: localStorage.getItem('site_line_avatar') || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80'
  },
  activeView: 'gantt', // 'gantt' | 'archive'

  // Monthly Timeline Info
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(), // 0-11
  monthInfo: null, // { year, month, daysInMonth, startIso, endIso, monthNameThai, yearThai, label, days: [...] }

  // Current Month Plan Data
  currentPlan: null,
  mainTasks: [],
  monthObjective: '',
  planStatus: 'Draft', // 'Draft' | 'Pending' | 'Approved' | 'Revision'
  pmNotes: '',

  // Historical Plans for this company
  monthlyPlans: [],
  archiveFilter: 'all',

  // UI Helpers
  editingTaskId: null,
  modalSubtasksTemp: [],
  expandedTasks: new Set(),
  isDirty: false
};

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  parseUrlParams();
  renderProfile();
  renderProjectInfo();

  // 1. Sync User Profile from backend to resolve registered Company & Project
  await syncUserProfile();

  // 2. Initialize Month Timeline (Default to current month)
  calculateMonthInfo(state.currentYear, state.currentMonth);
  renderMonthInfoUI();

  // 3. Load Projects and Company Plans
  await loadProjects();
  await loadWeeklyPlans();

  // 4. Bind UI Event Handlers
  bindNavigationEvents();
  bindToolbarActions();
  bindModalEvents();
  setupViewTabs();
  setupExitConfirmation();
  setupWeeklyRealtimeSync();
});

// ==========================================
// Profile & User Company Resolution (Strict LV2 Scoping)
// ==========================================
function parseUrlParams() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const uid = urlParams.get('uid');
    const name = urlParams.get('name');
    const company = urlParams.get('company');
    const prj = urlParams.get('prj') || urlParams.get('projectId');
    const prjName = urlParams.get('prjName') || urlParams.get('projectName');

    if (uid) {
      state.user.uid = uid;
      localStorage.setItem('site_line_uid', uid);
    }
    if (name) {
      state.user.name = decodeURIComponent(name);
      localStorage.setItem('site_line_name', state.user.name);
    }
    if (company) {
      state.subcontractor.name = decodeURIComponent(company);
      localStorage.setItem('site_sub_name', state.subcontractor.name);
    }
    if (prj) {
      state.project.id = decodeURIComponent(prj);
      localStorage.setItem('site_project_id', state.project.id);
    }
    if (prjName) {
      state.project.name = decodeURIComponent(prjName);
      localStorage.setItem('site_project_name', state.project.name);
    }
  } catch (e) {
    console.warn('parseUrlParams error:', e);
  }
}

async function syncUserProfile() {
  if (!state.user.uid || state.user.uid === '-') return;

  try {
    const profile = await gasService.fetchUserProfile(state.user.uid);
    if (profile) {
      if (profile.displayName || profile.lineName) {
        state.user.name = profile.displayName || profile.lineName;
        localStorage.setItem('site_line_name', state.user.name);
      }
      if (profile.avatar) {
        state.user.avatar = profile.avatar;
        localStorage.setItem('site_line_avatar', profile.avatar);
      }
      if (profile.company && profile.company !== '-') {
        state.subcontractor.name = profile.company;
        localStorage.setItem('site_sub_name', profile.company);
      }
      if (profile.projectId && profile.projectId !== '-' && (!state.project.id || state.project.id === '-')) {
        state.project.id = profile.projectId;
        state.project.name = profile.projectName || profile.projectId;
        localStorage.setItem('site_project_id', state.project.id);
        localStorage.setItem('site_project_name', state.project.name);
      }
      renderProfile();
      renderProjectInfo();
    }
  } catch (err) {
    console.warn('syncUserProfile error:', err);
  }
}

function renderProfile() {
  const nameEl = document.getElementById('sub-user-name');
  const compEl = document.getElementById('sub-company-name');
  const avatarEl = document.getElementById('sub-avatar');

  if (nameEl) nameEl.innerText = state.user.name !== '-' ? state.user.name : 'หัวหน้าผู้รับเหมา';
  if (compEl) {
    const compName = state.subcontractor.name;
    if (compName && compName !== '-') {
      compEl.innerText = compName;
    } else {
      compEl.innerText = 'หจก. ผู้รับเหมาประจำระบบ';
    }
  }
  if (avatarEl && state.user.avatar) avatarEl.src = state.user.avatar;
}

function renderProjectInfo() {
  const pName = document.getElementById('display-project-name');
  if (pName) pName.innerText = state.project.name || 'แตะเลือกโครงการ';
}

async function loadProjects() {
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

// ==========================================
// Monthly Calculation & Stepper
// ==========================================
function calculateMonthInfo(year, month) {
  state.currentYear = year;
  state.currentMonth = month;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toIsoDate(today);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNamesThai = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const monthNamesThaiShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const dayNamesShort = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const dayInitials = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(year, month, d);
    const dayOfWeek = curDate.getDay();
    const iso = toIsoDate(curDate);

    days.push({
      dateNumber: d,
      dayIndex: d - 1, // 0-indexed: 0 .. daysInMonth - 1
      date: curDate,
      iso: iso,
      dayOfWeek: dayOfWeek,
      dayNameShort: dayNamesShort[dayOfWeek],
      dayInitial: dayInitials[dayOfWeek],
      monthShort: monthNamesThaiShort[month],
      isToday: (iso === todayIso),
      isWeekend: (dayOfWeek === 0 || dayOfWeek === 6)
    });
  }

  const startIso = days[0].iso;
  const endIso = days[daysInMonth - 1].iso;
  const monthNameThai = monthNamesThai[month];
  const yearThai = year + 543;

  state.monthInfo = {
    year: year,
    month: month,
    daysInMonth: daysInMonth,
    startIso: startIso,
    endIso: endIso,
    monthNameThai: monthNameThai,
    yearThai: yearThai,
    label: `แผนงานประจำเดือน ${monthNameThai} ${yearThai}`,
    rangeText: `1 - ${daysInMonth} ${monthNamesThaiShort[month]} ${yearThai}`,
    days: days
  };

  // Set CSS custom property dynamically for timeline grid
  document.documentElement.style.setProperty('--timeline-days', daysInMonth);

  syncCurrentMonthPlan();
}

function toIsoDate(d) {
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const date = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${date}`;
}

function renderMonthInfoUI() {
  const rangeEl = document.getElementById('display-month-range') || document.getElementById('display-week-range');
  const labelEl = document.getElementById('display-month-label') || document.getElementById('display-week-label');
  if (!state.monthInfo) return;

  if (rangeEl) {
    rangeEl.innerText = state.monthInfo.rangeText;
  }
  if (labelEl) {
    const now = new Date();
    const isThisMonth = (state.currentYear === now.getFullYear() && state.currentMonth === now.getMonth());
    labelEl.innerText = isThisMonth 
      ? `🌟 ${state.monthInfo.monthNameThai} ${state.monthInfo.yearThai} (เดือนนี้ • ${state.monthInfo.daysInMonth} วัน)` 
      : `📅 ${state.monthInfo.monthNameThai} ${state.monthInfo.yearThai} (${state.monthInfo.daysInMonth} วัน)`;
  }

  renderGanttDaysHeader();
}

function renderGanttDaysHeader() {
  const container = document.getElementById('gantt-days-header');
  if (!container || !state.monthInfo) return;

  container.innerHTML = state.monthInfo.days.map(d => `
    <div class="gantt-day-th ${d.isWeekend ? 'weekend' : ''} ${d.isToday ? 'today' : ''}" data-day-index="${d.dayIndex}" title="วันที่ ${d.dateNumber} ${d.monthShort} (${d.dayNameShort})">
      <span class="th-day-name">${d.dayInitial}</span>
      <span class="th-day-num">${d.dateNumber}</span>
      ${d.isToday ? '<span class="badge-today-indicator">วันนี้</span>' : ''}
    </div>
  `).join('');
}

// ==========================================
// Sync Plan for the Active Month
// ==========================================
function syncCurrentMonthPlan() {
  if (!state.monthInfo) return;

  const mStart = state.monthInfo.startIso;
  const mEnd = state.monthInfo.endIso;

  // Search if a plan already exists in loaded plans from GAS for this company
  const existingPlan = (state.monthlyPlans || []).find(p => {
    const s = p.startDate || '';
    const e = p.endDate || s;
    return (s <= mEnd && e >= mStart);
  });

  if (existingPlan) {
    state.currentPlan = existingPlan;
    state.planStatus = existingPlan.status || existingPlan.pmStatus || 'Pending';
    state.monthObjective = existingPlan.objective || '';
    state.pmNotes = existingPlan.pmNotes || existingPlan.pmComment || '';
    loadTasksForPlan(existingPlan.planId);
  } else {
    // Check local draft
    const draftKey = `draft_mplan_${state.project.id}_${state.monthInfo.year}_${state.monthInfo.month}_${state.subcontractor.name}`;
    const savedDraft = localStorage.getItem(draftKey);

    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        // Discard any old mock sample tasks
        const hasMockTasks = (parsed.mainTasks || []).some(m => m.name && (m.name.includes('ตัดหัวเข็ม') || m.name.includes('เข้าแบบและผูกเหล็ก')));
        if (hasMockTasks) {
          localStorage.removeItem(draftKey);
          initDefaultPlan();
        } else {
          state.currentPlan = null;
          state.planStatus = 'Draft';
          state.monthObjective = parsed.objective || '';
          state.mainTasks = parsed.mainTasks || [];
          state.pmNotes = '';
        }
      } catch (e) {
        initDefaultPlan();
      }
    } else {
      initDefaultPlan();
    }
  }

  renderPlanMetaUI();
  renderGanttTable();
  updateKPISummary();
}

function initDefaultPlan() {
  state.currentPlan = null;
  state.planStatus = 'Draft';
  state.monthObjective = '';
  state.pmNotes = '';
  state.mainTasks = [];
  state.expandedTasks.clear();
}

async function loadTasksForPlan(planId) {
  try {
    const tasks = await gasService.fetchDailyTasks(planId);
    if (tasks && tasks.length > 0) {
      const grouped = {};
      const totalDays = state.monthInfo.daysInMonth;
      const days = state.monthInfo.days;

      tasks.forEach((t, idx) => {
        const cat = t.category || 'งานโครงสร้าง';

        // Determine parent task name:
        let groupKey = '';
        if (t.parent_task_name) {
          groupKey = t.parent_task_name;
        } else if (t.description && t.description.includes('[งานหลัก:')) {
          const matchMain = t.description.match(/\[งานหลัก:\s*([^\]]+)\]/);
          if (matchMain) groupKey = matchMain[1].trim();
        } else if (t.description && t.description.includes(':')) {
          const parts = t.description.split(':');
          if (parts[0].length > 2 && !parts[0].includes('http') && !parts[0].includes('[')) {
            groupKey = parts[0].trim();
          }
        }
        if (!groupKey) {
          groupKey = t.taskName || t.name || cat;
        }

        let sDateStr = state.monthInfo.startIso;
        let eDateStr = state.monthInfo.endIso;

        if (t.description) {
          const match = t.description.match(/\[(\d{4}-\d{2}-\d{2})\s+ถึง\s+(\d{4}-\d{2}-\d{2})\]/);
          if (match) {
            sDateStr = match[1];
            eDateStr = match[2];
          } else if (t.date) {
            sDateStr = t.date;
            eDateStr = t.date;
          }
        } else if (t.date) {
          sDateStr = t.date;
          eDateStr = t.date;
        }

        let workArea = t.workArea || t.work_area || '';
        if (!workArea && t.description && t.description.includes('[โซน:')) {
          const matchZone = t.description.match(/\[โซน:\s*([^\]]+)\]/);
          if (matchZone && matchZone[1] !== '-') workArea = matchZone[1].trim();
        }

        if (!grouped[groupKey]) {
          let sIdx = days.findIndex(d => d.iso === sDateStr);
          let eIdx = days.findIndex(d => d.iso === eDateStr);
          if (sIdx < 0) sIdx = 0;
          if (eIdx < 0) eIdx = Math.min(totalDays - 1, sIdx + 6);
          if (sIdx > eIdx) eIdx = sIdx;

          grouped[groupKey] = {
            id: 'MTASK-' + planId + '-' + Object.keys(grouped).length,
            name: groupKey,
            category: cat,
            categoryColor: getCategoryColorClass(cat),
            workArea: workArea,
            startDayIndex: sIdx,
            endDayIndex: eIdx,
            startDate: days[sIdx].iso,
            endDate: days[eIdx].iso,
            subtasks: []
          };
        }

        const taskName = t.taskName || t.name || '';
        const isSelfMainTask = (taskName === groupKey && (!t.description || (t.description.startsWith('[') && !t.description.includes(': '))));

        if (!isSelfMainTask && taskName) {
          let cleanDesc = t.description || t.taskDesc || '';
          cleanDesc = cleanDesc.replace(/\[\d{4}-\d{2}-\d{2}\s+ถึง\s+\d{4}-\d{2}-\d{2}\]/g, '');
          cleanDesc = cleanDesc.replace(/\[งานหลัก:[^\]]+\]/g, '');
          cleanDesc = cleanDesc.replace(/\[โซน:[^\]]+\]/g, '');
          if (cleanDesc.startsWith(groupKey + ':')) {
            cleanDesc = cleanDesc.slice(groupKey.length + 1).trim();
          }
          cleanDesc = cleanDesc.trim();

          grouped[groupKey].subtasks.push({
            id: t.taskId || ('STASK-' + idx),
            name: taskName,
            workArea: workArea,
            description: cleanDesc,
            targetQty: t.targetQty || t.quantity || '',
            plannedWorkers: Number(t.plannedWorkers) || 0,
            machinery: t.machinery || '-',
            actualStatus: t.actualStatus || (Number(t.progress || t.actualProgress) >= 100 ? 'Completed' : 'Pending'),
            actualProgress: Number(t.progress || t.actualProgress) || 0,
            actualDate: t.taskDate || null,
            reportedBy: t.foremanName || t.reportedBy || null
          });
        }
      });

      state.mainTasks = Object.values(grouped);
      state.mainTasks.forEach(m => state.expandedTasks.add(m.id));
    } else {
      state.mainTasks = [];
    }
    renderGanttTable();
    updateKPISummary();
  } catch (e) {
    console.warn('loadTasksForPlan error:', e);
    state.mainTasks = [];
    renderGanttTable();
    updateKPISummary();
  }
}

function getCategoryColorClass(cat) {
  if (!cat) return 'cat-structure';
  if (cat.includes('ฐานราก') || cat.includes('เข็ม')) return 'cat-foundation';
  if (cat.includes('โครงสร้าง') || cat.includes('คอนกรีต') || cat.includes('เหล็ก')) return 'cat-structure';
  if (cat.includes('สถาปัตย์') || cat.includes('ฉาบ') || cat.includes('ปู')) return 'cat-architecture';
  if (cat.includes('ระบบ') || cat.includes('ไฟฟ้า') || cat.includes('สุขาภิบาล')) return 'cat-mep';
  if (cat.includes('ดิน') || cat.includes('ถม') || cat.includes('ขุด')) return 'cat-earthwork';
  return 'cat-structure';
}

// ==========================================
// UI Rendering: Plan Meta, Directives, KPIs
// ==========================================
function renderPlanMetaUI() {
  const statusContainer = document.getElementById('plan-status-pill-container');
  const objInput = document.getElementById('input-month-objective') || document.getElementById('input-week-objective');
  const pmBox = document.getElementById('pm-directive-box');

  if (objInput) {
    objInput.value = state.monthObjective || '';
  }

  if (statusContainer) {
    const st = state.planStatus;
    let badgeClass = 'draft';
    let badgeText = '📝 ร่างแผนงาน (ยังไม่ได้ยื่น)';

    if (st === 'Approved') {
      badgeClass = 'approved';
      badgeText = '🟢 PM อนุมัติแล้ว (โฟร์แมนดึงงานได้)';
    } else if (st === 'Pending') {
      badgeClass = 'pending';
      badgeText = '🟡 รอ PM พิจารณาอนุมัติ';
    } else if (st === 'Revision') {
      badgeClass = 'revision';
      badgeText = '🔴 PM สั่งปรับปรุงแผนงาน';
    }

    statusContainer.innerHTML = `<span class="gantt-status-pill ${badgeClass}">${badgeText}</span>`;
  }

  if (pmBox) {
    if (state.pmNotes && state.pmNotes !== '-') {
      const isApproved = state.planStatus === 'Approved';
      pmBox.className = `pm-directive-banner ${isApproved ? 'approved' : 'revision'}`;
      pmBox.style.display = 'flex';
      pmBox.innerHTML = `
        <span style="font-size: 1.4rem;">${isApproved ? '👔' : '⚠️'}</span>
        <div>
          <strong style="font-size: 0.88rem;">ข้อสั่งการและคำแนะนำจาก PM:</strong>
          <div style="margin-top: 3px; line-height: 1.4;">${escapeHtml(state.pmNotes)}</div>
          ${state.currentPlan?.approvedAt ? `<div style="font-size: 0.68rem; opacity: 0.8; margin-top: 4px;">อนุมัติเมื่อ: ${state.currentPlan.approvedAt} โดย ${state.currentPlan.pmName || 'PM'}</div>` : ''}
        </div>
      `;
    } else {
      pmBox.style.display = 'none';
    }
  }
}

function updateKPISummary() {
  const mainTasksEl = document.getElementById('kpi-main-tasks');
  const subtasksCountEl = document.getElementById('kpi-subtasks-count');
  const avgWorkersEl = document.getElementById('kpi-avg-workers');
  const machineryCountEl = document.getElementById('kpi-machinery-count');
  const progressEl = document.getElementById('kpi-actual-progress');

  const mainCount = state.mainTasks.length;
  let totalSubtasks = 0;
  let totalWorkers = 0;
  let machinesSet = new Set();
  let progressSum = 0;

  state.mainTasks.forEach(m => {
    (m.subtasks || []).forEach(st => {
      totalSubtasks++;
      totalWorkers += Number(st.plannedWorkers || 0);
      progressSum += Number(st.actualProgress || 0);
      if (st.machinery && st.machinery !== '-') {
        st.machinery.split(',').forEach(item => {
          const trimmed = item.trim();
          if (trimmed) machinesSet.add(trimmed);
        });
      }
    });
  });

  const daysCount = state.monthInfo?.daysInMonth || 30;
  const avgWorkers = Math.round(totalWorkers / Math.max(1, Math.min(daysCount, 30)));
  const avgProgress = totalSubtasks > 0 ? Math.round(progressSum / totalSubtasks) : 0;

  if (mainTasksEl) mainTasksEl.innerText = `${mainCount} รายการ`;
  if (subtasksCountEl) subtasksCountEl.innerText = `${totalSubtasks} งานย่อย`;
  if (avgWorkersEl) avgWorkersEl.innerText = `${avgWorkers} คน/วัน`;
  if (machineryCountEl) machineryCountEl.innerText = `${machinesSet.size} ชนิด`;
  if (progressEl) progressEl.innerText = `${avgProgress}%`;
}

// ==========================================
// RENDER GANTT TABLE (Split Table with Monthly Drag/Drop)
// ==========================================
function renderGanttTable() {
  const tbody = document.getElementById('gantt-table-body');
  if (!tbody || !state.monthInfo) return;

  const totalDays = state.monthInfo.daysInMonth;

  if (state.mainTasks.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2">
          <div class="gantt-empty-state" style="position: sticky; left: 0; max-width: 650px; margin: 0 auto;">
            <div class="empty-icon">📊</div>
            <h3>ยังไม่มีรายการงานหลักในเดือนนี้</h3>
            <p>รายการงานจะดึงจาก Google Sheets เท่านั้น หรือกดปุ่ม "➕ เพิ่มรายการงานหลัก" ด้านบนเพื่อเริ่มกำหนดแผนงาน</p>
            <button type="button" class="btn-gantt-primary" onclick="window.openAddMainTaskModal()" style="margin: 0 auto;">
              ➕ เพิ่มรายการงานหลักใหม่
            </button>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  let html = '';

  state.mainTasks.forEach((m, mIdx) => {
    const isExpanded = state.expandedTasks.has(m.id);
    const subtasks = m.subtasks || [];

    // Ensure valid indices within 0 .. totalDays - 1
    let sIdx = Number(m.startDayIndex);
    let eIdx = Number(m.endDayIndex);
    if (isNaN(sIdx) || sIdx < 0) sIdx = 0;
    if (isNaN(eIdx) || eIdx >= totalDays) eIdx = totalDays - 1;
    if (sIdx > eIdx) eIdx = sIdx;
    m.startDayIndex = sIdx;
    m.endDayIndex = eIdx;

    const durDays = (m.endDayIndex - m.startDayIndex) + 1;
    const sDate = state.monthInfo.days[m.startDayIndex];
    const eDate = state.monthInfo.days[m.endDayIndex];

    const leftPct = (m.startDayIndex * 100) / totalDays;
    const widthPct = (durDays * 100) / totalDays;

    let taskProgressSum = 0;
    subtasks.forEach(st => taskProgressSum += Number(st.actualProgress || 0));
    const taskAvgProgress = subtasks.length > 0 ? Math.round(taskProgressSum / subtasks.length) : 0;

    // 1. MAIN TASK ROW
    html += `
      <tr class="gantt-task-row" data-task-id="${m.id}" data-task-idx="${mIdx}">
        
        <!-- Left Meta Cell (Fixed 360px) -->
        <td class="gantt-meta-cell">
          <div class="task-meta-top">
            <button type="button" class="btn-toggle-task-subtasks" onclick="window.toggleSubtasksExpansion('${m.id}')" title="ย่อ/ขยายงานย่อย">
              ${isExpanded ? '▼' : '▶'}
            </button>
            <div class="task-title-group">
              <span class="task-cat-badge">${escapeHtml(m.category)}</span>
              <div class="task-name-text">${escapeHtml(m.name)}</div>
              ${m.workArea ? `<div class="task-area-text">📍 โซนพื้นที่: <strong>${escapeHtml(m.workArea)}</strong></div>` : ''}
            </div>
          </div>

          <div class="task-meta-bottom">
            <div style="display: flex; gap: 6px; align-items: center;">
              <span class="task-date-pill">
                ${sDate.dateNumber} - ${eDate.dateNumber} ${sDate.monthShort} (${durDays} วัน)
              </span>
              <span class="task-subtasks-count-pill" onclick="window.toggleSubtasksExpansion('${m.id}')">
                ⚡ ${subtasks.length} งานย่อย
              </span>
            </div>

            <div class="task-row-actions">
              <button type="button" class="btn-mini-action" onclick="window.openAddSubtaskModal('${m.id}')" title="เพิ่มงานย่อย">
                + ย่อย
              </button>
              <button type="button" class="btn-mini-action" onclick="window.openEditMainTaskModal('${m.id}')" title="แก้ไข">
                ✏️
              </button>
              <button type="button" class="btn-mini-action btn-mini-delete" onclick="window.deleteMainTask('${m.id}')" title="ลบรายการ">
                🗑️
              </button>
            </div>
          </div>
        </td>

        <!-- Right Timeline Cell with Interactive Gantt Bar (Full Month) -->
        <td class="gantt-timeline-cell">
          <div class="gantt-timeline-track" data-track-id="${m.id}">
            
            <!-- Month Background Day Columns for Guidelines -->
            ${state.monthInfo.days.map(d => `
              <div class="gantt-track-day-col ${d.isWeekend ? 'weekend' : ''} ${d.isToday ? 'today' : ''}" data-day-index="${d.dayIndex}" title="คลิกเพื่อย้ายงานมาที่วันที่ ${d.dateNumber} ${d.monthShort}"></div>
            `).join('')}

            <!-- The Draggable / Resizable Gantt Bar -->
            <div 
              class="gantt-bar-element ${m.categoryColor || 'cat-structure'}" 
              id="gantt-bar-${m.id}"
              data-task-id="${m.id}"
              style="left: calc(${leftPct}% + 2px); width: calc(${widthPct}% - 4px);"
              title="${escapeHtml(m.name)}: วันที่ ${sDate.dateNumber} ถึง วันที่ ${eDate.dateNumber} ${sDate.monthShort} (${durDays} วัน)"
            >
              <!-- Left Resize Handle -->
              <div class="gantt-bar-handle handle-left" data-handle="left" data-task-id="${m.id}" title="ลากปรับวันเริ่มต้น">◀</div>

              <!-- Bar Body Content -->
              <div class="gantt-bar-inner">
                <span class="gantt-bar-label">${escapeHtml(m.name)}</span>
                <span class="gantt-bar-days-count">${durDays} วัน</span>
              </div>

              <!-- Right Resize Handle -->
              <div class="gantt-bar-handle handle-right" data-handle="right" data-task-id="${m.id}" title="ลากปรับวันสิ้นสุด">▶</div>

              <!-- Progress Overlay -->
              ${taskAvgProgress > 0 ? `<div class="gantt-bar-progress-fill" style="width: ${taskAvgProgress}%;"></div>` : ''}
            </div>

          </div>
        </td>
      </tr>
    `;

    // 2. SUBTASKS ACCORDION ROW (Dateless Checklist)
    if (isExpanded) {
      html += `
        <tr class="subtasks-accordion-row" id="subtasks-row-${m.id}">
          <td colspan="2">
            <div class="subtasks-wrapper-box">
              <div class="subtasks-branch-line"></div>
              
              <div class="subtasks-header-bar">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="subtasks-title-hint">⚡ งานย่อยใต้รายการ "${escapeHtml(m.name)}" (${subtasks.length} งานย่อย)</span>
                  <span class="subtasks-rule-pill">
                    งานย่อยไม่ต้องระบุวันที่ — โฟร์แมนรายงานตามที่ทำได้จริงหน้างาน
                  </span>
                </div>
                <button type="button" class="btn-gantt-secondary" onclick="window.openAddSubtaskModal('${m.id}')" style="padding: 4px 12px; font-size: 0.8rem; background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; border-radius: 6px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                  <span>➕</span> เพิ่มงานย่อย
                </button>
              </div>

              ${subtasks.length === 0 ? `
                <div style="padding: 12px; background: #ffffff; border: 1.5px dashed var(--border-subtle); border-radius: var(--radius-xs); text-align: center; color: var(--text-muted); font-size: 0.78rem;">
                  ยังไม่มีงานย่อยในรายการนี้ กดปุ่ม "➕ เพิ่มงานย่อย" เพื่อระบุขั้นตอนการทำงาน
                </div>
              ` : `
                <div class="subtasks-cards-list">
                  ${subtasks.map((st, stIdx) => {
                    const progress = Number(st.actualProgress || 0);
                    const isCompleted = progress >= 100 || st.actualStatus === 'Completed';

                    return `
                      <div class="subtask-item-card ${isCompleted ? 'completed' : ''}" data-subtask-id="${st.id}">
                        <div class="subtask-card-left">
                          <span class="subtask-number-badge">${stIdx + 1}</span>
                          <div class="subtask-info-group">
                            <div class="subtask-name-line">
                              <strong>${escapeHtml(st.name)}</strong>
                              ${st.workArea ? `<span class="subtask-area-tag">📍 ${escapeHtml(st.workArea)}</span>` : ''}
                            </div>
                            ${st.description ? `<div class="subtask-desc-line">${escapeHtml(st.description)}</div>` : ''}
                            <div class="subtask-specs-line">
                              <span>🎯 เป้าหมาย: <strong>${escapeHtml(st.targetQty || '-')}</strong></span>
                              <span>👷 แผนคน: <strong>${st.plannedWorkers || 0} คน</strong></span>
                              <span>🚜 เครื่องจักร: <strong>${escapeHtml(st.machinery || '-')}</strong></span>
                            </div>
                          </div>
                        </div>

                        <div class="subtask-card-right">
                          <div class="subtask-actual-progress-box">
                            <span class="progress-label">ผลงานจริงโฟร์แมน</span>
                            <div class="progress-bar-mini">
                              <div class="progress-fill" style="width: ${progress}%;"></div>
                            </div>
                            <span class="progress-percent" style="color: ${isCompleted ? '#059669' : 'var(--text-heading)'};">${progress}%</span>
                          </div>

                          <div class="subtask-card-actions">
                            <button type="button" class="btn-mini-action btn-mini-delete" onclick="window.deleteSubtask('${m.id}', '${st.id}')" title="ลบงานย่อย">
                              🗑️
                            </button>
                          </div>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              `}
            </div>
          </td>
        </tr>
      `;
    }
  });

  tbody.innerHTML = html;
  attachGanttInteractiveEvents();
}

// ==========================================
// MOUSE DRAG & RESIZE LOGIC (Monthly Full Timeline)
// ==========================================
function attachGanttInteractiveEvents() {
  const totalDays = state.monthInfo?.daysInMonth || 30;

  document.querySelectorAll('.gantt-bar-element').forEach(bar => {
    const taskId = bar.dataset.taskId;
    const task = state.mainTasks.find(t => t.id === taskId);
    if (!task) return;

    let dragType = null; // 'left' | 'right' | 'body'
    let startX = 0;
    let initialStart = 0;
    let initialEnd = 0;
    let trackRect = null;

    const onMouseDown = (e) => {
      if (e.target.dataset.handle === 'left') {
        dragType = 'left';
      } else if (e.target.dataset.handle === 'right') {
        dragType = 'right';
      } else {
        dragType = 'body';
      }

      startX = e.clientX;
      initialStart = Number(task.startDayIndex);
      initialEnd = Number(task.endDayIndex);

      const track = bar.closest('.gantt-timeline-track');
      if (track) {
        trackRect = track.getBoundingClientRect();
      }

      bar.classList.add('dragging');
      document.body.style.cursor = dragType === 'body' ? 'grabbing' : 'ew-resize';
      document.body.style.userSelect = 'none';

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
      e.stopPropagation();
    };

    const onMouseMove = (e) => {
      if (!dragType || !trackRect) return;

      const cellWidth = trackRect.width / totalDays;
      const deltaX = e.clientX - startX;
      const dayDelta = Math.round(deltaX / cellWidth);

      let newStart = initialStart;
      let newEnd = initialEnd;

      if (dragType === 'left') {
        newStart = Math.min(task.endDayIndex, Math.max(0, initialStart + dayDelta));
      } else if (dragType === 'right') {
        newEnd = Math.max(task.startDayIndex, Math.min(totalDays - 1, initialEnd + dayDelta));
      } else if (dragType === 'body') {
        const duration = initialEnd - initialStart;
        newStart = initialStart + dayDelta;
        newEnd = newStart + duration;

        if (newStart < 0) {
          newStart = 0;
          newEnd = duration;
        }
        if (newEnd > totalDays - 1) {
          newEnd = totalDays - 1;
          newStart = (totalDays - 1) - duration;
        }
      }

      // Realtime visual positioning via percentages
      const leftPct = (newStart * 100) / totalDays;
      const widthPct = ((newEnd - newStart + 1) * 100) / totalDays;
      bar.style.left = `calc(${leftPct}% + 2px)`;
      bar.style.width = `calc(${widthPct}% - 4px)`;

      const durDays = (newEnd - newStart) + 1;
      const countLabel = bar.querySelector('.gantt-bar-days-count');
      if (countLabel) countLabel.innerText = `${durDays} วัน`;

      // Update date pill in row
      const sDate = state.monthInfo.days[newStart];
      const eDate = state.monthInfo.days[newEnd];
      const row = bar.closest('.gantt-task-row');
      if (row) {
        const datePill = row.querySelector('.task-date-pill');
        if (datePill) {
          datePill.innerText = `${sDate.dateNumber} - ${eDate.dateNumber} ${sDate.monthShort} (${durDays} วัน)`;
        }
      }

      // Live highlight corresponding header days
      document.querySelectorAll('#gantt-days-header .gantt-day-th').forEach((th, idx) => {
        if (idx >= newStart && idx <= newEnd) {
          th.classList.add('drag-highlight');
        } else {
          th.classList.remove('drag-highlight');
        }
      });
    };

    const onMouseUp = (e) => {
      if (!dragType || !trackRect) return;

      const cellWidth = trackRect.width / totalDays;
      const deltaX = e.clientX - startX;
      const dayDelta = Math.round(deltaX / cellWidth);

      let newStart = initialStart;
      let newEnd = initialEnd;

      if (dragType === 'left') {
        newStart = Math.min(task.endDayIndex, Math.max(0, initialStart + dayDelta));
      } else if (dragType === 'right') {
        newEnd = Math.max(task.startDayIndex, Math.min(totalDays - 1, initialEnd + dayDelta));
      } else if (dragType === 'body') {
        const duration = initialEnd - initialStart;
        newStart = initialStart + dayDelta;
        newEnd = newStart + duration;
        if (newStart < 0) { newStart = 0; newEnd = duration; }
        if (newEnd > totalDays - 1) { newEnd = totalDays - 1; newStart = (totalDays - 1) - duration; }
      }

      task.startDayIndex = newStart;
      task.endDayIndex = newEnd;
      task.startDate = state.monthInfo.days[task.startDayIndex].iso;
      task.endDate = state.monthInfo.days[task.endDayIndex].iso;

      document.querySelectorAll('.drag-highlight').forEach(el => el.classList.remove('drag-highlight'));
      bar.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragType = null;

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      autoSaveDraft();
      renderGanttTable();
      updateKPISummary();
      showToast(`🗓️ ปรับช่วงเวลา: ${task.name} (${(task.endDayIndex - task.startDayIndex) + 1} วัน)`, 'info');
    };

    bar.addEventListener('mousedown', onMouseDown);
  });

  // Direct click on empty day column to jump/move task
  document.querySelectorAll('.gantt-track-day-col').forEach(col => {
    col.addEventListener('click', (e) => {
      if (e.target.closest('.gantt-bar-element')) return;
      const dayIdx = Number(col.dataset.dayIndex);
      const track = col.closest('.gantt-timeline-track');
      if (!track || isNaN(dayIdx)) return;
      const taskId = track.dataset.trackId;
      const task = state.mainTasks.find(t => t.id === taskId);
      if (!task) return;

      const dur = task.endDayIndex - task.startDayIndex;
      let newStart = dayIdx;
      let newEnd = dayIdx + dur;
      if (newEnd > totalDays - 1) {
        newEnd = totalDays - 1;
        newStart = Math.max(0, (totalDays - 1) - dur);
      }
      task.startDayIndex = newStart;
      task.endDayIndex = newEnd;
      task.startDate = state.monthInfo.days[newStart].iso;
      task.endDate = state.monthInfo.days[newEnd].iso;

      autoSaveDraft();
      renderGanttTable();
      updateKPISummary();
      showToast(`🗓️ เลื่อนงาน "${task.name}" ไปเริ่มวันที่ ${state.monthInfo.days[newStart].dateNumber}`, 'info');
    });
  });
}

// Global toggle for subtasks accordion
window.toggleSubtasksExpansion = function(taskId) {
  if (state.expandedTasks.has(taskId)) {
    state.expandedTasks.delete(taskId);
  } else {
    state.expandedTasks.add(taskId);
  }
  renderGanttTable();
};

window.deleteMainTask = function(taskId) {
  const task = state.mainTasks.find(t => t.id === taskId);
  if (!task) return;

  if (confirm(`ยืนยันการลบรายการ "${task.name}" และงานย่อยทั้งหมดในรายการนี้หรือไม่?`)) {
    state.mainTasks = state.mainTasks.filter(t => t.id !== taskId);
    state.expandedTasks.delete(taskId);
    autoSaveDraft();
    renderGanttTable();
    updateKPISummary();
    showToast('ลบรายการงานหลักสำเร็จ', 'info');
  }
};

window.deleteSubtask = function(mainTaskId, subtaskId) {
  const mainTask = state.mainTasks.find(t => t.id === mainTaskId);
  if (!mainTask) return;

  mainTask.subtasks = (mainTask.subtasks || []).filter(st => st.id !== subtaskId);
  autoSaveDraft();
  renderGanttTable();
  updateKPISummary();
  showToast('ลบงานย่อยสำเร็จ', 'info');
};

// ==========================================
// MODAL: ADD / EDIT MAIN TASK
// ==========================================
window.openAddMainTaskModal = function() {
  state.editingTaskId = null;
  state.modalSubtasksTemp = [];

  document.getElementById('modal-task-title').innerText = '➕ เพิ่มรายการงานหลักใน Gantt';
  document.getElementById('input-task-id').value = '';
  document.getElementById('input-task-name').value = '';
  document.getElementById('input-task-area').value = '';
  document.getElementById('input-task-category').value = 'งานฐานราก';

  const days = state.monthInfo.days;
  const defaultEndIdx = Math.min(6, days.length - 1);
  document.getElementById('input-task-start-date').value = days[0].iso;
  document.getElementById('input-task-end-date').value = days[defaultEndIdx].iso;
  updateModalDurationBadge(days[0].iso, days[defaultEndIdx].iso);

  renderModalSubtasksTempList();
  document.getElementById('modal-main-task').classList.add('active');
};

window.openEditMainTaskModal = function(taskId) {
  const task = state.mainTasks.find(t => t.id === taskId);
  if (!task) return;

  state.editingTaskId = taskId;
  state.modalSubtasksTemp = JSON.parse(JSON.stringify(task.subtasks || []));

  document.getElementById('modal-task-title').innerText = '✏️ แก้ไขรายการงานหลักใน Gantt';
  document.getElementById('input-task-id').value = task.id;
  document.getElementById('input-task-name').value = task.name;
  document.getElementById('input-task-area').value = task.workArea || '';
  document.getElementById('input-task-category').value = task.category || 'งานโครงสร้าง';
  document.getElementById('input-task-start-date').value = task.startDate;
  document.getElementById('input-task-end-date').value = task.endDate;
  updateModalDurationBadge(task.startDate, task.endDate);

  renderModalSubtasksTempList();
  document.getElementById('modal-main-task').classList.add('active');
};

function updateModalDurationBadge(sIso, eIso) {
  const badge = document.getElementById('modal-task-duration-badge');
  if (!badge) return;
  if (!sIso || !eIso) {
    badge.innerText = '-';
    return;
  }
  const s = new Date(sIso);
  const e = new Date(eIso);
  const diffDays = Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
  badge.innerText = `${diffDays} วัน`;
}

function renderModalSubtasksTempList() {
  const container = document.getElementById('modal-task-subtasks-list');
  const countBadge = document.getElementById('modal-task-subtasks-count');
  if (!container) return;

  if (countBadge) countBadge.innerText = `${state.modalSubtasksTemp.length} รายการ`;

  if (state.modalSubtasksTemp.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.75rem; color: var(--text-muted); text-align: center; padding: 8px; border: 1px dashed var(--border-subtle); border-radius: 4px;">
        ยังไม่มีงานย่อยในรายการนี้ สามารถเพิ่มได้ด้านล่าง
      </div>
    `;
    return;
  }

  container.innerHTML = state.modalSubtasksTemp.map((st, idx) => `
    <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid var(--border-subtle); padding: 6px 10px; border-radius: 4px; font-size: 0.78rem;">
      <div>
        <strong>${idx + 1}. ${escapeHtml(st.name)}</strong>
        <span style="color: var(--text-muted); font-size: 0.7rem; margin-left: 6px;">(${st.targetQty || '-'})</span>
        ${st.plannedWorkers ? `<span style="font-size: 0.68rem; color: #0369a1; margin-left: 4px;">👷 ${st.plannedWorkers} คน</span>` : ''}
      </div>
      <button type="button" class="btn-mini-action btn-mini-delete" onclick="window.removeTempModalSubtask(${idx})">ลบ</button>
    </div>
  `).join('');
}

window.removeTempModalSubtask = function(idx) {
  state.modalSubtasksTemp.splice(idx, 1);
  renderModalSubtasksTempList();
};

// ==========================================
// MODAL: ADD SINGLE SUBTASK (Quick Drawer)
// ==========================================
window.openAddSubtaskModal = function(parentTaskId) {
  const parent = state.mainTasks.find(t => t.id === parentTaskId);
  if (!parent) return;

  document.getElementById('input-subtask-parent-id').value = parentTaskId;
  document.getElementById('subtask-parent-task-name').innerText = parent.name;
  document.getElementById('input-quick-subtask-name').value = '';
  document.getElementById('input-quick-subtask-area').value = parent.workArea || '';
  document.getElementById('input-quick-subtask-qty').value = '';
  document.getElementById('input-quick-subtask-desc').value = '';
  document.getElementById('input-quick-subtask-workers').value = '4';
  document.getElementById('input-quick-subtask-machinery').value = '';

  document.getElementById('modal-single-subtask').classList.add('active');
};

// ==========================================
// Toolbar, Stepper, & Modal Event Listeners
// ==========================================
function bindNavigationEvents() {
  const btnPrev = document.getElementById('btn-prev-month') || document.getElementById('btn-prev-week');
  const btnNext = document.getElementById('btn-next-month') || document.getElementById('btn-next-week');
  const btnToday = document.getElementById('btn-today-month') || document.getElementById('btn-today-week');

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      let m = state.currentMonth - 1;
      let y = state.currentYear;
      if (m < 0) {
        m = 11;
        y--;
      }
      calculateMonthInfo(y, m);
      renderMonthInfoUI();
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      let m = state.currentMonth + 1;
      let y = state.currentYear;
      if (m > 11) {
        m = 0;
        y++;
      }
      calculateMonthInfo(y, m);
      renderMonthInfoUI();
    });
  }

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      const now = new Date();
      calculateMonthInfo(now.getFullYear(), now.getMonth());
      renderMonthInfoUI();
      showToast('สลับมายังเดือนปัจจุบัน', 'info');
    });
  }
}

function bindToolbarActions() {
  document.getElementById('btn-add-main-task')?.addEventListener('click', () => {
    window.openAddMainTaskModal();
  });

  document.getElementById('btn-save-draft')?.addEventListener('click', () => {
    autoSaveDraft();
    showToast('💾 บันทึกแบบร่างลงเครื่องสำเร็จ', 'success');
  });

  document.getElementById('btn-submit-to-pm')?.addEventListener('click', () => {
    openSubmitConfirmModal();
  });

  document.getElementById('btn-sync-plans')?.addEventListener('click', async () => {
    showToast('🔄 กำลังซิงก์ข้อมูลจาก Google Sheets...', 'info');
    await syncUserProfile();
    await loadWeeklyPlans();
    showToast('ซิงก์ข้อมูลแผนงานสำเร็จ', 'success');
  });

  const objInput = document.getElementById('input-month-objective') || document.getElementById('input-week-objective');
  if (objInput) {
    objInput.addEventListener('input', (e) => {
      state.monthObjective = e.target.value;
      autoSaveDraft();
    });
  }

  document.getElementById('btn-toggle-all-subtasks')?.addEventListener('click', () => {
    if (state.expandedTasks.size === state.mainTasks.length) {
      state.expandedTasks.clear();
    } else {
      state.mainTasks.forEach(m => state.expandedTasks.add(m.id));
    }
    renderGanttTable();
  });
}

function bindModalEvents() {
  // Modal Main Task
  const modalTask = document.getElementById('modal-main-task');
  document.getElementById('btn-close-task-modal')?.addEventListener('click', () => modalTask.classList.remove('active'));
  document.getElementById('btn-cancel-task-modal')?.addEventListener('click', () => modalTask.classList.remove('active'));

  // Quick category presets in modal
  document.querySelectorAll('.btn-cat-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-cat-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('input-task-category').value = btn.dataset.cat;
    });
  });

  // Date changes in modal
  const sInput = document.getElementById('input-task-start-date');
  const eInput = document.getElementById('input-task-end-date');
  if (sInput && eInput) {
    const onDateChange = () => updateModalDurationBadge(sInput.value, eInput.value);
    sInput.addEventListener('change', onDateChange);
    eInput.addEventListener('change', onDateChange);
  }

  // Quick duration buttons in modal
  document.querySelectorAll('.btn-quick-dur').forEach(btn => {
    btn.addEventListener('click', () => {
      const daysToAdd = Number(btn.dataset.days) || 1;
      const sVal = sInput.value || state.monthInfo.startIso;
      const s = new Date(sVal);
      const e = new Date(s);
      e.setDate(s.getDate() + daysToAdd - 1);
      eInput.value = toIsoDate(e);
      updateModalDurationBadge(sInput.value, eInput.value);
    });
  });

  // Add mini subtask inside modal
  document.getElementById('btn-add-subtask-in-modal')?.addEventListener('click', () => {
    const nameEl = document.getElementById('input-modal-new-subtask-name');
    const qtyEl = document.getElementById('input-modal-new-subtask-qty');
    const workersEl = document.getElementById('input-modal-new-subtask-workers');
    const machEl = document.getElementById('input-modal-new-subtask-machinery');

    const name = nameEl.value.trim();
    if (!name) {
      showToast('กรุณาระบุชื่องานย่อย', 'warning');
      nameEl.focus();
      return;
    }

    state.modalSubtasksTemp.push({
      id: 'STASK-' + Date.now() + '-' + state.modalSubtasksTemp.length,
      name: name,
      workArea: document.getElementById('input-task-area')?.value.trim() || '',
      description: '',
      targetQty: qtyEl.value.trim() || '-',
      plannedWorkers: Number(workersEl.value) || 0,
      machinery: machEl.value.trim() || '-',
      actualStatus: 'Pending',
      actualProgress: 0
    });

    nameEl.value = '';
    qtyEl.value = '';
    renderModalSubtasksTempList();
  });

  // Save Main Task button in modal
  document.getElementById('btn-save-task-modal')?.addEventListener('click', () => {
    const name = document.getElementById('input-task-name').value.trim();
    if (!name) {
      showToast('กรุณาระบุชื่องานหลัก', 'warning');
      document.getElementById('input-task-name').focus();
      return;
    }

    const cat = document.getElementById('input-task-category').value.trim() || 'งานโครงสร้าง';
    const area = document.getElementById('input-task-area').value.trim();
    const startDateIso = document.getElementById('input-task-start-date').value;
    const endDateIso = document.getElementById('input-task-end-date').value;

    const totalDays = state.monthInfo.daysInMonth;
    let sIdx = state.monthInfo.days.findIndex(d => d.iso === startDateIso);
    let eIdx = state.monthInfo.days.findIndex(d => d.iso === endDateIso);

    if (sIdx < 0) sIdx = 0;
    if (eIdx < 0) eIdx = Math.min(6, totalDays - 1);
    if (sIdx > eIdx) eIdx = sIdx;

    if (state.editingTaskId) {
      const task = state.mainTasks.find(t => t.id === state.editingTaskId);
      if (task) {
        task.name = name;
        task.category = cat;
        task.categoryColor = getCategoryColorClass(cat);
        task.workArea = area;
        task.startDayIndex = sIdx;
        task.endDayIndex = eIdx;
        task.startDate = state.monthInfo.days[sIdx].iso;
        task.endDate = state.monthInfo.days[eIdx].iso;
        task.subtasks = state.modalSubtasksTemp;
      }
    } else {
      const newTask = {
        id: 'MTASK-' + Date.now(),
        name: name,
        category: cat,
        categoryColor: getCategoryColorClass(cat),
        workArea: area,
        startDayIndex: sIdx,
        endDayIndex: eIdx,
        startDate: state.monthInfo.days[sIdx].iso,
        endDate: state.monthInfo.days[eIdx].iso,
        subtasks: state.modalSubtasksTemp
      };
      state.mainTasks.push(newTask);
      state.expandedTasks.add(newTask.id);
    }

    modalTask.classList.remove('active');
    autoSaveDraft();
    renderGanttTable();
    updateKPISummary();
    showToast('บันทึกรายการงานลงใน Gantt สำเร็จ', 'success');
  });

  // Modal Single Subtask (Quick Drawer)
  const modalSub = document.getElementById('modal-single-subtask');
  document.getElementById('btn-close-subtask-modal')?.addEventListener('click', () => modalSub.classList.remove('active'));
  document.getElementById('btn-cancel-subtask-modal')?.addEventListener('click', () => modalSub.classList.remove('active'));

  document.getElementById('btn-confirm-add-subtask')?.addEventListener('click', () => {
    const parentId = document.getElementById('input-subtask-parent-id').value;
    const parent = state.mainTasks.find(t => t.id === parentId);
    if (!parent) return;

    const name = document.getElementById('input-quick-subtask-name').value.trim();
    if (!name) {
      showToast('กรุณาระบุชื่องานย่อย', 'warning');
      document.getElementById('input-quick-subtask-name').focus();
      return;
    }

    const newSubtask = {
      id: 'STASK-' + Date.now(),
      name: name,
      workArea: document.getElementById('input-quick-subtask-area').value.trim(),
      description: document.getElementById('input-quick-subtask-desc').value.trim(),
      targetQty: document.getElementById('input-quick-subtask-qty').value.trim() || '-',
      plannedWorkers: Number(document.getElementById('input-quick-subtask-workers').value) || 0,
      machinery: document.getElementById('input-quick-subtask-machinery').value.trim() || '-',
      actualStatus: 'Pending',
      actualProgress: 0,
      actualDate: null,
      reportedBy: null
    };

    if (!parent.subtasks) parent.subtasks = [];
    parent.subtasks.push(newSubtask);
    state.expandedTasks.add(parentId);

    modalSub.classList.remove('active');
    autoSaveDraft();
    renderGanttTable();
    updateKPISummary();
    showToast('เพิ่มงานย่อยลงในแผนเรียบร้อยแล้ว', 'success');
  });

  setupProjectModal();
}

// ==========================================
// SUBMIT MONTHLY PLAN TO PM
// ==========================================
function openSubmitConfirmModal() {
  const modal = document.getElementById('modal-submit-confirm');
  if (!modal || !state.monthInfo) return;

  if (state.mainTasks.length === 0) {
    showToast('กรุณาเพิ่มรายการงานหลักอย่างน้อย 1 รายการก่อนส่งแผนงาน', 'warning');
    return;
  }

  let totalSubtasks = 0;
  let totalWorkers = 0;
  state.mainTasks.forEach(m => {
    (m.subtasks || []).forEach(st => {
      totalSubtasks++;
      totalWorkers += Number(st.plannedWorkers || 0);
    });
  });

  const daysCount = state.monthInfo.daysInMonth;
  const avgWorkers = Math.round(totalWorkers / Math.max(1, Math.min(daysCount, 30)));

  const lbl = document.getElementById('submit-confirm-week-label');
  const rng = document.getElementById('submit-confirm-date-range');
  if (lbl) lbl.innerText = state.monthInfo.label;
  if (rng) rng.innerText = `${state.monthInfo.startIso} ถึง ${state.monthInfo.endIso}`;

  document.getElementById('submit-summary-main-tasks').innerText = `${state.mainTasks.length} รายการ`;
  document.getElementById('submit-summary-subtasks').innerText = `${totalSubtasks} งานย่อย`;
  document.getElementById('submit-summary-workers').innerText = `${avgWorkers} คน/วัน`;
  document.getElementById('submit-summary-project').innerText = `${state.project.name} (${state.subcontractor.name})`;

  modal.classList.add('active');

  const btnConfirm = document.getElementById('btn-confirm-submit-plan');
  const btnClose = document.getElementById('btn-close-submit-modal');
  const btnCancel = document.getElementById('btn-cancel-submit-modal');

  const closeModal = () => modal.classList.remove('active');
  if (btnClose) btnClose.onclick = closeModal;
  if (btnCancel) btnCancel.onclick = closeModal;

  if (btnConfirm) {
    btnConfirm.onclick = async () => {
      await submitPlanToPM();
      closeModal();
    };
  }
}

async function submitPlanToPM() {
  const btnSubmit = document.getElementById('btn-submit-to-pm');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerText = '⏳ กำลังส่งให้ PM...';
  }

  showToast('🚀 กำลังส่งแผนงานประจำเดือนให้ PM พิจารณา...', 'info');

  const planId = state.currentPlan?.planId || ('MPLAN-' + state.monthInfo.year + String(state.monthInfo.month + 1).padStart(2, '0') + '-' + Date.now().toString().slice(-4));
  const foremanNote = document.getElementById('input-submit-note')?.value.trim() || 'ส่งแผนงานประจำเดือนจากระบบ Subcontractor Monthly Gantt Planner';

  const dailyTasksPayload = [];

  state.mainTasks.forEach((m, mIdx) => {
    const subtasks = m.subtasks || [];
    if (subtasks.length === 0) {
      dailyTasksPayload.push({
        task_id: m.id,
        plan_id: planId,
        date: m.startDate,
        day: m.category,
        company: state.subcontractor.name,
        category: m.category,
        task_name: m.name,
        description: `[${m.startDate} ถึง ${m.endDate}][งานหลัก: ${m.name}][โซน: ${m.workArea || '-'}]`,
        work_area: m.workArea || '',
        quantity: '-',
        planned_workers: 5,
        machinery: '-'
      });
    } else {
      subtasks.forEach((st, stIdx) => {
        dailyTasksPayload.push({
          task_id: st.id || ('STASK-' + mIdx + '-' + stIdx),
          plan_id: planId,
          parent_task_id: m.id,
          parent_task_name: m.name,
          date: m.startDate, // Default anchor date
          day: m.category,
          company: state.subcontractor.name,
          category: m.category,
          task_name: st.name,
          description: `[${m.startDate} ถึง ${m.endDate}][งานหลัก: ${m.name}][โซน: ${st.workArea || m.workArea || '-'}] ${st.description || ''}`,
          work_area: st.workArea || m.workArea || '',
          quantity: st.targetQty || '-',
          planned_workers: Number(st.plannedWorkers || 0),
          machinery: st.machinery || '-'
        });
      });
    }
  });

  // Resolve submitter identity from LINE profile / state / localStorage
  const submitterName = state.lineUser?.displayName || state.lineUser?.name || localStorage.getItem('site_user_name') || localStorage.getItem('site_line_name') || 'หัวหน้าผู้รับเหมา';
  const submitterRole = state.lineUser?.role || localStorage.getItem('site_user_role') || 'หัวหน้าผู้รับเหมา (Subcontractor Lead)';
  const submitterUid = state.lineUser?.userId || state.lineUser?.uid || localStorage.getItem('site_user_uid') || localStorage.getItem('site_line_uid') || '-';
  const submitterCompany = state.subcontractor?.name || localStorage.getItem('site_company_name') || '-';

  const payload = {
    plan_id: planId,
    project_id: state.project.id,
    project_name: state.project.name,
    sub_id: state.subcontractor.id,
    company_name: state.subcontractor.name,
    week_label: state.monthInfo.label,
    start_date: state.monthInfo.startIso,
    end_date: state.monthInfo.endIso,
    days_count: state.monthInfo.daysInMonth,
    weekly_objective: state.monthObjective || 'ดำเนินการตามแผนงานประจำเดือน',
    foreman_note: foremanNote,
    submitted_by_name: submitterName,
    submitted_by_role: submitterRole,
    submitted_by_uid: submitterUid,
    submitted_by_company: submitterCompany,
    submittedByName: submitterName,
    submittedByRole: submitterRole,
    daily_tasks: dailyTasksPayload,
    tasks: dailyTasksPayload
  };

  try {
    const res = await gasService.saveWeeklyPlan(payload);
    if (res && res.success) {
      showToast('🎉 ส่งแผนงานประจำเดือนสำเร็จ! รอ PM กดอนุมัติเพื่อส่งต่องานให้โฟร์แมน', 'success');
      state.planStatus = 'Pending';
      state.isDirty = false;
      renderPlanMetaUI();
      if (firebaseService.isConfigured()) {
        firebaseService.broadcastEvent('PLAN_SUBMITTED', {
          planId: state.currentPlanId,
          projectId: state.project.id,
          subName: state.subcontractor.name
        }).catch(e => console.warn('[WeeklySync] Firebase broadcast error:', e));
      }
      try {
        const channel = new BroadcastChannel('cpm_site_sync');
        channel.postMessage({ type: 'PLAN_SUBMITTED', planId: state.currentPlanId, projectId: state.project.id, timestamp: Date.now() });
        channel.close();
      } catch (e) {}
      try {
        localStorage.setItem('cpm_sync_trigger', JSON.stringify({ type: 'PLAN_SUBMITTED', time: Date.now() }));
      } catch (e) {}
      await loadWeeklyPlans();
    } else {
      showToast(`⚠️ ส่งไม่สำเร็จ: ${res?.message || 'โปรดตรวจสอบ'}`, 'warning');
    }
  } catch (err) {
    showToast(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<span>🚀 ยื่นส่ง PM อนุมัติ</span>';
    }
  }
}

function autoSaveDraft() {
  if (!state.monthInfo) return;
  state.isDirty = true;
  const draftKey = `draft_mplan_${state.project.id}_${state.monthInfo.year}_${state.monthInfo.month}_${state.subcontractor.name}`;
  const data = {
    objective: state.monthObjective,
    mainTasks: state.mainTasks,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(draftKey, JSON.stringify(data));
}

// ==========================================
// VIEW 2: PLANS ARCHIVE & HISTORY
// ==========================================
function setupViewTabs() {
  const tabGantt = document.getElementById('tab-view-gantt');
  const tabArchive = document.getElementById('tab-view-archive');
  const paneGantt = document.getElementById('pane-gantt-planner');
  const paneArchive = document.getElementById('pane-plans-archive');

  if (tabGantt && tabArchive && paneGantt && paneArchive) {
    tabGantt.addEventListener('click', () => {
      tabGantt.classList.add('active');
      tabArchive.classList.remove('active');
      paneGantt.style.display = 'block';
      paneArchive.style.display = 'none';
      state.activeView = 'gantt';
      renderGanttTable();
    });

    tabArchive.addEventListener('click', () => {
      tabArchive.classList.add('active');
      tabGantt.classList.remove('active');
      paneGantt.style.display = 'none';
      paneArchive.style.display = 'block';
      state.activeView = 'archive';
      renderArchivePlans();
    });
  }

  document.querySelectorAll('#archive-status-filter-chips .tag-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#archive-status-filter-chips .tag-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.archiveFilter = btn.dataset.filter;
      renderArchivePlans();
    });
  });
}

async function loadWeeklyPlans() {
  const container = document.getElementById('weekly-plans-container');
  if (!container) return;

  try {
    const plans = await gasService.fetchWeeklyPlans(state.project.id, '', state.subcontractor.name);
    // Extra safeguard: Only keep plans belonging to this contractor's company
    state.monthlyPlans = (plans || []).filter(p => {
      if (!state.subcontractor.name || state.subcontractor.name === '-') return true;
      return !p.company || p.company === '-' || p.company === state.subcontractor.name;
    });
    renderArchivePlans();
    syncCurrentMonthPlan();
    state.isDirty = false;
  } catch (err) {
    console.warn('loadWeeklyPlans error:', err);
  }
}

function renderArchivePlans() {
  const container = document.getElementById('weekly-plans-container');
  if (!container) return;

  let filtered = state.monthlyPlans || [];
  if (state.archiveFilter !== 'all') {
    filtered = filtered.filter(p => p.status === state.archiveFilter || p.pmStatus === state.archiveFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted); border: 2px dashed var(--border-subtle); border-radius: var(--radius-sm);">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📋</div>
        <strong style="font-size: 0.95rem;">ยังไม่มีแผนงานในหมวดหมู่นี้สำหรับ ${escapeHtml(state.subcontractor.name || '')}</strong>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const st = p.status || p.pmStatus || 'Pending';
    const statusClass = st === 'Approved' ? 'approved' : (st === 'Revision' ? 'revision' : 'pending');
    const statusText = st === 'Approved' ? '🟢 PM อนุมัติแล้ว' : (st === 'Revision' ? '🔴 สั่งปรับปรุง' : '🟡 รอ PM อนุมัติ');
    const pct = Math.round(Number(p.overallProgress || p.progress) || 0);

    return `
      <div class="weekly-plan-card" style="background:#ffffff; border:1.5px solid var(--border-dark); border-radius:var(--radius-sm); padding:16px; margin-bottom:12px; box-shadow:var(--shadow-neo-sm);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <div>
            <strong style="font-size:0.95rem; color:var(--text-heading);">${escapeHtml(p.weekLabel || p.planId)}</strong>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
              🏢 บริษัท: <strong>${escapeHtml(p.company || '-')}</strong> | ช่วงเวลา: <strong>${p.startDate} ถึง ${p.endDate}</strong>
            </div>
          </div>
          <span class="gantt-status-pill ${statusClass}">${statusText}</span>
        </div>

        ${p.objective ? `<div style="font-size:0.78rem; color:#475569; background:#f8fafc; padding:6px 10px; border-radius:4px; margin-bottom:8px; border:1px solid var(--border-subtle);">🎯 <strong>เป้าหมาย:</strong> ${escapeHtml(p.objective)}</div>` : ''}

        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.74rem;">
          <span>ความคืบหน้าจริงจากโฟร์แมน</span>
          <strong style="color:${pct >= 100 ? '#059669' : 'var(--text-heading)'};">${pct}%</strong>
        </div>
        <div style="height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden; margin-top:4px;">
          <div style="height:100%; width:${pct}%; background:#10b981;"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ==========================================
// Project Selector Modal
// ==========================================
function setupProjectModal() {
  const modal = document.getElementById('modal-project-selector');
  const btnOpen = document.getElementById('project-pill');
  const btnClose = document.getElementById('btn-close-project-modal');

  if (btnOpen && modal) {
    btnOpen.addEventListener('click', () => {
      modal.classList.add('active');
      renderProjectsModal();
    });
  }
  if (btnClose && modal) {
    btnClose.addEventListener('click', () => modal.classList.remove('active'));
  }
}

function renderProjectsModal() {
  const container = document.getElementById('projects-list-container');
  if (!container) return;

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
  calculateMonthInfo(state.currentYear, state.currentMonth);
  loadWeeklyPlans();
};

// ==========================================
// Toast & Utilities
// ==========================================
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3200);
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
// Exit Confirmation Modal (ส่ง PM หรือปิดแบบไม่เซฟ)
// ==========================================
function setupExitConfirmation() {
  const btnClose = document.getElementById('btn-close-planner');
  const modalExit = document.getElementById('modal-confirm-exit');
  const btnSubmitPM = document.getElementById('btn-exit-submit-pm');
  const btnDiscard = document.getElementById('btn-exit-discard');
  const btnCancel = document.getElementById('btn-exit-cancel');

  function requestExit() {
    if (state.isDirty) {
      if (modalExit) modalExit.classList.add('active');
    } else {
      doExit();
    }
  }

  function doExit() {
    state.isDirty = false;
    window.location.href = 'index.html';
  }

  btnClose?.addEventListener('click', requestExit);

  btnCancel?.addEventListener('click', () => {
    modalExit?.classList.remove('active');
  });

  btnDiscard?.addEventListener('click', () => {
    modalExit?.classList.remove('active');
    doExit();
  });

  btnSubmitPM?.addEventListener('click', () => {
    modalExit?.classList.remove('active');
    openSubmitConfirmModal();
  });

  // Browser tab close guard
  window.addEventListener('beforeunload', (e) => {
    if (state.isDirty) {
      e.preventDefault();
      e.returnValue = 'คุณมีข้อมูลแผนงานที่ยังไม่ได้ส่งอนุมัติ ต้องการปิดโดยไม่บันทึกหรือไม่?';
      return e.returnValue;
    }
  });
}

// ==========================================
// Real-Time Cross-Device Sync
// ==========================================
function setupWeeklyRealtimeSync() {
  if (firebaseService.isConfigured()) {
    firebaseService.listenEvents(async (type, payload) => {
      if (type === 'PLAN_APPROVED' || type === 'REFRESH_ALL') {
        console.log('[WeeklyLiveSync] Firebase event received:', type, payload);
        await loadWeeklyPlans(true);
        showToast('⚡ แผนงานได้รับการอนุมัติจาก PM แล้ว! (Firebase Realtime)', 'success');
      }
    });
  }

  try {
    const channel = new BroadcastChannel('cpm_site_sync');
    channel.onmessage = async (event) => {
      const data = event.data;
      if (data && (data.type === 'PLAN_APPROVED' || data.type === 'REFRESH_ALL')) {
        await loadWeeklyPlans(true);
        showToast('⚡ แผนงานได้รับการอนุมัติจาก PM แล้ว!', 'success');
      }
    };
  } catch (e) {}
}

