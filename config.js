// =====================================================================
// ตั้งค่าการเชื่อมต่อ — แก้ไฟล์นี้ไฟล์เดียวเมื่อเปิดใช้งานจริง
// ---------------------------------------------------------------------
// backend:
//   'demo'  = ทดลองใช้ในเบราว์เซอร์ ข้อมูลจำลอง ไม่ต้องมีฐานข้อมูล
//   'neon'  = ใช้งานจริง ต่อฐานข้อมูล Neon (Data API + Neon Auth)
//   'local' = สำหรับนักพัฒนาทดสอบกับ PostgreSQL ในเครื่อง (tools/dev_server.py)
// =====================================================================
export const CONFIG = {
  backend: 'neon',

  neon: {
    // Neon Console → โปรเจกต์ → Auth → Configuration → "Auth URL"
    authUrl: 'https://ep-orange-rain-az9rei97.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth',
    // Neon Console → โปรเจกต์ → Data API → "API URL" (ลงท้ายด้วย /rest/v1)
    dataApiUrl: 'https://ep-orange-rain-az9rei97.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1',
    // ไลบรารีของ Neon (โหลดจาก CDN) — ปกติไม่ต้องแก้
    sdkUrl: 'https://cdn.jsdelivr.net/npm/@neondatabase/neon-js/+esm',
    // อนุญาตให้สมัครสมาชิกเองจากหน้าเข้าสู่ระบบ (บัญชีใหม่ต้องรอ Admin กำหนดสิทธิ์ก่อนใช้งาน)
    allowSignup: true,
  },

  local: { baseUrl: '' },

  appName: 'AVO FLOW',
  appSub: 'Stock & Sales',
};

// เปิดโหมดทดลองชั่วคราวได้ด้วย ?demo=1 ต่อท้ายลิงก์ (ไม่กระทบข้อมูลจริง)
try {
  const q = new URLSearchParams(location.search);
  if (q.get('demo') === '1') CONFIG.backend = 'demo';
  if (q.get('backend')) CONFIG.backend = q.get('backend');
} catch (e) { /* ignore */ }
