# 👷‍♂️ Projectmanager_site: Foreman Daily Report
> ระบบรายงานผลประจำวันหน้างานก่อสร้างสำหรับโฟร์แมน รองรับการทำงาน 2 จังหวะ (เปิดงานเช้า & รายงานจบงาน) พร้อมเชื่อมโยง Google Sheets, Google Drive และแจ้งเตือนผ่าน LINE Bot

---

## 🌟 ฟังก์ชันเด่น (Key Features)

1. **ระบบรายงาน 2 จังหวะ (Dual-Shift Workflow)**:
   - 🌅 **รอบเปิดงานเช้า**: บันทึกคนงานแรกเข้าหน้างาน (+/-) และ **งานที่คาดการณ์ว่าจะทำวันนี้ (Planned Targets)** พร้อมรูปถ่ายแถวความปลอดภัย (Safety Talk)
   - 🌆 **รอบรายงานจบงาน**: **ดึงแผนงานที่คาดการณ์จากรอบเช้าขึ้นมาให้อัตโนมัติ** ให้โฟร์แมนประเมินผลงานจริงที่ทำได้ (%) ปริมาณงานจริง สภาพอากาศฝนตก และรูปถ่ายผลงานจริง
2. **ปรับยอดกำลังพลด้วยปุ่มสัมผัส (+ / -)**:
   - โฟร์แมน, ช่างฝีมือ, กรรมกรทั่วไป, จป.ความปลอดภัย พร้อมรวมยอดเรียลไทม์
3. **รายการงานแบบ Dynamic**:
   - กดปุ่ม `➕` เพื่อเพิ่มงานทีละรายการ กำหนดชื่องาน รายละเอียด ปริมาณ และ % ความคืบหน้า (25%, 50%, 75%, 100%)
4. **ถ่ายรูปหน้างานพร้อมย่อขนาด (Canvas Compression)**:
   - บีบอัดภาพไม่เกิน 1200px (JPEG 0.75) พร้อมประทับวันที่ เวลา และรอบกะบนภาพ
5. **บันทึกข้อมูลเข้า Google Sheets & Drive (Google Apps Script)**:
   - บันทึกแยก 2 ตาราง: `Daily_Reports` (ภาพรวม) และ `Tasks_Detail` (รายการงานย่อย)
   - เซฟรูปภาพขึ้น Google Drive โฟลเดอร์ `Construction_Site_Photos`
6. **LINE Bot Messaging API Notification**:
   - แจ้งเตือนด้วย **Flex Message Card** แยกธีมเช้า (ส้มทอง) และธีมจบงาน (เขียวมรกต) เข้ากลุ่ม LINE หรือแชตส่วนตัวทันที

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```
Projectmanager_site/
├── index.html                 # หน้าจอรายงาน Mobile-first
├── css/
│   └── style.css              # สไตล์ UI มือถือ ปุ่มสัมผัสใหญ่ คอนทราสต์สูง
├── js/
│   ├── app.js                 # คอนโทรลเลอร์: จัดการรอบเช้า-เย็น, กำลังพล, แผนงาน, กล้อง
│   └── gas_service.js         # API Client เชื่อมต่อ Google Apps Script
├── gas/
│   ├── Code.gs                # Google Apps Script: บันทึก Sheets, Drive, และส่ง LINE Flex Message
│   └── appsscript.json        # Manifest config ของ GAS
├── LINE_BOT_GAS_SETUP.md      # คู่มือติดตั้งและทดสอบแบบละเอียดทีละขั้นตอน
├── run_server.bat             # ไฟล์ดับเบิลคลิกรันเซิร์ฟเวอร์ทดสอบในเครื่องทันที
└── README.md
```

---

## 🚀 วิธีเปิดใช้งานบน GitHub Pages (เปิดเป็นเว็บจริงฟรี)

1. ไปที่แท็บ **Settings** ของ Repository นี้บน GitHub
2. เมนูด้านซ้ายเลือก **Pages**
3. ที่หัวข้อ **Build and deployment > Branch**:
   - เลือก Branch เป็น `main`
   - เลือก Folder เป็น `/ (root)`
   - กดปุ่ม **Save**
4. รอประมาณ 1-2 นาที จะได้ URL เช่น:
   `https://EngineeringDepSethachon.github.io/Projectmanager_site/`
   สามารถนำ URL นี้ส่งให้โฟร์แมนเปิดบนมือถือเพื่อใช้งานได้ทันที!

---

## 📖 คู่มือการตั้งค่า Google Sheets และ LINE Bot
สามารถเปิดดูขั้นตอนการตั้งค่าอย่างละเอียดได้ที่ [LINE_BOT_GAS_SETUP.md](./LINE_BOT_GAS_SETUP.md)
