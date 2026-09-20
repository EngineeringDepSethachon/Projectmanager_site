/**
 * app_weekly.js - Subcontractor Weekly Planning & Interactive Gantt Controller (LV2 - Desktop)
 * หน้าจอสำหรับหัวหน้าผู้รับเหมา:
 * - เพิ่มรายการงานหลักและลากแถบกราฟ Gantt ตามวันที่วางแผนไว้
 * - แตกงานย่อย (Subtasks) ใต้แต่ละงานหลัก "โดยงานย่อยไม่ต้องลงวันที่ จะเป็นไปตามที่โฟร์แมนทำได้จริงหน้างาน"
 * - ยื่นส่งแผนงานให้ PM อนุมัติล่วงหน้า
 */

import { gasService } from './gas_service.js';

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
  currentWeekOffset: 0, // 0 = current week, 1 = next week, -1 = prev week
  weekInfo: null, // { monday, sunday, startIso, endIso, label, days: [...] }
  
  // Current Week Plan Data
  currentPlan: null, // Loaded from GAS or local draft
  mainTasks: [], // [{ id, name, category, workArea, startDayIndex, endDayIndex, startDate, endDate, subtasks: [...] }]
  weekObjective: '',
  planStatus: 'Draft', // 'Draft' | 'Pending' | 'Approved' | 'Revision'
  pmNotes: '',
  
  // Historical / All plans
  weeklyPlans: [],
  archiveFilter: 'all',
  
  // UI Helpers
  editingTaskId: null,
  modalSubtasksTemp: [],
  expandedTasks: new Set()
};

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  parseUrlParams();
  renderProfile();
  renderProjectInfo();
  
  calculateWeekInfo(state.currentWeekOffset);
  renderWeekInfoUI();
  
  await loadProjects();
  await loadWeeklyPlans();
  
  bindNavigationEvents();
  bindToolbarActions();
  bindModalEvents();
  setupViewTabs();
});

// ==========================================
// URL Parsing & Profile
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

function renderProfile() {
  const nameEl = document.getElementById('sub-user-name');
  const compEl = document.getElementById('sub-company-name');
  const avatarEl = document.getElementById('sub-avatar');

  if (nameEl) nameEl.innerText = state.user.name !== '-' ? state.user.name : 'หัวหน้าผู้รับเหมา';
  if (compEl) compEl.innerText = state.subcontractor.name !== '-' ? state.subcontractor.name : 'หจก. ผู้รับเหมาโครงสร้าง';
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
// Week Calculation & Navigation
// ==========================================
function calculateWeekInfo(offset = 0) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Compute Monday of the target week
  const day = today.getDay(); // 0 is Sun, 1 is Mon...
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMon + (offset * 7));

  const days = [];
  const dayNamesShort = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสฯ', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
  const monthNamesThaiShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const iso = toIsoDate(cur);
    const isToday = iso === toIsoDate(today);

    days.push({
      date: cur,
      iso: iso,
      dayIndex: i,
      dayNameShort: dayNamesShort[i],
      dateNumber: cur.getDate(),
      monthShort: monthNamesThaiShort[cur.getMonth()],
      yearThaiShort: (cur.getFullYear() + 543).toString().slice(-2),
      isToday: isToday,
      isWeekend: i >= 5
    });
  }

  const sunday = days[6].date;
  const yearThai = sunday.getFullYear() + 543;

  state.weekInfo = {
    monday: monday,
    sunday: sunday,
    startIso: days[0].iso,
    endIso: days[6].iso,
    label: `สัปดาห์ (${days[0].dateNumber} ${days[0].monthShort} - ${days[6].dateNumber} ${days[6].monthShort} ${yearThai})`,
    days: days
  };

  // Sync active plan for this calculated week
  syncCurrentWeekPlan();
}

