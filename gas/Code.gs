/**
 * ==============================================================================
 * Google Apps Script (GAS) Backend: Construction Daily Site Report
 * ระบบบันทึกรายงานหน้างานก่อสร้าง 2 จังหวะ:
 * 1. 🌅 เปิดงานตอนเช้า (Morning Shift): ยอดคนงานเข้างาน + งานที่คาดการณ์วันนี้
 * 2. 🌆 รายงานจบงาน (Evening Shift): ผลงานจริงเทียบแผน + สภาพอากาศ + ปัญหาอุปสรรค
 * เชื่อมโยง LINE UID + Google Sheets + Google Drive + LINE Bot Flex Message
 * ==============================================================================
 */

const SHEET_NAME_REPORTS = "Daily_Reports";
const SHEET_NAME_TASKS = "Tasks_Detail";
const SHEET_NAME_USERS = "Site_Users";
const SHEET_NAME_SUBCONTRACTORS = "Subcontractors";
const SHEET_NAME_PROJECTS = "Projects";
const SHEET_NAME_WEEKLY_PLANS = "Weekly_Plans";
const SHEET_NAME_PLAN_TASKS = "Plan_Daily_Tasks";
const DRIVE_FOLDER_NAME = "Construction_Site_Photos";

// LINE Bot Messaging API Channel Access Token & Target User/Group ID
const DEFAULT_LINE_ACCESS_TOKEN = "nPrsEU/qv2jmfqQPj8Wq5G8CGza70HNmrf1am2FsbEqRRaHgbx2aLgzpaSAdfI+FPZQNMW0GwG9xUmKxR87Wy5iN+ddrncF7/CAQO9vEshKqh7WKmc08jQzpLVQtrvz2TkUu/l//ka26GkuKeLUPtQdB04t89/1O/w1cDnyilFU="; 
const DEFAULT_TARGET_ID = "U224cf73ea4b2484a0eb0055155e05bf4";
const DEFAULT_FRONTEND_WEB_URL = "https://engineeringdepsethachon.github.io/Projectmanager_site";

/**
 * ฟังก์ชันสร้างเมนูบนแถบเครื่องมือ Google Sheets เมื่อเปิดสเปรดชีต
 */
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu("🏗️ ระบบรายงานหน้างาน")
      .addItem("🔄 ตรวจสอบและสร้างโครงสร้างชีตทั้งหมด (Init Sheets)", "initialSystemSheets")
      .addItem("ℹ️ ข้อมูลการเชื่อมต่อระบบ", "showConnectionInfo")
      .addToUi();
  } catch(e) {
    Logger.log("onOpen error: " + e.toString());
  }
}

/**
 * แสดงข้อมูลการเชื่อมต่อระบบใน Google Sheets
 */
function showConnectionInfo() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(
      "📊 ข้อมูลการเชื่อมต่อระบบรายงานหน้างาน",
      "• เว็บแอปรายงานหน้างาน: " + DEFAULT_FRONTEND_WEB_URL + "\n" +
      "• สถานะระบบ: เชื่อมต่อสมบูรณ์ (พร้อมใช้งาน)\n\n" +
      "💡 คำแนะนำในการจัดการ:\n" +
      "1. เพิ่ม/แก้ไขโครงการที่ชีต 'Projects'\n" +
      "2. เพิ่มรายชื่อผู้รับเหมาและระบุรหัสโครงการที่ชีต 'Subcontractors'\n" +
      "3. ระบุรหัสโครงการและบริษัทให้ช่าง/โฟร์แมนที่ชีต 'Site_Users'",
      ui.ButtonSet.OK
    );
  } catch(e) {}
}

