/**
 * app_weekly.js - Subcontractor Weekly Planning Controller (LV2 - Desktop-Wide)
 * หน้าจอสำหรับหัวหน้าผู้รับเหมาในการวางแผนสัปดาห์และแตกงานย่อย 7 วันล่วงหน้า เพื่อส่งให้ PM อนุมัติ
 */

import { gasService } from './gas_service.js';

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
    name: localStorage.getItem('site_line_name') || '-',
    avatar: localStorage.getItem('site_line_avatar') || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80'
  },
  weeklyPlans: [],
  statusFilter: 'all',
  newPlanTasks: []
};

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  parseUrlParams();
  renderProfile();
  renderProjectInfo();
  await loadProjects();
  await loadWeeklyPlans();
  setupFilterChips();
  setupNewPlanModal();
  setupProjectModal();

  document.getElementById('btn-sync-plans')?.addEventListener('click', async () => {
    showToast('🔄 กำลังซิงก์แผนงานจาก Google Sheets...', 'info');
    await loadWeeklyPlans();
    showToast('ซิงก์แผนงานสำเร็จ!', 'success');
  });
});

// ==========================================
// URL Query Parameter Parsing
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
  } catch (e) {}
}

function renderProfile() {
  const nameEl = document.getElementById('sub-user-name');
  const compEl = document.getElementById('sub-company-name');
  const avatarEl = document.getElementById('sub-avatar');

  if (nameEl) nameEl.innerText = state.user.name !== '-' ? state.user.name : 'หัวหน้าผู้รับเหมา';
  if (compEl) compEl.innerText = state.subcontractor.name !== '-' ? state.subcontractor.name : 'ไม่ระบุสังกัด';
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
// Load & Render Weekly Plans
// ==========================================
async function loadWeeklyPlans() {
  const container = document.getElementById('weekly-plans-container');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align: center; padding: 2.5rem 0; color: var(--text-muted); font-size: 0.85rem;">
      ⏳ กำลังดึงข้อมูลแผนงานสัปดาห์จาก Google Sheets...
    </div>
  `;

  try {
    const plans = await gasService.fetchWeeklyPlans(state.project.id);
    state.weeklyPlans = plans || [];
    renderWeeklyPlans();
  } catch (err) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem 0; color: var(--accent-red); font-size: 0.85rem;">
        ⚠️ ไม่สามารถดึงแผนงานได้: ${err.message}
      </div>
    `;
  }
}

function renderWeeklyPlans() {
  const container = document.getElementById('weekly-plans-container');
  if (!container) return;

  let filtered = state.weeklyPlans || [];
  if (state.statusFilter !== 'all') {
    filtered = filtered.filter(p => p.status === state.statusFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted); border: 2px dashed var(--border-subtle); border-radius: var(--radius-sm);">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📋</div>
        <strong style="font-size: 0.95rem;">ยังไม่มีแผนงานรายสัปดาห์ในหมวดหมู่นี้</strong>
        <p style="font-size: 0.78rem; margin-top: 0.25rem;">กดปุ่ม "➕ สร้างแผนสัปดาห์ใหม่" ด้านบนเพื่อเริ่มวางแผนงานล่วงหน้า</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const statusClass = p.status === 'Approved' ? 'approved' : (p.status === 'Revision' ? 'revision' : 'pending');
    const statusText = p.status === 'Approved' ? '🟢 PM อนุมัติแล้ว' : (p.status === 'Revision' ? '🔴 สั่งปรับปรุงแผน' : '🟡 รอ PM อนุมัติ');
    const pct = Math.round(Number(p.overallProgress) || 0);
    const finished = Number(p.completedTasks) || 0;
    const total = Number(p.totalTasks) || 0;

    return `
      <div class="weekly-plan-card" data-plan-id="${escapeHtml(p.planId)}">
        <div class="weekly-plan-header">
          <div>
            <div class="weekly-plan-title">${escapeHtml(p.weekLabel || p.planId)}</div>
            <div class="weekly-plan-meta">
              <span>🏢 ผู้รับเหมา: <strong>${escapeHtml(p.company || '-')}</strong></span>
              <span>📅 ช่วงเวลา: <strong>${escapeHtml(p.startDate || '')}</strong> ถึง <strong>${escapeHtml(p.endDate || '')}</strong></span>
              <span>👤 ผู้สร้าง: ${escapeHtml(p.createdBy || '-')}</span>
            </div>
          </div>
          <span class="plan-status-badge ${statusClass}">${statusText}</span>
        </div>

        ${p.objective ? `
          <div class="weekly-plan-objective">
            🎯 <strong>เป้าหมายสัปดาห์ (Milestone):</strong> ${escapeHtml(p.objective)}
          </div>
        ` : ''}

        ${p.pmNotes ? `
          <div class="pm-directive-box ${statusClass}">
            👔 <strong>ข้อสั่งการจาก PM:</strong> ${escapeHtml(p.pmNotes)}
            ${p.approvedAt ? `<div style="font-size:0.68rem; color:var(--text-muted); margin-top:3px;">อนุมัติเมื่อ: ${p.approvedAt} โดย ${p.approvedBy || 'PM'}</div>` : ''}
          </div>
        ` : ''}

        <div class="plan-progress-section">
          <div class="plan-progress-labels">
            <span>ความคืบหน้ารวมจากหน้างาน (คำนวณจากรายงานจริงของโฟร์แมน)</span>
            <strong style="color: ${pct >= 100 ? 'var(--accent-mint)' : 'var(--text-heading)'}; font-size: 0.95rem;">${pct}% (เสร็จ ${finished}/${total} งานย่อย)</strong>
          </div>
          <div class="plan-progress-bar">
            <div class="plan-progress-fill" style="width: ${Math.min(100, Math.max(0, pct))}%;"></div>
          </div>
        </div>

        <div style="margin-top: 0.85rem;">
          <button type="button" class="btn-toggle-subtasks" onclick="window.togglePlanSubtasks('${p.planId}')">
            <span>🔍 ดูตารางงานย่อย 7 วัน (${total} รายการ)</span>
            <span class="subtask-arrow-icon" id="arrow-${p.planId}">▼</span>
          </button>
          <div id="subtasks-container-${p.planId}" class="plan-subtasks-drawer" style="display: none;"></div>
        </div>
      </div>
    `;
  }).join('');
}

