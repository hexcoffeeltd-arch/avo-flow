// =====================================================================
// ทำงานต่อได้ตอนสัญญาณหลุด
//  1) รายการที่ "บันทึกได้แบบออฟไลน์" (ตรวจความสุก ตัดทิ้ง/ปรับยอด ชั่งซ้ำ ผลนับ โอนภายใน รับของ รับเข้า)
//     ส่งผ่าน api_offline_submit พร้อมรหัสอ้างอิง (ส่งซ้ำได้ไม่บันทึกซ้ำ)
//     ถ้าเน็ตหลุด → เก็บไว้ในเครื่อง (outbox) แล้วส่งให้อัตโนมัติเมื่อกลับมาออนไลน์
//  2) ข้อมูลที่เปิดดูล่าสุด (สต็อก แดชบอร์ด ฯลฯ) เก็บสำเนาไว้ เปิดดูได้ตอนออฟไลน์
// =====================================================================
export const QUEUE_FNS = new Set(['api_ripeness_change', 'api_adjust_request', 'api_reweigh', 'api_stocktake_save', 'api_zone_transfer', 'api_dispatch_receive', 'api_receipt_save']);
const READ_FNS = new Set(['api_me', 'api_stock', 'api_dashboard', 'api_alerts', 'api_branch_stock', 'api_fefo', 'api_dispatch_lots', 'api_tasks', 'api_assignees',
  'api_stocktakes', 'api_stocktake_get', 'api_dispatches', 'api_dispatch_get', 'api_receipts', 'api_receipt_get', 'api_lot_trace', 'api_adjustments', 'api_cases', 'api_plan_month']);
const OUTBOX = 'avoflow-outbox';
const CACHE = 'avoflow-cache';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};
export const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