/**
 * Handle GET requests (Health Check Ping & Query Reports & Query Users)
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || "ping";
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "ping") {
      return jsonResponse({
        status: "success",
        message: "ระบบเชื่อมต่อ Google Apps Script สำเร็จพร้อมใช้งาน",
        sheetName: ss.getName(),
        timestamp: Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss")
      });
    }

    if (action === "init_sheets" || action === "setup") {
      const res = initialSystemSheets(ss);
      return jsonResponse({
        status: "success",
        message: "ตรวจสอบและปรับโครงสร้างชีตทั้งหมดสำเร็จ",
        sheets: res,
        timestamp: Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss")
      });
    }

    if (action === "inspect") {
      const allSheets = ss.getSheets();
      const dump = {};
      allSheets.forEach(s => {
        dump[s.getName()] = s.getDataRange().getValues().slice(0, 10);
      });
      return jsonResponse({
        status: "success",
        sheets: dump,
        timestamp: Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss")
      });
    }

    if (action === "get_reports") {
      const sheet = getOrCreateReportsSheet(ss);
      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) {
        return jsonResponse({ status: "success", total: 0, reports: [] });
      }
      const headers = data[0];
      const reports = [];
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const report = {};
        headers.forEach((h, idx) => {
          report[h] = row[idx];
        });
        reports.push(report);
      }
      return jsonResponse({
        status: "success",
        total: reports.length,
        reports: reports
      });
    }

    if (action === "get_projects") {
      const sheet = getOrCreateProjectsSheet(ss);
      const data = sheet.getDataRange().getValues();
      const projectsMap = getProjectsMap(ss);
      const projects = [];

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row[0] && !row[1]) continue;
        const pId = String(row[0] || "").trim();
        let pName = String(row[1] || "").trim();
        if (pId && projectsMap[pId] && projectsMap[pId] !== pName) {
          pName = projectsMap[pId];
          try {
            sheet.getRange(i + 1, 2).setValue(pName);
          } catch(e) {}
        }
        projects.push({
          id: pId,
          name: pName,
          location: String(row[2] || "").trim(),
          pm: String(row[3] || "").trim(),
          status: String(row[4] || "Active").trim()
        });
      }

      return jsonResponse({
        status: "success",
        total: projects.length,
        projects: projects
      });
    }

    if (action === "get_user" || action === "get_users") {
      const sheet = getOrCreateUsersSheet(ss);
      const data = sheet.getDataRange().getValues();
      const targetUid = (e.parameter && e.parameter.uid ? String(e.parameter.uid).trim() : "");
      const projectsMap = getProjectsMap(ss);
      const colIdx = data.length > 0 ? getUserColumnIndexes(data[0]) : {};
      const users = [];
      let foundUser = null;

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rawComp = String(colIdx.compCol > -1 ? row[colIdx.compCol] : row[5] || "-").trim();
        const rawRole = String(colIdx.roleCol > -1 ? row[colIdx.roleCol] : row[3] || "-").trim();
        const rawProj = String(colIdx.projCol > -1 ? row[colIdx.projCol] : "-").trim();

        const cleanComp = rawComp || "-";
        const cleanRole = rawRole || "-";
        const cleanProjId = (!rawProj || rawProj === "-") ? "-" : rawProj;
        const cleanProjName = (cleanProjId !== "-" && projectsMap[cleanProjId]) ? projectsMap[cleanProjId] : (cleanProjId !== "-" ? cleanProjId : "-");

        const u = {
          uid: String(row[0] || "").trim(),
          lineName: String(row[1] || ""),
          displayName: String(row[2] || "-"),
          role: cleanRole,
          level: String(row[4] || "-"),
          company: cleanComp,
          projectId: cleanProjId,
          projectName: cleanProjName,
          avatar: String(colIdx.avatarCol > -1 ? row[colIdx.avatarCol] : row[6] || ""),
          status: String(row[7] || "-"),
          registeredAt: String(row[8] || ""),
          lastActive: String(row[9] || "")
        };
        users.push(u);
        if (targetUid && u.uid === targetUid) {
          foundUser = u;
        }
      }

      return jsonResponse({
        status: "success",
        total: users.length,
        users: users,
        user: foundUser
      });
    }

    if (action === "get_subcontractors") {
      const sheet = getOrCreateSubcontractorsSheet(ss);
      const data = sheet.getDataRange().getValues();
      const targetProjectId = (e.parameter && (e.parameter.projectId || e.parameter.prj) ? String(e.parameter.projectId || e.parameter.prj).trim() : "");
      const projectsMap = getProjectsMap(ss);
      const subs = [];

      if (data.length > 1) {
        const headers = data[0].map(h => String(h).trim());
        let projIdIdx = headers.findIndex(h => h.includes("Project") || h.includes("โครงการ"));
        let projNameIdx = headers.findIndex(h => h.includes("Project Name") || h.includes("ชื่อโครงการ"));
        let subIdIdx = headers.findIndex(h => h.includes("รหัสผู้รับเหมา") || h.includes("Subcontractor ID") || h === "ID" || h.includes("(ID)"));
        let nameIdx = headers.findIndex(h => h.includes("ชื่อบริษัท") || (h.includes("ผู้รับเหมา") && !h.includes("รหัส")));
        let scopeIdx = headers.findIndex(h => h.includes("ขอบเขต") || h.includes("ประเภท"));
        let contactIdx = headers.findIndex(h => h.includes("ผู้ติดต่อ"));
        let phoneIdx = headers.findIndex(h => h.includes("โทร"));
        let statusIdx = headers.findIndex(h => h.includes("สถานะ"));

        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const subName = String(nameIdx > -1 ? row[nameIdx] : row[3] || row[1] || "").trim();
          if (!subName || subName === "-") continue;

          const pId = String(projIdIdx > -1 ? row[projIdIdx] : "-").trim() || "-";
          const pName = String(projNameIdx > -1 ? row[projNameIdx] : (projectsMap[pId] || "-")).trim() || "-";

          // หากระบุ targetProjectId ให้กรองเฉพาะโครงการที่ตรงกัน (หรือแถวที่ยังไม่ได้ระบุโครงการ)
          if (targetProjectId && targetProjectId !== "-" && pId !== "-" && pId !== targetProjectId) {
            continue;
          }

          subs.push({
            projectId: pId,
            projectName: pName,
            id: String(subIdIdx > -1 ? row[subIdIdx] : ("SUB-" + i)).trim(),
            name: subName,
            scope: String(scopeIdx > -1 ? row[scopeIdx] : "").trim(),
            contact: String(contactIdx > -1 ? row[contactIdx] : "").trim(),
            phone: String(phoneIdx > -1 ? row[phoneIdx] : "").trim(),
            status: String(statusIdx > -1 ? row[statusIdx] : "Active").trim()
          });
        }
      }

      return jsonResponse({
        status: "success",
        total: subs.length,
        subcontractors: subs
      });
    }

    if (action === "get_weekly_plans") {
      const sheet = getOrCreateWeeklyPlansSheet(ss);
      const data = sheet.getDataRange().getValues();
      const targetProjectId = (e.parameter && (e.parameter.projectId || e.parameter.prj) ? String(e.parameter.projectId || e.parameter.prj).trim() : "");
      const targetSubId = (e.parameter && (e.parameter.subId || e.parameter.sub) ? String(e.parameter.subId || e.parameter.sub).trim() : "");
      const targetCompany = (e.parameter && e.parameter.company ? String(e.parameter.company).trim() : "");

      const plans = [];
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row[0]) continue;
        const pId = String(row[1] || "").trim();
        const sId = String(row[3] || "").trim();
        const comp = String(row[4] || "").trim();

        if (targetProjectId && targetProjectId !== "-" && pId !== "-" && pId !== targetProjectId) continue;
        if (targetSubId && targetSubId !== "-" && sId !== "-" && sId !== targetSubId) continue;
        if (targetCompany && targetCompany !== "-" && comp !== "-" && comp !== targetCompany) continue;

        plans.push({
          planId: String(row[0] || "").trim(),
          projectId: pId,
          projectName: String(row[2] || "").trim(),
          subId: sId,
          company: comp,
          weekLabel: String(row[5] || "").trim(),
          startDate: formatDateValue(row[6]),
          endDate: formatDateValue(row[7]),
          objective: String(row[8] || "").trim(),
          daysCount: Number(row[9] || 0),
          totalTasks: Number(row[10] || 0),
          avgWorkers: Number(row[11] || 0),
          foremanReview: String(row[12] || "-"),
          foremanNote: String(row[13] || "-"),
          pmStatus: String(row[14] || "Pending").trim(),
          pmName: String(row[15] || "-").trim(),
          pmComment: String(row[16] || "-").trim(),
          submittedAt: String(row[17] || "").trim(),
          approvedAt: String(row[18] || "").trim(),
          completedTasks: Number(row[19] || 0),
          progress: Number(row[20] || 0)
        });
      }

      return jsonResponse({
        status: "success",
        total: plans.length,
        plans: plans
      });
    }

    if (action === "get_daily_tasks") {
      const sheet = getOrCreatePlanTasksSheet(ss);
      const data = sheet.getDataRange().getValues();
      const targetPlanId = (e.parameter && e.parameter.planId ? String(e.parameter.planId).trim() : "");
      const targetDate = (e.parameter && e.parameter.date ? formatDateValue(e.parameter.date) : "");

      const tasks = [];
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row[0]) continue;
        const planId = String(row[1] || "").trim();
        const taskDate = formatDateValue(row[2]);

        if (targetPlanId && planId !== targetPlanId) continue;
        if (targetDate && taskDate !== targetDate) continue;

        tasks.push({
          taskId: String(row[0] || "").trim(),
          planId: planId,
          date: taskDate,
          day: String(row[3] || "").trim(),
          company: String(row[4] || "").trim(),
          category: String(row[5] || "").trim(),
          name: String(row[6] || "").trim(),
          description: String(row[7] || "").trim(),
          quantity: String(row[8] || "").trim(),
          plannedWorkers: Number(row[9] || 0),
          machinery: String(row[10] || "-").trim(),
          pmStatus: String(row[11] || "Pending").trim(),
          progress: Number(row[12] || 0),
          actualQuantity: String(row[13] || "-").trim(),
          foremanRemarks: String(row[14] || "-").trim(),
          taskStatus: String(row[15] || "Planned").trim(),
          reportId: String(row[16] || "-").trim(),
          foremanName: String(row[17] || "-").trim(),
          reportedAt: String(row[18] || "-").trim()
        });
      }

      return jsonResponse({
        status: "success",
        total: tasks.length,
        tasks: tasks
      });
    }

    if (action === "get_approved_tasks_for_date") {
      const sheet = getOrCreatePlanTasksSheet(ss);
      const weeklySheet = getOrCreateWeeklyPlansSheet(ss);
      const targetDate = (e.parameter && e.parameter.date ? formatDateValue(e.parameter.date) : Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd"));
      const targetCompany = (e.parameter && e.parameter.company ? String(e.parameter.company).trim() : "");

      // Map approved plans covering targetDate
      const weeklyData = weeklySheet.getDataRange().getValues();
      const approvedPlanIds = {};
      for (let w = 1; w < weeklyData.length; w++) {
        const wRow = weeklyData[w];
        const wPlanId = String(wRow[0] || "").trim();
        const wStart = formatDateValue(wRow[6]);
        const wEnd = formatDateValue(wRow[7]);
        const wStatus = String(wRow[14] || "").trim();
        if (wStatus === "Approved") {
          if (!wStart || !wEnd || (targetDate >= wStart && targetDate <= wEnd)) {
            approvedPlanIds[wPlanId] = true;
          }
        }
      }

      const tasks = [];
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row[0]) continue;
        const pId = String(row[1] || "").trim();
        const taskDate = formatDateValue(row[2]);
        const company = String(row[4] || "").trim();
        const pmStatus = String(row[11] || "").trim();
        const taskStatus = String(row[15] || "").trim();

        // Must be approved directly or via parent plan
        const isApproved = (pmStatus === "Approved" || approvedPlanIds[pId] === true);
        if (!isApproved) continue;
        if (targetCompany && targetCompany !== "-" && company !== "-" && company !== targetCompany) continue;

        // Date matches directly OR task is from active approved plan for this week
        const isDateMatch = (taskDate === targetDate || approvedPlanIds[pId] === true);
        if (!isDateMatch) continue;

        tasks.push({
          taskId: String(row[0] || "").trim(),
          planId: pId,
          date: taskDate || targetDate,
          day: String(row[3] || "").trim(),
          company: company,
          category: String(row[5] || "").trim(),
          name: String(row[6] || "").trim(),
          description: String(row[7] || "").trim(),
          quantity: String(row[8] || "").trim(),
          plannedWorkers: Number(row[9] || 0),
          machinery: String(row[10] || "-").trim(),
          progress: Number(row[12] || 0),
          actualQuantity: String(row[13] || "").trim(),
          foremanRemarks: String(row[14] || "").trim(),
          taskStatus: taskStatus || "Planned"
        });
      }

      return jsonResponse({
        status: "success",
        date: targetDate,
        total: tasks.length,
        tasks: tasks
      });
    }

    return jsonResponse({ status: "error", message: "Unknown action parameter" });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

/**
 * Handle POST requests (บันทึกรายงานรอบเช้า / จบงาน + อัปโหลดรูป Drive + แจ้งเตือน LINE)
 */
