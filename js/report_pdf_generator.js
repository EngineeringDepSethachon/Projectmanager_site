/**
 * report_pdf_generator.js
 * โมดูลสร้างและพิมพ์เอกสาร PDF รายงานประจำวันหน้างาน (Construction Daily Site Report)
 * รองรับ:
 * 1. ดาวน์โหลดเป็นไฟล์ PDF ขนาด A4 คมชัดสูงผ่าน html2pdf.js
 * 2. สั่งพิมพ์เอกสารผ่าน Print Preview ของเบราว์เซอร์
 * 3. จัดหน้าตามฟอร์มมาตรฐานงานวิศวกรรมก่อสร้างไทย (ราชการและเอกชน)
 */

/**
 * แปลงข้อความให้ปลอดภัยจาก XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * แปลงวันที่เป็นรูปแบบภาษาไทย เช่น 21 กันยายน 2569
 */
function formatThaiDate(dateStr) {
  if (!dateStr || dateStr === '-') return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const thaiMonths = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const day = d.getDate();
    const month = thaiMonths[d.getMonth()];
    const year = d.getFullYear() + 543;
    return `${day} ${month} ${year}`;
  } catch (e) {
    return dateStr;
  }
}

/**
 * แปลงลิงก์ Google Drive ทุกรูปแบบเป็น Direct Image CDN URL เพื่อให้ <img> และ html2canvas เรนเดอร์ได้ 100%
 */
export function formatDirectDriveImageUrl(url) {
  if (!url) return '';
  url = String(url).trim();
  if (url.startsWith('https://lh3.googleusercontent.com/d/')) return url;
  if (url.startsWith('data:image')) return url;
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://lh3.googleusercontent.com/d/${match[1]}`;
  }
  return url;
}

/**
 * สร้าง HTML สำหรับเอกสารรายงานประจำวันขนาด A4
 */