// Global toggle for 7-day daily tasks
window.togglePlanSubtasks = async function(planId) {
  const drawer = document.getElementById(`subtasks-container-${planId}`);
  const arrow = document.getElementById(`arrow-${planId}`);
  if (!drawer) return;

  if (drawer.style.display === 'block') {
    drawer.style.display = 'none';
    if (arrow) arrow.innerText = '▼';
    return;
  }

  drawer.style.display = 'block';
  if (arrow) arrow.innerText = '▲';
  drawer.innerHTML = `
    <div style="text-align: center; padding: 1.2rem; color: var(--text-muted); font-size: 0.8rem;">
      ⏳ กำลังดึงรายการงานย่อย 7 วัน...
    </div>
  `;

  try {
    const tasks = await gasService.fetchDailyTasks(planId);
    if (!tasks || tasks.length === 0) {
      drawer.innerHTML = `<div style="text-align: center; padding: 1rem; color: var(--text-muted);">ยังไม่มีรายการงานย่อยในแผนนี้</div>`;
      return;
    }

    drawer.innerHTML = `
      <div class="subtasks-table-wrapper">
        <table class="subtasks-table">
          <thead>
            <tr>
              <th style="width: 110px;">วันที่</th>
              <th style="width: 100px;">หมวดงาน</th>
              <th>ชื่องาน / โซนพื้นที่</th>
              <th style="width: 90px;">เป้าหมาย</th>
              <th style="width: 60px;">คนงาน</th>
              <th style="width: 100px;">เครื่องจักร</th>
              <th style="width: 110px;">สถานะ PM</th>
              <th style="width: 140px;">ผลงานจริง (โฟร์แมน)</th>
            </tr>
          </thead>
          <tbody>
            ${tasks.map(t => {
              const pct = Number(t.actualProgress) || 0;
              const isDone = t.actualStatus === 'Completed' || pct >= 100;
              return `
                <tr class="${isDone ? 'task-row-done' : ''}">
                  <td>
                    <strong>${t.taskDate || '-'}</strong>
                    <div style="font-size: 0.68rem; color: var(--text-muted);">${t.dayOfWeek || ''}</div>
                  </td>
                  <td><span class="user-role-badge">${escapeHtml(t.category || 'ทั่วไป')}</span></td>
                  <td>
                    <strong>${escapeHtml(t.taskName || '-')}</strong>
                    ${t.workArea ? `<div style="font-size: 0.72rem; color: var(--text-muted);">📍 โซน: ${escapeHtml(t.workArea)}</div>` : ''}
                    ${t.taskDesc ? `<div style="font-size: 0.7rem; color: #475569;">${escapeHtml(t.taskDesc)}</div>` : ''}
                  </td>
                  <td><strong>${escapeHtml(t.targetQty || '-')}</strong></td>
                  <td>${t.plannedWorkers ? t.plannedWorkers + ' คน' : '-'}</td>
                  <td style="font-size: 0.72rem;">${escapeHtml(t.machinery || '-')}</td>
                  <td>
                    <span class="subtask-status-pill ${t.pmStatus === 'Approved' ? 'done' : 'pending'}">
                      ${t.pmStatus === 'Approved' ? 'อนุมัติแล้ว' : 'รออนุมัติ'}
                    </span>
                  </td>
                  <td>
                    ${pct > 0 ? `<strong style="color: #059669;">${pct}%</strong>` : '<span style="color:var(--text-muted);">ยังไม่รายงาน</span>'}
                    ${t.actualQty ? `<div style="font-size: 0.7rem; color: var(--text-muted);">จริง: ${escapeHtml(t.actualQty)}</div>` : ''}
                    ${t.reportedBy ? `<div style="font-size: 0.65rem; color: #059669;">โดย: ${escapeHtml(t.reportedBy)}</div>` : ''}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    drawer.innerHTML = `<div style="padding: 1rem; color: var(--accent-red);">เกิดข้อผิดพลาด: ${err.message}</div>`;
  }
};