function doPost(e) {
  try {
    let payload;
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else {
      payload = e.parameter;
    }

    // ตรวจสอบว่าเป็นการเรียกจาก LINE Webhook หรือไม่ (มี payload.events)
    if (payload && payload.events && Array.isArray(payload.events)) {
      return handleLineWebhook(payload);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // ตรวจสอบ Action พิเศษใน POST สำหรับแผนงานสัปดาห์และการอนุมัติของ PM
    if (payload && payload.action === "save_weekly_plan") {
      return handleSaveWeeklyPlan(ss, payload);
    }
    if (payload && payload.action === "approve_weekly_plan_pm") {
      return handleApproveWeeklyPlanPM(ss, payload);
    }

    const reportsSheet = getOrCreateReportsSheet(ss);
    const tasksSheet = getOrCreateTasksSheet(ss);

    // กะการทำงาน: morning (เปิดงานเช้า) หรือ evening (รายงานจบงาน)
    const shiftType = payload.shift_type || "morning";
    const isMorning = shiftType === "morning";
    const shiftLabel = payload.shift_label || (isMorning ? "เปิดงานตอนเช้า" : "รายงานจบงาน");

    const reportId = payload.id || ((shiftType === "morning" ? "MORN-" : "EVEN-") + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss"));
    const reportDate = payload.report_date || Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");
    const timestamp = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");

    // 1. LINE Profile Data & Project Info
    const lineUid = payload.line_uid || "NOT_PROVIDED";
    const lineName = payload.line_name || "-";
    const subName = payload.sub_name || "-";
    const foremanName = payload.foreman_name || lineName;
    const projectId = payload.project_id || payload.prj || "-";
    const projectName = payload.project_name || payload.prjName || "-";

    // 2. สภาพอากาศ & เวลาหยุดงาน (รอบเช้าเป็น 0 ชม. เพราะยังไม่มีการหยุดงาน / รอบจบงานคำนวณตามจริง)
    const weather = payload.weather || "☀️ แจ่มใส";
    const rainDelayHours = isMorning ? 0 : Number(payload.rain_delay_hours || 0);

    // 3. กำลังพล (+/-)
    const wf = payload.workforce || {};
    const countForeman = Number(wf.foreman || 0);
    const countSkilled = Number(wf.skilled_workers || 0);
    const countLabor = Number(wf.general_labor || 0);
    const countSafety = Number(wf.safety_officer || 0);
    const totalWorkforce = countForeman + countSkilled + countLabor + countSafety;

    // 4. รายการงาน (งานที่คาดการณ์รอบเช้า หรือ ผลงานจริงรอบจบงาน)
    const taskItems = payload.task_progress || [];
    const taskSummaryList = [];

    // บันทึกลงตาราง Tasks_Detail ทีละรายการ
    taskItems.forEach(function(t, idx) {
      const taskName = t.name || t.task_name || ("งานที่ " + (idx + 1));
      const desc = t.description || t.note || "-";
      const progress = Number(t.progress || 0);
      const qty = t.quantity || "-";
      taskSummaryList.push((idx + 1) + ". " + taskName + " (" + progress + "%) : " + desc);

      tasksSheet.appendRow([
        reportId,
        reportDate,
        shiftLabel,
        lineUid,
        t.id || ("TSK-" + (idx + 1)),
        taskName,
        desc,
        progress,
        qty,
        timestamp
      ]);
    });

    // ซิงก์ผลงานย่อยกลับไปยังชีต Plan_Daily_Tasks ถ้ามีงานที่มาจากแผนงานสัปดาห์
    try {
      syncPlanTasksFromDailyReport(ss, taskItems, reportId, foremanName, timestamp);
    } catch (syncErr) {
      Logger.log("syncPlanTasksFromDailyReport error: " + syncErr.toString());
    }

    const taskSummary = taskSummaryList.join(" | ") || "ไม่มีรายการงาน";

    // 5. บันทึกรูปภาพขึ้น Google Drive
    const photos = payload.photos || [];
    let photoUrls = [];

    photos.forEach(function(p, pIdx) {
      if (p.base64 && p.base64.indexOf("base64,") > -1) {
        try {
          const folder = getOrCreateDriveFolder(DRIVE_FOLDER_NAME);
          const contentType = p.base64.substring(5, p.base64.indexOf(";"));
          const bytes = Utilities.base64Decode(p.base64.substr(p.base64.indexOf("base64,") + 7));
          const fileName = reportId + "_photo_" + (pIdx + 1) + ".jpg";
          const blob = Utilities.newBlob(bytes, contentType, fileName);
          const file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          photoUrls.push(file.getUrl());
        } catch (err) {
          photoUrls.push(p.url || ("Photo #" + (pIdx + 1)));
        }
      } else if (p.url) {
        photoUrls.push(p.url);
      }
    });

    // 6. เครื่องจักร & ปัญหาอุปสรรค
    const machinery = Array.isArray(payload.machinery) ? payload.machinery.join(", ") : (payload.machinery || "-");
    const issues = Array.isArray(payload.issues) ? payload.issues.join(", ") : (payload.issues || "ปกติ");
    const status = payload.status || (shiftType === "morning" ? "morning_opened" : "evening_closed");

    // 7. บันทึกลงตาราง Daily_Reports
    reportsSheet.appendRow([
      reportId,
      reportDate,
      shiftLabel,
      timestamp,
      lineUid,
      lineName,
      subName,
      foremanName,
      weather,
      rainDelayHours,
      countForeman,
      countSkilled,
      countLabor,
      countSafety,
      totalWorkforce,
      taskItems.length,
      taskSummary,
      machinery,
      photoUrls.length,
      photoUrls.join(", "),
      issues,
      status,
      projectId,
      projectName
    ]);

    // 8. ยิง LINE Bot Flex Message แจ้งเตือน (แยกตามเช้า vs จบงาน)
    let linePushResult = { sent: false, note: "ไม่ได้ระบุ Token" };
    try {
      linePushResult = sendLineShiftFlexNotification({
        shiftType: shiftType,
        shiftLabel: shiftLabel,
        reportId: reportId,
        reportDate: reportDate,
        lineUid: lineUid,
        lineName: lineName,
        foremanName: foremanName,
        subName: subName,
        projectId: projectId,
        projectName: projectName,
        weather: weather,
        rainDelayHours: rainDelayHours,
        totalWorkforce: totalWorkforce,
        taskItems: taskItems,
        photoUrl: photoUrls[0] || "",
        issues: issues
      });
    } catch (lineErr) {
      linePushResult = { sent: false, error: lineErr.toString() };
    }

    return jsonResponse({
      status: "success",
      message: "บันทึกรายงานรอบ " + shiftLabel + " ลง Google Sheets สำเร็จ",
      report_id: reportId,
      shift_type: shiftType,
      shift_label: shiftLabel,
      line_uid: lineUid,
      total_workforce: totalWorkforce,
      tasks_count: taskItems.length,
      photos_count: photoUrls.length,
      line_push: linePushResult,
      timestamp: timestamp
    });

  } catch (err) {
    return jsonResponse({
      status: "error",
      message: "เกิดข้อผิดพลาดในการประมวลผล: " + err.toString()
    });
  }
}

/**
 * บันทึกแผนงานสัปดาห์ (Weekly_Plans) และงานย่อยรายวัน (Plan_Daily_Tasks)
 */
function handleSaveWeeklyPlan(ss, payload) {
  const weeklySheet = getOrCreateWeeklyPlansSheet(ss);
  const tasksSheet = getOrCreatePlanTasksSheet(ss);

  const timestamp = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
  const planId = payload.plan_id || ("WPLAN-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss"));
  const projectId = payload.project_id || "-";
  const projectName = payload.project_name || "-";
  const subId = payload.sub_id || "-";
  const company = payload.company_name || payload.company || "-";
  const weekLabel = payload.week_label || ("สัปดาห์ " + (payload.start_date || ""));
  const startDate = payload.start_date || "";
  const endDate = payload.end_date || "";
  const dailyTasks = payload.daily_tasks || payload.tasks || [];
  const objective = payload.weekly_objective || payload.objective || "-";
  const daysCount = payload.days_count || (new Set(dailyTasks.map(t => t.date)).size) || 0;
  const totalTasks = dailyTasks.length;

  let totalWorkersSum = 0;
  dailyTasks.forEach(t => {
    totalWorkersSum += Number(t.planned_workers || 0);
  });
  const avgWorkers = daysCount > 0 ? Math.round(totalWorkersSum / daysCount) : 0;

  // บันทึกลงตาราง Master: Weekly_Plans
  weeklySheet.appendRow([
    planId,
    projectId,
    projectName,
    subId,
    company,
    weekLabel,
    startDate,
    endDate,
    objective,
    daysCount,
    totalTasks,
    avgWorkers,
    "Checked",
    payload.foreman_note || "ส่งแผนงานเข้าระบบแล้ว",
    "Pending", // สถานะการอนุมัติของ PM เริ่มต้นที่ Pending
    "-",
    "-",
    timestamp,
    "-",
    0,
    0
  ]);

  // บันทึกรายการงานย่อยลงตาราง Details: Plan_Daily_Tasks
  dailyTasks.forEach((t, idx) => {
    const taskId = t.task_id || ("WTASK-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd") + "-" + (idx + 1));
    tasksSheet.appendRow([
      taskId,
      planId,
      t.date || startDate,
      t.day_of_week || t.day || "-",
      company,
      t.category || "-",
      t.task_name || t.name || ("งานที่ " + (idx + 1)),
      t.description || "-",
      t.target_qty || t.quantity || "-",
      Number(t.planned_workers || 0),
      t.machinery || "-",
      "Pending", // PM Approval Status
      0, // Actual %
      "-", // Actual Qty
      "-", // Foreman Remarks
      "Planned", // Status
      "-", // Daily Report ID
      "-", // Foreman Name
      "-"  // Reported At
    ]);
  });

  // แจ้งเตือนเข้า LINE กลุ่ม / PM
  try {
    sendLineWeeklyPlanNotification({
      planId: planId,
      projectName: projectName,
      company: company,
      weekLabel: weekLabel,
      objective: objective,
      totalTasks: totalTasks,
      avgWorkers: avgWorkers
    }, "new_plan");
  } catch(e) {
    Logger.log("Line notify error: " + e.toString());
  }

  return jsonResponse({
    status: "success",
    plan_id: planId,
    message: "บันทึกแผนงานสัปดาห์และงานย่อย " + totalTasks + " รายการสำเร็จ รอ PM อนุมัติ"
  });
}

/**
 * PM อนุมัติหรือส่งกลับแก้ไขแผนงานสัปดาห์
 */
function handleApproveWeeklyPlanPM(ss, payload) {
  const weeklySheet = getOrCreateWeeklyPlansSheet(ss);
  const tasksSheet = getOrCreatePlanTasksSheet(ss);
  const planId = String(payload.plan_id || "").trim();
  const status = String(payload.status || "Approved").trim(); // "Approved" หรือ "Revision"
  const pmName = String(payload.pm_name || "ผู้จัดการโครงการ (PM)").trim();
  const pmComment = String(payload.pm_comment || "-").trim();
  const timestamp = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");

  if (!planId) {
    return jsonResponse({ status: "error", message: "Missing plan_id" });
  }

  const weeklyData = weeklySheet.getDataRange().getValues();
  let planFound = false;
  let companyName = "";
  let weekLabel = "";
  let projectName = "";

  for (let i = 1; i < weeklyData.length; i++) {
    if (String(weeklyData[i][0] || "").trim() === planId) {
      const rowNum = i + 1;
      projectName = String(weeklyData[i][2] || "");
      companyName = String(weeklyData[i][4] || "");
      weekLabel = String(weeklyData[i][5] || "");

      weeklySheet.getRange(rowNum, 15).setValue(status); // Col O: PM Approval Status
      weeklySheet.getRange(rowNum, 16).setValue(pmName); // Col P: PM Name
      weeklySheet.getRange(rowNum, 17).setValue(pmComment); // Col Q: PM Comment
      weeklySheet.getRange(rowNum, 19).setValue(timestamp); // Col S: Approved At
      planFound = true;
      break;
    }
  }

  if (!planFound) {
    return jsonResponse({ status: "error", message: "Plan ID not found: " + planId });
  }

  // อัปเดตใน Plan_Daily_Tasks (Col L: PM Approval Status)
  const taskData = tasksSheet.getDataRange().getValues();
  for (let j = 1; j < taskData.length; j++) {
    if (String(taskData[j][1] || "").trim() === planId) {
      tasksSheet.getRange(j + 1, 12).setValue(status);
    }
  }

  // ส่งแจ้งเตือน LINE
  try {
    sendLineWeeklyPlanNotification({
      planId: planId,
      projectName: projectName,
      company: companyName,
      weekLabel: weekLabel,
      status: status,
      pmName: pmName,
      pmComment: pmComment
    }, "pm_decision");
  } catch(e) {
    Logger.log("Line notify error: " + e.toString());
  }

  return jsonResponse({
    status: "success",
    plan_id: planId,
    status: status,
    message: "บันทึกผลการพิจารณาของ PM เรียบร้อยแล้ว (" + (status === "Approved" ? "อนุมัติแผนงาน" : "ส่งกลับให้แก้ไข") + ")"
  });
}