function toIsoDate(d) {
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const date = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${date}`;
}

function renderWeekInfoUI() {
  const rangeEl = document.getElementById('display-week-range');
  const labelEl = document.getElementById('display-week-label');
  if (!state.weekInfo) return;

  if (rangeEl) {
    rangeEl.innerText = `${state.weekInfo.days[0].dateNumber} ${state.weekInfo.days[0].monthShort} - ${state.weekInfo.days[6].dateNumber} ${state.weekInfo.days[6].monthShort} ${state.weekInfo.sunday.getFullYear() + 543}`;
  }
  if (labelEl) {
    const isThisWeek = state.currentWeekOffset === 0;
    labelEl.innerText = isThisWeek ? '🌟 สัปดาห์ปัจจุบัน (Current Week)' : (state.currentWeekOffset > 0 ? `ล่วงหน้า +${state.currentWeekOffset} สัปดาห์` : `ย้อนหลัง ${state.currentWeekOffset} สัปดาห์`);
  }

  renderGanttDaysHeader();
}

function renderGanttDaysHeader() {
  const container = document.getElementById('gantt-days-header');
  if (!container || !state.weekInfo) return;

  container.innerHTML = state.weekInfo.days.map(d => `
    <div class="gantt-day-th ${d.isWeekend ? 'weekend' : ''} ${d.isToday ? 'today' : ''}" data-day-index="${d.dayIndex}">
      <span class="th-day-name">${d.dayNameShort}</span>
      <span class="th-day-num">${d.dateNumber}</span>
      ${d.isToday ? '<span class="badge-today-indicator">วันนี้</span>' : ''}
    </div>
  `).join('');
}

// ==========================================
// Sync Plan for the Active Week
// ==========================================
function syncCurrentWeekPlan() {
  if (!state.weekInfo) return;

  const weekStart = state.weekInfo.startIso;
  const weekEnd = state.weekInfo.endIso;

  // Search if a plan already exists in loaded plans from GAS
  const existingPlan = (state.weeklyPlans || []).find(p => {
    return p.startDate === weekStart || (p.startDate >= weekStart && p.startDate <= weekEnd);
  });

  if (existingPlan) {
    state.currentPlan = existingPlan;
    state.planStatus = existingPlan.status || existingPlan.pmStatus || 'Pending';
    state.weekObjective = existingPlan.objective || '';
    state.pmNotes = existingPlan.pmNotes || existingPlan.pmComment || '';
    
    // Load daily tasks from GAS or parse into mainTasks
    loadTasksForPlan(existingPlan.planId);
  } else {
    // Check local draft
    const draftKey = `draft_plan_${state.project.id}_${weekStart}`;
    const savedDraft = localStorage.getItem(draftKey);

    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        state.currentPlan = null;
        state.planStatus = 'Draft';
        state.weekObjective = parsed.objective || '';
        state.mainTasks = parsed.mainTasks || [];
        state.pmNotes = '';
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
  state.weekObjective = '';
  state.pmNotes = '';

  // Seed sample initial tasks for smooth lookahead preview
  const days = state.weekInfo.days;
  state.mainTasks = [
    {
      id: 'MTASK-' + Date.now() + '-1',
      name: 'งานตัดหัวเข็มและสกัดเปิดเหล็ก ฐานราก F1-F8',
      category: 'งานฐานราก',
      categoryColor: 'cat-foundation',
      workArea: 'โซนทิศเหนือ (Gridline A-D)',
      startDayIndex: 0,
      endDayIndex: 2,
      startDate: days[0].iso,
      endDate: days[2].iso,
      subtasks: [
        {
          id: 'STASK-101',
          name: 'สกัดคอนกรีตหัวเข็มให้ได้ระดับ -1.50 ม.',
          workArea: 'โซน A',
          description: 'ใช้สกัดลมตัดหัวเข็ม ระวังอย่าให้เหล็กเสริมเสียหาย',
          targetQty: '8 ต้น',
          plannedWorkers: 4,
          machinery: 'เครื่องสกัดลม 2 ตัว, รถขุด PC200',
          actualStatus: 'Pending',
          actualProgress: 0,
          actualDate: null,
          reportedBy: null
        },
        {
          id: 'STASK-102',
          name: 'เทคอนกรีตหยาบรองก้นหลุม (Lean Concrete)',
          workArea: 'โซน A',
          description: 'หนา 10 ซม. ปาดเรียบได้ระดับ',
          targetQty: '15 ตร.ม.',
          plannedWorkers: 3,
          machinery: 'รถโม่คอนกรีต',
          actualStatus: 'Pending',
          actualProgress: 0,
          actualDate: null,
          reportedBy: null
        }
      ]
    },
    {
      id: 'MTASK-' + Date.now() + '-2',
      name: 'งานเข้าแบบและผูกเหล็กเสริมฐานราก F1-F4',
      category: 'งานโครงสร้าง',
      categoryColor: 'cat-structure',
      workArea: 'โซนทิศเหนือ',
      startDayIndex: 2,
      endDayIndex: 4,
      startDate: days[2].iso,
      endDate: days[4].iso,
      subtasks: [
        {
          id: 'STASK-201',
          name: 'ผูกเหล็กข้ออ้อย DB20 ฐานราก F1-F4',
          workArea: 'โซน A',
          description: 'ผูกเหล็กตะแกรงล่าง-บน พร้อมหนุนลูกปูน 7.5 ซม.',
          targetQty: '4 หลุม',
          plannedWorkers: 5,
          machinery: 'เครื่องดัดเหล็ก, เครื่องตัดไฟเบอร์',
          actualStatus: 'Pending',
          actualProgress: 0,
          actualDate: null,
          reportedBy: null
        },
        {
          id: 'STASK-202',
          name: 'ติดตั้งแบบหล่อข้างฐานรากและค้ำยัน',
          workArea: 'โซน A',
          description: 'แบบเหล็ก ทาน้ำยาถอดแบบ ค้ำยันแน่นหนา',
          targetQty: '4 หลุม',
          plannedWorkers: 3,
          machinery: '-',
          actualStatus: 'Pending',
          actualProgress: 0,
          actualDate: null,
          reportedBy: null
        }
      ]
    }
  ];

  // Auto-expand the first task
  state.expandedTasks.add(state.mainTasks[0].id);
}

async function loadTasksForPlan(planId) {
  try {
    const tasks = await gasService.fetchDailyTasks(planId);
    if (tasks && tasks.length > 0) {
      // Group tasks by category or parent_task_name into Gantt mainTasks
      const grouped = {};
      const days = state.weekInfo.days;

      tasks.forEach((t, idx) => {
        const cat = t.category || 'งานโครงสร้าง';
        const groupKey = t.parent_task_name || cat;

        if (!grouped[groupKey]) {
          grouped[groupKey] = {
            id: 'MTASK-' + planId + '-' + Object.keys(grouped).length,
            name: groupKey,
            category: cat,
            categoryColor: getCategoryColorClass(cat),
            workArea: t.workArea || t.work_area || '',
            startDayIndex: 0,
            endDayIndex: 6,
            startDate: state.weekInfo.startIso,
            endDate: state.weekInfo.endIso,
            subtasks: []
          };
        }

        grouped[groupKey].subtasks.push({
          id: t.taskId || ('STASK-' + idx),
          name: t.taskName || t.name || '-',
          workArea: t.workArea || '',
          description: t.description || t.taskDesc || '',
          targetQty: t.targetQty || t.quantity || '',
          plannedWorkers: Number(t.plannedWorkers) || 0,
          machinery: t.machinery || '-',
          actualStatus: t.actualStatus || (Number(t.progress || t.actualProgress) >= 100 ? 'Completed' : 'Pending'),
          actualProgress: Number(t.progress || t.actualProgress) || 0,
          actualDate: t.taskDate || null,
          reportedBy: t.foremanName || t.reportedBy || null
        });
      });

      state.mainTasks = Object.values(grouped);
      // Auto-expand all
      state.mainTasks.forEach(m => state.expandedTasks.add(m.id));
      renderGanttTable();
      updateKPISummary();
    }
  } catch (e) {
    console.warn('loadTasksForPlan error:', e);
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
  const objInput = document.getElementById('input-week-objective');
  const pmBox = document.getElementById('pm-directive-box');

  if (objInput) {
    objInput.value = state.weekObjective || '';
  }

  // Status Badge
  if (statusContainer) {
    const st = state.planStatus;
    let badgeClass = 'draft';
    let badgeText = '📝 ร่างแผนงาน (ยังไม่ได้ยื่น)';

    if (st === 'Approved') {
      badgeClass = 'approved';
      badgeText = '🟢 PM อนุมัติแล้ว (โฟร์แมนเริ่มงานได้)';
    } else if (st === 'Pending') {
      badgeClass = 'pending';
      badgeText = '🟡 รอ PM พิจารณาอนุมัติ';
    } else if (st === 'Revision') {
      badgeClass = 'revision';
      badgeText = '🔴 PM สั่งปรับปรุงแผนงาน';
    }

    statusContainer.innerHTML = `<span class="gantt-status-pill ${badgeClass}">${badgeText}</span>`;
  }

  // PM Directive Box
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

  const avgWorkers = Math.round(totalWorkers / 7);
  const avgProgress = totalSubtasks > 0 ? Math.round(progressSum / totalSubtasks) : 0;

  if (mainTasksEl) mainTasksEl.innerText = `${mainCount} รายการ`;
  if (subtasksCountEl) subtasksCountEl.innerText = `${totalSubtasks} งานย่อย`;
  if (avgWorkersEl) avgWorkersEl.innerText = `${avgWorkers} คน/วัน`;
  if (machineryCountEl) machineryCountEl.innerText = `${machinesSet.size} ชนิด`;
  if (progressEl) progressEl.innerText = `${avgProgress}%`;
}

// ==========================================
// RENDER GANTT TABLE (Split Table with Drag/Drop)
// ==========================================
function renderGanttTable() {
  const tbody = document.getElementById('gantt-table-body');
  if (!tbody || !state.weekInfo) return;

  if (state.mainTasks.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2">
          <div class="gantt-empty-state">
            <div class="empty-icon">📊</div>
            <h3>ยังไม่มีรายการงานหลักในสัปดาห์นี้</h3>
            <p>กดปุ่ม "➕ เพิ่มรายการงานหลัก" ด้านบนเพื่อเริ่มกำหนดแผนงาน หรือกด "สัปดาห์นี้" เพื่อดูตัวอย่างงาน</p>
            <button type="button" class="btn-gantt-primary" onclick="window.openAddMainTaskModal()" style="margin: 0 auto;">
              ➕ เพิ่มรายการงานหลักแรก
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
    // Ensure valid indices within 0..6
    let sIdx = Number(m.startDayIndex);
    let eIdx = Number(m.endDayIndex);
    if (isNaN(sIdx) || sIdx < 0) sIdx = 0;
    if (isNaN(eIdx) || eIdx > 6) eIdx = 6;
    if (sIdx > eIdx) eIdx = sIdx;
    m.startDayIndex = sIdx;
    m.endDayIndex = eIdx;

    const durDays = (m.endDayIndex - m.startDayIndex) + 1;
    const sDate = state.weekInfo.days[m.startDayIndex];
    const eDate = state.weekInfo.days[m.endDayIndex];

    const leftPct = (m.startDayIndex * 100) / 7;
    const widthPct = (durDays * 100) / 7;

    // Compute subtasks average progress
    let taskProgressSum = 0;
    subtasks.forEach(st => taskProgressSum += Number(st.actualProgress || 0));
    const taskAvgProgress = subtasks.length > 0 ? Math.round(taskProgressSum / subtasks.length) : 0;

    // 1. MAIN TASK ROW
    html += `
      <tr class="gantt-task-row" data-task-id="${m.id}" data-task-idx="${mIdx}">
        
        <!-- Left Meta Cell -->
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
                ${sDate.dayNameShort} ${sDate.dateNumber} - ${eDate.dayNameShort} ${eDate.dateNumber} (${durDays} วัน)
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

        <!-- Right Timeline Cell with Interactive Gantt Bar -->
        <td class="gantt-timeline-cell">
          <div class="gantt-timeline-track" data-track-id="${m.id}">
            
            <!-- 7 Background Day Columns for Guidelines -->
            ${state.weekInfo.days.map(d => `
              <div class="gantt-track-day-col ${d.isWeekend ? 'weekend' : ''} ${d.isToday ? 'today' : ''}" data-day-index="${d.dayIndex}" title="คลิกเพื่อย้ายงานมาที่วัน${d.dayNameShort}"></div>
            `).join('')}

            <!-- The Draggable / Resizable Gantt Bar (Pixel-Perfect % Positioning) -->
            <div 
              class="gantt-bar-element ${m.categoryColor || 'cat-structure'}" 
              id="gantt-bar-${m.id}"
              data-task-id="${m.id}"
              style="left: calc(${leftPct}% + 4px); width: calc(${widthPct}% - 8px);"
              title="${escapeHtml(m.name)}: วัน${sDate.dayNameShort} ${sDate.dateNumber} ถึง วัน${eDate.dayNameShort} ${eDate.dateNumber} (${durDays} วัน)"
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

    // 2. SUBTASKS ACCORDION ROW (Displayed directly below main task)
    if (isExpanded) {
      html += `
        <tr class="subtasks-accordion-row" id="subtasks-row-${m.id}">
          <td colspan="2">
            <div class="subtasks-wrapper-box">
              <div class="subtasks-branch-line"></div>

              <div class="subtasks-header-bar">
                <div class="subtasks-title-hint">
                  ⚡ งานย่อยสำหรับโฟร์แมนดำเนินการจริง (${subtasks.length} รายการ)
                </div>
                <span class="subtasks-rule-pill">
                  💡 งานย่อยไม่มีวันที่บังคับ — โฟร์แมนจะรายงานตามที่ทำได้จริงหน้างาน
                </span>
              </div>

              ${subtasks.length === 0 ? `
                <div style="background: #ffffff; padding: 12px; border-radius: 6px; border: 1.5px dashed var(--border-subtle); text-align: center; color: var(--text-muted); font-size: 0.78rem;">
                  ยังไม่มีงานย่อยในรายการนี้ — กดปุ่ม "+ เพิ่มงานย่อยในรายการนี้" ด้านล่างเพื่อแตกงานให้โฟร์แมน
                </div>
              ` : `
                <div class="subtasks-cards-list">
                  ${subtasks.map((st, stIdx) => {
                    const isDone = st.actualStatus === 'Completed' || Number(st.actualProgress) >= 100;
                    return `
                      <div class="subtask-card-item" data-subtask-id="${st.id}">
                        <div class="subtask-card-left">
                          <span class="subtask-bullet">↳</span>
                          <div>
                            <div class="subtask-name-main">${escapeHtml(st.name)}</div>
                            ${st.description ? `<div class="subtask-desc-detail">📝 ${escapeHtml(st.description)}</div>` : ''}
                            <div class="subtask-tags-row">
                              ${st.workArea ? `<span class="subtask-tag">📍 โซน: <strong>${escapeHtml(st.workArea)}</strong></span>` : ''}
                              ${st.targetQty ? `<span class="subtask-tag">🎯 เป้าหมาย: <strong>${escapeHtml(st.targetQty)}</strong></span>` : ''}
                              ${st.plannedWorkers ? `<span class="subtask-tag">👷 แผนคนงาน: <strong>${st.plannedWorkers} คน</strong></span>` : ''}
                              ${st.machinery && st.machinery !== '-' ? `<span class="subtask-tag">🚜 เครื่องจักร: <strong>${escapeHtml(st.machinery)}</strong></span>` : ''}
                            </div>
                          </div>
                        </div>

                        <div class="subtask-card-right">
                          <div class="subtask-actual-status-box">
                            <span class="actual-status-pill ${isDone ? 'done' : 'pending'}">
                              ${isDone ? '✓ ทำเสร็จแล้ว' : (Number(st.actualProgress) > 0 ? `กำลังทำ ${st.actualProgress}%` : '⏳ รอโฟร์แมนรายงาน')}
                            </span>
                            ${st.actualDate ? `<div class="actual-reported-note">ทำจริงวันที่: ${st.actualDate}</div>` : ''}
                            ${st.reportedBy ? `<div class="actual-reported-note">โดย: ${escapeHtml(st.reportedBy)}</div>` : ''}
                          </div>

                          <button type="button" class="btn-remove-subtask" onclick="window.deleteSubtask('${m.id}', '${st.id}')" title="ลบงานย่อยนี้">
                            &times;
                          </button>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              `}

              <button type="button" class="btn-add-subtask-under-task" onclick="window.openAddSubtaskModal('${m.id}')">
                ➕ เพิ่มงานย่อยในรายการนี้
              </button>
            </div>
          </td>
        </tr>
      `;
    }
  });

  tbody.innerHTML = html;

  // Re-attach interactive drag & drop events to Gantt bars
  initGanttDragAndResize();
}

// ==========================================
// INTERACTIVE GANTT DRAG & RESIZE ENGINE
// ==========================================
function initGanttDragAndResize() {
  const bars = document.querySelectorAll('.gantt-bar-element');

  bars.forEach(bar => {
    const taskId = bar.dataset.taskId;
    const task = state.mainTasks.find(t => t.id === taskId);
    if (!task) return;

    let dragType = null; // 'left' | 'right' | 'body'
    let startX = 0;
    let initialStart = task.startDayIndex;
    let initialEnd = task.endDayIndex;
    let trackRect = null;
    let track = null;

    const onMouseDown = (e) => {
      // Determine if clicking handle or bar body
      const handle = e.target.closest('.gantt-bar-handle');
      if (handle) {
        dragType = handle.dataset.handle; // 'left' or 'right'
      } else {
        dragType = 'body';
      }

      startX = e.clientX;
      initialStart = task.startDayIndex;
      initialEnd = task.endDayIndex;

      track = bar.closest('.gantt-timeline-track');
      if (track) {
        trackRect = track.getBoundingClientRect();
      }

      bar.classList.add('dragging');
      document.body.style.cursor = dragType === 'body' ? 'grabbing' : 'ew-resize';
      document.body.style.userSelect = 'none';

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      e.stopPropagation();
    };

    const onMouseMove = (e) => {
      if (!dragType || !trackRect) return;

      const cellWidth = trackRect.width / 7;
      const deltaX = e.clientX - startX;
      const dayDelta = Math.round(deltaX / cellWidth);

      let newStart = initialStart;
      let newEnd = initialEnd;

      if (dragType === 'left') {
        newStart = Math.min(initialEnd, Math.max(0, initialStart + dayDelta));
      } else if (dragType === 'right') {
        newEnd = Math.max(initialStart, Math.min(6, initialEnd + dayDelta));
      } else if (dragType === 'body') {
        const duration = initialEnd - initialStart;
        newStart = initialStart + dayDelta;
        newEnd = newStart + duration;

        if (newStart < 0) {
          newStart = 0;
          newEnd = duration;
        }
        if (newEnd > 6) {
          newEnd = 6;
          newStart = 6 - duration;
        }
      }

      // Live Percentage positioning matching the 7 columns perfectly
      const leftPct = (newStart * 100) / 7;
      const widthPct = ((newEnd - newStart + 1) * 100) / 7;
      bar.style.left = `calc(${leftPct}% + 4px)`;
      bar.style.width = `calc(${widthPct}% - 8px)`;

      const durDays = (newEnd - newStart) + 1;
      const countLabel = bar.querySelector('.gantt-bar-days-count');
      if (countLabel) countLabel.innerText = `${durDays} วัน`;

      // Update date pill in row
      const sDate = state.weekInfo.days[newStart];
      const eDate = state.weekInfo.days[newEnd];
      const row = bar.closest('.gantt-task-row');
      if (row) {
        const datePill = row.querySelector('.task-date-pill');
        if (datePill) {
          datePill.innerText = `${sDate.dayNameShort} ${sDate.dateNumber} - ${eDate.dayNameShort} ${eDate.dateNumber} (${durDays} วัน)`;
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

      // Live highlight track columns in this row
      if (track) {
        track.querySelectorAll('.gantt-track-day-col').forEach((col, idx) => {
          if (idx >= newStart && idx <= newEnd) {
            col.classList.add('drag-highlight');
          } else {
            col.classList.remove('drag-highlight');
          }
        });
      }
    };

    const onMouseUp = (e) => {
      if (!dragType || !trackRect) return;

      const cellWidth = trackRect.width / 7;
      const deltaX = e.clientX - startX;
      const dayDelta = Math.round(deltaX / cellWidth);

      let newStart = initialStart;
      let newEnd = initialEnd;

      if (dragType === 'left') {
        newStart = Math.min(task.endDayIndex, Math.max(0, initialStart + dayDelta));
      } else if (dragType === 'right') {
        newEnd = Math.max(task.startDayIndex, Math.min(6, initialEnd + dayDelta));
      } else if (dragType === 'body') {
        const duration = initialEnd - initialStart;
        newStart = initialStart + dayDelta;
        newEnd = newStart + duration;
        if (newStart < 0) { newStart = 0; newEnd = duration; }
        if (newEnd > 6) { newEnd = 6; newStart = 6 - duration; }
      }

      task.startDayIndex = newStart;
      task.endDayIndex = newEnd;

      // Finalize ISO dates
      task.startDate = state.weekInfo.days[task.startDayIndex].iso;
      task.endDate = state.weekInfo.days[task.endDayIndex].iso;

      // Remove all highlight classes
      document.querySelectorAll('.drag-highlight').forEach(el => el.classList.remove('drag-highlight'));

      bar.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragType = null;

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      // Auto-save draft and re-render to ensure 100% synchronization
      autoSaveDraft();
      renderGanttTable();
      updateKPISummary();
      showToast(`🗓️ ปรับวันที่: ${task.name} (${(task.endDayIndex - task.startDayIndex) + 1} วัน)`, 'info');
    };

    bar.addEventListener('mousedown', onMouseDown);
  });

  // Direct click on empty day columns to move or place task
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
      if (newEnd > 6) {
        newEnd = 6;
        newStart = Math.max(0, 6 - dur);
      }
      task.startDayIndex = newStart;
      task.endDayIndex = newEnd;
      task.startDate = state.weekInfo.days[newStart].iso;
      task.endDate = state.weekInfo.days[newEnd].iso;

      autoSaveDraft();
      renderGanttTable();
      updateKPISummary();
      showToast(`🗓️ เลื่อนงาน "${task.name}" ไปที่วัน${state.weekInfo.days[newStart].dayNameShort}`, 'info');
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

  // Default dates: day 0 to day 3 of this week
  const days = state.weekInfo.days;
  document.getElementById('input-task-start-date').value = days[0].iso;
  document.getElementById('input-task-end-date').value = days[3].iso;
  updateModalDurationBadge(days[0].iso, days[3].iso);

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
  if (!badge || !sIso || !eIso) return;
  const d1 = new Date(sIso);
  const d2 = new Date(eIso);
  const diffDays = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);
  badge.innerText = `${diffDays} วัน`;
}

function renderModalSubtasksTempList() {
  const listEl = document.getElementById('modal-task-subtasks-list');
  const countEl = document.getElementById('modal-task-subtasks-count');
  if (!listEl) return;

  if (countEl) countEl.innerText = `${state.modalSubtasksTemp.length} รายการ`;

  if (state.modalSubtasksTemp.length === 0) {
    listEl.innerHTML = `<div style="text-align:center; padding:10px; color:var(--text-muted); font-size:0.75rem;">ยังไม่มีงานย่อย สามารถเพิ่มได้ด้านล่าง</div>`;
    return;
  }

  listEl.innerHTML = state.modalSubtasksTemp.map((st, idx) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border:1px solid var(--border-subtle); padding:6px 10px; border-radius:4px; font-size:0.75rem;">
      <div>
        <strong style="color:var(--text-heading);">${escapeHtml(st.name)}</strong>
        ${st.targetQty ? `<span style="color:var(--text-muted);"> (${escapeHtml(st.targetQty)})</span>` : ''}
        ${st.plannedWorkers ? `<span style="color:#059669;"> [${st.plannedWorkers} คน]</span>` : ''}
      </div>
      <button type="button" onclick="window.removeModalSubtaskTemp(${idx})" style="background:none; border:none; color:var(--accent-coral); font-size:1rem; cursor:pointer;" title="ลบ">&times;</button>
    </div>
  `).join('');
}

window.removeModalSubtaskTemp = function(idx) {
  state.modalSubtasksTemp.splice(idx, 1);
  renderModalSubtasksTempList();
};

// ==========================================
// MODAL: ADD SINGLE SUBTASK UNDER TASK
// ==========================================
window.openAddSubtaskModal = function(parentTaskId) {
  const task = state.mainTasks.find(t => t.id === parentTaskId);
  if (!task) return;

  document.getElementById('input-subtask-parent-id').value = parentTaskId;
  document.getElementById('subtask-parent-task-name').innerText = task.name;
  document.getElementById('input-quick-subtask-name').value = '';
  document.getElementById('input-quick-subtask-area').value = task.workArea || '';
  document.getElementById('input-quick-subtask-desc').value = '';
  document.getElementById('input-quick-subtask-qty').value = '';
  document.getElementById('input-quick-subtask-workers').value = '4';
  document.getElementById('input-quick-subtask-machinery').value = '';

  document.getElementById('modal-single-subtask').classList.add('active');
  setTimeout(() => document.getElementById('input-quick-subtask-name')?.focus(), 100);
};

// ==========================================
// EVENT BINDINGS
// ==========================================
function bindNavigationEvents() {
  document.getElementById('btn-prev-week')?.addEventListener('click', () => {
    state.currentWeekOffset--;
    calculateWeekInfo(state.currentWeekOffset);
    renderWeekInfoUI();
  });

  document.getElementById('btn-next-week')?.addEventListener('click', () => {
    state.currentWeekOffset++;
    calculateWeekInfo(state.currentWeekOffset);
    renderWeekInfoUI();
  });

  document.getElementById('btn-today-week')?.addEventListener('click', () => {
    state.currentWeekOffset = 0;
    calculateWeekInfo(0);
    renderWeekInfoUI();
  });

  // Toggle all subtasks
  document.getElementById('btn-toggle-all-subtasks')?.addEventListener('click', () => {
    if (state.expandedTasks.size === state.mainTasks.length) {
      state.expandedTasks.clear();
    } else {
      state.mainTasks.forEach(m => state.expandedTasks.add(m.id));
    }
    renderGanttTable();
  });

  // Objective input auto-save
  document.getElementById('input-week-objective')?.addEventListener('input', (e) => {
    state.weekObjective = e.target.value;
    autoSaveDraft();
  });

  // Sync button
  document.getElementById('btn-sync-plans')?.addEventListener('click', async () => {
    showToast('🔄 กำลังซิงก์แผนงานจาก Google Sheets...', 'info');
    await loadWeeklyPlans();
    syncCurrentWeekPlan();
    showToast('ซิงก์แผนงานสำเร็จ!', 'success');
  });
}

function bindToolbarActions() {
  document.getElementById('btn-add-main-task')?.addEventListener('click', () => {
    window.openAddMainTaskModal();
  });

  document.getElementById('btn-save-draft')?.addEventListener('click', () => {
    autoSaveDraft();
    showToast('💾 บันทึกแบบร่างสัปดาห์นี้ลงเครื่องเรียบร้อยแล้ว', 'success');
  });

  document.getElementById('btn-submit-to-pm')?.addEventListener('click', () => {
    openSubmitConfirmModal();
  });
}

function bindModalEvents() {
  // Task Modal Closes
  const modalTask = document.getElementById('modal-main-task');
  document.getElementById('btn-close-task-modal')?.addEventListener('click', () => modalTask.classList.remove('active'));
  document.getElementById('btn-cancel-task-modal')?.addEventListener('click', () => modalTask.classList.remove('active'));

  // Category Presets in Modal
  document.querySelectorAll('.btn-cat-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-cat-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('input-task-category').value = btn.dataset.cat;
    });
  });

  // Quick Duration Buttons
  document.querySelectorAll('.btn-quick-dur').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = Number(btn.dataset.days) || 1;
      const sVal = document.getElementById('input-task-start-date').value;
      if (sVal) {
        const d1 = new Date(sVal);
        const d2 = new Date(d1);
        d2.setDate(d1.getDate() + days - 1);
        document.getElementById('input-task-end-date').value = toIsoDate(d2);
        updateModalDurationBadge(sVal, toIsoDate(d2));
      }
    });
  });

  document.getElementById('input-task-start-date')?.addEventListener('change', () => {
    const s = document.getElementById('input-task-start-date').value;
    const e = document.getElementById('input-task-end-date').value;
    updateModalDurationBadge(s, e);
  });

  document.getElementById('input-task-end-date')?.addEventListener('change', () => {
    const s = document.getElementById('input-task-start-date').value;
    const e = document.getElementById('input-task-end-date').value;
    updateModalDurationBadge(s, e);
  });

  // Add subtask inside Task Modal
  document.getElementById('btn-add-subtask-in-modal')?.addEventListener('click', () => {
    const name = document.getElementById('input-modal-new-subtask-name').value.trim();
    const qty = document.getElementById('input-modal-new-subtask-qty').value.trim();
    const workers = document.getElementById('input-modal-new-subtask-workers').value;
    const mach = document.getElementById('input-modal-new-subtask-machinery').value.trim();

    if (!name) {
      showToast('กรุณาระบุชื่องานย่อย', 'warning');
      document.getElementById('input-modal-new-subtask-name').focus();
      return;
    }

    state.modalSubtasksTemp.push({
      id: 'STASK-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      name: name,
      workArea: document.getElementById('input-task-area').value.trim(),
      description: '',
      targetQty: qty,
      plannedWorkers: Number(workers) || 0,
      machinery: mach || '-',
      actualStatus: 'Pending',
      actualProgress: 0,
      actualDate: null
    });

    document.getElementById('input-modal-new-subtask-name').value = '';
    document.getElementById('input-modal-new-subtask-qty').value = '';
    renderModalSubtasksTempList();
  });

  // Save Task Modal
  document.getElementById('btn-save-task-modal')?.addEventListener('click', () => {
    const name = document.getElementById('input-task-name').value.trim();
    const area = document.getElementById('input-task-area').value.trim();
    const cat = document.getElementById('input-task-category').value.trim() || 'งานโครงสร้าง';
    const sDate = document.getElementById('input-task-start-date').value;
    const eDate = document.getElementById('input-task-end-date').value;

    if (!name) {
      showToast('กรุณาระบุชื่องานหลัก', 'warning');
      document.getElementById('input-task-name').focus();
      return;
    }
    if (!sDate || !eDate) {
      showToast('กรุณาระบุวันเริ่มต้นและสิ้นสุดของงาน', 'warning');
      return;
    }

    // Map sDate and eDate to 0..6 day indices relative to week
    const days = state.weekInfo.days;
    let sIdx = days.findIndex(d => d.iso === sDate);
    let eIdx = days.findIndex(d => d.iso === eDate);

    if (sIdx === -1) sIdx = 0;
    if (eIdx === -1) eIdx = 6;
    if (sIdx > eIdx) eIdx = sIdx;

    if (state.editingTaskId) {
      // Edit existing
      const task = state.mainTasks.find(t => t.id === state.editingTaskId);
      if (task) {
        task.name = name;
        task.workArea = area;
        task.category = cat;
        task.categoryColor = getCategoryColorClass(cat);
        task.startDate = sDate;
        task.endDate = eDate;
        task.startDayIndex = sIdx;
        task.endDayIndex = eIdx;
        task.subtasks = state.modalSubtasksTemp;
      }
    } else {
      // Create new
      const newId = 'MTASK-' + Date.now();
      state.mainTasks.push({
        id: newId,
        name: name,
        workArea: area,
        category: cat,
        categoryColor: getCategoryColorClass(cat),
        startDate: sDate,
        endDate: eDate,
        startDayIndex: sIdx,
        endDayIndex: eIdx,
        subtasks: state.modalSubtasksTemp
      });
      state.expandedTasks.add(newId);
    }

    modalTask.classList.remove('active');
    autoSaveDraft();
    renderGanttTable();
    updateKPISummary();
    showToast('บันทึกรายการงานหลักสำเร็จ!', 'success');
  });

  // Single Subtask Modal Closes
  const modalSubtask = document.getElementById('modal-single-subtask');
  document.getElementById('btn-close-subtask-modal')?.addEventListener('click', () => modalSubtask.classList.remove('active'));
  document.getElementById('btn-cancel-subtask-modal')?.addEventListener('click', () => modalSubtask.classList.remove('active'));

  // Confirm Add Single Subtask
  document.getElementById('btn-confirm-add-subtask')?.addEventListener('click', () => {
    const parentId = document.getElementById('input-subtask-parent-id').value;
    const name = document.getElementById('input-quick-subtask-name').value.trim();
    const area = document.getElementById('input-quick-subtask-area').value.trim();
    const desc = document.getElementById('input-quick-subtask-desc').value.trim();
    const qty = document.getElementById('input-quick-subtask-qty').value.trim();
    const workers = document.getElementById('input-quick-subtask-workers').value;
    const mach = document.getElementById('input-quick-subtask-machinery').value.trim();

    if (!name) {
      showToast('กรุณาระบุชื่องานย่อย', 'warning');
      document.getElementById('input-quick-subtask-name').focus();
      return;
    }

    const mainTask = state.mainTasks.find(t => t.id === parentId);
    if (!mainTask) return;

    if (!mainTask.subtasks) mainTask.subtasks = [];

    mainTask.subtasks.push({
      id: 'STASK-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      name: name,
      workArea: area || mainTask.workArea || '',
      description: desc,
      targetQty: qty,
      plannedWorkers: Number(workers) || 0,
      machinery: mach || '-',
      actualStatus: 'Pending',
      actualProgress: 0,
      actualDate: null
    });

    state.expandedTasks.add(parentId);
    modalSubtask.classList.remove('active');
    autoSaveDraft();
    renderGanttTable();
    updateKPISummary();
    showToast('เพิ่มงานย่อยลงในแผนเรียบร้อยแล้ว', 'success');
  });

  // Project selector
  setupProjectModal();
}