export function wrapOffline(api, AppError) {
  const raw = api.rpc.bind(api);
  const isNet = (e) => (typeof navigator !== 'undefined' && navigator.onLine === false) || /เชื่อมต่อเซิร์ฟเวอร์ไม่ได้|Failed to fetch|NetworkError|Load failed|network/i.test(e?.message || '');
  const emit = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* ignore */ } };
  const who = () => store.get('avoflow-me', null)?.email || '';
  let offlineSince = null;
  const setOnline = (on) => { const was = offlineSince; offlineSince = on ? null : (offlineSince || new Date().toISOString()); if (!!was !== !!offlineSince) emit('avo:net', { offline: !!offlineSince, since: offlineSince }); };

  // อัปโหลดรูปที่เก็บไว้ในเครื่อง (local:data:image…) ก่อนส่งรายการ
  const resolvePhotos = async (p) => {
    const out = { ...p };
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === 'string' && v.includes('local:data:image')) {
        const parts = [];
        for (const r of v.split('|')) parts.push(r.startsWith('local:data:image') ? (await raw('api_attachment_save', { data: r.slice(6) })).ref : r);
        out[k] = parts.join('|');
      }
    }
    return out;
  };
  const clearLocal = () => { try { localStorage.removeItem(CACHE); localStorage.removeItem('avoflow-me'); } catch (e) { /* ignore */ } };
  const cacheKey = (fn, p) => fn + ':' + JSON.stringify(p || {});

  // outbox แยกตามผู้ใช้: เห็น/ส่งเฉพาะรายการของผู้ที่ล็อกอินอยู่ (เครื่องใช้ร่วมกันได้)
  const outbox = () => { const me = who(); return me ? store.get(OUTBOX, []).filter((x) => x.user === me) : []; };
  const saveOutbox = (mine) => { const me = who(); const others = store.get(OUTBOX, []).filter((x) => x.user !== me);
    const list = mine; store.set(OUTBOX, [...others, ...mine]); emit('avo:outbox', { pending: list.filter((x) => x.status !== 'failed').length, failed: list.filter((x) => x.status === 'failed').length }); };

  async function rpc(fn, p = {}) {
    if (QUEUE_FNS.has(fn)) {
      const ref = uuid();
      try {
        const res = await raw('api_offline_submit', { ref, fn, p: await resolvePhotos(p) });
        setOnline(true); return res;
      } catch (e) {
        if (!isNet(e)) throw e;
        setOnline(false);
        if (!who()) throw new AppError('ออฟไลน์อยู่ — กรุณาเข้าสู่ระบบอีกครั้งเมื่อมีสัญญาณ');
        const all = store.get(OUTBOX, []); all.push({ ref, fn, p, at: new Date().toISOString(), user: who(), status: 'pending', error: null });
        if (!store.set(OUTBOX, all)) throw new AppError('เน็ตหลุดและพื้นที่ในเครื่องเต็ม บันทึกไม่ได้ ลองใหม่เมื่อมีสัญญาณ');
        saveOutbox(outbox());
        return { _queued: true, ref, doc_no: 'รอส่ง', status: 'queued' };
      }
    }
    try {
      const res = await raw(fn, p);
      setOnline(true);
      if (READ_FNS.has(fn)) { const c = store.get(CACHE, {}); c[cacheKey(fn, p)] = { at: new Date().toISOString(), data: res };
        const keys = Object.keys(c); if (keys.length > 40) delete c[keys[0]];
        if (!store.set(CACHE, c)) store.set(CACHE, { [cacheKey(fn, p)]: c[cacheKey(fn, p)] }); }
      if (fn === 'api_me' && res?.user) {
        if (who() && who() !== res.user.email) clearLocal(); // เปลี่ยนผู้ใช้ → ล้างข้อมูลที่เก็บไว้ของคนก่อน
        store.set('avoflow-me', { email: res.user.email, user: res.user, master: res.master });
        if (outbox().some((x) => x.status === 'pending')) setTimeout(flush, 0);
      }
      return res;
    } catch (e) {
      if (isNet(e)) {
        setOnline(false);
        const hit = READ_FNS.has(fn) ? store.get(CACHE, {})[cacheKey(fn, p)] : null;
        if (hit) return hit.data;
        throw new AppError('ออฟไลน์อยู่ — ยังไม่มีข้อมูลนี้ในเครื่อง (เปิดดูได้หลังกลับมาออนไลน์)');
      }
      throw e;
    }
  }

  let flushing = false;
  async function flush() {
    if (flushing) return; flushing = true;
    try {
      let list = outbox(); if (!list.some((x) => x.status === 'pending')) return;
      for (const item of list.filter((x) => x.status === 'pending')) {
        try {
          await raw('api_offline_submit', { ref: item.ref, fn: item.fn, p: await resolvePhotos(item.p) });
          list = outbox().filter((x) => x.ref !== item.ref); saveOutbox(list);
          setOnline(true); emit('avo:synced', { fn: item.fn });
        } catch (e) {
          if (isNet(e)) { setOnline(false); break; }
          list = outbox().map((x) => (x.ref === item.ref ? { ...x, status: 'failed', error: e.message } : x)); saveOutbox(list);
        }
      }
    } finally { flushing = false; }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { setOnline(true); flush(); });
    window.addEventListener('offline', () => setOnline(false));
    setInterval(() => { if (outbox().some((x) => x.status === 'pending')) flush(); }, 60000);
  }
  // ออกจากระบบ → ล้างสำเนาข้อมูลและข้อมูลผู้ใช้ในเครื่อง (รายการรอส่งยังอยู่ ส่งต่อเมื่อคนเดิมล็อกอินกลับมา)
  if (typeof api.auth?.signOut === 'function') { const so = api.auth.signOut.bind(api.auth); api.auth.signOut = async (...a) => { clearLocal(); emit('avo:outbox', { pending: 0, failed: 0 }); return so(...a); }; }
  Object.assign(api, {
    rpc, isNetworkError: isNet, flush,
    outbox: () => outbox(),
    outboxRetry(ref) { saveOutbox(outbox().map((x) => (x.ref === ref ? { ...x, status: 'pending', error: null } : x))); return flush(); },
    outboxDelete(ref) { saveOutbox(outbox().filter((x) => x.ref !== ref)); },
    cachedMe: () => store.get('avoflow-me', null),
  });
  Object.defineProperty(api, 'offline', { get: () => !!offlineSince });
  return api;
}
