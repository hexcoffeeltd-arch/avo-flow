// =====================================================================
// AVO FLOW — โครงหน้าจอหลัก: เข้าสู่ระบบ, เมนู, เส้นทางหน้า, สิทธิ์
// =====================================================================
import { CONFIG } from './config.js';
import { createApi, AppError } from './api.js';
import { $, $$, esc, toast, ICONS, ROLE, thDateY, busy, field } from './ui.js';
import * as docs from './docs.js';

const PAGES = {
  dashboard: { title: 'แดชบอร์ด', load: () => import('./dashboard.js') },
  warehouse: { title: 'คลังสินค้า', load: () => import('./warehouse.js') },
  branches: { title: 'สาขาและส่งต่องาน', load: () => import('./branches.js') },
  sales: { title: 'การขายและบิล', load: () => import('./sales.js') },
  suppliers: { title: 'จัดซื้อ / สวน', load: () => import('./suppliers.js') },
  reports: { title: 'รายงาน', load: () => import('./reports.js') },
  settings: { title: 'ตั้งค่า', load: () => import('./settings.js') },
  alerts: { title: 'แจ้งเตือนและงานรอตรวจ', load: () => import('./alerts.js') },
};

const ctx = { api: null, me: null, master: null, page: null, params: [] };
window.__avo = ctx; // สำหรับตรวจสอบ/ทดสอบ

// ---------- สิทธิ์ฝั่งหน้าจอ (ฐานข้อมูลตรวจซ้ำทุกครั้ง) ----------
function buildCan(u) {
  const r = u.role; const is = (...roles) => r === 'admin' || roles.includes(r);
  const site = (id) => ctx.master.sites.find((s) => s.id === Number(id));
  const canAct = (sid) => r === 'admin' || (r === 'warehouse' && ((u.site_id == null && site(sid)?.kind === 'warehouse') || u.site_id === Number(sid))) || (r === 'branch' && u.site_id === Number(sid));
  return {
    receive: is('warehouse'), dispatch: is('warehouse', 'branch'), actAt: canAct,
    approveAt: (sid) => ['admin', 'executive'].includes(r) || (u.is_manager && canAct(sid)),
    sales: is('sales', 'executive'), invoices: is('sales', 'executive', 'warehouse'), prices: is('executive'),
    settings: r === 'admin', master: r === 'admin' || (r === 'warehouse' && u.is_manager),
    suppliers: is('warehouse', 'executive'), customers: is('sales', 'executive'),
    seeWarehouse: r !== 'branch', recordDelivery: is('warehouse', 'sales'),
  };
}

// ---------- เข้าสู่ระบบ ----------
function authShell(inner) {
  document.body.innerHTML = `<div class="auth"><div class="card auth-card">
    <div class="brand"><div class="brand-mark">A</div><div><div class="brand-name">${esc(CONFIG.appName)}</div><div class="brand-sub">${esc(CONFIG.appSub)}</div></div></div>
    ${inner}</div></div>`;
}

function showDemoLogin() {
  authShell(`<p class="muted small" style="text-align:center;margin:0 0 16px">โหมดทดลอง · ข้อมูลจำลอง · เลือกบทบาทเพื่อเข้าใช้งาน</p>
    <div class="role-grid">${ctx.api.demoUsers.map((u) => `<button class="role-btn" data-sub="${u.sub}"><b>${esc(u.name)}</b><span>${esc(ROLE[u.role])}${u.manager ? ' · ผู้จัดการ' : ''} — ${esc(u.desc)}</span></button>`).join('')}</div>
    <p class="small muted" style="margin:16px 0 0;text-align:center">ข้อมูลในโหมดทดลองเก็บไว้ในเบราว์เซอร์นี้เท่านั้น <button class="link" id="reset-demo">รีเซ็ตข้อมูลตัวอย่าง</button></p>`);
  $$('.role-btn').forEach((b) => (b.onclick = async () => { await ctx.api.auth.signInAs(b.dataset.sub); boot(); }));
  $('#reset-demo').onclick = async () => { await ctx.api.resetDemo(); toast('รีเซ็ตข้อมูลตัวอย่างแล้ว', 'ok'); };
}