/**
 * ซิงก์ผลงานย่อยที่โฟร์แมนรายงานใน Daily Report กลับไปยังชีต Plan_Daily_Tasks
 */
function syncPlanTasksFromDailyReport(ss, taskItems, reportId, foremanName, timestamp) {
  if (!taskItems || taskItems.length === 0) return;
  const planTasksSheet = ss.getSheetByName(SHEET_NAME_PLAN_TASKS);
  if (!planTasksSheet) return;

  const data = planTasksSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const updatedPlanIds = {};

  taskItems.forEach(function(t) {
    const targetTaskId = String(t.source_task_id || t.plan_task_id || (t.id && t.id.startsWith("WTASK-") ? t.id : "")).trim();
    if (!targetTaskId) return;

    for (let r = 1; r < data.length; r++) {
      const rowTaskId = String(data[r][0] || "").trim();
      if (rowTaskId === targetTaskId) {
        const rowNum = r + 1;
        const progress = Number(t.progress || 0);
        const qty = t.quantity || "-";
        const remarks = t.description || t.note || "-";
        const taskStatus = progress >= 100 ? "Completed" : (progress > 0 ? "In_Progress" : "Delayed");

        // Col M (13): Actual Progress (%)
        planTasksSheet.getRange(rowNum, 13).setValue(progress);
        // Col N (14): Actual Qty
        planTasksSheet.getRange(rowNum, 14).setValue(qty);
        // Col O (15): Foreman Remarks
        planTasksSheet.getRange(rowNum, 15).setValue(remarks);
        // Col P (16): Task Status
        planTasksSheet.getRange(rowNum, 16).setValue(taskStatus);
        // Col Q (17): Report ID
        planTasksSheet.getRange(rowNum, 17).setValue(reportId);
        // Col R (18): Foreman Name
        planTasksSheet.getRange(rowNum, 18).setValue(foremanName);
        // Col S (19): Reported At
        planTasksSheet.getRange(rowNum, 19).setValue(timestamp);

        const planId = String(data[r][1] || "").trim();
        if (planId) updatedPlanIds[planId] = true;
        break;
      }
    }
  });

  // คำนวณความคืบหน้ารวมของ Weekly_Plans ที่เกี่ยวข้อง
  Object.keys(updatedPlanIds).forEach(function(pId) {
    recalcWeeklyPlanSummary(ss, pId);
  });
}

/**
 * คำนวณสรุปผลงานที่เสร็จและ % ความคืบหน้ารวมของสัปดาห์
 */
function recalcWeeklyPlanSummary(ss, planId) {
  try {
    const planTasksSheet = ss.getSheetByName(SHEET_NAME_PLAN_TASKS);
    const weeklySheet = ss.getSheetByName(SHEET_NAME_WEEKLY_PLANS);
    if (!planTasksSheet || !weeklySheet) return;

    const taskData = planTasksSheet.getDataRange().getValues();
    let totalTasks = 0;
    let completedTasks = 0;
    let sumProgress = 0;

    for (let i = 1; i < taskData.length; i++) {
      if (String(taskData[i][1] || "").trim() === planId) {
        totalTasks++;
        const pct = Number(taskData[i][12] || 0);
        sumProgress += pct;
        if (pct >= 100 || String(taskData[i][15] || "") === "Completed") {
          completedTasks++;
        }
      }
    }

    if (totalTasks === 0) return;
    const avgProgress = Math.round(sumProgress / totalTasks);

    const weeklyData = weeklySheet.getDataRange().getValues();
    for (let j = 1; j < weeklyData.length; j++) {
      if (String(weeklyData[j][0] || "").trim() === planId) {
        const rowNum = j + 1;
        // Col T (20): งานที่เสร็จแล้ว (งาน)
        weeklySheet.getRange(rowNum, 20).setValue(completedTasks);
        // Col U (21): ความคืบหน้ารวมสัปดาห์ (%)
        weeklySheet.getRange(rowNum, 21).setValue(avgProgress);
        break;
      }
    }
  } catch(e) {
    Logger.log("recalcWeeklyPlanSummary error: " + e.toString());
  }
}

/**
 * ส่ง LINE Flex Message แจ้งเตือนแผนงานสัปดาห์และการอนุมัติของ PM
 */
function sendLineWeeklyPlanNotification(data, type) {
  const isApproved = data.status === "Approved";
  let title = "";
  let color = "#4f46e5";

  if (type === "new_plan") {
    title = "📋 มีแผนงานสัปดาห์ใหม่ รอ PM อนุมัติ";
    color = "#4f46e5";
  } else if (isApproved) {
    title = "✅ PM อนุมัติแผนงานสัปดาห์แล้ว";
    color = "#059669";
  } else {
    title = "⚠️ PM ขอให้ปรับปรุงแผนงานสัปดาห์";
    color = "#d97706";
  }

  const contents = [
    {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: title, weight: "bold", size: "md", color: color },
        { type: "text", text: "โครงการ: " + (data.projectName || "-"), size: "xs", color: "#666666", margin: "xs" },
        { type: "separator", margin: "md" },
        {
          type: "box",
          layout: "vertical",
          margin: "md",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "baseline",
              contents: [
                { type: "text", text: "ผู้รับเหมา:", size: "xs", color: "#888888", flex: 2 },
                { type: "text", text: data.company || "-", size: "xs", color: "#111111", weight: "bold", flex: 5, wrap: true }
              ]
            },
            {
              type: "box",
              layout: "baseline",
              contents: [
                { type: "text", text: "สัปดาห์:", size: "xs", color: "#888888", flex: 2 },
                { type: "text", text: data.weekLabel || "-", size: "xs", color: "#111111", flex: 5 }
              ]
            }
          ]
        }
      ]
    }
  ];

  if (type === "new_plan") {
    contents[0].contents[3].contents.push({
      type: "box",
      layout: "baseline",
      contents: [
        { type: "text", text: "เป้าหมาย:", size: "xs", color: "#888888", flex: 2 },
        { type: "text", text: data.objective || "-", size: "xs", color: "#111111", flex: 5, wrap: true }
      ]
    });
    contents[0].contents[3].contents.push({
      type: "box",
      layout: "baseline",
      contents: [
        { type: "text", text: "งานย่อย:", size: "xs", color: "#888888", flex: 2 },
        { type: "text", text: (data.totalTasks || 0) + " งาน (คนงานเฉลี่ย " + (data.avgWorkers || 0) + " คน/วัน)", size: "xs", color: "#111111", flex: 5 }
      ]
    });
  } else {
    contents[0].contents[3].contents.push({
      type: "box",
      layout: "baseline",
      contents: [
        { type: "text", text: "ผู้อนุมัติ:", size: "xs", color: "#888888", flex: 2 },
        { type: "text", text: data.pmName || "-", size: "xs", color: "#111111", weight: "bold", flex: 5 }
      ]
    });
    contents[0].contents[3].contents.push({
      type: "box",
      layout: "baseline",
      contents: [
        { type: "text", text: "คำสั่งการ:", size: "xs", color: "#888888", flex: 2 },
        { type: "text", text: data.pmComment || "-", size: "xs", color: isApproved ? "#059669" : "#dc2626", weight: "bold", flex: 5, wrap: true }
      ]
    });
  }

  const flexBubble = {
    type: "bubble",
    size: "mega",
    body: contents[0],
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: color,
          height: "sm",
          action: {
            type: "uri",
            label: "เปิดระบบอนุมัติแผนงาน (PM)",
            uri: DEFAULT_FRONTEND_WEB_URL + (DEFAULT_FRONTEND_WEB_URL.endsWith('/') ? '' : '/') + "pm-center.html"
          }
        }
      ]
    }
  };

  sendLineMessage(DEFAULT_TARGET_ID, [{
    type: "flex",
    altText: title + ": " + (data.company || ""),
    contents: flexBubble
  }]);
}

/**
 * ยิง LINE Bot Flex Message แจ้งเตือน (แยกการ์ดรอบเช้า vs รอบจบงาน)
 */
