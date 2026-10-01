// =====================================================================
// ตั้งค่าการเชื่อมต่อ — แก้ไฟล์นี้ไฟล์เดียวเมื่อเปิดใช้งานจริง
// ---------------------------------------------------------------------
// backend:
//   'demo'  = ทดลองใช้ในเบราว์เซอร์ ข้อมูลจำลอง ไม่ต้องมีฐานข้อมูล
//   'neon'  = ใช้งานจริง ต่อฐานข้อมูล Neon (Data API + Neon Auth)
//   'supabase' = ใช้ Supabase แทน Neon (ดู docs/SUPABASE.md)
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
    // ล็อกอินกลาง HR.SPOT: ลิงก์หน้าเข้าสู่ระบบของ HR.SPOT (…/exec) — ถ้าใส่ จะมีปุ่ม "เข้าสู่ระบบด้วยบัญชี HR.SPOT" ในหน้าเข้าสู่ระบบ
    hrspotUrl: 'https://script.google.com/macros/s/AKfycbzqF2qJqVF_asrKzX3jsUoXkslFpOUO_Y2E6irNU8-saJlVXP4S8FRsvNcs4twTVu9Pqw/exec',
    // false = ซ่อนฟอร์มอีเมล/รหัสผ่านเดิมและปิดสมัครเอง (ใช้หลังทุกคนเข้าผ่าน HR.SPOT ได้แล้ว)
    passwordLogin: true,
  },

  // ใช้เมื่อ backend: 'supabase' — Project Settings → API (ค่า anon/publishable key เปิดเผยได้)
  supabase: { url: '', anonKey: '', allowSignup: true },

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
