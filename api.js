// =====================================================================
// ตัวเชื่อมต่อข้อมูล: demo (ในเบราว์เซอร์) / neon (ใช้งานจริง) / local (นักพัฒนา)
// ทุกโหมดมีหน้าตาเหมือนกัน: api.rpc('api_xxx', {...}) และ api.auth.*
// =====================================================================
import { CONFIG } from './config.js';
import { wrapOffline } from './offline.js';

export class AppError extends Error {}
// ลิงก์กลับมาหน้านี้หลังกดลิงก์ตั้งรหัสผ่านใหม่ในอีเมล
const resetRedirect = () => location.origin + location.pathname + '?reset=1';

function cleanMessage(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || 'เกิดข้อผิดพลาด');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  if (/JWT|jwt expired|invalid token/i.test(m)) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  if (/permission denied for function/i.test(m)) return 'บัญชีนี้ยังไม่ได้รับสิทธิ์เรียกใช้ระบบ (ตรวจสอบการตั้งค่า Data API)';
  if (/Invalid email or password|INVALID_EMAIL_OR_PASSWORD|Invalid login credentials/i.test(m)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/User already exists|USER_ALREADY_EXISTS|already registered/i.test(m)) return 'อีเมลนี้สมัครไว้แล้ว ใช้ "เข้าสู่ระบบ" หรือ "ลืมรหัสผ่าน"';
  if (/INVALID_TOKEN|invalid token|expired/i.test(m)) return 'ลิงก์ตั้งรหัสผ่านหมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ใหม่';
  if (/Could not find the function|PGRST202|schema cache/i.test(m)) return 'ระบบยังไม่รู้จักฟังก์ชันใหม่ — ผู้ดูแลต้องกด Refresh schema cache ในหน้า Data API ของ Neon';
  return m;
}

// ---------------------------------------------------------------------
// DEMO
// ---------------------------------------------------------------------
async function demoApi() {
  const { createDemoBackend } = await import('./demo-backend.js');
  const { seedDemo, DEMO_USERS } = await import('./seed.js');
  const be = createDemoBackend('avoflow-demo-v3');
  const ensureData = async () => {
    if (be.load()) return;
    be.reset();
    await seedDemo(async (sub, fn, p) => { const u = DEMO_USERS.find((x) => x.sub === sub); be.setClaims({ sub, email: sub + '@demo.local', name: u?.name || sub }); return be.rpc(fn, p); });
    be.save();
  };
  await ensureData();
  let current = null;
  try { current = sessionStorage.getItem('avoflow-demo-user'); } catch (e) { /* ignore */ }
  const setUser = (sub) => {
    current = sub;
    try { if (sub) sessionStorage.setItem('avoflow-demo-user', sub); else sessionStorage.removeItem('avoflow-demo-user'); } catch (e) { /* ignore */ }
    const u = DEMO_USERS.find((x) => x.sub === sub);
    be.setClaims(sub ? { sub, email: sub + '@demo.local', name: u?.name || sub } : null);
  };
  setUser(current);
  return {
    mode: 'demo',
    demoUsers: DEMO_USERS,
    async rpc(fn, p = {}) { try { return await be.rpc(fn, p); } catch (e) { throw new AppError(cleanMessage(e)); } },
    auth: {
      async getSession() { return current ? { email: current + '@demo.local' } : null; },
      async signInAs(sub) { setUser(sub); },
      async signOut() { setUser(null); },
    },
    async resetDemo() { be.reset(); await seedDemo(async (sub, fn, p) => { const u = DEMO_USERS.find((x) => x.sub === sub); be.setClaims({ sub, email: sub + '@demo.local', name: u?.name || sub }); return be.rpc(fn, p); }); be.save(); setUser(current); },
  };
}

// ---------------------------------------------------------------------
// NEON (Data API + Neon Auth) — ใช้งานจริง
// ---------------------------------------------------------------------
async function neonApi() {
  const cfg = CONFIG.neon;
  if (!cfg.authUrl || !cfg.dataApiUrl) throw new AppError('ยังไม่ได้ตั้งค่า Neon ใน assets/js/config.js (authUrl และ dataApiUrl)');
  let mod;
  try { mod = await import(/* @vite-ignore */ cfg.sdkUrl); } catch (e) { throw new AppError('โหลดไลบรารีเชื่อมต่อ Neon ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต'); }
  const createClient = mod.createClient || mod.default?.createClient;
  const client = createClient({ auth: { url: cfg.authUrl }, dataApi: { url: cfg.dataApiUrl } });
  const unwrap = (res) => { if (res && res.error) throw new AppError(cleanMessage(res.error)); return res ? res.data : null; };
  const call = async (fn) => { try { return unwrap(await fn()); } catch (e) { throw e instanceof AppError ? e : new AppError(cleanMessage(e)); } };
  return {
    mode: 'neon',
    async rpc(fn, p = {}) { return call(() => client.rpc(fn, { p })); },
    auth: {
      allowSignup: cfg.allowSignup !== false, canReset: true,
      async getSession() {
        try { const d = unwrap(await client.auth.getSession()); const u = d?.user || d?.session?.user; return u ? { email: u.email, name: u.name } : null; }
        catch (e) { if (/เชื่อมต่อเซิร์ฟเวอร์ไม่ได้/.test(e.message)) throw e; return null; }
      },
      async signIn(email, password) { await call(() => client.auth.signIn.email({ email, password })); },
      async signUp(name, email, password) { await call(() => client.auth.signUp.email({ email, password, name })); },
      async signOut() { try { await client.auth.signOut(); } catch (e) { /* ignore */ } },
      // ลืมรหัสผ่าน: Neon Auth ส่งอีเมลลิงก์ตั้งรหัสผ่านใหม่ (ลิงก์หมดอายุใน 15 นาที)
      async requestReset(email) {
        const a = client.auth; const f = a.requestPasswordReset || a.forgetPassword;
        if (!f) throw new AppError('ระบบล็อกอินรุ่นนี้ยังไม่รองรับการรีเซ็ตรหัสผ่าน');
        await call(() => f.call(a, { email, redirectTo: resetRedirect() }));
      },
      async resetPassword(token, newPassword) {
        const a = client.auth; if (!a.resetPassword) throw new AppError('ระบบล็อกอินรุ่นนี้ยังไม่รองรับการตั้งรหัสผ่านใหม่');
        await call(() => a.resetPassword({ newPassword, token }));
      },
    },
  };
}