function sendLineShiftFlexNotification(data) {
  const scriptProps = PropertiesService.getScriptProperties();
  const token = scriptProps.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || DEFAULT_LINE_ACCESS_TOKEN;

  if (!token) {
    return { sent: false, reason: "ไม่มี LINE_CHANNEL_ACCESS_TOKEN ในการตั้งค่า" };
  }

  const targetId = scriptProps.getProperty('LINE_TARGET_ID') || scriptProps.getProperty('LINE_TARGET_GROUP_ID') || (data.lineUid && data.lineUid.startsWith("U") ? data.lineUid : DEFAULT_TARGET_ID);
  if (!targetId || targetId === "NOT_PROVIDED" || (!targetId.startsWith("U") && !targetId.startsWith("C") && !targetId.startsWith("R"))) {
    return { sent: false, reason: "LINE Target ID ไม่ถูกต้องสำหรับการ Push: " + targetId };
  }

  const isMorning = data.shiftType === "morning";
  const headerColor = isMorning ? "#b45309" : "#065f46";
  const badgeTitle = isMorning ? "🌅 รายงานเปิดงานตอนเช้า" : "🌆 สรุปผลงานจบงานประจำวัน";
  const taskHeaderTitle = isMorning ? "🎯 แผนงานที่คาดการณ์วันนี้ (" + data.taskItems.length + " รายการ):" : "⚡ ผลงานจริงที่ทำได้วันนี้ (" + data.taskItems.length + " รายการ):";
  const accentTextColor = isMorning ? "#f59e0b" : "#10b981";

  const flexMessage = {
    type: "flex",
    altText: badgeTitle + ": " + data.reportId,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: headerColor,
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: badgeTitle,
            weight: "bold",
            color: "#ffffff",
            size: "md"
          },
          {
            type: "text",
            text: data.reportId + " • " + data.reportDate,
            size: "xs",
            color: "#fed7aa",
            margin: "xs"
          }
        ]
      },
      hero: data.photoUrl && data.photoUrl.startsWith("http") ? {
        type: "image",
        url: data.photoUrl,
        size: "full",
        aspectRatio: "16:9",
        aspectMode: "cover"
      } : undefined,
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1e293b",
        paddingAll: "16px",
        spacing: "md",
        contents: [
          // โครงการ & แผนก & ผู้ส่ง
          ...(data.projectName && data.projectName !== "-" ? [{
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "โครงการ:", size: "xs", color: "#94a3b8", flex: 2 },
              { type: "text", text: data.projectName, size: "xs", color: "#a78bfa", weight: "bold", flex: 5, wrap: true }
            ]
          }] : []),
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "ผู้รับเหมา:", size: "xs", color: "#94a3b8", flex: 2 },
              { type: "text", text: data.subName, size: "xs", color: "#ffffff", weight: "bold", flex: 5, wrap: true }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "โฟร์แมน:", size: "xs", color: "#94a3b8", flex: 2 },
              { type: "text", text: data.foremanName, size: "xs", color: "#38bdf8", flex: 5 }
            ]
          },
          {
            type: "separator",
            color: "#334155"
          },
          // สภาพอากาศ & กำลังคน
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: isMorning ? "อากาศเช้า:" : "สภาพอากาศ:", size: "xs", color: "#94a3b8", flex: 2 },
              { type: "text", text: isMorning ? data.weather : (data.weather + (data.rainDelayHours > 0 ? " (หยุดงาน " + data.rainDelayHours + " ชม.)" : "")), size: "xs", color: "#f59e0b", flex: 5 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: isMorning ? "คนงานเข้า:" : "กำลังพลรวม:", size: "xs", color: "#94a3b8", flex: 2 },
              { type: "text", text: data.totalWorkforce + " คน", size: "sm", color: accentTextColor, weight: "bold", flex: 5 }
            ]
          },
          {
            type: "separator",
            color: "#334155"
          },
          // รายการงาน (งานที่คาดการณ์ หรือ ผลงานจริง)
          {
            type: "text",
            text: taskHeaderTitle,
            size: "xs",
            weight: "bold",
            color: "#ffffff"
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            contents: data.taskItems.slice(0, 4).map(function(t) {
              return {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "• " + (t.name || t.task_name || "งาน"), size: "xxs", color: "#cbd5e1", flex: 4, wrap: true },
                  { type: "text", text: (t.progress || 0) + "%", size: "xxs", color: accentTextColor, align: "end", flex: 1, weight: "bold" }
                ]
              };
            })
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#0f172a",
        paddingAll: "12px",
        contents: [
          {
            type: "text",
            text: "✅ บันทึกรายงานรอบ " + data.shiftLabel + " ลง Google Sheets แล้ว",
            size: "xxs",
            color: accentTextColor,
            align: "center"
          }
        ]
      }
    }
  };

  const options = {
    method: "post",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    payload: JSON.stringify({
      to: targetId,
      messages: [flexMessage]
    }),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", options);
  const code = response.getResponseCode();
  return {
    sent: code === 200,
    statusCode: code,
    responseBody: response.getContentText()
  };
}

/**
 * ==============================================================================
 * Master Schemas สำหรับชีตทั้งหมดของระบบ
 * ใช้เป็น Single Source of Truth สำหรับหัวตาราง, สีหัวตาราง, ความกว้างคอลัมน์ และข้อมูลเริ่มต้น
 * ==============================================================================
 */
const SYSTEM_SHEET_SCHEMAS = {
  [SHEET_NAME_PROJECTS]: {
    name: SHEET_NAME_PROJECTS,
    headers: [
      "รหัสโครงการ (Project ID)",
      "ชื่อโครงการ (Project Name)",
      "สถานที่ / ขอบเขตงาน (Location)",
      "ผู้จัดการโครงการ / PM",
      "สถานะโครงการ (Status)",
      "วันที่เริ่มโครงการ",
      "วันที่สิ้นสุดตามสัญญา",
      "วันที่สร้างรายการ (Created At)"
    ],
    color: "#0f766e", // Teal 700
    widths: [150, 260, 220, 180, 120, 140, 160, 160],
    seed: [
      "PRJ-01",
      "อาคารสำนักงาน 8 ชั้น",
      "กรุงเทพมหานคร",
      "วิศวกรโครงการ",
      "Active",
      "2026-01-01",
      "2026-12-31"
    ]
  },
  [SHEET_NAME_SUBCONTRACTORS]: {
    name: SHEET_NAME_SUBCONTRACTORS,
    headers: [
      "รหัสโครงการ (Project ID)",
      "ชื่อโครงการ (Project Name)",
      "รหัสผู้รับเหมา (ID)",
      "ชื่อบริษัท / ผู้รับเหมา (Company Name)",
      "ประเภทงาน / ขอบเขตงาน (Scope)",
      "ชื่อผู้ติดต่อ (Contact Person)",
      "เบอร์โทรศัพท์ (Phone)",
      "สถานะ (Status)",
      "วันที่บันทึก (Created At)"
    ],
    color: "#0d9488", // Teal 600
    widths: [150, 220, 130, 260, 240, 160, 140, 100, 160],
    seed: [
      "PRJ-01",
      "อาคารสำนักงาน 8 ชั้น",
      "SUB-01",
      "หจก. นครพิงค์โครงสร้าง",
      "งานโครงสร้างฐานรากและเสาเข็ม",
      "ช่างสมหมาย",
      "081-111-2233",
      "Active"
    ]
  },
  [SHEET_NAME_USERS]: {
    name: SHEET_NAME_USERS,
    headers: [
      "LINE UID",
      "ชื่อใน LINE (LINE Name)",
      "ชื่อที่แสดงในระบบ (Display Name)",
      "ตำแหน่ง (Role)",
      "ระดับ (Level/LV)",
      "บริษัท / ผู้รับเหมา (Company)",
      "รูปโปรไฟล์ (Avatar URL)",
      "สถานะ (Status)",
      "ลงทะเบียนเมื่อ (Registered At)",
      "เข้าใช้งานล่าสุด (Last Active)",
      "รหัสโครงการ (Project ID)"
    ],
    color: "#4338ca", // Indigo 700
    widths: [260, 160, 180, 140, 100, 240, 200, 100, 180, 180, 160]
  },
  [SHEET_NAME_REPORTS]: {
    name: SHEET_NAME_REPORTS,
    headers: [
      "รหัสรายงาน (Report ID)",
      "วันที่รายงาน (Date)",
      "รอบกะ (Shift: เช้า/จบงาน)",
      "เวลาบันทึก (Timestamp)",
      "LINE UID",
      "ชื่อ LINE (LINE Name)",
      "บริษัทผู้รับเหมา",
      "ชื่อโฟร์แมน",
      "สภาพอากาศ",
      "เวลาหยุดงานจากฝน (ชม.)",
      "โฟร์แมน (คน)",
      "ช่างฝีมือ (คน)",
      "แรงงานทั่วไป (คน)",
      "จป.ความปลอดภัย (คน)",
      "ยอดคนงานรวม (คน)",
      "จำนวนงาน (รายการ)",
      "สรุปรายการงาน / เป้าหมาย",
      "เครื่องจักรที่ใช้งาน",
      "จำนวนรูปภาพ",
      "ลิงก์รูปภาพหน้างาน (Drive)",
      "ปัญหาและอุปสรรค",
      "สถานะการอนุมัติ",
      "รหัสโครงการ (Project ID)",
      "ชื่อโครงการ (Project Name)"
    ],
    color: "#0284c7", // Sky 600
    widths: [150, 120, 140, 160, 260, 160, 220, 160, 120, 120, 100, 100, 100, 100, 120, 100, 260, 180, 100, 240, 200, 120, 160, 200]
  },
  [SHEET_NAME_TASKS]: {
    name: SHEET_NAME_TASKS,
    headers: [
      "รหัสรายงาน (Report ID)",
      "วันที่",
      "รอบกะ (Shift)",
      "LINE UID",
      "รหัสรายการงาน",
      "ชื่องาน / กิจกรรม",
      "รายละเอียดงาน / เป้าหมาย",
      "ความคืบหน้า (%)",
      "ปริมาณงาน",
      "เวลาบันทึก"
    ],
    color: "#059669", // Emerald 600
    widths: [150, 120, 120, 260, 120, 240, 260, 120, 120, 160]
  },
  [SHEET_NAME_WEEKLY_PLANS]: {
    name: SHEET_NAME_WEEKLY_PLANS,
    headers: [
      "รหัสแผนงาน (Plan ID)",
      "รหัสโครงการ (Project ID)",
      "ชื่อโครงการ (Project Name)",
      "รหัสผู้รับเหมา (Sub ID)",
      "ชื่อบริษัทผู้รับเหมา (Company)",
      "สัปดาห์ที่ (Week)",
      "วันที่เริ่ม (Start Date)",
      "วันที่สิ้นสุด (End Date)",
      "เป้าหมายหลักประจำสัปดาห์",
      "จำนวนวันที่มีงาน (วัน)",
      "จำนวนงานย่อยทั้งหมด (งาน)",
      "ยอดคนงานเฉลี่ยต่อวัน (คน)",
      "สถานะการตรวจของโฟร์แมน",
      "บันทึกจากโฟร์แมนหน้างาน",
      "สถานะการอนุมัติของ PM",
      "ชื่อ PM ผู้อนุมัติ",
      "คำสั่งการ / ข้อเสนอแนะจาก PM",
      "วันที่ส่งแผน (Submitted At)",
      "วันที่ PM อนุมัติ (Approved At)",
      "งานที่เสร็จแล้ว (งาน)",
      "ความคืบหน้ารวมสัปดาห์ (%)"
    ],
    color: "#4338ca", // Indigo 700
    widths: [170, 130, 200, 130, 240, 180, 120, 120, 260, 120, 130, 130, 140, 220, 150, 180, 240, 170, 170, 120, 140],
    seed: [
      "WPLAN-2026-W38-01",
      "PRJ-01",
      "อาคารประมง 2 ชั้น",
      "SUB-01",
      "หจก. นครพิงค์โครงสร้าง",
      "สัปดาห์ที่ 38 (21-27 ก.ย. 2026)",
      "2026-09-21",
      "2026-09-27",
      "ตัดหัวเข็มและสกัดเปิดเหล็ก F1-F4 และเตรียมแบบหล่อ",
      "6",
      "6",
      "10",
      "Checked",
      "พื้นที่พร้อม เข้าทำงานได้ตามแผน",
      "Approved",
      "นายชัยวัฒน์ สระสิริ (PM)",
      "อนุมัติ ให้เน้นค้ำยันเสาตอม่อให้มั่นคงก่อนเทคอนกรีต",
      "2026-09-20 20:00:00",
      "2026-09-21 07:30:00",
      "0",
      "0"
    ]
  },
  [SHEET_NAME_PLAN_TASKS]: {
    name: SHEET_NAME_PLAN_TASKS,
    headers: [
      "รหัสงานย่อย (Task ID)",
      "รหัสแผนสัปดาห์ (Plan ID)",
      "วันที่ปฏิบัติงาน (Date)",
      "วันในสัปดาห์ (Day)",
      "ชื่อบริษัทผู้รับเหมา (Company)",
      "หมวดงาน (Category)",
      "ชื่องานและโซนพื้นที่ (Task & Zone)",
      "รายละเอียดขั้นตอนงาน",
      "เป้าหมายปริมาณงาน (Plan Qty)",
      "แผนคนงาน (คน)",
      "เครื่องจักร / อุปกรณ์",
      "สถานะการอนุมัติของ PM",
      "ความคืบหน้าจริง (% Actual)",
      "ปริมาณงานจริงที่ทำได้ (Actual Qty)",
      "หมายเหตุจากโฟร์แมน (Foreman Remarks)",
      "สถานะงานย่อย (Task Status)",
      "รหัสรายงานประจำวัน (Report ID)",
      "ชื่อโฟร์แมนผู้รายงาน",
      "เวลาที่รายงานผล"
    ],
    color: "#059669", // Emerald 600
    widths: [160, 170, 120, 110, 220, 160, 260, 260, 150, 110, 180, 140, 140, 160, 240, 130, 160, 180, 170],
    seed: [
      "WTASK-20260921-01",
      "WPLAN-2026-W38-01",
      "2026-09-21",
      "วันจันทร์",
      "หจก. นครพิงค์โครงสร้าง",
      "งานโครงสร้างฐานราก",
      "ตัดหัวเข็มและสกัดเปิดเหล็ก F1-F4 (โซนทิศเหนือ)",
      "สกัดคอนกรีตหัวเข็ม 8 ต้น เตรียมแบบหล่อเทลีน",
      "8 ต้น",
      "10",
      "สกัดลม 2 ตัว, รถขุดเล็ก 1 คัน",
      "Approved",
      "100",
      "8 ต้น",
      "สกัดหัวเข็มเสร็จครบทั้ง 8 ต้นตามเป้าหมาย",
      "Completed",
      "EVEN-20260921-173000",
      "นายชัยวัฒน์ สระสิริ (PM)",
      "2026-09-21 17:30:00"
    ]
  }
};

