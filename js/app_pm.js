/**
 * app_pm.js - Project Manager Executive Center Controller (LV3 - Desktop Dashboard)
 * ระบบศูนย์บริหารและอนุมัติโครงการสำหรับ PM:
 * 1. ศูนย์พิจารณาอนุมัติแผนงานประจำเดือน (Approval Center)
 *    - ตรวจสอบเป้าหมาย Milestone, รายการงานหลัก, งานย่อยที่ไม่มีวันที่
 *    - คอมเมนต์สั่งการด่วนด้วย Quick Preset Chips หรือพิมพ์สั่งการเอง
 *    - กดอนุมัติ (Approve) หรือสั่งปรับปรุง (Revision)
 * 2. แผนภูมิ Gantt ไทม์ไลน์ภาพรวมโครงการ (Master Monthly Gantt Chart)
 *    - สลับดูเป็นรายเดือน (28-31 วัน)
 *    - แสดงแถบไทม์ไลน์ของผู้รับเหมาทุกรายในโครงการพร้อม % ความคืบหน้าจริง
 * 3. คลังรายงานประจำวันย้อนหลัง (Daily Reports Archive)
 *    - ค้นหาและกรองตาม กะเช้า/กะเย็น, วันที่, โฟร์แมน, ผู้รับเหมา
 *    - เปิดดูรายงานฉบับเต็มพร้อมแกลเลอรีรูปภาพหน้างาน
 */

import { gasService } from './gas_service.js';
import { firebaseService } from './firebase_service.js';
import { downloadDailyReportPDF, printDailyReport, formatDirectDriveImageUrl } from './report_pdf_generator.js';

// ==========================================
// App State
// ==========================================
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
  activeTab: 'view-pm-approvals', // 'view-pm-approvals' | 'view-pm-gantt' | 'view-pm-reports'
  weeklyPlans: [],
  dailyReports: [],
  approvalFilter: 'all',
  reportFilterShift: 'all',
  reportFilterSearch: '',
  currentSelectedReport: null,

  // PM Master Gantt Month State
  pmYear: new Date().getFullYear(),
  pmMonth: new Date().getMonth() // 0-11
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
  setupPMMonthStepper();

  await loadProjects();
  await loadWeeklyPlans();
  await loadDailyReports();
  setupRealtimeSync();

  document.getElementById('btn-sync-pm-all')?.addEventListener('click', async () => {
    showToast('🔄 กำลังซิงก์ข้อมูลทั้งหมดจาก Google Sheets...', 'info');
    await loadWeeklyPlans();
    await loadDailyReports();
    showToast('ซิงก์ข้อมูลโครงการสำเร็จ!', 'success');
  });

  // Modal PDF Actions
  document.getElementById('btn-modal-download-pdf')?.addEventListener('click', async () => {
    if (!state.currentSelectedReport) {
      showToast('กรุณาเลือกรายงานก่อนดาวน์โหลด', 'warning');
      return;
    }
    const btn = document.getElementById('btn-modal-download-pdf');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> กำลังสร้าง PDF...';
    }
    showToast('⏳ กำลังจัดรูปแบบและสร้างเอกสาร PDF (A4)...', 'info');
    try {
      await downloadDailyReportPDF(state.currentSelectedReport, {
        projectName: state.project.name,
        projectId: state.project.id
      });
      showToast('ดาวน์โหลดไฟล์ PDF เรียบร้อยแล้ว', 'success');
    } catch (err) {
      console.error('downloadDailyReportPDF error:', err);
      showToast('เกิดข้อผิดพลาดในการสร้าง PDF - สลับไปเปิดหน้าต่างพิมพ์แทน', 'info');
      printDailyReport(state.currentSelectedReport, {
        projectName: state.project.name,
        projectId: state.project.id
      });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  });

  document.getElementById('btn-modal-print-pdf')?.addEventListener('click', () => {
    if (!state.currentSelectedReport) {
      showToast('กรุณาเลือกรายงานก่อนสั่งพิมพ์', 'warning');
      return;
    }
    printDailyReport(state.currentSelectedReport, {
      projectName: state.project.name,
      projectId: state.project.id
    });
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
        renderMasterMonthlyGantt();
      } else if (viewId === 'view-pm-reports') {
        renderDailyReportsTable();
      } else if (viewId === 'view-pm-approvals') {
        renderApprovalPlans();
      }
    });
  });
}

// ==========================================
// 1. Approval Center (ศูนย์อนุมัติแผนงาน)
// ==========================================
async function loadWeeklyPlans(isSilent = false) {
  try {
    const plans = await gasService.fetchWeeklyPlans(state.project.id);
    // Explicitly filter out any dummy mock seed data
    state.weeklyPlans = (plans || []).filter(p => p.planId !== 'WPLAN-2026-W38-01');
    renderApprovalPlans();
    updateBadges();
    updateExecutiveKPIs();
    if (state.activeTab === 'view-pm-gantt') {
      renderMasterMonthlyGantt();
    }
  } catch (err) {
    if (!isSilent) console.warn('loadWeeklyPlans error:', err);
  }
}