// ---------------------------------------------------------------------
// SUPABASE (ถ้าย้ายกลับไปใช้ Supabase) — ใช้ SQL ชุดเดียวกัน ดู docs/SUPABASE.md
// ---------------------------------------------------------------------
async function supabaseApi() {
  const cfg = CONFIG.supabase || {};
  if (!cfg.url || !cfg.anonKey) throw new AppError('ยังไม่ได้ตั้งค่า Supabase ใน config.js (url และ anonKey)');
  let mod;
  try { mod = await import(/* @vite-ignore */ cfg.sdkUrl || 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'); } catch (e) { throw new AppError('โหลดไลบรารี Supabase ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต'); }
  const sb = mod.createClient(cfg.url, cfg.anonKey, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } });
  const call = async (fn) => { let r; try { r = await fn(); } catch (e) { throw new AppError(cleanMessage(e)); } if (r?.error) throw new AppError(cleanMessage(r.error)); return r?.data; };
  return {
    mode: 'supabase',
    async rpc(fn, p = {}) { return call(() => sb.rpc(fn, { p })); },
    auth: {
      allowSignup: cfg.allowSignup !== false, canReset: true,
      async getSession() { const d = await call(() => sb.auth.getSession()); const u = d?.session?.user; return u ? { email: u.email, name: u.user_metadata?.name } : null; },
      async signIn(email, password) { await call(() => sb.auth.signInWithPassword({ email, password })); },
      async signUp(name, email, password) { await call(() => sb.auth.signUp({ email, password, options: { data: { name } } })); },
      async signOut() { try { await sb.auth.signOut(); } catch (e) { /* ignore */ } },
      async requestReset(email) { await call(() => sb.auth.resetPasswordForEmail(email, { redirectTo: resetRedirect() })); },
      async resetPassword(_token, newPassword) { await call(() => sb.auth.updateUser({ password: newPassword })); },
    },
  };
}

// ---------------------------------------------------------------------
// LOCAL (นักพัฒนา): tools/dev_server.py จำลอง Data API บน PostgreSQL ในเครื่อง
// ---------------------------------------------------------------------
async function localApi() {
  const base = CONFIG.local.baseUrl || '';
  let claims = null;
  try { claims = JSON.parse(sessionStorage.getItem('avoflow-local') || 'null'); } catch (e) { /* ignore */ }
  const save = () => { try { sessionStorage.setItem('avoflow-local', JSON.stringify(claims)); } catch (e) { /* ignore */ } };
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  return {
    mode: 'local',
    async rpc(fn, p = {}) {
      let r;
      try {
        r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(claims ? { Authorization: 'Bearer ' + b64(JSON.stringify(claims)) } : {}) }, body: JSON.stringify({ p }) });
      } catch (e) { throw new AppError(cleanMessage(e)); }
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new AppError(cleanMessage(body || { message: 'HTTP ' + r.status }));
      return body;
    },
    auth: {
      allowSignup: true, canReset: true,
      async requestReset() { /* โหมดนักพัฒนา: จำลองว่าส่งอีเมลแล้ว */ },
      async resetPassword() { /* โหมดนักพัฒนา */ },
      async getSession() { return claims ? { email: claims.email, name: claims.name } : null; },
      async signIn(email) { const e = email.toLowerCase(); claims = { sub: e.endsWith('@demo.local') ? e.split('@')[0] : 'local:' + e, email: e, name: e.split('@')[0] }; save(); },
      async signUp(name, email) { claims = { sub: 'local:' + email.toLowerCase(), email, name }; save(); },
      async signOut() { claims = null; save(); },
    },
  };
}

export async function createApi() {
  if (CONFIG.backend === 'neon') return wrapOffline(await neonApi(), AppError);
  if (CONFIG.backend === 'supabase') return wrapOffline(await supabaseApi(), AppError);
  if (CONFIG.backend === 'local') return wrapOffline(await localApi(), AppError);
  return demoApi();
}
