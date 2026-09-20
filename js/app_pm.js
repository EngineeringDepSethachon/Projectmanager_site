/**
 * app_pm.js - Project Manager Executive Center Controller (LV3 - Desktop Dashboard)
 * รวม 3 โมดูลหลักสำหรับ PM:
 * 1. ศูนย์พิจารณาอนุมัติแผนงาน (Approval Center)
 * 2. แผนภูมิ Gantt ไทม์ไลน์ภาพรวมโครงการ (Lookahead Gantt Chart)
 * 3. คลังรายงานประจำวันย้อนหลัง (Daily Reports Archive)
 */

import { gasService } from './gas_service.js';

const state = {
  project: {
    id: localStorage.getItem('site_project_id') || '-',
    name: localStorage.getItem('site_project_name') || '-'
  },
  availableProjects: [],
  user: {
    name: localStorage.getItem('site_line_name') || 'ผู้จัดการโครงการ (PM)',
    uid: localStorage.getItem('site_line_uid') || '-'
  },
  activeTab: 'view-pm-approvals',
  weeklyPlans: [],
  dailyReports: [],
  approvalFilter: 'all',
  reportFilterShift: 'all',
  reportFilterSearch: ''
};

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  parseUrlParams();
  renderProjectInfo();
  setupSubNavTabs();
  setupProjectModal();
  setupFilters();

  await loadProjects();
  await loadWeeklyPlans();
  await loadDailyReports();

  document.getElementById('btn-sync-pm-all')?.addEventListener('click', async () => {
    showToast('🔄 กำลังซิงก์ข้อมูลทั้งหมดจาก Google Sheets...', 'info');
    await loadWeeklyPlans();
    await loadDailyReports();
    showToast('ซิงก์ข้อมูลโครงการสำเร็จ!', 'success');
  });
});

function parseUrlParams() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const prj = urlParams.get('prj') || urlParams.get('projectId');
    const prjName = urlParams.get('prjName') || urlParams.get('projectName');
    const name = urlParams.get('name');

    if (prj) {
      state.project.id = decodeURIComponent(prj);
      localStorage.setItem('site_project_id', state.project.id);
    }
    if (prjName) {
      state.project.name = decodeURIComponent(prjName);
      localStorage.setItem('site_project_name', state.project.name);
    }
    if (name) {
      state.user.name = decodeURIComponent(name);
      localStorage.setItem('site_line_name', state.user.name);
    }
  } catch (e) {}
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
// Top Navigation Tabs (3 Main Modules)
// ==========================================
function setupSubNavTabs() {
  const tabs = document.querySelectorAll('.pm-nav-tab');
  const panes = document.querySelectorAll('.pm-view-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const viewId = tab.dataset.view;
      if (!viewId) return;

      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      panes.forEach(p => {
        if (p.id === viewId) {
          p.style.display = 'block';
          p.classList.add('active');
        } else {
          p.style.display = 'none';
          p.classList.remove('active');
        }
      });

      state.activeTab = viewId;

      if (viewId === 'view-pm-gantt') {
        renderGanttChart();
      } else if (viewId === 'view-pm-reports') {
        renderDailyReportsTable();
      }
    });
  });
}

// ==========================================
// 1. Approval Center (ศูนย์อนุมัติแผนงาน)
// ==========================================
async function loadWeeklyPlans() {
  try {
    const plans = await gasService.fetchWeeklyPlans(state.project.id);
    state.weeklyPlans = plans || [];
    renderApprovalPlans();
    updateBadges();
    if (state.activeTab === 'view-pm-gantt') renderGanttChart();
  } catch (err) {
    console.warn('loadWeeklyPlans error:', err);
  }
}

function updateBadges() {
  const pendingCount = (state.weeklyPlans || []).filter(p => p.status === 'Pending').length;
  const badgePending = document.getElementById('badge-pending-plans');
  if (badgePending) {
    if (pendingCount > 0) {
      badgePending.innerText = pendingCount;
      badgePending.style.display = 'inline-block';
    } else {
      badgePending.style.display = 'none';
    }
  }
}

