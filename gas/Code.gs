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
const DRIVE_FOLDER_NAME = "Construction_Site_Photos";

// LINE Bot Messaging API Channel Access Token & Target User/Group ID
const DEFAULT_LINE_ACCESS_TOKEN = "nPrsEU/qv2jmfqQPj8Wq5G8CGza70HNmrf1am2FsbEqRRaHgbx2aLgzpaSAdfI+FPZQNMW0GwG9xUmKxR87Wy5iN+ddrncF7/CAQO9vEshKqh7WKmc08jQzpLVQtrvz2TkUu/l//ka26GkuKeLUPtQdB04t89/1O/w1cDnyilFU="; 
const DEFAULT_TARGET_ID = "U224cf73ea4b2484a0eb0055155e05bf4";

/**
 * Handle GET requests (Health Check Ping & Query Reports)
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

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const reportsSheet = getOrCreateReportsSheet(ss);
    const tasksSheet = getOrCreateTasksSheet(ss);

    // กะการทำงาน: morning (เปิดงานเช้า) หรือ evening (รายงานจบงาน)
    const shiftType = payload.shift_type || "morning";
    const shiftLabel = payload.shift_label || (shiftType === "morning" ? "เปิดงานตอนเช้า" : "รายงานจบงาน");

    const reportId = payload.id || ((shiftType === "morning" ? "MORN-" : "EVEN-") + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss"));
    const reportDate = payload.report_date || Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");
    const timestamp = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");

    // 1. LINE Profile Data
    const lineUid = payload.line_uid || "NOT_PROVIDED";
    const lineName = payload.line_name || "ช่างหน้างาน";
    const subName = payload.sub_name || "หจก. นครพิงค์โครงสร้าง";
    const foremanName = payload.foreman_name || lineName;

    // 2. สภาพอากาศ & เวลาหยุดงาน
    const weather = payload.weather || "☀️ แจ่มใส";
    const rainDelayHours = Number(payload.rain_delay_hours || 0);

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
      status
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
          // แผนก & ผู้ส่ง
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
              { type: "text", text: data.weather + (data.rainDelayHours > 0 ? " (หยุด " + data.rainDelayHours + " ชม.)" : ""), size: "xs", color: "#f59e0b", flex: 5 }
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
 * สร้างหรือดึงชีต Daily_Reports พร้อมจัดรูปแบบหัวตาราง
 */
function getOrCreateReportsSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME_REPORTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_REPORTS);
    const headers = [
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
      "สถานะการอนุมัติ"
    ];
    sheet.appendRow(headers);
    sheet.getRange("A1:V1").setBackground("#0284c7").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * สร้างหรือดึงชีต Tasks_Detail สำหรับรายการงานย่อย
 */
function getOrCreateTasksSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME_TASKS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_TASKS);
    const headers = [
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
    ];
    sheet.appendRow(headers);
    sheet.getRange("A1:J1").setBackground("#059669").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * สร้างหรือค้นหาโฟลเดอร์ใน Google Drive สำหรับเก็บรูปถ่ายหน้างาน
 */
function getOrCreateDriveFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}

/**
 * สร้างผลลัพธ์ JSON สำหรับส่งกลับไปยัง Web App
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