/**
 * ปรับขนาดคอลัมน์สูงสุดของชีตให้รองรับจำนวนหัวตารางที่ต้องการ
 */
function ensureSheetColumns(sheet, requiredCols) {
  const currentMax = sheet.getMaxColumns();
  if (currentMax < requiredCols) {
    sheet.insertColumnsAfter(currentMax, requiredCols - currentMax);
  }
}

/**
 * ฟังก์ชันสร้าง/ตรวจสอบ/ปรับแต่งโครงสร้างชีต หัวตาราง สีสัน และข้อมูลเริ่มต้น
 */
function setupSheetSchema(ss, sheetName, schema) {
  let sheet = ss.getSheetByName(sheetName);
  const requiredCols = schema.headers.length;

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  ensureSheetColumns(sheet, requiredCols);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow === 0) {
    // ชีตว่างเปล่า: ใส่หัวตารางทันที
    sheet.getRange(1, 1, 1, requiredCols).setValues([schema.headers]);
  } else {
    // ตรวจสอบและอัปเดตหัวตาราง
    const existingHeaders = sheet.getRange(1, 1, 1, Math.max(lastCol, 1)).getValues()[0].map(h => String(h || "").trim());

    // กรณีพิเศษชีต Subcontractors เดิมที่ยังไม่มี Project ID ในสองคอลัมน์แรก
    if (sheetName === SHEET_NAME_SUBCONTRACTORS && !existingHeaders.some(h => h.includes("Project") || h.includes("โครงการ"))) {
      sheet.insertColumnsBefore(1, 2);
      sheet.getRange(1, 1).setValue(schema.headers[0]);
      sheet.getRange(1, 2).setValue(schema.headers[1]);
    } else {
      // ตรวจสอบทุกตำแหน่งหัวตาราง หากว่างให้เติมตามสคีมา
      for (let c = 0; c < requiredCols; c++) {
        const cur = sheet.getRange(1, c + 1).getValue();
        if (!cur || String(cur).trim() === "") {
          sheet.getRange(1, c + 1).setValue(schema.headers[c]);
        }
      }
    }
  }

  // จัดรูปแบบแถวหัวตาราง (Row 1): สีพื้นหลัง, ตัวอักษรสีขาวหนา, กึ่งกลาง, ความสูง 36px, ล็อคแถว
  sheet.setRowHeight(1, 36);
  const headerRange = sheet.getRange(1, 1, 1, requiredCols);
  headerRange
    .setBackground(schema.color)
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);

  sheet.setFrozenRows(1);

  // ตั้งค่าความกว้างคอลัมน์ตามสัดส่วนที่เหมาะสม
  if (schema.widths && schema.widths.length > 0) {
    for (let w = 0; w < schema.widths.length; w++) {
      try {
        sheet.setColumnWidth(w + 1, schema.widths[w]);
      } catch(e) {}
    }
  }

  // ถ้าชีตมีแค่แถวหัวตาราง (ยังไม่มีข้อมูล) ให้ใส่ Seed Data เริ่มต้น
  if (schema.seed && sheet.getLastRow() <= 1) {
    const timestamp = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
    const seedRow = schema.seed.slice();
    seedRow.push(timestamp);
    sheet.appendRow(seedRow);
  }

  return sheet;
}

/**
 * ฟังก์ชัน Getter ดึงหรือสร้างชีตแต่ละประเภท
 */
function getOrCreateProjectsSheet(ss) {
  return setupSheetSchema(ss, SHEET_NAME_PROJECTS, SYSTEM_SHEET_SCHEMAS[SHEET_NAME_PROJECTS]);
}

function getOrCreateSubcontractorsSheet(ss) {
  return setupSheetSchema(ss, SHEET_NAME_SUBCONTRACTORS, SYSTEM_SHEET_SCHEMAS[SHEET_NAME_SUBCONTRACTORS]);
}

function getOrCreateUsersSheet(ss) {
  return setupSheetSchema(ss, SHEET_NAME_USERS, SYSTEM_SHEET_SCHEMAS[SHEET_NAME_USERS]);
}

function getOrCreateReportsSheet(ss) {
  return setupSheetSchema(ss, SHEET_NAME_REPORTS, SYSTEM_SHEET_SCHEMAS[SHEET_NAME_REPORTS]);
}

function getOrCreateTasksSheet(ss) {
  return setupSheetSchema(ss, SHEET_NAME_TASKS, SYSTEM_SHEET_SCHEMAS[SHEET_NAME_TASKS]);
}

function getOrCreateWeeklyPlansSheet(ss) {
  return setupSheetSchema(ss, SHEET_NAME_WEEKLY_PLANS, SYSTEM_SHEET_SCHEMAS[SHEET_NAME_WEEKLY_PLANS]);
}

function getOrCreatePlanTasksSheet(ss) {
  return setupSheetSchema(ss, SHEET_NAME_PLAN_TASKS, SYSTEM_SHEET_SCHEMAS[SHEET_NAME_PLAN_TASKS]);
}

/**
 * ดึง Map ของโครงการ { [projectId]: projectName } จากชีต Projects และชีต Subcontractors
 */
function getProjectsMap(ss) {
  const sheet = getOrCreateProjectsSheet(ss);
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || "").trim();
    const name = String(data[i][1] || "").trim();
    if (id) {
      map[id] = name || id;
    }
  }

  // หากผู้ใช้ไประบุ/แก้ไขชื่อโครงการในชีต Subcontractors ให้นำมาผูกด้วย
  try {
    const subSheet = ss.getSheetByName(SHEET_NAME_SUBCONTRACTORS);
    if (subSheet) {
      const subData = subSheet.getDataRange().getValues();
      for (let j = 1; j < subData.length; j++) {
        const subProjId = String(subData[j][0] || "").trim();
        const subProjName = String(subData[j][1] || "").trim();
        if (subProjId && subProjName && subProjName !== "-" && subProjName !== "อาคารสำนักงาน 8 ชั้น") {
          map[subProjId] = subProjName;
        }
      }
    }
  } catch(e) {}

  return map;
}