function openSubmitConfirmModal() {
  const modal = document.getElementById('modal-submit-confirm');
  if (!modal || !state.weekInfo) return;

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

  const avgWorkers = Math.round(totalWorkers / 7);

  document.getElementById('submit-confirm-week-label').innerText = state.weekInfo.label;
  document.getElementById('submit-confirm-date-range').innerText = `${state.weekInfo.startIso} ถึง ${state.weekInfo.endIso}`;
  document.getElementById('submit-summary-main-tasks').innerText = `${state.mainTasks.length} รายการ`;
  document.getElementById('submit-summary-subtasks').innerText = `${totalSubtasks} งานย่อย`;
  document.getElementById('submit-summary-workers').innerText = `${avgWorkers} คน/วัน`;
  document.getElementById('submit-summary-project').innerText = state.project.name;

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

  showToast('🚀 กำลังส่งแผนงานและงานย่อยให้ PM พิจารณา...', 'info');

  const planId = state.currentPlan?.planId || ('WPLAN-' + Date.now());
  const foremanNote = document.getElementById('input-submit-note')?.value.trim() || 'ส่งแผนงานสัปดาห์จากระบบ Gantt Planner';

  // Flatten subtasks for Plan_Daily_Tasks table in Google Sheets
  const dailyTasksPayload = [];

  state.mainTasks.forEach((m, mIdx) => {
    const subtasks = m.subtasks || [];
    if (subtasks.length === 0) {
      // If a main task has no subtasks, emit the main task itself as a task
      dailyTasksPayload.push({
        task_id: m.id,
        plan_id: planId,
        date: m.startDate,
        day: m.category,
        company: state.subcontractor.name,
        category: m.category,
        task_name: m.name,
        description: `[${m.startDate} ถึง ${m.endDate}] ${m.workArea || ''}`,
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
          date: m.startDate, // default planned date is main task start date
          day: m.category,
          company: state.subcontractor.name,
          category: m.category,
          task_name: st.name,
          description: `${m.name}: ${st.description || ''} [โซน: ${st.workArea || m.workArea || '-'}]`,
          work_area: st.workArea || m.workArea || '',
          quantity: st.targetQty || '-',
          planned_workers: Number(st.plannedWorkers || 0),
          machinery: st.machinery || '-'
        });
      });
    }
  });

  const payload = {
    plan_id: planId,
    project_id: state.project.id,
    project_name: state.project.name,
    sub_id: state.subcontractor.id,
    company_name: state.subcontractor.name,
    week_label: state.weekInfo.label,
    start_date: state.weekInfo.startIso,
    end_date: state.weekInfo.endIso,
    weekly_objective: state.weekObjective || 'ดำเนินการตามแผนงานสัปดาห์',
    foreman_note: foremanNote,
    daily_tasks: dailyTasksPayload,
    tasks: dailyTasksPayload
  };

  try {
    const res = await gasService.saveWeeklyPlan(payload);
    if (res && res.success) {
      showToast('🎉 ส่งแผนงานสัปดาห์สำเร็จ! รอ PM กดอนุมัติเพื่อส่งต่องานให้โฟร์แมน', 'success');
      state.planStatus = 'Pending';
      renderPlanMetaUI();
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
  if (!state.weekInfo) return;
  const draftKey = `draft_plan_${state.project.id}_${state.weekInfo.startIso}`;
  const data = {
    objective: state.weekObjective,
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

  // Filter chips in archive
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
    const plans = await gasService.fetchWeeklyPlans(state.project.id);
    state.weeklyPlans = plans || [];
    renderArchivePlans();
  } catch (err) {
    console.warn('loadWeeklyPlans error:', err);
  }
}

function renderArchivePlans() {
  const container = document.getElementById('weekly-plans-container');
  if (!container) return;

  let filtered = state.weeklyPlans || [];
  if (state.archiveFilter !== 'all') {
    filtered = filtered.filter(p => p.status === state.archiveFilter || p.pmStatus === state.archiveFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted); border: 2px dashed var(--border-subtle); border-radius: var(--radius-sm);">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📋</div>
        <strong style="font-size: 0.95rem;">ยังไม่มีแผนงานรายสัปดาห์ในหมวดหมู่นี้</strong>
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
              🏢 ผู้รับเหมา: <strong>${escapeHtml(p.company || '-')}</strong> | ช่วงเวลา: <strong>${p.startDate} ถึง ${p.endDate}</strong>
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
// Project Selector
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
  calculateWeekInfo(state.currentWeekOffset);
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