function showLogin(mode = 'in', msg = '') {
  const up = mode === 'up';
  authShell(`<h2 style="font-size:18px;font-weight:500;text-align:center;margin:4px 0 16px">${up ? 'สมัครบัญชีผู้ใช้' : 'เข้าสู่ระบบ'}</h2>
    ${msg ? `<div class="notice">${esc(msg)}</div>` : ''}
    <form id="auth-form" class="grid">
      ${up ? field('ชื่อที่แสดง', '<input class="input" name="name" required autocomplete="name">', { req: true }) : ''}
      ${field('อีเมล', '<input class="input" name="email" type="email" required autocomplete="email">', { req: true })}
      ${field('รหัสผ่าน', `<input class="input" name="password" type="password" required minlength="8" autocomplete="${up ? 'new-password' : 'current-password'}">`, { req: true, hint: up ? 'อย่างน้อย 8 ตัวอักษร' : '' })}
      <button class="btn primary" type="submit">${up ? 'สมัครและเข้าสู่ระบบ' : 'เข้าสู่ระบบ'}</button>
    </form>
    ${ctx.api.auth.allowSignup ? `<p class="small muted" style="text-align:center;margin:14px 0 0">${up ? 'มีบัญชีแล้ว?' : 'ยังไม่มีบัญชี?'} <button class="link" id="swap">${up ? 'เข้าสู่ระบบ' : 'สมัครใช้งาน'}</button></p>` : ''}
    ${up ? '<p class="small muted" style="text-align:center;margin:8px 0 0">บัญชีใหม่ต้องรอ Admin กำหนดบทบาทและสาขาก่อนใช้งาน (ผู้ใช้คนแรกของระบบจะเป็น Admin อัตโนมัติ)</p>' : ''}`);
  const sw = $('#swap'); if (sw) sw.onclick = () => showLogin(up ? 'in' : 'up');
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const btn = $('button[type=submit]', e.target);
    await busy(btn, async () => {
      if (up) await ctx.api.auth.signUp(f.name, f.email, f.password); else await ctx.api.auth.signIn(f.email, f.password);
      ctx.pendingName = f.name; boot();
    });
  };
}

function showPending(u) {
  authShell(`<div class="notice info" style="margin:6px 0 14px">บัญชี <b>${esc(u.email || u.display_name)}</b> สมัครเรียบร้อยแล้ว กำลังรอผู้ดูแลระบบกำหนดบทบาทและสาขา</div>
    <p class="small muted">แจ้ง Admin ให้เข้าเมนู ตั้งค่า → ผู้ใช้งาน เพื่อกำหนดสิทธิ์ แล้วกด "ตรวจสอบอีกครั้ง"</p>
    <div class="actions" style="justify-content:center;margin-top:14px"><button class="btn primary" id="again">ตรวจสอบอีกครั้ง</button><button class="btn" id="out">ออกจากระบบ</button></div>`);
  $('#again').onclick = () => boot(); $('#out').onclick = async () => { await ctx.api.auth.signOut(); boot(); };
}

// ---------- โครงหน้าจอ ----------
const NAV = [
  { group: 'ภาพรวม' },
  { key: 'dashboard', icon: 'dash', label: 'แดชบอร์ด' },
  { group: 'ปฏิบัติงาน' },
  { key: 'warehouse', icon: 'stock', label: 'คลังสินค้า', sub: 'รับเข้า · คงคลัง · ตีออก · ประวัติ', show: (c) => c.seeWarehouse },
  { key: 'branches', icon: 'store', label: 'สาขาและส่งต่องาน', sub: 'หน้าร้าน · หลังร้าน · แช่แข็ง' },
  { key: 'sales', icon: 'bill', label: 'การขายและบิล', sub: 'ทำบิล · ลูกค้า · ประวัติขาย', show: (c) => c.invoices },
  { group: 'ข้อมูลและระบบ' },
  { key: 'suppliers', icon: 'farm', label: 'จัดซื้อ / สวน', show: (c) => c.seeWarehouse },
  { key: 'reports', icon: 'report', label: 'รายงาน' },
  { key: 'settings', icon: 'settings', label: 'ตั้งค่า', show: (c) => c.settings || c.master || c.prices },
];