/**
 * ฟังก์ชันหลักในการ Initial / ซิงก์โครงสร้างชีตทั้งหมดของระบบ
 * จะสร้างชีตที่ขาดหายไป จัดหัวตาราง ใส่สี ล็อคแถวแรก ปรับขนาดคอลัมน์ และเติมข้อมูลเริ่มต้น
 * สามารถกดเรียกได้จากเมนูใน Google Sheets หรือเรียกผ่าน Web App API ?action=init_sheets
 */
function initialSystemSheets(ss) {
  if (!ss) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }

  const results = {};
  const sheetNames = [
    SHEET_NAME_PROJECTS,
    SHEET_NAME_SUBCONTRACTORS,
    SHEET_NAME_USERS,
    SHEET_NAME_REPORTS,
    SHEET_NAME_TASKS,
    SHEET_NAME_WEEKLY_PLANS,
    SHEET_NAME_PLAN_TASKS
  ];

  sheetNames.forEach(name => {
    const sheet = setupSheetSchema(ss, name, SYSTEM_SHEET_SCHEMAS[name]);
    results[name] = {
      name: name,
      rows: sheet.getLastRow(),
      cols: sheet.getLastColumn(),
      headers: sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    };
  });

  // ตรวจสอบโฟลเดอร์ Google Drive
  try {
    getOrCreateDriveFolder(DRIVE_FOLDER_NAME);
  } catch(e) {}

  // แสดงผลลัพธ์ผ่าน Dialog หากรันผ่าน Google Sheets UI
  try {
    const ui = SpreadsheetApp.getUi();
    if (ui) {
      ui.alert(
        "✅ ซิงก์โครงสร้างและหัวตารางสำเร็จ",
        "ตรวจสอบและปรับโครงสร้างหัวตารางชีตทั้งหมดเรียบร้อยแล้ว:\n\n" +
        "1. " + SHEET_NAME_PROJECTS + " (โครงการ) - " + SYSTEM_SHEET_SCHEMAS[SHEET_NAME_PROJECTS].headers.length + " คอลัมน์\n" +
        "2. " + SHEET_NAME_SUBCONTRACTORS + " (ผู้รับเหมาประจำโครงการ) - " + SYSTEM_SHEET_SCHEMAS[SHEET_NAME_SUBCONTRACTORS].headers.length + " คอลัมน์\n" +
        "3. " + SHEET_NAME_USERS + " (บัญชีผู้ใช้งาน/โฟร์แมน) - " + SYSTEM_SHEET_SCHEMAS[SHEET_NAME_USERS].headers.length + " คอลัมน์\n" +
        "4. " + SHEET_NAME_REPORTS + " (รายงานประจำวัน 2 กะ) - " + SYSTEM_SHEET_SCHEMAS[SHEET_NAME_REPORTS].headers.length + " คอลัมน์\n" +
        "5. " + SHEET_NAME_TASKS + " (รายการงานย่อย) - " + SYSTEM_SHEET_SCHEMAS[SHEET_NAME_TASKS].headers.length + " คอลัมน์",
        ui.ButtonSet.OK
      );
    }
  } catch(e) {}

  return results;
}

/**
 * แปลงค่า Date จาก Google Sheets ให้เป็นสตริง YYYY-MM-DD
 */
function formatDateValue(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, "GMT+7", "yyyy-MM-dd");
  }
  const s = String(val).trim();
  if (s.includes("T")) return s.split("T")[0];
  if (s.includes("GMT") || s.includes("00:00:00")) {
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return Utilities.formatDate(d, "GMT+7", "yyyy-MM-dd");
      }
    } catch(e) {}
  }
  return s;
}

/**
 * ตรวจสอบและหา Index ของคอลัมน์ต่างๆ ในชีต Site_Users แบบไดนามิก
 */
function getUserColumnIndexes(headerRow) {
  const headers = headerRow.map(h => String(h || "").trim());
  let projCol = -1;
  let compCol = 5; // default 0-indexed column 5 (F)
  let avatarCol = 6;
  let roleCol = 3;
  let dispNameCol = 2;
  let lineNameCol = 1;
  let uidCol = 0;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (h.includes("Project") || h.includes("โครงการ")) projCol = i;
    else if (h.includes("Company") || h.includes("ผู้รับเหมา")) compCol = i;
    else if (h.includes("Avatar") || h.includes("รูปโปรไฟล์")) avatarCol = i;
    else if (h.includes("Role") || h.includes("ตำแหน่ง")) roleCol = i;
    else if (h.includes("Display Name") || h.includes("ชื่อที่แสดง")) dispNameCol = i;
  }
  return { uidCol, lineNameCol, dispNameCol, roleCol, compCol, projCol, avatarCol };
}

/**
 * บันทึกหรือดึงข้อมูลผู้ใช้จากชีต Site_Users
 * หากเป็นช่างใหม่ จะบันทึกแถวใหม่ทันที
 * หากมีอยู่แล้ว จะอ่านชื่อ/ตำแหน่ง/โครงการ ที่แอดมินแก้ไขไว้ และอัปเดตเวลาเข้าใช้งานล่าสุด
 */
function recordOrUpdateSiteUser(ss, userId, lineProfile) {
  const sheet = getOrCreateUsersSheet(ss);
  const data = sheet.getDataRange().getValues();
  const timestamp = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");
  const lineName = (lineProfile && lineProfile.displayName) || "-";
  const avatarUrl = (lineProfile && lineProfile.pictureUrl) || "";
  const projectsMap = getProjectsMap(ss);
  const colIdx = data.length > 0 ? getUserColumnIndexes(data[0]) : {};

  let userRowIndex = -1;
  let existingUser = null;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || "").trim() === String(userId || "").trim()) {
      userRowIndex = i + 1; // 1-indexed for Sheet
      const row = data[i];
      const dispNameVal = String(row[colIdx.dispNameCol > -1 ? colIdx.dispNameCol : 2] || "").trim();
      let roleVal = String(row[colIdx.roleCol > -1 ? colIdx.roleCol : 3] || "").trim();
      const levelVal = String(row[4] || "").trim();
      let compVal = String(row[colIdx.compCol > -1 ? colIdx.compCol : 5] || "").trim();
      let projIdVal = String(colIdx.projCol > -1 ? row[colIdx.projCol] : "-").trim();
      const statusVal = String(row[7] || "").trim();

      // หากคอลัมน์เดิมติดค่าเริ่มต้นตัวอย่างเดิม ให้ล้างเป็น '-'
      if (compVal === "หจก. นครพิงค์โครงสร้าง") {
        compVal = "-";
        if (colIdx.compCol > -1) sheet.getRange(userRowIndex, colIdx.compCol + 1).setValue("-");
      }
      if (roleVal === "โฟร์แมนหน้างาน" || roleVal === "โฟร์แมน") {
        roleVal = "-";
        if (colIdx.roleCol > -1) sheet.getRange(userRowIndex, colIdx.roleCol + 1).setValue("-");
      }
      if (!projIdVal) projIdVal = "-";

      const projNameVal = (projIdVal !== "-" && projectsMap[projIdVal]) ? projectsMap[projIdVal] : (projIdVal !== "-" ? projIdVal : "-");

      existingUser = {
        uid: String(row[0]).trim(),
        lineName: String(row[1] || lineName),
        displayName: dispNameVal || "-",
        role: roleVal || "-",
        level: levelVal || "-",
        company: compVal || "-",
        projectId: projIdVal,
        projectName: projNameVal,
        avatar: String(colIdx.avatarCol > -1 ? row[colIdx.avatarCol] : row[6] || avatarUrl),
        status: statusVal || "-"
      };
      break;
    }
  }

  if (userRowIndex > 0 && existingUser) {
    // ผู้ใช้เดิม: อัปเดตชื่อ LINE, รูป และเวลาล่าสุด
    sheet.getRange(userRowIndex, 2).setValue(lineName);
    if (avatarUrl && colIdx.avatarCol > -1) sheet.getRange(userRowIndex, colIdx.avatarCol + 1).setValue(avatarUrl);
    sheet.getRange(userRowIndex, 10).setValue(timestamp);
    return existingUser;
  } else {
    // ผู้ใช้ใหม่: ลงทะเบียนข้อมูลเป็น "-" ทั้งหมด เพื่อให้แอดมินเข้ามาแก้ไขในชีต
    const newRow = [];
    const headers = data[0].map(h => String(h || "").trim());
    headers.forEach(h => {
      if (h.includes("UID")) newRow.push(userId);
      else if (h.includes("LINE Name")) newRow.push(lineName);
      else if (h.includes("Avatar") || h.includes("รูปโปรไฟล์")) newRow.push(avatarUrl);
      else if (h.includes("ลงทะเบียน")) newRow.push(timestamp);
      else if (h.includes("ล่าสุด")) newRow.push(timestamp);
      else newRow.push("-"); // Display Name, Role, Level, Company, Project ID, Status เริ่มต้นเป็น - ทั้งหมด
    });

    sheet.appendRow(newRow);
    return {
      uid: userId,
      lineName: lineName,
      displayName: "-",
      role: "-",
      level: "-",
      company: "-",
      projectId: "-",
      projectName: "-",
      avatar: avatarUrl,
      status: "-"
    };
  }
}



/**
 * สร้างหรือค้นหาโฟลเดอร์ใน Google Drive สำหรับเก็บรูปถ่ายหน้างาน
 */
function getOrCreateDriveFolder(folderName) {
  const name = folderName || DRIVE_FOLDER_NAME || "Construction_Site_Photos";
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(name);
}