// ==========================================
// Filter Chips
// ==========================================
function setupFilterChips() {
  document.querySelectorAll('#status-filter-chips .tag-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#status-filter-chips .tag-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.statusFilter = btn.dataset.filter;
      renderWeeklyPlans();
    });
  });
}

// ==========================================
// Setup New Weekly Plan Modal
// ==========================================
function setupNewPlanModal() {
  const modal = document.getElementById('modal-new-weekly-plan');
  const btnOpen = document.getElementById('btn-open-new-plan-modal');
  const btnClose = document.getElementById('btn-close-plan-modal');
  const btnCancel = document.getElementById('btn-cancel-new-plan');
  const btnAddSubtask = document.getElementById('btn-add-subtask-to-list');
  const btnSubmit = document.getElementById('btn-submit-weekly-plan');

  if (!modal) return;

  const closeModal = () => modal.classList.remove('active');
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      document.getElementById('modal-plan-company').innerText = state.subcontractor.name || 'ไม่ระบุ';
      document.getElementById('modal-plan-project').innerText = state.project.name || 'ไม่ระบุ';

      // Default next Monday to Sunday
      const today = new Date();
      const nextMon = new Date(today);
      const day = today.getDay();
      const diff = day === 0 ? 1 : 8 - day;
      nextMon.setDate(today.getDate() + (day === 1 ? 0 : diff));
      const nextSun = new Date(nextMon);
      nextSun.setDate(nextMon.getDate() + 6);

      const toIsoDate = d => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;

      const startInput = document.getElementById('input-plan-start-date');
      const endInput = document.getElementById('input-plan-end-date');
      const subtaskDate = document.getElementById('input-subtask-date');

      if (startInput) startInput.value = toIsoDate(nextMon);
      if (endInput) endInput.value = toIsoDate(nextSun);
      if (subtaskDate) subtaskDate.value = toIsoDate(nextMon);

      const weekLabel = document.getElementById('input-plan-week-label');
      if (weekLabel) {
        weekLabel.value = `สัปดาห์ (${nextMon.getDate()}/${nextMon.getMonth()+1} - ${nextSun.getDate()}/${nextSun.getMonth()+1})`;
      }

      state.newPlanTasks = [];
      renderModalAddedTasks();
      modal.classList.add('active');
    });
  }

  if (btnAddSubtask) {
    btnAddSubtask.addEventListener('click', () => {
      const date = document.getElementById('input-subtask-date')?.value;
      const cat = document.getElementById('input-subtask-cat')?.value.trim();
      const name = document.getElementById('input-subtask-name')?.value.trim();
      const area = document.getElementById('input-subtask-area')?.value.trim();
      const desc = document.getElementById('input-subtask-desc')?.value.trim();
      const qty = document.getElementById('input-subtask-qty')?.value.trim();
      const workers = document.getElementById('input-subtask-workers')?.value;
      const machinery = document.getElementById('input-subtask-machinery')?.value.trim();

      if (!name) {
        showToast('กรุณาระบุชื่องานย่อย', 'warning');
        document.getElementById('input-subtask-name')?.focus();
        return;
      }
      if (!date) {
        showToast('กรุณาระบุวันที่ทำงาน', 'warning');
        return;
      }

      state.newPlanTasks.push({
        id: 'WTASK-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        taskDate: date,
        category: cat || 'ทั่วไป',
        taskName: name,
        workArea: area || '',
        taskDesc: desc,
        targetQty: qty,
        plannedWorkers: Number(workers) || 0,
        plannedMachinery: machinery
      });

      // Clear some inputs
      if (document.getElementById('input-subtask-name')) document.getElementById('input-subtask-name').value = '';
      if (document.getElementById('input-subtask-desc')) document.getElementById('input-subtask-desc').value = '';
      if (document.getElementById('input-subtask-qty')) document.getElementById('input-subtask-qty').value = '';

      renderModalAddedTasks();
      showToast('เพิ่มงานย่อยลงในแผนแล้ว', 'info');
    });
  }

  if (btnSubmit) {
    btnSubmit.addEventListener('click', async () => {
      const startDate = document.getElementById('input-plan-start-date')?.value;
      const endDate = document.getElementById('input-plan-end-date')?.value;
      const weekLabel = document.getElementById('input-plan-week-label')?.value.trim();
      const objective = document.getElementById('input-plan-objective')?.value.trim();

      if (!startDate || !endDate) {
        showToast('กรุณาระบุวันเริ่มต้นและสิ้นสุดสัปดาห์', 'warning');
        return;
      }
      if (state.newPlanTasks.length === 0) {
        showToast('กรุณาเพิ่มงานย่อยอย่างน้อย 1 รายการก่อนส่งแผนงาน', 'warning');
        return;
      }

      btnSubmit.disabled = true;
      btnSubmit.innerText = '⏳ กำลังส่งแผนงานให้ PM...';

      const planPayload = {
        planId: 'WPLAN-' + Date.now(),
        projectId: state.project.id,
        projectName: state.project.name,
        company: state.subcontractor.name,
        startDate,
        endDate,
        weekLabel: weekLabel || `แผนสัปดาห์ ${startDate} ถึง ${endDate}`,
        objective,
        createdBy: state.user.name,
        lineUid: state.user.uid,
        tasks: state.newPlanTasks
      };

      try {
        const res = await gasService.saveWeeklyPlan(planPayload);
        if (res && res.success) {
          showToast('🚀 ยื่นแผนงานรายสัปดาห์สำเร็จ! รอ PM พิจารณาอนุมัติ', 'success');
          closeModal();
          await loadWeeklyPlans();
        } else {
          showToast(`⚠️ ส่งไม่สำเร็จ: ${res?.message || 'โปรดตรวจสอบ'}`, 'warning');
        }
      } catch (err) {
        showToast(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerText = '🚀 ยื่นแผนงานสัปดาห์ (ส่งให้ PM อนุมัติ)';
      }
    });
  }
}

