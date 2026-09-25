// =====================================================================
// ตัวเชื่อมต่อข้อมูล: demo (ในเบราว์เซอร์) / neon (ใช้งานจริง) / local (นักพัฒนา)
// ทุกโหมดมีหน้าตาเหมือนกัน: api.rpc('api_xxx', {...}) และ api.auth.*
// =====================================================================
import { CONFIG } from './config.js';

export class AppError extends Error {}

function cleanMessage(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || 'เกิดข้อผิดพลาด');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  if (/JWT|jwt expired|invalid token/i.test(m)) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
  if (/permission denied for function/i.test(m)) return 'บัญชีนี้ยังไม่ได้รับสิทธิ์เรียกใช้ระบบ (ตรวจสอบการตั้งค่า Data API)';
  return m;
}

// ---------------------------------------------------------------------
// DEMO
// ---------------------------------------------------------------------
async function demoApi() {
  const { createDemoBackend } = await import('./demo-backend.js');
  const { seedDemo, DEMO_USERS } = await import('./seed.js');
  const be = createDemoBackend('avoflow-demo-v2');
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
  return {
    mode: 'neon',
    async rpc(fn, p = {}) {
      try { return unwrap(await client.rpc(fn, { p })); } catch (e) { throw e instanceof AppError ? e : new AppError(cleanMessage(e)); }
    },
    auth: {
      allowSignup: cfg.allowSignup !== false,
      async getSession() {
        try { const d = unwrap(await client.auth.getSession()); const u = d?.user || d?.session?.user; return u ? { email: u.email, name: u.name } : null; }
        catch (e) { return null; }
      },
      async signIn(email, password) { unwrap(await client.auth.signIn.email({ email, password })); },
      async signUp(name, email, password) { unwrap(await client.auth.signUp.email({ email, password, name })); },
      async signOut() { try { await client.auth.signOut(); } catch (e) { /* ignore */ } },
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
      allowSignup: true,
      async getSession() { return claims ? { email: claims.email, name: claims.name } : null; },
      async signIn(email) { const e = email.toLowerCase(); claims = { sub: e.endsWith('@demo.local') ? e.split('@')[0] : 'local:' + e, email: e, name: e.split('@')[0] }; save(); },
      async signUp(name, email) { claims = { sub: 'local:' + email.toLowerCase(), email, name }; save(); },
      async signOut() { claims = null; save(); },
    },
  };
}

export async function createApi() {
  if (CONFIG.backend === 'neon') return neonApi();
  if (CONFIG.backend === 'local') return localApi();
  return demoApi();
}