/**
 * สร้างผลลัพธ์ JSON สำหรับส่งกลับไปยัง Web App
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ==============================================================================
 * LINE Webhook Handler
 * จัดการเมื่อผู้ใช้กดปุ่มใน Rich Menu หรือทักแชตเข้ามา -> ดึง UID แล้วส่งลิงก์เข้าเว็บกลับไป
 * ==============================================================================
 */
function handleLineWebhook(payload) {
  const events = payload.events || [];
  const scriptProps = PropertiesService.getScriptProperties();
  const token = scriptProps.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || DEFAULT_LINE_ACCESS_TOKEN;
  // URL หน้าเว็บที่จะให้ช่างเปิด (ตั้งค่าใน Script Properties ชื่อ FRONTEND_WEB_URL หรือใช้ค่าเริ่มต้นจาก GitHub Pages)
  const webAppFrontendUrl = scriptProps.getProperty('FRONTEND_WEB_URL') || DEFAULT_FRONTEND_WEB_URL;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const replyToken = event.replyToken;
    const source = event.source || {};
    const userId = source.userId;

    if (!replyToken || !userId) continue;

    let shouldReply = false;
    let userMsg = "";

    if (event.type === "message" && event.message && event.message.type === "text") {
      userMsg = (event.message.text || "").trim();
      shouldReply = true;
    } else if (event.type === "postback") {
      userMsg = (event.postback && event.postback.data) || "postback";
      shouldReply = true;
    } else if (event.type === "follow") {
      shouldReply = true;
    }

    if (shouldReply) {
      // 1. ดึงโปรไฟล์ LINE ของช่าง (ชื่อ + รูปภาพ)
      const userProfile = getLineUserProfile(userId, token);

      // 2. ตรวจสอบ/สร้างชีต Site_Users และบันทึกหรือดึงข้อมูลผู้ใช้ (ชื่อแสดง, ตำแหน่ง, เลเวล, บริษัท)
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const siteUser = recordOrUpdateSiteUser(ss, userId, userProfile);

      // 3. กำหนดหน้าเว็บปลายทางตาม Level ของผู้ใช้โดยตรง (LV1=foreman.html, LV2=weekly-plan.html, LV3=pm-center.html)
      const rawLv = String(siteUser.level || "").toLowerCase().trim();
      const rawRole = String(siteUser.role || "").toLowerCase().trim();
      let targetPage = "foreman.html";

      if (rawLv === "lv2" || rawLv === "2" || rawRole.includes("ผู้รับเหมา") || rawRole.includes("subcontractor")) {
        targetPage = "weekly-plan.html";
      } else if (rawLv === "lv3" || rawLv === "3" || rawRole.includes("pm") || rawRole.includes("ผู้จัดการ") || rawRole.includes("project manager")) {
        targetPage = "pm-center.html";
      } else {
        targetPage = "foreman.html";
      }

      let cleanBase = webAppFrontendUrl.trim();
      if (cleanBase.endsWith('index.html')) {
        cleanBase = cleanBase.replace('index.html', '');
      }
      if (!cleanBase.endsWith('/') && !cleanBase.includes('?')) {
        cleanBase += '/';
      }
      const separator = cleanBase.includes('?') ? '&' : '?';
      const directWebUrl = cleanBase + targetPage + separator +
        "uid=" + encodeURIComponent(siteUser.uid) +
        "&name=" + encodeURIComponent(siteUser.displayName) +
        "&role=" + encodeURIComponent(siteUser.role) +
        "&lv=" + encodeURIComponent(siteUser.level) +
        "&company=" + encodeURIComponent(siteUser.company) +
        "&prj=" + encodeURIComponent(siteUser.projectId || "-") +
        "&prjName=" + encodeURIComponent(siteUser.projectName || "-") +
        (siteUser.avatar ? "&avatar=" + encodeURIComponent(siteUser.avatar) : "");

      // 4. ตอบกลับด้วย Flex Card ปรากฏปุ่มเข้าสู่ระบบ พร้อมสรุปข้อมูลตำแหน่งและโครงการ
      replyLineWebAppCard(replyToken, token, {
        userId: siteUser.uid,
        userName: siteUser.displayName,
        lineName: siteUser.lineName,
        role: siteUser.role,
        level: siteUser.level,
        company: siteUser.company,
        projectId: siteUser.projectId || "-",
        projectName: siteUser.projectName || "-",
        pictureUrl: siteUser.avatar,
        webUrl: directWebUrl,
        userMsg: userMsg
      });
    }
  }

  return jsonResponse({ status: "success", message: "Webhook processed" });
}

/**
 * ดึงข้อมูลโปรไฟล์ผู้ใช้จาก LINE Messaging API
 */
function getLineUserProfile(userId, token) {
  if (!token || !userId) return { displayName: "ช่างหน้างาน", pictureUrl: "" };
  try {
    const url = "https://api.line.me/v2/bot/profile/" + encodeURIComponent(userId);
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "Authorization": "Bearer " + token },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() === 200) {
      return JSON.parse(response.getContentText());
    }
  } catch (e) {
    Logger.log("Error fetching LINE user profile: " + e.toString());
  }
  return { displayName: "ช่างหน้างาน", pictureUrl: "" };
}

/**
 * ส่ง Reply Message ด้วย Flex Card มีปุ่มกดเข้าเว็บรายงานหน้างาน พร้อมสรุปข้อมูลโปรไฟล์จากชีต
 */
function replyLineWebAppCard(replyToken, token, data) {
  if (!token || !replyToken) return;

  const flexCard = {
    type: "flex",
    altText: "📱 ข้อมูลบัญชีและลิงก์เข้าสู่ระบบ: " + data.userName,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#4338ca",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: (function() {
              var lv = String(data.level || '').toLowerCase();
              if (lv === 'lv3' || lv === '3') return '👔 ระบบบริหารโครงการ PM';
              if (lv === 'lv2' || lv === '2') return '📋 ระบบวางแผนงาน (ผู้รับเหมา)';
              return '📱 ระบบรายงานประจำวัน (โฟร์แมน)';
            })(),
            weight: "bold",
            color: "#ffffff",
            size: "md"
          },
          {
            type: "text",
            text: "บันทึกข้อมูลเข้าชีต Site_Users แล้ว ✅",
            size: "xxs",
            color: "#c7d2fe",
            margin: "xs"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1e293b",
        paddingAll: "18px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            alignItems: "center",
            contents: [
              ...(data.pictureUrl ? [{
                type: "image",
                url: data.pictureUrl,
                size: "xs",
                aspectRatio: "1:1",
                aspectMode: "cover",
                flex: 1
              }] : []),
              {
                type: "box",
                layout: "vertical",
                flex: 4,
                contents: [
                  {
                    type: "text",
                    text: data.userName,
                    weight: "bold",
                    color: "#ffffff",
                    size: "md"
                  },
                  {
                    type: "text",
                    text: "LINE: " + (data.lineName || data.userName),
                    color: "#94a3b8",
                    size: "xxs",
                    margin: "xs"
                  }
                ]
              }
            ]
          },
          {
            type: "separator",
            color: "#334155"
          },
          // กล่องข้อมูลผู้ใช้ที่ดึงจากชีต
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            backgroundColor: "#0f172a",
            paddingAll: "12px",
            cornerRadius: "6px",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "💼 ตำแหน่ง:", size: "xxs", color: "#94a3b8", flex: 3 },
                  { type: "text", text: (data.role && data.role !== "-" ? data.role : "-"), size: "xxs", color: "#38bdf8", weight: "bold", flex: 6 }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "🏢 บริษัท/สังกัด:", size: "xxs", color: "#94a3b8", flex: 3 },
                  { type: "text", text: data.company || "-", size: "xxs", color: "#fbbf24", flex: 6, wrap: true }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "🏗️ โครงการ:", size: "xxs", color: "#94a3b8", flex: 3 },
                  { type: "text", text: (data.projectName && data.projectName !== "-" ? data.projectName : (data.projectId && data.projectId !== "-" ? data.projectId : "-")), size: "xxs", color: "#a78bfa", weight: "bold", flex: 6, wrap: true }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "🔑 LINE UID:", size: "xxs", color: "#94a3b8", flex: 3 },
                  { type: "text", text: data.userId, size: "xxs", color: "#86efac", flex: 6, wrap: true }
                ]
              }
            ]
          },
          {
            type: "text",
            text: "💡 ผู้ใช้ใหม่จะถูกลงทะเบียนเป็น (-) ทั้งหมด แอดมินสามารถเปิด Google Sheets ที่ชีต 'Site_Users' เพื่อระบุชื่อ, ตำแหน่ง, บริษัท หรือโครงการได้ตลอดเวลา",
            size: "xxs",
            color: "#cbd5e1",
            wrap: true
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#0f172a",
        paddingAll: "12px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: (function() {
              var lv = String(data.level || '').toLowerCase();
              if (lv === 'lv3' || lv === '3') return "#92400e";
              if (lv === 'lv2' || lv === '2') return "#1e40af";
              return "#065f46";
            })(),
            height: "sm",
            action: {
              type: "uri",
              label: (function() {
                var lv = String(data.level || '').toLowerCase();
                if (lv === 'lv3' || lv === '3') return "👔 เปิดศูนย์อนุมัติแผนงาน & Gantt (PM)";
                if (lv === 'lv2' || lv === '2') return "📋 เปิดระบบวางแผนงานสัปดาห์ (ผู้รับเหมา)";
                return "📱 เปิดระบบรายงานหน้างาน (โฟร์แมน)";
              })(),
              uri: data.webUrl
            }
          }
        ]
      }
    }
  };

  const options = {
    method: "post",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [flexCard]
    }),
    muteHttpExceptions: true
  };

  try {
    UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", options);
  } catch (err) {
    Logger.log("Error replying to LINE: " + err.toString());
  }
}