function renderApprovalPlans() {
  const container = document.getElementById('pm-plans-container');
  if (!container) return;

  let filtered = state.weeklyPlans || [];
  if (state.approvalFilter !== 'all') {
    filtered = filtered.filter(p => p.status === state.approvalFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted); border: 2px dashed var(--border-subtle); border-radius: var(--radius-sm);">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">👔</div>
        <strong style="font-size: 0.95rem;">ไม่พบแผนงานในหมวดหมู่นี้</strong>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const statusClass = p.status === 'Approved' ? 'approved' : (p.status === 'Revision' ? 'revision' : 'pending');
    const statusText = p.status === 'Approved' ? '🟢 อนุมัติแล้ว' : (p.status === 'Revision' ? '🔴 สั่งปรับปรุง' : '🟡 รอการพิจารณา');
    const total = Number(p.totalTasks) || 0;
    const pct = Math.round(Number(p.overallProgress) || 0);

    return `
      <div class="pm-review-card" data-plan-id="${escapeHtml(p.planId)}">
        <div class="pm-card-top">
          <div>
            <div class="weekly-plan-title">${escapeHtml(p.weekLabel || p.planId)}</div>
            <div class="weekly-plan-meta">
              <span>🏢 ผู้รับเหมา: <strong>${escapeHtml(p.company || '-')}</strong></span>
              <span>📅 ช่วงเวลา: <strong>${escapeHtml(p.startDate || '')}</strong> ถึง <strong>${escapeHtml(p.endDate || '')}</strong></span>
              <span>👤 ส่งโดย: ${escapeHtml(p.createdBy || '-')}</span>
              <span>⚡ ความคืบหน้าสะสม: <strong>${pct}%</strong></span>
            </div>
          </div>
          <span class="plan-status-badge ${statusClass}">${statusText}</span>
        </div>

        ${p.objective ? `
          <div class="weekly-plan-objective" style="margin: 0.75rem 0;">
            🎯 <strong>เป้าหมายสัปดาห์ (Milestone):</strong> ${escapeHtml(p.objective)}
          </div>
        ` : ''}

        <div style="margin-bottom: 0.85rem;">
          <button type="button" class="btn-toggle-subtasks" onclick="window.togglePMSubtasks('${p.planId}')">
            <span>🔍 ตรวจสอบงานย่อย 7 วัน (${total} รายการ)</span>
            <span class="subtask-arrow-icon" id="pm-arrow-${p.planId}">▼</span>
          </button>
          <div id="pm-subtasks-${p.planId}" class="plan-subtasks-drawer" style="display: none;"></div>
        </div>

        <div class="pm-action-form">
          <label style="font-size: 0.75rem; font-weight: 800; color: var(--text-heading); display: block; margin-bottom: 4px;">
            ✍️ ข้อสั่งการ / คอมเมนต์จาก PM ถึงหัวหน้าผู้รับเหมา:
          </label>
          <textarea id="pm-notes-${p.planId}" class="form-textarea" rows="2" placeholder="เช่น อนุญาตให้เข้างานตามแผน ให้เน้น Safety บริเวณฐานราก F1...">${p.pmNotes || ''}</textarea>

          <div style="margin-top: 0.6rem; display: flex; gap: 0.6rem;">
            <button type="button" onclick="window.handlePMDecision('${p.planId}', 'Approved')" style="flex: 1; padding: 10px 14px; background: var(--accent-mint); color: #065f46; font-weight: 800; border: 2px solid #065f46; border-radius: var(--radius-xs); cursor: pointer; font-size: 0.85rem;">
              ✅ อนุมัติแผนงาน (Approve)
            </button>
            <button type="button" onclick="window.handlePMDecision('${p.planId}', 'Revision')" style="flex: 1; padding: 10px 14px; background: #fee2e2; color: #991b1b; font-weight: 800; border: 2px solid #991b1b; border-radius: var(--radius-xs); cursor: pointer; font-size: 0.85rem;">
              ⚠️ สั่งปรับปรุงแผน (Revision)
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.togglePMSubtasks = async function(planId) {
  const drawer = document.getElementById(`pm-subtasks-${planId}`);
  const arrow = document.getElementById(`pm-arrow-${planId}`);
  if (!drawer) return;

  if (drawer.style.display === 'block') {
    drawer.style.display = 'none';
    if (arrow) arrow.innerText = '▼';
    return;
  }

  drawer.style.display = 'block';
  if (arrow) arrow.innerText = '▲';
  drawer.innerHTML = `<div style="text-align:center; padding:1rem; color:var(--text-muted);">⏳ กำลังดึงงานย่อย 7 วัน...</div>`;

  try {
    const tasks = await gasService.fetchDailyTasks(planId);
    if (!tasks || tasks.length === 0) {
      drawer.innerHTML = `<div style="text-align:center; padding:0.8rem; color:var(--text-muted);">ไม่มีงานย่อย</div>`;
      return;
    }

    drawer.innerHTML = `
      <div class="subtasks-table-wrapper">
        <table class="subtasks-table">
          <thead>
            <tr>
              <th style="width: 100px;">วันที่</th>
              <th style="width: 100px;">หมวด</th>
              <th>ชื่องาน / รายละเอียด</th>
              <th style="width: 90px;">เป้าหมาย</th>
              <th style="width: 60px;">คน</th>
              <th style="width: 100px;">เครื่องจักร</th>
              <th style="width: 130px;">ผลงานจริง (โฟร์แมน)</th>
            </tr>
          </thead>
          <tbody>
            ${tasks.map(t => `
              <tr>
                <td><strong>${t.taskDate || '-'}</strong><div style="font-size:0.65rem; color:var(--text-muted);">${t.dayOfWeek || ''}</div></td>
                <td><span class="user-role-badge">${escapeHtml(t.category || 'ทั่วไป')}</span></td>
                <td>
                  <strong>${escapeHtml(t.taskName || '-')}</strong>
                  ${t.workArea ? `<div style="font-size:0.72rem; color:var(--text-muted);">📍 โซน: ${escapeHtml(t.workArea)}</div>` : ''}
                  ${t.taskDesc ? `<div style="font-size:0.7rem; color:#64748b;">${escapeHtml(t.taskDesc)}</div>` : ''}
                </td>
                <td><strong>${escapeHtml(t.targetQty || '-')}</strong></td>
                <td>${t.plannedWorkers || '-'}</td>
                <td style="font-size:0.72rem;">${escapeHtml(t.machinery || '-')}</td>
                <td>
                  ${Number(t.actualProgress) > 0 ? `<strong style="color:#059669;">${t.actualProgress}%</strong>` : '<span style="color:var(--text-muted);">-</span>'}
                  ${t.actualQty ? `<div style="font-size:0.68rem;">(${escapeHtml(t.actualQty)})</div>` : ''}
                  ${t.reportedBy ? `<div style="font-size:0.65rem; color:#059669;">โดย: ${escapeHtml(t.reportedBy)}</div>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    drawer.innerHTML = `<div style="padding:0.8rem; color:var(--accent-red);">${err.message}</div>`;
  }
};

window.handlePMDecision = async function(planId, decision) {
  const notesEl = document.getElementById(`pm-notes-${planId}`);
  const notes = notesEl ? notesEl.value.trim() : '';

  if (decision === 'Revision' && !notes) {
    showToast('โปรดระบุเหตุผลหรือข้อสั่งการที่ต้องแก้ไขในช่องข้อคิดเห็น', 'warning');
    if (notesEl) notesEl.focus();
    return;
  }

  const decisionText = decision === 'Approved' ? 'อนุมัติแผนงาน' : 'สั่งปรับปรุงแผนงาน';
  showToast(`⏳ กำลังบันทึกผลการพิจารณา (${decisionText})...`, 'info');

  try {
    const res = await gasService.approveWeeklyPlanPM(planId, decision, notes, state.user.name);
    if (res && res.success) {
      showToast(`✅ บันทึกผล: ${decisionText} สำเร็จ! งานย่อยพร้อมให้โฟร์แมนดึงไปทำงานแล้ว`, 'success');
      await loadWeeklyPlans();
    } else {
      showToast(`⚠️ บันทึกไม่สำเร็จ: ${res?.message || 'โปรดตรวจสอบสิทธิ์'}`, 'warning');
    }
  } catch (err) {
    showToast(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
  }
};

// ==========================================
// 2. Gantt Chart View (แผนภูมิ Gantt ไทม์ไลน์)
// ==========================================
function renderGanttChart() {
  const container = document.getElementById('gantt-chart-container');
  const counterEl = document.getElementById('gantt-total-weeks');
  if (!container) return;

  const plans = state.weeklyPlans || [];
  if (counterEl) counterEl.innerText = `${plans.length} แผนงาน`;

  if (plans.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted); border: 2px dashed var(--border-subtle); border-radius: var(--radius-sm);">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">📊</div>
        <strong>ยังไม่มีแผนงานสัปดาห์สำหรับสร้างแผนภูมิ Gantt</strong>
      </div>
    `;
    return;
  }

  // หาวันที่เริ่มต้นต่ำสุด และวันที่สิ้นสุดสูงสุด
  let minDate = new Date(plans[0].startDate || Date.now());
  let maxDate = new Date(plans[0].endDate || Date.now());

  plans.forEach(p => {
    if (p.startDate) {
      const d1 = new Date(p.startDate);
      if (d1 < minDate) minDate = d1;
    }
    if (p.endDate) {
      const d2 = new Date(p.endDate);
      if (d2 > maxDate) maxDate = d2;
    }
  });

  const totalDays = Math.max(7, Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1);

  let html = `
    <div class="gantt-table-container">
      <table class="gantt-table">
        <thead>
          <tr>
            <th style="width: 280px; text-align: left; padding: 8px 12px;">แผนงาน / ผู้รับเหมา / เป้าหมาย</th>
            <th style="width: 100px; text-align: center;">ช่วงเวลา</th>
            <th style="width: 80px; text-align: center;">สถานะ PM</th>
            <th style="width: 80px; text-align: center;">ความคืบหน้า</th>
            <th style="text-align: left; padding: 8px 12px;">ไทม์ไลน์ Gantt Bar (${totalDays} วัน)</th>
          </tr>
        </thead>
        <tbody>
  `;

  plans.forEach(p => {
    const pct = Math.round(Number(p.overallProgress) || 0);
    const pStart = new Date(p.startDate || minDate);
    const pEnd = new Date(p.endDate || maxDate);
    const offsetDays = Math.max(0, Math.round((pStart - minDate) / (1000 * 60 * 60 * 24)));
    const durationDays = Math.max(1, Math.round((pEnd - pStart) / (1000 * 60 * 60 * 24)) + 1);

    const leftPct = (offsetDays / totalDays) * 100;
    const widthPct = Math.min(100 - leftPct, (durationDays / totalDays) * 100);

    const barColor = p.status === 'Approved' ? '#059669' : (p.status === 'Revision' ? '#dc2626' : '#d97706');
    const statusText = p.status === 'Approved' ? 'อนุมัติแล้ว' : (p.status === 'Revision' ? 'สั่งปรับปรุง' : 'รออนุมัติ');

    html += `
      <tr>
        <td style="padding: 10px 12px;">
          <div style="font-weight: 800; color: var(--text-heading); font-size: 0.85rem;">${escapeHtml(p.weekLabel || p.planId)}</div>
          <div style="font-size: 0.74rem; color: var(--text-muted);">🏢 ${escapeHtml(p.company || '-')}</div>
          ${p.objective ? `<div style="font-size: 0.72rem; color: #475569; margin-top: 2px;">🎯 ${escapeHtml(p.objective)}</div>` : ''}
        </td>
        <td style="text-align: center; font-size: 0.72rem;">
          <div>${p.startDate || '-'}</div>
          <div style="color: var(--text-muted); font-size: 0.65rem;">ถึง ${p.endDate || '-'}</div>
        </td>
        <td style="text-align: center;">
          <span class="subtask-status-pill ${p.status === 'Approved' ? 'done' : (p.status === 'Revision' ? 'pending' : 'inprogress')}">
            ${statusText}
          </span>
        </td>
        <td style="text-align: center; font-weight: 800; color: ${pct >= 100 ? '#059669' : 'inherit'};">
          ${pct}%
        </td>
        <td style="padding: 10px 12px; position: relative;">
          <div class="gantt-track-bg">
            <div class="gantt-bar-item" style="left: ${leftPct}%; width: ${widthPct}%; background: ${barColor};" onclick="window.togglePMSubtasks('${p.planId}')" title="${escapeHtml(p.weekLabel)} (${pct}%)">
              <div class="gantt-bar-progress" style="width: ${pct}%;"></div>
              <span class="gantt-bar-text">${pct}%</span>
            </div>
          </div>
        </td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;
}

// ==========================================
// 3. Daily Reports Archive (คลังรายงานประจำวันย้อนหลัง)
// ==========================================
async function loadDailyReports() {
  try {
    const list = await gasService.fetchDailyReports(state.project.id);
    state.dailyReports = list || [];
    const badge = document.getElementById('badge-total-reports');
    if (badge) badge.innerText = state.dailyReports.length;
    if (state.activeTab === 'view-pm-reports') renderDailyReportsTable();
  } catch (err) {
    console.warn('loadDailyReports error:', err);
  }
}

function renderDailyReportsTable() {
  const container = document.getElementById('reports-table-container');
  const counterEl = document.getElementById('reports-archive-counter');
  if (!container) return;

  let filtered = state.dailyReports || [];

  if (state.reportFilterShift !== 'all') {
    filtered = filtered.filter(r => {
      const shift = String(r.shiftLabel || r.Shift || r['กะการทำงาน'] || '').toLowerCase();
      if (state.reportFilterShift === 'morning') return shift.includes('เช้า') || shift.includes('morning');
      if (state.reportFilterShift === 'evening') return shift.includes('เย็น') || shift.includes('evening') || shift.includes('จบงาน');
      return true;
    });
  }

  if (state.reportFilterSearch) {
    const query = state.reportFilterSearch.toLowerCase();
    filtered = filtered.filter(r => {
      return JSON.stringify(r).toLowerCase().includes(query);
    });
  }

  if (counterEl) counterEl.innerText = `${filtered.length} รายงาน`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted); border: 2px dashed var(--border-subtle); border-radius: var(--radius-sm);">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">📑</div>
        <strong>ไม่พบรายงานประจำวันตามเงื่อนไขที่ค้นหา</strong>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="archive-table-wrapper">
      <table class="archive-table">
        <thead>
          <tr>
            <th style="width: 140px;">รหัสรายงาน / เวลา</th>
            <th style="width: 100px;">วันที่</th>
            <th style="width: 90px;">กะการทำงาน</th>
            <th style="width: 120px;">ผู้รายงาน (โฟร์แมน)</th>
            <th style="width: 140px;">บริษัทผู้รับเหมา</th>
            <th style="width: 100px;">กำลังพล</th>
            <th style="width: 130px;">สภาพอากาศ</th>
            <th>สรุปงาน / ประเด็นปัญหา</th>
            <th style="width: 70px; text-align: center;">รูปภาพ</th>
            <th style="width: 90px; text-align: center;">การจัดการ</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((r, idx) => {
            const reportId = r.id || r['รหัสรายงาน'] || `RPT-${idx}`;
            const date = r.report_date || r['วันที่'] || '-';
            const shift = r.shift_label || r['กะการทำงาน'] || '-';
            const isMorning = String(shift).includes('เช้า');
            const foreman = r.foreman_name || r['ผู้รายงาน'] || '-';
            const comp = r.sub_name || r['บริษัท'] || '-';
            const totalWf = r.totalWorkforce || r['กำลังพลรวม'] || '-';
            const weather = r.weather || r['สภาพอากาศ'] || '-';
            const tasks = r.task_summary || r['สรุปงาน'] || '-';
            const photoCount = r.photo_count || (r.photoUrls ? r.photoUrls.split(',').length : 0);

            return `
              <tr>
                <td>
                  <code style="font-size: 0.72rem; font-weight: 700;">${escapeHtml(reportId)}</code>
                  <div style="font-size: 0.65rem; color: var(--text-muted);">${r.timestamp || ''}</div>
                </td>
                <td><strong>${date}</strong></td>
                <td>
                  <span class="subtask-status-pill ${isMorning ? 'inprogress' : 'done'}">
                    ${isMorning ? '🌅 เช้า' : '🌆 จบงาน'}
                  </span>
                </td>
                <td><strong>${escapeHtml(foreman)}</strong></td>
                <td><span class="user-company-badge">${escapeHtml(comp)}</span></td>
                <td><strong>${totalWf}</strong> คน</td>
                <td style="font-size: 0.75rem;">${escapeHtml(weather)}</td>
                <td style="font-size: 0.75rem; max-width: 250px;">
                  <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(tasks)}">
                    ${escapeHtml(tasks)}
                  </div>
                </td>
                <td style="text-align: center;">
                  <span class="badge-hint" style="font-size: 0.68rem;">📷 ${photoCount}</span>
                </td>
                <td style="text-align: center;">
                  <button type="button" class="btn-sync-inline" onclick="window.viewReportDetails(${idx})" style="padding: 3px 8px; font-size: 0.72rem;">
                    🔍 เปิดดู
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

window.viewReportDetails = function(idx) {
  const r = state.dailyReports[idx];
  if (!r) return;

  const modal = document.getElementById('modal-report-details');
  const body = document.getElementById('modal-report-body');
  const title = document.getElementById('modal-report-title');
  if (!modal || !body) return;

  const reportId = r.id || r['รหัสรายงาน'] || 'REPORT';
  if (title) title.innerText = `รายงานฉบับเต็ม: ${reportId}`;

  const photoList = r.photoUrls ? r.photoUrls.split(',').map(s => s.trim()).filter(Boolean) : [];

  body.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-bottom: 1rem; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid var(--border-subtle);">
      <div>
        <div>📅 <strong>วันที่รายงาน:</strong> ${r.report_date || r['วันที่'] || '-'} (${r.shift_label || r['กะการทำงาน'] || '-'})</div>
        <div>👤 <strong>โฟร์แมนผู้รายงาน:</strong> ${r.foreman_name || r['ผู้รายงาน'] || '-'}</div>
        <div>🏢 <strong>บริษัท:</strong> ${r.sub_name || r['บริษัท'] || '-'}</div>
      </div>
      <div>
        <div>☀️ <strong>สภาพอากาศ:</strong> ${r.weather || r['สภาพอากาศ'] || '-'}</div>
        <div>🌧️ <strong>เวลาหยุดงานจากฝน:</strong> ${r.rain_delay_hours || r['เวลาฝนหยุดงาน'] || 0} ชม.</div>
        <div>👷 <strong>กำลังพลรวม:</strong> ${r.totalWorkforce || r['กำลังพลรวม'] || 0} คน</div>
      </div>
    </div>

    <div style="margin-bottom: 1rem;">
      <h4 style="font-size: 0.85rem; margin-bottom: 0.4rem; color: var(--text-heading);">⚡ รายการงานที่บันทึก:</h4>
      <div style="background: #ffffff; border: 1px solid var(--border-subtle); padding: 10px; border-radius: 4px; font-size: 0.8rem; line-height: 1.5;">
        ${r.task_summary || r['สรุปงาน'] || 'ไม่มีรายการงาน'}
      </div>
    </div>

    ${r.issues || r['ปัญหาอุปสรรค'] ? `
      <div style="margin-bottom: 1rem;">
        <h4 style="font-size: 0.85rem; margin-bottom: 0.4rem; color: #b45309;">⚠️ ปัญหาอุปสรรค / ข้อสังเกต:</h4>
        <div style="background: #fffbeb; border: 1px solid #f59e0b; padding: 10px; border-radius: 4px; font-size: 0.8rem; color: #92400e;">
          ${r.issues || r['ปัญหาอุปสรรค']}
        </div>
      </div>
    ` : ''}

    ${photoList.length > 0 ? `
      <div>
        <h4 style="font-size: 0.85rem; margin-bottom: 0.4rem; color: var(--text-heading);">📸 ภาพถ่ายหน้างาน (${photoList.length} รูป):</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.6rem;">
          ${photoList.map(url => `
            <div style="border: 2px solid var(--border-dark); border-radius: 6px; overflow: hidden; background: #000;">
              <a href="${url}" target="_blank" title="คลิกเพื่อดูรูปขนาดเต็ม">
                <img src="${url}" alt="รูปหน้างาน" style="width: 100%; height: 130px; object-fit: cover; display: block;">
              </a>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;

  modal.classList.add('active');
};

document.getElementById('btn-close-report-modal')?.addEventListener('click', () => {
  document.getElementById('modal-report-details')?.classList.remove('active');
});

// ==========================================
// Filters & Modals
// ==========================================
function setupFilters() {
  document.querySelectorAll('#pm-approval-filters .tag-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pm-approval-filters .tag-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.approvalFilter = btn.dataset.filter;
      renderApprovalPlans();
    });
  });

  document.getElementById('filter-shift')?.addEventListener('change', (e) => {
    state.reportFilterShift = e.target.value;
    renderDailyReportsTable();
  });

  document.getElementById('filter-search')?.addEventListener('input', (e) => {
    state.reportFilterSearch = e.target.value.trim();
    renderDailyReportsTable();
  });
}

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
  loadDailyReports();
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