function renderShell() {
  const u = ctx.me; const c = ctx.can;
  const nm = (u.display_name || u.email || 'U').replace(/[()]/g, '').trim();
  const initials = /^[A-Za-z]/.test(nm) ? nm.slice(0, 2).toUpperCase() : ({ admin: 'AD', executive: 'EX', warehouse: 'WH', branch: 'BR', sales: 'SA' }[u.role] || 'U');
  document.body.innerHTML = `<div class="app" id="app">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">A</div><div><div class="brand-name">${esc(CONFIG.appName)}</div><div class="brand-sub">${esc(CONFIG.appSub)}</div></div></div>
      <nav class="nav">${NAV.map((n) => n.group ? `<div class="nav-group">${n.group}</div>` : (!n.show || n.show(c)) ? `<a href="#/${n.key}" data-nav="${n.key}">${ICONS[n.icon]}<span>${n.label}</span></a>${n.sub ? `<div class="sub">${n.sub}</div>` : ''}` : '').join('')}</nav>
      <div class="sidebar-foot" id="me-btn" title="บัญชีผู้ใช้"><div class="avatar">${esc(initials)}</div><div style="min-width:0"><div class="user-name">${esc(u.display_name || u.email)}</div>
        <div class="user-role">${esc(ROLE[u.role])}${u.is_manager ? ' · ผู้จัดการ' : ''} · ${esc(u.site?.name || 'ทุกสาขา')}</div></div></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="iconbtn menu-btn" id="menu-btn" aria-label="เมนู">${ICONS.menu}</button>
        <div class="crumb" id="crumb"></div><div class="spacer"></div>
        ${ctx.api.mode === 'demo' ? '<span class="pill">ตัวอย่างหน้าจอ · ข้อมูลจำลอง</span>' : ''}
        <span class="topdate">${thDateY(new Date().toISOString())}</span>
        <button class="iconbtn" id="bell" aria-label="แจ้งเตือน" title="แจ้งเตือนและงานรอตรวจ">${ICONS.bell}<span class="dot hidden" id="bell-dot"></span></button>
      </header>
      <main class="content" id="content"></main>
    </div></div>`;
  $('#menu-btn').onclick = () => $('#app').classList.toggle('nav-open');
  $('#app').addEventListener('click', (e) => { if (e.target.id === 'app') $('#app').classList.remove('nav-open'); });
  $$('.nav a').forEach((a) => (a.onclick = () => $('#app').classList.remove('nav-open')));
  $('#bell').onclick = () => go('alerts');
  $('#me-btn').onclick = () => docs.userMenu(ctx);
}

export function go(path) { location.hash = '#/' + path; }
ctx.go = go;

async function route() {
  if (!ctx.me) return;
  const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
  let key = parts[0]; if (!PAGES[key]) key = 'dashboard';
  const navKey = key === 'alerts' ? null : key;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
  $('#crumb').innerHTML = `${esc(CONFIG.appName)} / <b>${esc(PAGES[key].title)}</b>`;
  const el = $('#content'); el.innerHTML = '<div class="spinner"></div>';
  ctx.page = key; ctx.params = parts.slice(1);
  try {
    const mod = await PAGES[key].load();
    if (ctx.page !== key) return;
    await mod.render(el, ctx, parts.slice(1));
  } catch (e) {
    if (!(e instanceof AppError)) console.error(e);
    el.innerHTML = `<div class="notice">${esc(e.message || e)}</div>`;
  }
  refreshBell();
  window.scrollTo(0, 0);
}
ctx.rerender = () => route();

async function refreshBell() {
  try {
    const a = await ctx.api.rpc('api_alerts', {});
    const n = a.filter((x) => x.level !== 'info' || ['pending_receipt', 'pending_adjust'].includes(x.kind)).length;
    const dot = $('#bell-dot'); if (!dot) return; dot.textContent = n > 99 ? '99+' : n; dot.classList.toggle('hidden', !n);
  } catch (e) { /* ignore */ }
}
ctx.refreshBell = refreshBell;

ctx.reloadMe = async () => {
  const r = await ctx.api.rpc('api_me', {});
  ctx.me = r.user; ctx.master = r.master; ctx.can = buildCan(ctx.me);
};

async function boot() {
  try {
    if (!ctx.api) ctx.api = await createApi();
  } catch (e) {
    authShell(`<div class="notice">${esc(e.message)}</div><p class="small muted">ผู้ดูแลระบบ: ตรวจสอบไฟล์ assets/js/config.js ตามคู่มือ docs/DEPLOY.md</p>`); return;
  }
  const s = await ctx.api.auth.getSession();
  if (!s) { ctx.me = null; return ctx.api.mode === 'demo' ? showDemoLogin() : showLogin(); }
  try {
    const r = await ctx.api.rpc('api_me', { name: ctx.pendingName || s.name || null, email: s.email || null });
    if (r.user.role === 'pending' || !r.user.active) { ctx.me = null; return showPending(r.user); }
    ctx.me = r.user; ctx.master = r.master; ctx.can = buildCan(ctx.me);
  } catch (e) {
    ctx.me = null; await ctx.api.auth.signOut();
    return ctx.api.mode === 'demo' ? showDemoLogin() : showLogin('in', e.message);
  }
  renderShell();
  route();
}

window.addEventListener('hashchange', route);
ctx.boot = boot;
boot();