function renderModalAddedTasks() {
  const container = document.getElementById('modal-added-tasks-list');
  const counter = document.getElementById('modal-tasks-counter');
  if (!container) return;

  if (counter) counter.innerText = `${state.newPlanTasks.length} รายการ`;

  if (state.newPlanTasks.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:0.8rem; color:var(--text-muted); font-size:0.75rem;">ยังไม่มีงานย่อยที่เพิ่มเข้ามา</div>`;
    return;
  }

  container.innerHTML = state.newPlanTasks.map((t, idx) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:#ffffff; border:1px solid var(--border-subtle); padding:6px 10px; border-radius:4px; font-size:0.75rem;">
      <div>
        <strong>${t.taskDate}</strong>: <span style="font-weight:700; color:var(--text-heading);">${escapeHtml(t.taskName)}</span>
        ${t.workArea ? `<span style="color:var(--text-muted);"> [📍 ${escapeHtml(t.workArea)}]</span>` : ''}
        ${t.targetQty ? `<span style="color:var(--text-muted);"> (${escapeHtml(t.targetQty)})</span>` : ''}
        ${t.plannedWorkers ? `<span style="color:#059669;"> [${t.plannedWorkers} คน]</span>` : ''}
      </div>
      <button type="button" onclick="window.removeSubtask(${idx})" style="background:none; border:none; color:var(--accent-red); cursor:pointer; font-size:0.9rem;" title="ลบ">&times;</button>
    </div>
  `).join('');
}

window.removeSubtask = function(idx) {
  state.newPlanTasks.splice(idx, 1);
  renderModalAddedTasks();
};

// Project selector
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
  loadWeeklyPlans();
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