function updateBadges() {
  const pendingCount = (state.weeklyPlans || []).filter(p => (p.status === 'Pending' || p.pmStatus === 'Pending')).length;
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

function updateExecutiveKPIs() {
  const plans = (state.weeklyPlans || []).filter(p => p.planId !== 'WPLAN-2026-W38-01');
  const subsSet = new Set();
  plans.forEach(p => {
    const c = p.submittedByCompany || p.company;
    if (c && c !== '-' && c !== 'ผู้รับเหมา') subsSet.add(c);
  });

  const pendingCount = plans.filter(p => (p.status || p.pmStatus) === 'Pending').length;
  const approvedCount = plans.filter(p => (p.status || p.pmStatus) === 'Approved').length;

  let totalWorkers = 0;
  let totalTasks = 0;
  plans.forEach(p => {
    totalWorkers += Number(p.avgWorkers || 0);
    totalTasks += Number(p.totalTasks || 0);
  });

  const elSubs = document.getElementById('pm-kpi-subs');
  const elPending = document.getElementById('pm-kpi-pending');
  const elApproved = document.getElementById('pm-kpi-approved');
  const elWorkers = document.getElementById('pm-kpi-workers');
  const elTasksSub = document.getElementById('pm-kpi-tasks-sub');

  if (elSubs) elSubs.innerText = `${subsSet.size} บริษัท`;
  if (elPending) elPending.innerText = `${pendingCount} แผน`;
  if (elApproved) elApproved.innerText = `${approvedCount} แผน`;
  if (elWorkers) elWorkers.innerText = `${totalWorkers} คน/วัน`;
  if (elTasksSub) elTasksSub.innerText = `${totalTasks} รายการงานทั้งหมด`;
}

function renderApprovalPlans() {
  const container = document.getElementById('pm-plans-container');
  if (!container) return;

  // Real data only: exclude legacy mock WPLAN-2026-W38-01
  let filtered = (state.weeklyPlans || []).filter(p => p.planId !== 'WPLAN-2026-W38-01');
  if (state.approvalFilter !== 'all') {
    filtered = filtered.filter(p => (p.status === state.approvalFilter || p.pmStatus === state.approvalFilter));
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="pm-empty-executive-state">
        <div class="empty-icon-circle">📋</div>
        <h3>ยังไม่มีแผนงานที่ยื่นส่งเข้ามาในหมวดนี้</h3>
        <p>ระบบเชื่อมโยง Google Sheets แบบเรียลไทม์ — เมื่อหัวหน้าผู้รับเหมายื่นส่งแผนงานประจำเดือน รายการและประวัติผู้ยื่นจะปรากฏที่นี่โดยอัตโนมัติ</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const status = p.status || p.pmStatus || 'Pending';
    const statusClass = status === 'Approved' ? 'approved' : (status === 'Revision' ? 'revision' : 'pending');
    const statusText = status === 'Approved' ? '🟢 อนุมัติแล้ว' : (status === 'Revision' ? '🔴 สั่งปรับปรุง' : '🟡 รอการพิจารณา');
    const total = Number(p.totalTasks) || 0;
    const pct = Math.round(Number(p.overallProgress || p.progress) || 0);
    const avgWf = Number(p.avgWorkers) || 0;

    // Submitter identity from real log / sheet columns
    const submitterName = p.submittedByName || p.createdBy || p.foremanName || 'หัวหน้าผู้รับเหมา';
    const submitterRole = p.submittedByRole || 'หัวหน้าผู้รับเหมา (Subcontractor Lead)';
    const submitterCompany = p.submittedByCompany || p.company || 'ผู้รับเหมาประจำโครงการ';
    const submitDate = p.submittedAt || '-';

    return `
      <div class="pm-plan-approval-card" data-plan-id="${escapeHtml(p.planId)}">
        <!-- Card Header -->
        <div class="pm-plan-card-header">
          <div class="pm-plan-title-box">
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <span class="user-company-badge">🏢 ${escapeHtml(submitterCompany)}</span>
              <span class="pm-plan-id-badge">${escapeHtml(p.planId)}</span>
            </div>
            <h3 style="margin-top: 6px; font-size: 1.15rem; color: var(--text-heading);">${escapeHtml(p.weekLabel || p.planId)}</h3>
            <div class="pm-plan-meta-tags">
              <span>📅 ช่วงเวลาตามแผน: <strong>${escapeHtml(p.startDate || '')}</strong> ถึง <strong>${escapeHtml(p.endDate || '')}</strong></span>
              <span>🕒 วันที่ยื่นส่ง: <strong>${escapeHtml(submitDate)}</strong></span>
            </div>
          </div>
          <span class="gantt-status-pill ${statusClass}">${statusText}</span>
        </div>

        <!-- Real Submitter Profile Section (ดึงจาก Log จริง) -->
        <div class="pm-submitter-profile-box">
          <div class="submitter-avatar-wrap">
            <div class="submitter-avatar-icon">👷</div>
          </div>
          <div class="submitter-info-wrap">
            <div class="submitter-headline">
              <span class="submitter-label">ผู้ยื่นเสนอแผนงาน:</span>
              <strong class="submitter-name">${escapeHtml(submitterName)}</strong>
              <span class="submitter-role-pill">💼 ${escapeHtml(submitterRole)}</span>
              <span class="submitter-verified-pill">✓ บันทึกใน Log ระบบแล้ว</span>
            </div>
            <div class="submitter-subline">
              <span>🏢 บริษัท: <strong>${escapeHtml(submitterCompany)}</strong></span>
              <span>🕒 ส่งเมื่อ: <strong>${escapeHtml(submitDate)}</strong></span>
              ${p.submittedByUid && p.submittedByUid !== '-' ? `<span class="submitter-uid-tag">UID: ${escapeHtml(p.submittedByUid.slice(0, 12))}...</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Card Body -->
        <div class="pm-plan-card-body">
          ${p.objective ? `
            <div class="pm-milestone-box">
              🎯 <strong>เป้าหมายประจำเดือน (Milestone):</strong> ${escapeHtml(p.objective)}
            </div>
          ` : ''}

          <!-- Stats Strip -->
          <div class="pm-plan-stats-strip">
            <div class="pm-stat-chip">
              <span class="chip-label">งานหลักในแผน</span>
              <span class="chip-val">${total} รายการ</span>
            </div>
            <div class="pm-stat-chip">
              <span class="chip-label">กำลังพลเฉลี่ย</span>
              <span class="chip-val">${avgWf} คน/วัน</span>
            </div>
            <div class="pm-stat-chip">
              <span class="chip-label">ความคืบหน้าสะสม</span>
              <span class="chip-val" style="color: ${pct >= 100 ? '#059669' : 'inherit'};">${pct}%</span>
            </div>
            <div class="pm-stat-chip">
              <span class="chip-label">สถานะโฟร์แมน</span>
              <span class="chip-val" style="font-size: 0.82rem; color: #0284c7;">⚡ พร้อมดึงงาน</span>
            </div>
          </div>

          <!-- Latest PM Decision Note (If already reviewed) -->
          ${(p.pmName && p.pmName !== '-' && p.approvedAt && p.approvedAt !== '-') ? `
            <div class="pm-latest-action-box ${statusClass}">
              <div class="action-box-title">
                <span>📌 คำสั่งการล่าสุดจาก PM:</span>
                <span class="action-box-time">บันทึกเมื่อ: ${escapeHtml(p.approvedAt)}</span>
              </div>
              <div class="action-box-by">
                โดย: <strong>${escapeHtml(p.pmName)}</strong> | มติ: <strong>${statusText}</strong>
              </div>
              ${p.pmComment && p.pmComment !== '-' ? `
                <div class="action-box-comment">
                  "${escapeHtml(p.pmComment)}"
                </div>
              ` : ''}
            </div>
          ` : ''}

          <!-- Drawers Button Group (Subtasks + Audit Trail) -->
          <div class="pm-drawers-btn-group">
            <button type="button" class="pm-drawer-toggle-btn btn-view-subtasks" onclick="window.togglePMSubtasks('${p.planId}')">
              <span>🔍 ตรวจสอบงานย่อยในแผนงาน (${total} รายการ)</span>
              <span id="pm-arrow-${p.planId}">▼ ขยายดูรายละเอียด</span>
            </button>
            <button type="button" class="pm-drawer-toggle-btn btn-view-audit" onclick="window.togglePMAuditTrail('${p.planId}')">
              <span>📜 ประวัติการดำเนินการ (Audit Trail)</span>
              <span id="pm-audit-arrow-${p.planId}">▼ ดูประวัติ Log</span>
            </button>
          </div>

          <!-- Drawer Content 1: Subtasks -->
          <div id="pm-subtasks-${p.planId}" class="pm-plan-tasks-drawer" style="display: none;"></div>

          <!-- Drawer Content 2: Audit Trail -->
          <div id="pm-audit-${p.planId}" class="pm-audit-drawer" style="display: none;"></div>
        </div>

        <!-- PM Decision Panel -->
        <div class="pm-decision-panel">
          ${status === 'Approved' ? `
            <div class="pm-approved-banner" style="background: #f0fdf4; border: 1.5px solid #86efac; border-radius: var(--radius-xs); padding: 12px 14px;">
              <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 1.3rem;">✅</span>
                  <div>
                    <strong style="color: #065f46; font-size: 0.92rem;">แผนงานนี้ได้รับการอนุมัติเรียบร้อยแล้ว (Approved)</strong>
                    <div style="font-size: 0.74rem; color: #047857; margin-top: 2px;">
                      พร้อมให้โฟร์แมนดึงไปปฏิบัติงานหน้างาน • พิจารณาโดย: <strong>${escapeHtml(p.pmName || state.user.name)}</strong>
                      ${p.approvedAt && p.approvedAt !== '-' ? `<span>🕒 เมื่อ: ${escapeHtml(p.approvedAt)}</span>` : ''}
                    </div>
                  </div>
                </div>
                <button type="button" class="btn-pm-revision" style="padding: 5px 12px; font-size: 0.72rem;" onclick="window.promptPMRevision('${p.planId}')">
                  ⚠️ สั่งปรับปรุงแผน (Revision)
                </button>
              </div>
              ${(p.pmComment && p.pmComment !== '-') ? `
                <div style="margin-top: 8px; font-size: 0.78rem; background: #ffffff; border-left: 3px solid #059669; padding: 6px 10px; border-radius: 4px; color: #065f46;">
                  💬 <strong>คำสั่งการ:</strong> "${escapeHtml(p.pmComment)}"
                </div>
              ` : ''}
            </div>
          ` : `
            <div>
              <label style="font-size: 0.78rem; font-weight: 800; color: var(--text-heading); display: block; margin-bottom: 6px;">
                ✍️ คำสั่งการ / ความเห็นจาก PM ถึงหัวหน้าผู้รับเหมา:
              </label>

              <!-- Quick Preset Chips -->
              <div class="pm-quick-comments">
                <button type="button" class="btn-quick-comment" onclick="window.setQuickComment('${p.planId}', '✅ อนุมัติแผนงาน อนุญาตให้เข้าปฏิบัติงานตามมาตรการความปลอดภัย')">
                  + อนุมัติเข้างาน
                </button>
                <button type="button" class="btn-quick-comment" onclick="window.setQuickComment('${p.planId}', '⚠️ ขอให้เพิ่มกำลังพลในส่วนงานโครงสร้างให้ทันกำหนด')">
                  + ให้เพิ่มคนงาน
                </button>
                <button type="button" class="btn-quick-comment" onclick="window.setQuickComment('${p.planId}', '⚠️ จัดทำแผนความปลอดภัย (Safety Plan) และติดตั้งค้ำยันให้แน่นหนา')">
                  + เน้น Safety
                </button>
                <button type="button" class="btn-quick-comment" onclick="window.setQuickComment('${p.planId}', '⚠️ ขอให้แยกขั้นตอนเทคอนกรีตและระบุสเปกให้ชัดเจนก่อนเริ่มงาน')">
                  + ขอรายละเอียดเพิ่ม
                </button>
              </div>

              <textarea id="pm-notes-${p.planId}" class="pm-comment-input" rows="2" placeholder="ระบุข้อสั่งการ คำแนะนำ หรือเงื่อนไขเพิ่มเติมถึงผู้รับเหมา...">${p.pmNotes || p.pmComment || ''}</textarea>
            </div>

            <div class="pm-decision-buttons">
              <button type="button" class="btn-pm-revision" onclick="window.handlePMDecision('${p.planId}', 'Revision')">
                ⚠️ สั่งปรับปรุงแผน (Revision)
              </button>
              <button type="button" class="btn-pm-approve" onclick="window.handlePMDecision('${p.planId}', 'Approved')">
                ✅ อนุมัติแผนงานประจำเดือน (Approve)
              </button>
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');
}

window.setQuickComment = function(planId, text) {
  const textarea = document.getElementById(`pm-notes-${planId}`);
  if (textarea) {
    if (textarea.value.trim()) {
      textarea.value += ' ' + text;
    } else {
      textarea.value = text;
    }
    textarea.focus();
  }
};

window.togglePMSubtasks = async function(planId) {
  const drawer = document.getElementById(`pm-subtasks-${planId}`);
  const arrow = document.getElementById(`pm-arrow-${planId}`);
  if (!drawer) return;

  if (drawer.style.display === 'block') {
    drawer.style.display = 'none';
    if (arrow) arrow.innerText = '▼ ขยายดูรายละเอียด';
    return;
  }

  drawer.style.display = 'block';
  if (arrow) arrow.innerText = '▲ ย่อรายละเอียด';
  drawer.innerHTML = `<div style="text-align:center; padding:1.2rem; color:var(--text-muted);">⏳ กำลังดึงรายการงานย่อย...</div>`;

  try {
    const tasks = await gasService.fetchDailyTasks(planId);
    if (!tasks || tasks.length === 0) {
      drawer.innerHTML = `<div style="text-align:center; padding:1rem; color:var(--text-muted); font-size:0.8rem;">ไม่มีรายการงานย่อยในแผนงานนี้</div>`;
      return;
    }

    drawer.innerHTML = `
      <div style="overflow-x: auto;">
        <table class="subtasks-table" style="width: 100%; border-collapse: collapse; font-size: 0.78rem;">
          <thead>
            <tr style="background: #f1f5f9; border-bottom: 1.5px solid var(--border-subtle); text-align: left;">
              <th style="padding: 6px 10px; width: 50px;">#</th>
              <th style="padding: 6px 10px; width: 110px;">หมวดหมู่งาน</th>
              <th style="padding: 6px 10px;">ชื่องานย่อย / รายละเอียด</th>
              <th style="padding: 6px 10px; width: 100px;">เป้าหมาย</th>
              <th style="padding: 6px 10px; width: 70px;">คนงาน</th>
              <th style="padding: 6px 10px; width: 120px;">เครื่องจักร</th>
              <th style="padding: 6px 10px; width: 110px; text-align: right;">ผลงานจริงโฟร์แมน</th>
            </tr>
          </thead>
          <tbody>
            ${tasks.map((t, idx) => {
              const prog = Number(t.progress || t.actualProgress || 0);
              let mainTask = '';
              let zone = t.workArea || '';
              let desc = t.description || '';
              if (desc.includes('[งานหลัก:')) {
                const m = desc.match(/\[งานหลัก:\s*([^\]]+)\]/);
                if (m) mainTask = m[1].trim();
              }
              if (!zone && desc.includes('[โซน:')) {
                const z = desc.match(/\[โซน:\s*([^\]]+)\]/);
                if (z && z[1] !== '-') zone = z[1].trim();
              }
              desc = desc.replace(/\[\d{4}-\d{2}-\d{2}\s+ถึง\s+\d{4}-\d{2}-\d{2}\]/g, '')
                         .replace(/\[งานหลัก:[^\]]+\]/g, '')
                         .replace(/\[โซน:[^\]]+\]/g, '')
                         .trim();
              return `
                <tr style="border-bottom: 1px solid var(--border-subtle);">
                  <td style="padding: 6px 10px; font-weight: 700; color: var(--text-muted);">${idx + 1}</td>
                  <td style="padding: 6px 10px;"><span class="task-cat-badge">${escapeHtml(t.category || 'ทั่วไป')}</span></td>
                  <td style="padding: 6px 10px;">
                    ${mainTask ? `<div style="font-size:0.68rem; color:var(--primary); font-weight:700;">📂 งานหลัก: ${escapeHtml(mainTask)}</div>` : ''}
                    <strong>${escapeHtml(t.name || t.taskName || '-')}</strong>
                    ${zone ? `<div style="font-size:0.7rem; color:var(--text-muted);">📍 โซน: ${escapeHtml(zone)}</div>` : ''}
                    ${desc ? `<div style="font-size:0.7rem; color:#64748b;">${escapeHtml(desc)}</div>` : ''}
                  </td>
                  <td style="padding: 6px 10px;"><strong>${escapeHtml(t.quantity || t.targetQty || '-')}</strong></td>
                  <td style="padding: 6px 10px;">${t.plannedWorkers || 0} คน</td>
                  <td style="padding: 6px 10px; font-size: 0.72rem;">${escapeHtml(t.machinery || '-')}</td>
                  <td style="padding: 6px 10px; text-align: right;">
                    <strong style="color: ${prog >= 100 ? '#059669' : 'inherit'};">${prog}%</strong>
                    ${t.foremanName ? `<div style="font-size:0.65rem; color:var(--text-muted);">โดย: ${escapeHtml(t.foremanName)}</div>` : ''}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    drawer.innerHTML = `<div style="padding:0.8rem; color:var(--accent-coral); font-size:0.8rem;">เกิดข้อผิดพลาด: ${err.message}</div>`;
  }
};

window.togglePMAuditTrail = async function(planId) {
  const drawer = document.getElementById(`pm-audit-${planId}`);
  const arrow = document.getElementById(`pm-audit-arrow-${planId}`);
  if (!drawer) return;

  if (drawer.style.display === 'block') {
    drawer.style.display = 'none';
    if (arrow) arrow.innerText = '▼ ดูประวัติ Log';
    return;
  }

  drawer.style.display = 'block';
  if (arrow) arrow.innerText = '▲ ซ่อนประวัติ Log';
  drawer.innerHTML = `<div style="text-align:center; padding:1.2rem; color:var(--text-muted);">⏳ กำลังดึงประวัติ Audit Trail...</div>`;

  try {
    const logs = await gasService.fetchPlanLogs(planId);
    if (!logs || logs.length === 0) {
      drawer.innerHTML = `
        <div style="text-align:center; padding:1.2rem; color:var(--text-muted); font-size:0.82rem;">
          ยังไม่มีรายการบันทึก Audit Trail ในระบบ
        </div>
      `;
      return;
    }

    drawer.innerHTML = `
      <div class="audit-trail-timeline">
        ${logs.map(lg => {
          let actionBadge = '';
          let actionIcon = '📝';
          if (lg.action === 'SUBMIT_PLAN') {
            actionBadge = '<span class="audit-action-badge submit">🚀 ยื่นส่งแผนงาน</span>';
            actionIcon = '📤';
          } else if (lg.action === 'PM_APPROVE') {
            actionBadge = '<span class="audit-action-badge approve">✅ อนุมัติแผนงาน</span>';
            actionIcon = '🟢';
          } else if (lg.action === 'PM_REVISION') {
            actionBadge = '<span class="audit-action-badge revision">⚠️ ส่งกลับให้แก้ไข</span>';
            actionIcon = '🔴';
          } else {
            actionBadge = `<span class="audit-action-badge">${escapeHtml(lg.action)}</span>`;
          }

          return `
            <div class="audit-trail-step">
              <div class="audit-step-bullet">${actionIcon}</div>
              <div class="audit-step-content">
                <div class="audit-step-header">
                  ${actionBadge}
                  <span class="audit-step-time">🕒 ${escapeHtml(lg.timestamp || '-')}</span>
                </div>
                <div class="audit-step-user">
                  <strong>👤 ${escapeHtml(lg.userName || 'ไม่ระบุ')}</strong>
                  <span class="audit-role-pill">💼 ${escapeHtml(lg.role || '-')}</span>
                  ${lg.company ? `<span class="audit-company-pill">🏢 ${escapeHtml(lg.company)}</span>` : ''}
                </div>
                ${lg.notes && lg.notes !== '-' ? `
                  <div class="audit-step-notes">
                    💬 "${escapeHtml(lg.notes)}"
                  </div>
                ` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    drawer.innerHTML = `<div style="padding:0.8rem; color:var(--accent-coral); font-size:0.8rem;">เกิดข้อผิดพลาดในการโหลด Audit Trail: ${err.message}</div>`;
  }
};

window.promptPMRevision = function(planId) {
  const targetPlan = (state.weeklyPlans || []).find(p => p.planId === planId);
  const currentComment = targetPlan && targetPlan.pmComment && targetPlan.pmComment !== '-' ? targetPlan.pmComment : '';
  const reason = prompt(`ระบุเหตุผลหรือข้อสั่งการที่ต้องการให้ผู้รับเหมาปรับปรุงแผนงาน (${planId}):`, currentComment);
  if (reason === null) return;
  if (!reason.trim()) {
    showToast('โปรดระบุเหตุผลที่ต้องการให้ปรับปรุงแผนงาน', 'warning');
    return;
  }
  const notesEl = document.getElementById(`pm-notes-${planId}`);
  if (notesEl) notesEl.value = reason.trim();
  window.handlePMDecision(planId, 'Revision', reason.trim());
};

window.handlePMDecision = async function(planId, decision, overrideNotes = null) {
  const notesEl = document.getElementById(`pm-notes-${planId}`);
  const notes = overrideNotes !== null ? overrideNotes : (notesEl ? notesEl.value.trim() : '');

  if (decision === 'Revision' && !notes) {
    showToast('โปรดระบุเหตุผลหรือข้อสั่งการที่ต้องแก้ไขในช่องข้อคิดเห็น', 'warning');
    if (notesEl) notesEl.focus();
    return;
  }

  const decisionText = decision === 'Approved' ? 'อนุมัติแผนงานประจำเดือน' : 'สั่งปรับปรุงแผนงาน';
  showToast(`⏳ กำลังบันทึกผลการพิจารณา (${decisionText})...`, 'info');

  // Optimistic UI Update: update local state immediately
  const nowStr = new Date().toLocaleString('th-TH');
  const targetPlan = (state.weeklyPlans || []).find(p => p.planId === planId);
  if (targetPlan) {
    targetPlan.pmStatus = decision;
    targetPlan.status = decision;
    targetPlan.pmName = state.user.name;
    targetPlan.pmComment = notes || (decision === 'Approved' ? 'อนุมัติแผนงานเรียบร้อย' : 'ส่งกลับให้แก้ไข');
    targetPlan.approvedAt = nowStr;
  }
  renderApprovalPlans();
  updateBadges();
  updateExecutiveKPIs();

  try {
    const res = await gasService.approveWeeklyPlanPM(
      planId,
      decision,
      state.user.name,
      notes,
      state.user.uid,
      'ผู้จัดการโครงการ (PM)'
    );
    if (res && res.success) {
      showToast(`✅ บันทึกผล: ${decisionText} สำเร็จ! งานย่อยพร้อมให้โฟร์แมนดึงไปทำงานแล้ว`, 'success');
      broadcastSync('PLAN_APPROVED', { planId, decision });

      // Sync approved tasks to Firestore (<100ms instant access for foremen)
      if (decision === 'Approved' && firebaseService.isConfigured()) {
        gasService.fetchDailyTasks(planId).then(async (tasks) => {
          if (tasks && tasks.length > 0) {
            const planCompany = targetPlan?.company || targetPlan?.subcontractor || '';
            const tasksByDate = {};
            tasks.forEach(t => {
              const d = t.taskDate || t.date || '';
              if (d) {
                if (!tasksByDate[d]) tasksByDate[d] = [];
                tasksByDate[d].push({ ...t, company: planCompany, planId: planId });
              }
            });
            for (const [tDate, dTasks] of Object.entries(tasksByDate)) {
              await firebaseService.syncApprovedTasks(tDate, state.project.id, dTasks);
            }
          }
        }).catch(e => console.warn('[PM] Sync approved tasks to Firestore error:', e));
      }

      await loadWeeklyPlans();
    } else {
      showToast(`⚠️ บันทึกไม่สำเร็จ: ${res?.message || 'โปรดตรวจสอบสิทธิ์'}`, 'warning');
      await loadWeeklyPlans();
    }
  } catch (err) {
    showToast(`❌ เกิดข้อผิดพลาด: ${err.message}`, 'error');
    await loadWeeklyPlans();
  }
};

// ==========================================
// 2. Master Monthly Gantt Chart (Gantt ไทม์ไลน์ภาพรวม)
// ==========================================
function setupPMMonthStepper() {
  document.getElementById('btn-pm-prev-month')?.addEventListener('click', () => {
    state.pmMonth--;
    if (state.pmMonth < 0) {
      state.pmMonth = 11;
      state.pmYear--;
    }
    renderMasterMonthlyGantt();
  });

  document.getElementById('btn-pm-next-month')?.addEventListener('click', () => {
    state.pmMonth++;
    if (state.pmMonth > 11) {
      state.pmMonth = 0;
      state.pmYear++;
    }
    renderMasterMonthlyGantt();
  });

  document.getElementById('btn-pm-today-month')?.addEventListener('click', () => {
    const now = new Date();
    state.pmYear = now.getFullYear();
    state.pmMonth = now.getMonth();
    renderMasterMonthlyGantt();
    showToast('สลับมายังเดือนปัจจุบัน', 'info');
  });
}

function renderMasterMonthlyGantt() {
  const container = document.getElementById('gantt-chart-container');
  const monthLabelEl = document.getElementById('pm-display-month-label');
  const counterEl = document.getElementById('gantt-total-weeks');
  if (!container) return;

  const y = state.pmYear;
  const m = state.pmMonth;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthNamesThai = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const monthName = monthNamesThai[m];
  const yearThai = y + 543;

  if (monthLabelEl) {
    monthLabelEl.innerText = `${monthName} ${yearThai} (${daysInMonth} วัน)`;
  }

  const mStartIso = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const mEndIso = `${y}-${String(m + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  // Filter plans active in this month
  const plansInMonth = (state.weeklyPlans || []).filter(p => {
    const s = p.startDate || '';
    const e = p.endDate || s;
    return (s <= mEndIso && e >= mStartIso);
  });

  if (counterEl) {
    counterEl.innerText = `${plansInMonth.length} แผนงาน`;
  }

  if (plansInMonth.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted); border: 2px dashed var(--border-subtle); border-radius: var(--radius-sm); background: #ffffff;">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📊</div>
        <strong>ไม่พบแผนงานในเดือน ${monthName} ${yearThai}</strong>
        <p style="font-size: 0.78rem; margin-top: 4px;">ลองเปลี่ยนเดือนที่แถบนำทางด้านบน หรือรอหัวหน้าผู้รับเหมายื่นแผนงาน</p>
      </div>
    `;
    return;
  }

  // Generate days array for this month
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dayInitials = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dObj = new Date(y, m, d);
    const dayOfWeek = dObj.getDay();
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({
      dateNumber: d,
      dayIndex: d - 1,
      iso: iso,
      dayInitial: dayInitials[dayOfWeek],
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      isToday: (iso === todayIso)
    });
  }

  // Render Master Gantt Table
  let html = `
    <div class="pm-master-gantt-wrapper">
      <div style="overflow-x: auto;">
        <table class="pm-master-gantt-table" style="--timeline-days: ${daysInMonth};">
          <thead>
            <tr>
              <th class="pm-master-meta-cell" style="background: #f1f5f9; font-weight: 800; font-size: 0.8rem; color: var(--text-heading);">
                🏢 แผนงาน / บริษัทผู้รับเหมา
              </th>
              <th class="pm-master-timeline-cell" style="background: #f8fafc;">
                <div class="gantt-days-header-grid" style="grid-template-columns: repeat(${daysInMonth}, minmax(0, 1fr));">
                  ${days.map(d => `
                    <div class="gantt-day-th ${d.isWeekend ? 'weekend' : ''} ${d.isToday ? 'today' : ''}" style="padding: 6px 1px;">
                      <span class="th-day-name" style="font-size: 0.6rem;">${d.dayInitial}</span>
                      <span class="th-day-num" style="font-size: 0.78rem;">${d.dateNumber}</span>
                      ${d.isToday ? '<span class="badge-today-indicator" style="font-size: 0.5rem; padding: 0 2px;">วันนี้</span>' : ''}
                    </div>
                  `).join('')}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
  `;

  // Group plans by company
  const companyGroups = {};
  plansInMonth.forEach(p => {
    const comp = p.company || 'ผู้รับเหมาทั่วไป';
    if (!companyGroups[comp]) companyGroups[comp] = [];
    companyGroups[comp].push(p);
  });

  Object.keys(companyGroups).forEach(comp => {
    html += `
      <tr>
        <td colspan="2" style="background: #f1f5f9; border-top: 2px solid var(--border-dark); border-bottom: 1.5px solid var(--border-subtle); padding: 0;">
          <div class="pm-contractor-section-header" style="position: sticky; left: 0; max-width: 500px; display: flex; align-items: center; justify-content: space-between; padding: 8px 14px;">
            <span>🏢 ${escapeHtml(comp)}</span>
            <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; margin-left: 12px;">${companyGroups[comp].length} แผนงาน</span>
          </div>
        </td>
      </tr>
    `;

    companyGroups[comp].forEach(p => {
      const pct = Math.round(Number(p.overallProgress || p.progress) || 0);
      const isApproved = (p.status === 'Approved' || p.pmStatus === 'Approved');
      const isRevision = (p.status === 'Revision' || p.pmStatus === 'Revision');

      // Calculate start and end indices within this month
      let sIdx = 0;
      let eIdx = daysInMonth - 1;

      if (p.startDate) {
        const pStart = new Date(p.startDate);
        if (pStart.getFullYear() === y && pStart.getMonth() === m) {
          sIdx = Math.max(0, pStart.getDate() - 1);
        } else if (pStart > new Date(mEndIso)) {
          sIdx = daysInMonth - 1;
        }
      }

      if (p.endDate) {
        const pEnd = new Date(p.endDate);
        if (pEnd.getFullYear() === y && pEnd.getMonth() === m) {
          eIdx = Math.min(daysInMonth - 1, pEnd.getDate() - 1);
        } else if (pEnd < new Date(mStartIso)) {
          eIdx = 0;
        }
      }

      if (sIdx > eIdx) eIdx = sIdx;
      const durDays = (eIdx - sIdx) + 1;

      const leftPct = (sIdx * 100) / daysInMonth;
      const widthPct = (durDays * 100) / daysInMonth;

      const barColor = isApproved 
        ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
        : (isRevision ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)');

      html += `
        <tr>
          <!-- Meta Cell -->
          <td class="pm-master-meta-cell">
            <div style="font-weight: 800; color: var(--text-heading); font-size: 0.82rem; line-height: 1.3;">
              ${escapeHtml(p.weekLabel || p.planId)}
            </div>
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">
              ${p.startDate} ถึง ${p.endDate}
            </div>
            ${p.objective ? `
              <div style="font-size: 0.68rem; color: #475569; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(p.objective)}">
                🎯 ${escapeHtml(p.objective)}
              </div>
            ` : ''}
          </td>

          <!-- Timeline Track -->
          <td class="pm-master-timeline-cell">
            <div class="pm-master-timeline-track" style="grid-template-columns: repeat(${daysInMonth}, minmax(0, 1fr));">
              <!-- Background grid lines -->
              ${days.map(d => `
                <div class="gantt-track-day-col ${d.isWeekend ? 'weekend' : ''} ${d.isToday ? 'today' : ''}"></div>
              `).join('')}

              <!-- Master Gantt Bar -->
              <div 
                class="pm-master-bar-element" 
                style="left: calc(${leftPct}% + 2px); width: calc(${widthPct}% - 4px); background: ${barColor};"
                onclick="window.togglePMSubtasks('${p.planId}')"
                title="${escapeHtml(p.weekLabel)} (${pct}%)"
              >
                <div style="display: flex; align-items: center; gap: 4px; overflow: hidden;">
                  <span>${isApproved ? '🟢' : (isRevision ? '🔴' : '🟡')}</span>
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(p.weekLabel || p.planId)}</span>
                </div>
                <span style="background: rgba(0,0,0,0.25); padding: 1px 5px; border-radius: 4px; font-size: 0.65rem; margin-left: 4px;">
                  ${pct}%
                </span>
              </div>
            </div>
          </td>
        </tr>
      `;
    });
  });

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// ==========================================
// 3. Daily Reports Archive (คลังรายงานประจำวันย้อนหลัง)
// ==========================================
async function loadDailyReports(isSilent = false) {
  try {
    let list = [];

    // 1. Fast Firestore fetch (<100ms) for instant executive dashboard update
    if (firebaseService.isConfigured() && state.project.id && state.project.id !== '-') {
      try {
        const fbList = await firebaseService.getDailyReports(state.project.id);
        if (fbList && fbList.length > 0) {
          list = fbList;
          state.dailyReports = list;
          const badge = document.getElementById('badge-total-reports');
          if (badge) badge.innerText = state.dailyReports.length;
          if (state.activeTab === 'view-pm-reports') {
            renderDailyReportsTable();
          }
        }
      } catch (fbErr) {
        console.warn('[PM] Firebase getDailyReports error:', fbErr);
      }
    }

    // 2. Comprehensive Google Sheets fetch & merge
    if (gasService.isConfigured() && state.project.id && state.project.id !== '-') {
      const gasList = await gasService.fetchDailyReports(state.project.id);
      if (gasList && gasList.length > 0) {
        const map = new Map();
        list.forEach(r => map.set(String(r.id), r));
        gasList.forEach(r => {
          const existing = map.get(String(r.id)) || {};
          map.set(String(r.id), { ...existing, ...r });
        });
        list = Array.from(map.values());
      }
    }

    const prevCount = (state.dailyReports || []).length;
    state.dailyReports = list || [];
    const badge = document.getElementById('badge-total-reports');
    if (badge) badge.innerText = state.dailyReports.length;
    if (state.activeTab === 'view-pm-reports') {
      renderDailyReportsTable();
    }
    if (isSilent && state.dailyReports.length > prevCount) {
      showToast(`⚡ มีรายงานใหม่เข้ามาจากหน้างาน! (${state.dailyReports.length - prevCount} ฉบับ)`, 'info');
    }
  } catch (err) {
    if (!isSilent) console.warn('loadDailyReports error:', err);
  }
}

function renderDailyReportsTable() {
  const container = document.getElementById('reports-table-container');
  const counterEl = document.getElementById('reports-archive-counter');
  if (!container) return;

  let filtered = state.dailyReports || [];

  if (state.reportFilterShift !== 'all') {
    filtered = filtered.filter(r => {
      const shift = String(r.shift_label || r['รอบกะ (Shift: เช้า/จบงาน)'] || r['กะการทำงาน'] || '').toLowerCase();
      if (state.reportFilterShift === 'morning') return shift.includes('เช้า') || shift.includes('morning');
      if (state.reportFilterShift === 'evening') return shift.includes('เย็น') || shift.includes('evening') || shift.includes('จบงาน');
      return true;
    });
  }

  if (state.reportFilterSearch) {
    const query = state.reportFilterSearch.toLowerCase();
    filtered = filtered.filter(r => JSON.stringify(r).toLowerCase().includes(query));
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
    <div class="reports-cards-grid">
      ${filtered.map((r, idx) => {
        const reportId = r.id || r['รหัสรายงาน (Report ID)'] || r['รหัสรายงาน'] || `RPT-${idx}`;
        const date = r.report_date || r['วันที่รายงาน (Date)'] || r['วันที่'] || '-';
        const shift = r.shift_label || r['รอบกะ (Shift: เช้า/จบงาน)'] || r['กะการทำงาน'] || '-';
        const isCompleted = String(shift).includes('เช้า-จบงาน') || r.status === 'day_completed';
        const isMorning = !isCompleted && String(shift).includes('เช้า');
        const foreman = r.foreman_name || r['ชื่อโฟร์แมน'] || r['ผู้รายงาน'] || '-';
        const comp = r.sub_name || r.company || r['บริษัทผู้รับเหมา'] || r['บริษัท'] || '-';
        const totalWf = (r.totalWorkforce !== undefined && r.totalWorkforce !== null && r.totalWorkforce !== '') 
          ? r.totalWorkforce 
          : (r['ยอดคนงานรวม (คน)'] !== undefined ? r['ยอดคนงานรวม (คน)'] : (r['กำลังพลรวม'] || '-'));
        const weather = r.weather || r['สภาพอากาศ'] || '-';
        const tasks = r.task_summary || r['สรุปรายการงาน / เป้าหมาย'] || r['สรุปงาน'] || '-';
        const photoRaw = r.photoUrls || r['ลิงก์รูปภาพหน้างาน (Drive)'] || '';
        const photoList = photoRaw ? String(photoRaw).split(',').map(s => formatDirectDriveImageUrl(s.trim())).filter(Boolean) : [];

        return `
          <div class="daily-report-card ${isCompleted ? 'completed-report-card' : ''}">
            <div>
              <div class="report-card-top">
                <span class="report-date-badge">📅 ${escapeHtml(date)}</span>
                ${isCompleted ? `
                  <span class="report-shift-tag" style="background: #ecfdf5; color: #065f46; border: 1.5px solid #10b981; font-weight: 800;">
                    ✨ ประจำวันสมบูรณ์ (เช้า-จบงาน)
                  </span>
                ` : `
                  <span class="report-shift-tag ${isMorning ? 'morning' : 'evening'}">
                    ${isMorning ? '🌅 รอบเช้า (เปิดงาน)' : '🌆 รอบเย็น (จบงาน)'}
                  </span>
                `}
              </div>

              <div class="report-meta-info">
                <div>🏢 บริษัท: <strong>${escapeHtml(comp)}</strong></div>
                <div>👤 ผู้รายงาน: <strong>${escapeHtml(foreman)}</strong> | 👷 ยอดคน: <strong>${escapeHtml(totalWf)}</strong> คน</div>
                <div>☀️ สภาพอากาศ: ${escapeHtml(weather)}</div>
              </div>

              <div style="font-size: 0.78rem; background: #f8fafc; padding: 8px 10px; border-radius: 4px; border: 1px solid var(--border-subtle); margin-bottom: 8px;">
                <strong style="color: var(--text-heading); font-size: 0.72rem; display: block; margin-bottom: 2px;">⚡ สรุปงาน:</strong>
                <div style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;">
                  ${escapeHtml(tasks)}
                </div>
              </div>

              ${photoList.length > 0 ? `
                <div class="report-photos-preview">
                  ${photoList.slice(0, 4).map(url => `
                    <img src="${url}" alt="รูปหน้างาน" class="report-thumb-img" loading="lazy" onclick="window.viewReportDetails(${idx})">
                  `).join('')}
                  ${photoList.length > 4 ? `
                    <div style="width: 58px; height: 58px; background: #f1f5f9; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 800; color: var(--text-muted); cursor: pointer;" onclick="window.viewReportDetails(${idx})">
                      +${photoList.length - 4}
                    </div>
                  ` : ''}
                </div>
              ` : ''}
            </div>

            <div class="report-card-actions">
              <button type="button" class="btn-inspect-report" onclick="window.viewReportDetails(${idx})">
                <span>🔍 ดูฉบับเต็ม</span>
              </button>
              <button type="button" class="btn-card-pdf" onclick="window.quickDownloadReportPDF(${idx})" title="ดาวน์โหลด PDF (A4) ทันที">
                <span>📄 PDF</span>
              </button>
              <button type="button" class="btn-card-pdf btn-card-print" onclick="window.quickPrintReport(${idx})" title="สั่งพิมพ์เอกสารทันที">
                <span>🖨️ พิมพ์</span>
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

window.findMatchingCounterpartReport = function(r) {
  if (!r) return null;
  const rDate = r.report_date || r['วันที่รายงาน (Date)'];
  const rSub = r.sub_name || r.company || r['บริษัทผู้รับเหมา'];
  const rId = String(r.id || '');
  const rShift = String(r.shift_label || '');
  const isMorning = rShift.includes('เช้า') || rId.startsWith('MORN');

  return (state.dailyReports || []).find(other => {
    if (other === r) return false;
    const oDate = other.report_date || other['วันที่รายงาน (Date)'];
    const oSub = other.sub_name || other.company || other['บริษัทผู้รับเหมา'];
    const oId = String(other.id || '');
    const oShift = String(other.shift_label || '');
    const otherIsMorning = oShift.includes('เช้า') || oId.startsWith('MORN');
    return oDate === rDate && oSub === rSub && otherIsMorning !== isMorning;
  }) || null;
};

window.quickDownloadReportPDF = async function(idx) {
  const r = state.dailyReports[idx];
  if (!r) return;
  const counterpart = window.findMatchingCounterpartReport(r);
  showToast('⏳ กำลังจัดรูปแบบและสร้างเอกสาร PDF (A4)...', 'info');
  try {
    await downloadDailyReportPDF(r, {
      projectName: state.project.name,
      projectId: state.project.id,
      matchingReport: counterpart
    });
    showToast('ดาวน์โหลดไฟล์ PDF สำเร็จ', 'success');
  } catch (err) {
    console.error('quickDownloadReportPDF error:', err);
    showToast('เกิดข้อผิดพลาดในการสร้าง PDF - สลับไปเปิดหน้าต่างพิมพ์แทน', 'info');
    printDailyReport(r, {
      projectName: state.project.name,
      projectId: state.project.id,
      matchingReport: counterpart
    });
  }
};

window.quickPrintReport = function(idx) {
  const r = state.dailyReports[idx];
  if (!r) return;
  const counterpart = window.findMatchingCounterpartReport(r);
  printDailyReport(r, {
    projectName: state.project.name,
    projectId: state.project.id,
    matchingReport: counterpart
  });
};

window.viewReportDetails = function(idx) {
  const r = state.dailyReports[idx];
  if (!r) return;

  const counterpart = window.findMatchingCounterpartReport(r);
  state.currentSelectedReport = {
    ...r,
    matchingReport: counterpart
  };

  const modal = document.getElementById('modal-report-details');
  const body = document.getElementById('modal-report-body');
  const title = document.getElementById('modal-report-title');
  if (!modal || !body) return;

  const reportId = r.id || r['รหัสรายงาน (Report ID)'] || r['รหัสรายงาน'] || 'REPORT';
  if (title) title.innerText = `รายงานประจำวัน: ${reportId} ${counterpart ? ' (ฉบับรวมเช้า-เย็น)' : ''}`;

  const date = r.report_date || r['วันที่รายงาน (Date)'] || r['วันที่'] || '-';
  const shift = r.shift_label || r['รอบกะ (Shift: เช้า/จบงาน)'] || r['กะการทำงาน'] || '-';
  const foreman = r.foreman_name || r['ชื่อโฟร์แมน'] || r['ผู้รายงาน'] || '-';
  const comp = r.sub_name || r.company || r['บริษัทผู้รับเหมา'] || r['บริษัท'] || '-';
  const weather = r.weather || r['สภาพอากาศ'] || '-';
  const rainDelay = (r.rain_delay_hours !== undefined && r.rain_delay_hours !== null) ? r.rain_delay_hours : (r['เวลาหยุดงานจากฝน (ชม.)'] || r['เวลาฝนหยุดงาน'] || 0);
  const totalWf = (r.totalWorkforce !== undefined && r.totalWorkforce !== null && r.totalWorkforce !== '') ? r.totalWorkforce : (r['ยอดคนงานรวม (คน)'] || r['กำลังพลรวม'] || 0);
  const tasks = r.task_summary || r['สรุปรายการงาน / เป้าหมาย'] || r['สรุปงาน'] || 'ไม่มีรายการงาน';
  const machinery = r.machinery || r['เครื่องจักรที่ใช้งาน'] || '-';
  const issues = r.issues || r['ปัญหาและอุปสรรค'] || r['ปัญหาอุปสรรค'] || '';

  const photoRaw = r.photoUrls || r['ลิงก์รูปภาพหน้างาน (Drive)'] || '';
  let photoList = photoRaw ? String(photoRaw).split(',').map(s => formatDirectDriveImageUrl(s.trim())).filter(Boolean) : [];

  if (counterpart) {
    const cpPhotos = counterpart.photoUrls || counterpart['ลิงก์รูปภาพหน้างาน (Drive)'] || '';
    const cpList = cpPhotos ? String(cpPhotos).split(',').map(s => formatDirectDriveImageUrl(s.trim())).filter(Boolean) : [];
    photoList = [...photoList, ...cpList];
  }

  body.innerHTML = `
    ${counterpart ? `
      <div style="background: #ecfdf5; border: 1.5px solid #a7f3d0; padding: 10px 14px; border-radius: 6px; font-size: 0.8rem; color: #065f46; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <strong>🔗 รายงานเชื่อมโยงสมบูรณ์ประจำวัน:</strong> มีบันทึกทั้งรอบเช้า (${escapeHtml(r.id.startsWith('MORN') ? r.id : counterpart.id)}) และรอบจบงาน (${escapeHtml(r.id.startsWith('EVEN') ? r.id : counterpart.id)})
        </div>
        <span style="background: #10b981; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700;">ครบทั้งวัน</span>
      </div>
    ` : ''}

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; margin-bottom: 1rem; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid var(--border-subtle); font-size: 0.82rem;">
      <div>
        <div>📅 <strong>วันที่รายงาน:</strong> ${escapeHtml(date)} (${escapeHtml(shift)})</div>
        <div>👤 <strong>โฟร์แมนผู้รายงาน:</strong> ${escapeHtml(foreman)}</div>
        <div>🏢 <strong>บริษัทผู้รับเหมา:</strong> ${escapeHtml(comp)}</div>
      </div>
      <div>
        <div>☀️ <strong>สภาพอากาศ:</strong> ${escapeHtml(weather)}</div>
        <div>🌧️ <strong>เวลาหยุดงานจากฝน:</strong> ${escapeHtml(rainDelay)} ชม.</div>
        <div>👷 <strong>กำลังพลรวม:</strong> <strong>${escapeHtml(totalWf)}</strong> คน</div>
      </div>
    </div>

    <div style="margin-bottom: 1rem;">
      <h4 style="font-size: 0.85rem; margin-bottom: 0.4rem; color: var(--text-heading);">⚡ รายการงานที่บันทึก (${escapeHtml(shift)}):</h4>
      <div style="background: #ffffff; border: 1px solid var(--border-subtle); padding: 10px; border-radius: 4px; font-size: 0.82rem; line-height: 1.5;">
        ${escapeHtml(tasks)}
      </div>
    </div>

    ${counterpart ? `
      <div style="margin-bottom: 1rem;">
        <h4 style="font-size: 0.85rem; margin-bottom: 0.4rem; color: var(--text-heading);">⚡ รายการงานของอีกรอบ (${escapeHtml(counterpart.shift_label || 'คู่เทียบ')}):</h4>
        <div style="background: #f8fafc; border: 1px solid var(--border-subtle); padding: 10px; border-radius: 4px; font-size: 0.82rem; line-height: 1.5;">
          ${escapeHtml(counterpart.task_summary || 'ไม่มีรายการงาน')}
        </div>
      </div>
    ` : ''}

    ${machinery && machinery !== '-' ? `
      <div style="margin-bottom: 1rem;">
        <h4 style="font-size: 0.85rem; margin-bottom: 0.4rem; color: var(--text-heading);">🚜 เครื่องจักรและยานพาหนะ:</h4>
        <div style="background: #ffffff; border: 1px solid var(--border-subtle); padding: 8px 10px; border-radius: 4px; font-size: 0.82rem; color: #334155;">
          ${escapeHtml(machinery)}
        </div>
      </div>
    ` : ''}

    ${issues && issues !== 'ปกติ' && issues !== '-' ? `
      <div style="margin-bottom: 1rem;">
        <h4 style="font-size: 0.85rem; margin-bottom: 0.4rem; color: #b45309;">⚠️ ปัญหาอุปสรรค / ข้อสังเกต:</h4>
        <div style="background: #fffbeb; border: 1px solid #f59e0b; padding: 10px; border-radius: 4px; font-size: 0.82rem; color: #92400e;">
          ${escapeHtml(issues)}
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
                <img src="${url}" alt="รูปหน้างาน" style="width: 100%; height: 130px; object-fit: cover; display: block;" onerror="this.src='https://placehold.co/300x200?text=Image+Load+Error'">
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

// ==========================================
// Real-Time Cross-Window & Background Sync
// ==========================================
function broadcastSync(type, details = {}) {
  // 1. Firebase Firestore Real-Time Broadcast (<100ms cross-device)
  if (firebaseService.isConfigured()) {
    firebaseService.broadcastEvent(type, {
      projectId: state.project.id,
      ...details
    }).catch(e => console.warn('[PMSync] Firebase broadcast error:', e));
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

function setupRealtimeSync() {
  // 1. Firebase Real-Time Firestore Listener (cross-device: desktop <-> mobile)
  if (firebaseService.isConfigured()) {
    firebaseService.listenEvents(async (type, payload) => {
      if (type === 'DAILY_REPORT_SUBMITTED' || type === 'PLAN_SUBMITTED' || type === 'PLAN_APPROVED' || type === 'REFRESH_ALL') {
        console.log('[PMSync] Firebase realtime event received:', type, payload);
        triggerSyncFlash();
        if (type === 'DAILY_REPORT_SUBMITTED') {
          const author = payload.foremanName || payload.subName || 'โฟร์แมน';
          const shift = payload.shift === 'evening' ? 'รอบปิดงานเย็น' : 'รอบเปิดงานเช้า';
          showToast(`⚡ มีรายงานใหม่ (${shift}) จาก ${author}! อัปเดตข้อมูลทันที`, 'info');
        } else if (type === 'PLAN_SUBMITTED') {
          showToast('📋 มีแผนงานใหม่ยื่นส่งเข้ามาให้ PM พิจารณา!', 'info');
        }
        await loadDailyReports(true);
        await loadWeeklyPlans(true);
      }
    });
  }

  // 2. BroadcastChannel: instant (< 50ms) cross-tab synchronization
  try {
    const channel = new BroadcastChannel('cpm_site_sync');
    channel.onmessage = async (event) => {
      const data = event.data;
      if (data && (data.type === 'DAILY_REPORT_SUBMITTED' || data.type === 'PLAN_SUBMITTED' || data.type === 'PLAN_APPROVED' || data.type === 'REFRESH_ALL')) {
        console.log('[LiveSync] BroadcastChannel signal received:', data.type);
        triggerSyncFlash();
        await loadDailyReports(true);
        await loadWeeklyPlans(true);
      }
    };
  } catch (e) {
    console.warn('[LiveSync] BroadcastChannel not supported:', e);
  }

  // 3. Storage event fallback for older browsers or cross-domain contexts
  window.addEventListener('storage', async (e) => {
    if (e.key === 'cpm_sync_trigger' && e.newValue) {
      console.log('[LiveSync] LocalStorage sync triggered');
      triggerSyncFlash();
      await loadDailyReports(true);
      await loadWeeklyPlans(true);
    }
  });

  // 3. Fast auto-polling: Every 10 seconds when PM dashboard is open & visible
  let pollInterval = null;
  const startPolling = () => {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      if (!document.hidden) {
        await loadDailyReports(true);
        if (state.activeTab === 'view-pm-approvals') {
          await loadWeeklyPlans(true);
        }
      }
    }, 10000);
  };

  startPolling();

  // 4. Immediate refresh when switching focus back to PM tab
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadDailyReports(true);
      loadWeeklyPlans(true);
    }
  });
}

function triggerSyncFlash() {
  const badge = document.querySelector('.live-sync-indicator');
  if (badge) {
    badge.classList.add('flash-active');
    setTimeout(() => badge.classList.remove('flash-active'), 1200);
  }
}