export function buildDailyReportHtml(report, options = {}) {
  // สกัดข้อมูลรายงาน
  const reportId = report.id || report['รหัสรายงาน'] || report['รหัสรายงาน (Report ID)'] || 'RPT-DAILY';
  const rawDate = report.report_date || report['วันที่'] || report['วันที่รายงาน (Date)'] || '-';
  const thaiDate = formatThaiDate(rawDate);
  const shift = report.shift_label || report['กะการทำงาน'] || report['รอบกะ (Shift: เช้า/จบงาน)'] || 'ประจำวัน';
  const isMorning = String(shift).includes('เช้า');
  const timestamp = report.timestamp || report['เวลาบันทึก (Timestamp)'] || '-';

  const projectName = options.projectName || report.project_name || report.projectName || report['ชื่อโครงการ (Project Name)'] || 'โครงการก่อสร้าง';
  const projectId = options.projectId || report.project_id || report.projectId || report['รหัสโครงการ (Project ID)'] || '-';
  const company = report.sub_name || report.company || report['บริษัทผู้รับเหมา'] || 'ผู้รับเหมาประจำโครงการ';
  const foreman = report.foreman_name || report.foremanName || report['ชื่อโฟร์แมน'] || 'โฟร์แมนหน้างาน';

  const weather = report.weather || report['สภาพอากาศ'] || '☀️ แจ่มใส';
  const rainDelay = Number(report.rain_delay_hours || report['เวลาหยุดงานจากฝน (ชม.)'] || 0);

  // กำลังพล
  const foremanCount = Number(report.foreman_count || report['โฟร์แมน (คน)'] || (isMorning ? 1 : 1));
  const skilledCount = Number(report.skilled_count || report['ช่างฝีมือ (คน)'] || 0);
  const laborCount = Number(report.labor_count || report['แรงงานทั่วไป (คน)'] || 0);
  const safetyCount = Number(report.safety_count || report['จป.ความปลอดภัย (คน)'] || 0);
  const totalWorkforce = Number(report.totalWorkforce || report['ยอดคนงานรวม (คน)'] || (foremanCount + skilledCount + laborCount + safetyCount));

  // เครื่องจักรและปัญหา
  const machinery = report.machinery || report['เครื่องจักรที่ใช้งาน'] || '-';
  const issues = report.issues || report['ปัญหาและอุปสรรค'] || 'ไม่มีปัญหาอุปสรรค การดำเนินงานเป็นไปตามแผน';

  // รายการงาน
  const rawTasks = report.task_summary || report['สรุปรายการงาน / เป้าหมาย'] || report.taskSummary || '';
  let taskList = [];
  if (Array.isArray(report.task_progress) && report.task_progress.length > 0) {
    taskList = report.task_progress;
  } else if (rawTasks) {
    const items = rawTasks.split(/\||\n/).map(s => s.trim()).filter(Boolean);
    taskList = items.map((it, idx) => {
      let prog = 0;
      const progMatch = it.match(/\((\d+)%\)/);
      if (progMatch) prog = Number(progMatch[1]);
      return {
        name: it.replace(/^\d+\.\s*/, '').replace(/\(\d+%\)\s*:?/, '').trim(),
        progress: prog,
        quantity: '-',
        description: it
      };
    });
  }

  // รูปภาพ (แปลงเป็น Direct Image CDN)
  const rawPhotos = report.photoUrls || report['ลิงก์รูปภาพหน้างาน (Drive)'] || report.photos || '';
  let photoList = [];
  if (Array.isArray(rawPhotos)) {
    photoList = rawPhotos.map(p => typeof p === 'string' ? formatDirectDriveImageUrl(p) : (p.url ? formatDirectDriveImageUrl(p.url) : p.base64)).filter(Boolean);
  } else if (typeof rawPhotos === 'string' && rawPhotos.trim()) {
    photoList = rawPhotos.split(',').map(s => formatDirectDriveImageUrl(s.trim())).filter(Boolean);
  }

  // หากมีรายงานของอีกกะ (เช้า-เย็น) ให้รวมรูปภาพทั้งหมดเข้าด้วยกัน
  if (options.matchingReport) {
    const matchingPhotos = options.matchingReport.photoUrls || options.matchingReport['ลิงก์รูปภาพหน้างาน (Drive)'] || options.matchingReport.photos || '';
    let matchingList = [];
    if (Array.isArray(matchingPhotos)) {
      matchingList = matchingPhotos.map(p => typeof p === 'string' ? formatDirectDriveImageUrl(p) : (p.url ? formatDirectDriveImageUrl(p.url) : p.base64)).filter(Boolean);
    } else if (typeof matchingPhotos === 'string' && matchingPhotos.trim()) {
      matchingList = matchingPhotos.split(',').map(s => formatDirectDriveImageUrl(s.trim())).filter(Boolean);
    }
    photoList = [...photoList, ...matchingList];
  }

  // สร้าง HTML Document Template
  return `
    <div class="pdf-document-container" style="
      font-family: 'Sarabun', 'Segoe UI', Tahoma, sans-serif;
      color: #0f172a;
      background: #ffffff;
      padding: 24px 30px;
      max-width: 800px;
      margin: 0 auto;
      line-height: 1.4;
      box-sizing: border-box;
    ">
      <!-- 1. Header Section -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; border-bottom: 2.5px solid #0f172a; padding-bottom: 10px;">
        <tr>
          <td style="vertical-align: middle; width: 65%;">
            <div style="font-size: 0.85rem; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">
              🏗️ โครงการ: <span style="color: #0f172a;">${escapeHtml(projectName)}</span>
            </div>
            <div style="font-size: 1.35rem; font-weight: 900; color: #0f172a; margin: 4px 0 2px 0;">
              รายงานประจำวันหน้างาน (DAILY SITE REPORT)
            </div>
            <div style="font-size: 0.8rem; color: #64748b;">
              สังกัด / ผู้รับเหมา: <strong style="color: #0f172a;">${escapeHtml(company)}</strong>
            </div>
          </td>
          <td style="vertical-align: middle; width: 35%; text-align: right;">
            <div style="display: inline-block; text-align: left; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 6px; padding: 6px 12px; font-size: 0.78rem;">
              <div><strong>รหัสรายงาน:</strong> <span style="font-family: monospace; font-weight: 800; color: #2563eb;">${escapeHtml(reportId)}</span></div>
              <div><strong>วันที่:</strong> ${escapeHtml(thaiDate)}</div>
              <div><strong>รอบกะ:</strong> <span style="font-weight: 800; color: ${isMorning ? '#b45309' : '#059669'};">${escapeHtml(shift)}</span></div>
            </div>
          </td>
        </tr>
      </table>

      <!-- 2. Environmental & Conditions Strip -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
        <tr>
          <td style="padding: 6px 12px; font-size: 0.78rem; border-right: 1px solid #e2e8f0; width: 33.33%;">
            🌤️ <strong>สภาพอากาศ:</strong> ${escapeHtml(weather)}
          </td>
          <td style="padding: 6px 12px; font-size: 0.78rem; border-right: 1px solid #e2e8f0; width: 33.33%;">
            🌧️ <strong>เวลาหยุดงานจากฝน:</strong> ${rainDelay > 0 ? `<span style="color: #dc2626; font-weight: bold;">${rainDelay} ชั่วโมง</span>` : '0 ชั่วโมง (ปกติ)'}
          </td>
          <td style="padding: 6px 12px; font-size: 0.78rem; width: 33.33%;">
            🕒 <strong>เวลาบันทึกข้อมูล:</strong> ${escapeHtml(timestamp)}
          </td>
        </tr>
      </table>

      <!-- 3. Workforce Breakdown Table -->
      <div style="margin-bottom: 14px;">
        <div style="font-size: 0.85rem; font-weight: 800; color: #0f172a; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
          <span>👷</span> สรุปยอดกำลังพลเข้าปฏิบัติงาน (Workforce Summary)
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 0.78rem; text-align: center; border: 1px solid #cbd5e1;">
          <thead>
            <tr style="background: #e2e8f0; color: #0f172a; font-weight: 800;">
              <th style="padding: 6px; border: 1px solid #cbd5e1;">โฟร์แมน / คุมงาน</th>
              <th style="padding: 6px; border: 1px solid #cbd5e1;">ช่างฝีมือ</th>
              <th style="padding: 6px; border: 1px solid #cbd5e1;">แรงงานทั่วไป</th>
              <th style="padding: 6px; border: 1px solid #cbd5e1;">จป.ความปลอดภัย</th>
              <th style="padding: 6px; border: 1px solid #cbd5e1; background: #0f172a; color: #ffffff;">ยอดกำลังพลรวม</th>
            </tr>
          </thead>
          <tbody>
            <tr style="background: #ffffff;">
              <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: 700;">${foremanCount} คน</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: 700;">${skilledCount} คน</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: 700;">${laborCount} คน</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: 700;">${safetyCount} คน</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: 900; font-size: 0.95rem; color: #059669; background: #f0fdf4;">${totalWorkforce} คน</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 4. Tasks & Progress Table -->
      <div style="margin-bottom: 14px;">
        <div style="font-size: 0.85rem; font-weight: 800; color: #0f172a; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>⚡</span> รายการงานและความคืบหน้า (Activities & Progress)
          </div>
          <span style="font-size: 0.72rem; color: #64748b; font-weight: 600;">รวม ${taskList.length} รายการ</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 0.78rem; border: 1px solid #cbd5e1;">
          <thead>
            <tr style="background: #0f172a; color: #ffffff; text-align: left;">
              <th style="padding: 6px 8px; width: 35px; text-align: center; border: 1px solid #334155;">#</th>
              <th style="padding: 6px 10px; border: 1px solid #334155;">รายการงาน / กิจกรรม</th>
              <th style="padding: 6px 10px; width: 130px; border: 1px solid #334155; text-align: center;">ปริมาณงาน</th>
              <th style="padding: 6px 10px; width: 110px; border: 1px solid #334155; text-align: center;">ความคืบหน้า (%)</th>
            </tr>
          </thead>
          <tbody>
            ${taskList.length === 0 ? `
              <tr>
                <td colspan="4" style="padding: 12px; text-align: center; color: #64748b; border: 1px solid #cbd5e1;">
                  ไม่มีรายการงานที่ระบุ
                </td>
              </tr>
            ` : taskList.map((t, idx) => {
              const prog = Number(t.progress || 0);
              return `
                <tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                  <td style="padding: 6px 8px; text-align: center; font-weight: 700; color: #64748b; border: 1px solid #cbd5e1;">
                    ${idx + 1}
                  </td>
                  <td style="padding: 6px 10px; border: 1px solid #cbd5e1;">
                    <div style="font-weight: 700; color: #0f172a;">${escapeHtml(t.name || t.task_name || ('งานที่ ' + (idx + 1)))}</div>
                    ${(t.description && t.description !== t.name) ? `<div style="font-size: 0.72rem; color: #64748b; margin-top: 1px;">${escapeHtml(t.description)}</div>` : ''}
                  </td>
                  <td style="padding: 6px 10px; text-align: center; border: 1px solid #cbd5e1; font-weight: 600;">
                    ${escapeHtml(t.quantity || t.target_qty || '-')}
                  </td>
                  <td style="padding: 6px 10px; text-align: center; border: 1px solid #cbd5e1;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                      <div style="flex: 1; height: 7px; background: #e2e8f0; border-radius: 999px; overflow: hidden; max-width: 60px;">
                        <div style="width: ${Math.min(100, prog)}%; height: 100%; background: ${prog >= 100 ? '#059669' : '#2563eb'};"></div>
                      </div>
                      <strong style="color: ${prog >= 100 ? '#059669' : '#0f172a'}; font-size: 0.76rem;">${prog}%</strong>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- 5. Machinery & Equipment / Problems & Obstacles Grid -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 0.78rem;">
        <tr>
          <!-- Machinery -->
          <td style="vertical-align: top; width: 50%; padding-right: 8px;">
            <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; background: #ffffff; min-height: 70px;">
              <div style="font-weight: 800; color: #0f172a; margin-bottom: 3px; display: flex; align-items: center; gap: 4px;">
                <span>🚜</span> เครื่องจักรและอุปกรณ์ที่ใช้งาน:
              </div>
              <div style="color: #334155; font-size: 0.75rem;">
                ${escapeHtml(machinery)}
              </div>
            </div>
          </td>

          <!-- Issues & Safety -->
          <td style="vertical-align: top; width: 50%; padding-left: 8px;">
            <div style="border: 1px solid #fed7aa; border-radius: 6px; padding: 8px 10px; background: #fffaf0; min-height: 70px;">
              <div style="font-weight: 800; color: #c2410c; margin-bottom: 3px; display: flex; align-items: center; gap: 4px;">
                <span>⚠️</span> ปัญหา อุปสรรค และความปลอดภัย:
              </div>
              <div style="color: #7c2d12; font-size: 0.75rem;">
                ${escapeHtml(issues)}
              </div>
            </div>
          </td>
        </tr>
      </table>

      <!-- 6. Photos Section (If any) -->
      ${photoList.length > 0 ? `
        <div style="margin-bottom: 16px; page-break-inside: avoid;">
          <div style="font-size: 0.85rem; font-weight: 800; color: #0f172a; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
            <span>📸</span> ภาพถ่ายบันทึกการปฏิบัติงานหน้างาน (${photoList.length} ภาพ)
          </div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
            ${photoList.slice(0, 6).map((url, pIdx) => `
              <div style="border: 1.5px solid #cbd5e1; border-radius: 6px; overflow: hidden; background: #f8fafc; text-align: center;">
                <img 
                  src="${url}" 
                  alt="รูปหน้างาน ${pIdx + 1}" 
                  style="width: 100%; height: 110px; object-fit: cover; display: block;" 
                  crossorigin="anonymous"
                  onerror="this.style.display='none'"
                />
                <div style="font-size: 0.65rem; color: #64748b; padding: 2px 4px; background: #f1f5f9; border-top: 1px solid #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ภาพที่ ${pIdx + 1} (${escapeHtml(thaiDate)})
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- 7. Sign-off / Endorsement Section -->
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px; page-break-inside: avoid; border-top: 1.5px dashed #cbd5e1; padding-top: 14px;">
        <tr>
          <!-- Foreman Sign-off -->
          <td style="width: 50%; padding-right: 15px; vertical-align: top;">
            <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; background: #ffffff; text-align: center;">
              <div style="font-size: 0.74rem; font-weight: 800; color: #475569; margin-bottom: 30px;">
                ลงชื่อ .............................................................. ผู้รายงาน
              </div>
              <div style="font-size: 0.8rem; font-weight: 700; color: #0f172a;">
                (${escapeHtml(foreman)})
              </div>
              <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">
                ตำแหน่ง: โฟร์แมนหน้างาน / ผู้ควบคุมงาน
              </div>
              <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">
                วันที่: ${escapeHtml(thaiDate)}
              </div>
            </div>
          </td>

          <!-- PM / Project Manager Sign-off -->
          <td style="width: 50%; padding-left: 15px; vertical-align: top;">
            <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; background: #ffffff; text-align: center;">
              <div style="font-size: 0.74rem; font-weight: 800; color: #475569; margin-bottom: 30px;">
                ลงชื่อ .............................................................. ผู้ตรวจสอบ / รับทราบ
              </div>
              <div style="font-size: 0.8rem; font-weight: 700; color: #0f172a;">
                (${escapeHtml(options.pmName || 'ผู้จัดการโครงการ (PM)')})
              </div>
              <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">
                ตำแหน่ง: ผู้จัดการโครงการ (Project Manager)
              </div>
              <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">
                วันที่: ........ / ........ / ................
              </div>
            </div>
          </td>
        </tr>
      </table>

      <!-- 8. Document Footer -->
      <div style="margin-top: 14px; text-align: center; font-size: 0.68rem; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 6px;">
        เอกสารสร้างโดยอัตโนมัติจากระบบ CPM Construction Site Management • อ้างอิงรหัส ${escapeHtml(reportId)} • วันที่พิมพ์ ${formatThaiDate(new Date().toISOString())}
      </div>
    </div>
  `;
}

/**
 * ดาวน์โหลดเอกสารรายงานประจำวันเป็นไฟล์ PDF
 */
export async function downloadDailyReportPDF(report, options = {}) {
  const reportId = report.id || report['รหัสรายงาน'] || report['รหัสรายงาน (Report ID)'] || 'REPORT';
  const dateStr = (report.report_date || report['วันที่'] || 'date').replace(/[^0-9-]/g, '');
  const fileName = `Daily_Report_${reportId}_${dateStr}.pdf`;

  const tempContainer = document.createElement('div');
  tempContainer.id = 'pdf-render-temp-container';
  tempContainer.style.position = 'absolute';
  tempContainer.style.top = '0';
  tempContainer.style.left = '0';
  tempContainer.style.zIndex = '-99999';
  tempContainer.style.width = '794px'; // 210mm at 96 DPI
  tempContainer.style.minHeight = '1123px';
  tempContainer.style.background = '#ffffff';
  tempContainer.style.boxSizing = 'border-box';
  tempContainer.style.pointerEvents = 'none';
  tempContainer.innerHTML = buildDailyReportHtml(report, options);
  document.body.appendChild(tempContainer);

  // รอให้ Web Fonts (Sarabun, Jakarta) โหลดเสร็จ
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch(e) {}

  // รอให้รูปภาพทั้งหมดในเอกสารโหลดเสร็จเพื่อป้องกัน html2canvas ได้ผืนผ้าใบว่างเปล่า
  const imgs = Array.from(tempContainer.querySelectorAll('img'));
  await Promise.all(imgs.map(img => {
    return new Promise(resolve => {
      if (img.complete && img.naturalHeight !== 0) return resolve();
      img.onload = () => resolve();
      img.onerror = () => {
        img.style.display = 'none'; // ซ่อนรูปที่เสียเพื่อไม่ให้ canvas ล้มเหลว
        resolve();
      };
      setTimeout(resolve, 2000); // Timeout 2 วินาที
    });
  }));

  // หน่วงเวลาสั้น ๆ เพื่อให้ layout DOM คงที่
  await new Promise(r => setTimeout(r, 120));

  const opt = {
    margin: [10, 10, 10, 10], // mm
    filename: fileName,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: 794
    },
    jsPDF: {
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait'
    }
  };

  try {
    if (window.html2pdf) {
      await window.html2pdf().set(opt).from(tempContainer).save();
    } else {
      printDailyReport(report, options);
    }
  } catch (err) {
    console.error('downloadDailyReportPDF error:', err);
    printDailyReport(report, options);
  } finally {
    if (tempContainer.parentNode) {
      tempContainer.parentNode.removeChild(tempContainer);
    }
  }
}

/**
 * สั่งพิมพ์เอกสารรายงานประจำวันผ่าน Browser Print Dialog
 */
export function printDailyReport(report, options = {}) {
  const htmlContent = buildDailyReportHtml(report, options);
  const printWindow = window.open('', '_blank', 'width=900,height=800');
  if (!printWindow) {
    alert('กรุณาอนุญาตให้เบราว์เซอร์เปิด Pop-up เพื่อพิมพ์เอกสาร');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>พิมพ์รายงาน: ${escapeHtml(report.id || 'Daily Report')}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
      <style>
        @page {
          size: A4 portrait;
          margin: 10mm;
        }
        body {
          margin: 0;
          padding: 0;
          background: #ffffff;
          font-family: 'Sarabun', Tahoma, sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        @media print {
          .no-print { display: none !important; }
        }
      </style>
    </head>
    <body>
      ${htmlContent}
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 400);
        };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// Attach to window for global access
if (typeof window !== 'undefined') {
  window.buildDailyReportHtml = buildDailyReportHtml;
  window.downloadDailyReportPDF = downloadDailyReportPDF;
  window.printDailyReport = printDailyReport;
}

