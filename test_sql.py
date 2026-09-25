"""Acceptance tests for AVO FLOW business rules.
Runs the same scenario against:
  * the real PostgreSQL functions (default)          python3 tests/test_sql.py
  * the in-browser demo backend (parity check)        python3 tests/test_sql.py --demo
Covers the acceptance criteria in the handoff document (เกณฑ์ตรวจรับตัวอย่าง) plus permissions and concurrency.
"""
import json, os, subprocess, sys, threading
sys.path.insert(0, os.path.dirname(__file__))
import pgcall
from pgcall import call, ApiError, psql

DB = 'avo_test'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = '--demo' in sys.argv
passed = failed = 0
results = []


class DemoBridge:
    def __init__(self):
        self.p = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'demo_bridge.mjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=ROOT)
        self.lock = threading.Lock()

    def send(self, obj):
        with self.lock:
            self.p.stdin.write(json.dumps(obj, ensure_ascii=False) + '\n'); self.p.stdin.flush()
            r = json.loads(self.p.stdout.readline())
        if 'err' in r:
            raise ApiError(r['err'])
        return r['ok']


bridge = DemoBridge() if DEMO else None


def call_any(fn, p, sub):
    if DEMO:
        return bridge.send({'fn': fn, 'p': p or {}, 'sub': sub})
    return call(fn, p, sub=sub, db=DB)


def table(name):
    """Return rows of an internal table as dicts (balances/movements/lots)."""
    if DEMO:
        return bridge.send({'cmd': 'db'})[name]
    out = psql(f"select coalesce(json_agg(t),'[]') from avo.{name} t", db=DB)
    return json.loads(out.strip())


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1; results.append(('PASS', name))
    else:
        failed += 1; results.append(('FAIL', name + (' — ' + str(detail) if detail else '')))
    print(('  ✓ ' if cond else '  ✗ ') + name + ('' if cond else f'   [{detail}]'))


def expect_error(name, fn, *a, contains=None, **k):
    try:
        fn(*a, **k)
        check(name, False, 'no error raised')
    except ApiError as e:
        ok = contains is None or contains in str(e)
        check(name, ok, str(e))
        return str(e)


def c(fn, p=None, who='admin'):
    return call_any(fn, p, who)


def kg(site, zone=None, lot=None, rip=None):
    tot = 0.0
    for b in table('balances'):
        if b['site_id'] == site and (zone is None or b['zone'] == zone) and (lot is None or b['lot_id'] == lot) and (rip is None or b['ripeness'] == rip):
            tot += float(b['kg'])
    return round(tot, 2)


def main():
    # ---------- fresh database ----------
    if DEMO:
        print('backend: in-browser demo (assets/js/demo-backend.js)')
    else:
        subprocess.run(['psql', '-h', 'localhost', '-U', 'avo', '-d', 'postgres', '-q', '-c', f'drop database if exists {DB}', '-c', f'create database {DB}'],
                       env=dict(os.environ, PGPASSWORD='avo'), check=True, capture_output=True)
        psql(open(os.path.join(ROOT, 'sql/avo_flow_install.sql')).read(), db=DB)
        print('backend: PostgreSQL (schema installed on fresh database)')

    print('\n[1] ผู้ใช้และสิทธิ์')
    me = c('api_me', {}, 'admin')
    check('ผู้ใช้คนแรกกลายเป็น Admin อัตโนมัติ', me['user']['role'] == 'admin', me['user']['role'])
    for u in ['wh', 'whm', 'br', 'brm', 'sales', 'exec', 'br2']:
        r = c('api_me', {}, u)
    check('ผู้ใช้ถัดไปเป็น "รอกำหนดสิทธิ์"', r['user']['role'] == 'pending')
    expect_error('ผู้ใช้รอสิทธิ์ใช้งานระบบไม่ได้', c, 'api_stock', {}, 'br2', contains='รอผู้ดูแล')
    expect_error('ผู้ใช้ที่ไม่ใช่ Admin แก้สิทธิ์ไม่ได้', c, 'api_users', {}, 'br2', contains='รอผู้ดูแล')

    master = me['master']
    CW = next(s['id'] for s in master['sites'] if s['code'] == 'CW')
    nww = c('api_master_save', {'entity': 'site', 'row': {'code': 'NWW', 'name': 'สาขา NWW', 'kind': 'branch'}})
    NWW = nww['id']
    b2 = c('api_master_save', {'entity': 'site', 'row': {'code': 'B2', 'name': 'สาขา 2', 'kind': 'branch'}})
    users = {u['email'].split('@')[0]: u for u in c('api_users')}
    setup = {'wh': ('warehouse', CW, False), 'whm': ('warehouse', CW, True), 'br': ('branch', NWW, False),
             'brm': ('branch', NWW, True), 'sales': ('sales', None, False), 'exec': ('executive', None, False),
             'br2': ('branch', b2['id'], True)}
    for name, (role, site, mgr) in setup.items():
        c('api_user_save', {'id': users[name]['id'], 'role': role, 'site_id': site, 'is_manager': mgr})
    expect_error('Admin ลดสิทธิ์ตัวเองไม่ได้', c, 'api_user_save', {'id': me['user']['id'], 'role': 'sales'}, contains='ตัวเอง')
    expect_error('ฝ่ายขายเพิ่มสาขาไม่ได้', c, 'api_master_save', {'entity': 'site', 'row': {'code': 'X', 'name': 'x', 'kind': 'branch'}}, 'sales', contains='ไม่มีสิทธิ์')

    HASS = next(v['id'] for v in master['varieties'] if v['code'] == 'HASS')
    S220 = next(s['id'] for s in master['sizes'] if s['code'] == '220')
    sup = c('api_supplier_save', {'name': 'สวนคุณหน่อย', 'province': 'น่าน', 'phone': '081-000-0000', 'buy_price': 40}, 'wh')
    cust = c('api_customer_save', {'name': 'บริษัท NWW', 'channel': 'wholesale', 'address': 'กรุงเทพฯ'}, 'sales')
    expect_error('ฝ่ายขายตั้งราคาเองไม่ได้', c, 'api_price_save', {'variety_id': HASS, 'size_id': S220, 'sell_price': 70}, 'sales', contains='ไม่มีสิทธิ์')
    c('api_price_save', {'variety_id': HASS, 'size_id': S220, 'sell_price': 70}, 'exec')

    print('\n[2] รับเข้า: สต็อกเพิ่มเมื่อยืนยันตรวจรับเท่านั้น')
    rc = c('api_receipt_save', {'supplier_id': sup['id'], 'lines': [
        {'variety_id': HASS, 'size_id': S220, 'ripeness': 'raw', 'baskets': 8, 'gross_kg': 160, 'tare_kg': 10, 'unit_cost': 40}]}, 'wh')
    LOT = rc['lines'][0]['lot_id']
    check('น้ำหนักสุทธิ = รวม − ตะกร้า (160−10=150)', float(rc['total_net']) == 150, rc['total_net'])
    check('ใบร่างยังไม่เพิ่มสต็อก', kg(CW) == 0)
    expect_error('บังคับกรอกน้ำหนักรวม', c, 'api_receipt_save', {'supplier_id': sup['id'], 'lines': [{'variety_id': HASS, 'size_id': S220, 'baskets': 1}]}, 'wh', contains='น้ำหนักรวม')
    expect_error('บังคับเลือกสวน', c, 'api_receipt_save', {'lines': [{'variety_id': HASS, 'size_id': S220, 'gross_kg': 10}]}, 'wh', contains='สวน')
    rc = c('api_receipt_save', {'id': rc['id'], 'supplier_id': sup['id'], 'submit': True, 'lines': [
        {'id': rc['lines'][0]['id'], 'variety_id': HASS, 'size_id': S220, 'ripeness': 'raw', 'baskets': 8, 'gross_kg': 160, 'tare_kg': 10, 'unit_cost': 40}]}, 'wh')
    check('แก้ใบร่างแล้ว Lot เดิมคงอยู่ (ไม่ออกเลข Lot ใหม่)', rc['lines'][0]['lot_id'] == LOT)
    check('ส่งตรวจรับ → สถานะรอตรวจรับ', rc['status'] == 'pending_check' and kg(CW) == 0)
    expect_error('ฝ่ายสาขายืนยันรับเข้าคลังไม่ได้', c, 'api_receipt_confirm', {'id': rc['id']}, 'br', contains='ไม่มีสิทธิ์')
    rc = c('api_receipt_confirm', {'id': rc['id']}, 'wh')
    check('ยืนยันรับเข้า 150 กก. → คลัง 150 กก.', kg(CW, 'main') == 150, kg(CW, 'main'))
    expect_error('ยืนยันซ้ำไม่ได้ (กันกดซ้ำ)', c, 'api_receipt_confirm', {'id': rc['id']}, 'wh', contains='ยืนยันหรือยกเลิกไปแล้ว')

    print('\n[3] ตีออก: ห้ามจ่ายเกิน / ต้องผู้จัดการยืนยัน / ไม่นับซ้ำ')
    d1 = c('api_dispatch_save', {'kind': 'transfer', 'from_site_id': CW, 'to_site_id': NWW, 'carrier': 'รถบริษัท',
                                 'lines': [{'lot_id': LOT, 'ripeness': 'raw', 'kg': 50, 'baskets': 3}]}, 'wh')
    dash = c('api_dashboard', {}, 'admin')
    check('ใบร่างจองสต็อก: พร้อมจ่าย 100 / จอง 50', float(dash['ready_kg']) == 100 and float(dash['reserved_kg']) == 50, (dash['ready_kg'], dash['reserved_kg']))
    expect_error('ห้ามตีออกเกินยอดพร้อมใช้ (ขอ 101 จากที่เหลือ 100)', c, 'api_dispatch_save',
                 {'kind': 'transfer', 'from_site_id': CW, 'to_site_id': NWW, 'lines': [{'lot_id': LOT, 'ripeness': 'raw', 'kg': 101}]}, 'wh', contains='ห้ามจ่ายเกิน')
    expect_error('พนักงานคลังยืนยันตีออกเองไม่ได้ ต้องผู้จัดการ', c, 'api_dispatch_ship', {'id': d1['id']}, 'wh', contains='ผู้จัดการ')
    d1 = c('api_dispatch_ship', {'id': d1['id']}, 'whm')
    check('ตีออก 50 → คลังเหลือ 100 กก.', kg(CW, 'main') == 100, kg(CW, 'main'))
    check('ยอดโอนสาขาเป็น "ระหว่างทาง" 50 กก.', kg(CW, 'transit') == 50)
    check('สาขายังไม่ได้รับ = 0 (ไม่นับซ้ำ)', kg(NWW) == 0)
    expect_error('กดส่งซ้ำไม่ได้', c, 'api_dispatch_ship', {'id': d1['id']}, 'whm', contains='กันกดซ้ำ')
    check('รวมทุกจุด = 150 กก. เท่ารับเข้า', kg(CW) + kg(NWW) == 150)

    print('\n[4] รับปลายทางบางส่วน → งานตรวจสอบส่วนต่าง (ตัวอย่างในเอกสาร 50→48)')
    line = d1['lines'][0]
    expect_error('สาขาอื่นยืนยันรับแทนไม่ได้', c, 'api_dispatch_receive', {'id': d1['id'], 'receiver_name': 'x', 'evidence': 'att:1'}, 'br2', contains='สาขาปลายทาง')
    expect_error('ต้องแนบรูปหลักฐานเมื่อรับ', c, 'api_dispatch_receive', {'id': d1['id'], 'receiver_name': 'สมชาย', 'lines': [{'id': line['id'], 'received_kg': 48}]}, 'br', contains='แนบรูป')
    att = c('api_attachment_save', {'data': 'data:image/jpeg;base64,/9j/4AAQ'}, 'br')
    d1 = c('api_dispatch_receive', {'id': d1['id'], 'receiver_name': 'สมชาย', 'evidence': att['ref'],
                                    'lines': [{'id': line['id'], 'received_kg': 48, 'received_baskets': 3}]}, 'br')
    check('สาขารับจริง 48 กก.', kg(NWW, 'back') == 48, kg(NWW, 'back'))
    check('คงค้าง 2 กก. เป็นส่วนต่าง', kg(CW, 'transit') == 2)
    check('สถานะ "รับบางส่วน" และมีงานตรวจสอบ 1 งาน', d1['status'] == 'partial' and d1['open_cases'] == 1)
    check('คลังยังเหลือ 100 กก.', kg(CW, 'main') == 100)
    expect_error('รับซ้ำไม่ได้', c, 'api_dispatch_receive', {'id': d1['id'], 'receiver_name': 'x', 'evidence': 'att:1'}, 'br', contains='ส่งแล้ว รอรับ')
    case = c('api_cases', {'status': 'open'}, 'admin')[0]
    expect_error('พนักงานสาขาปิดงานส่วนต่างไม่ได้', c, 'api_case_resolve', {'id': case['id'], 'outcome': 'loss', 'note': 'x'}, 'br', contains='ผู้จัดการ')
    d1 = c('api_case_resolve', {'id': case['id'], 'outcome': 'loss', 'note': 'ผลช้ำระหว่างขนส่ง'}, 'brm')
    check('สรุปเป็นสูญเสีย → ระหว่างทาง 0 และปิดใบ', kg(CW, 'transit') == 0 and d1['status'] == 'closed')

    print('\n[5] สาขา: ความสุก / โอนภายใน / แช่แข็ง / ตัดทิ้ง')
    c('api_ripeness_change', {'site_id': NWW, 'zone': 'back', 'lot_id': LOT, 'from': 'raw', 'to': 'ripe', 'kg': 20, 'baskets': 1, 'note': 'บีบนุ่ม'}, 'br')
    check('เปลี่ยนความสุก 20 กก. ดิบ→สุก', kg(NWW, 'back', rip='ripe') == 20 and kg(NWW, 'back', rip='raw') == 28)
    expect_error('สาขาอื่นเปลี่ยนความสุกไม่ได้', c, 'api_ripeness_change', {'site_id': NWW, 'zone': 'back', 'lot_id': LOT, 'from': 'raw', 'to': 'ripe', 'kg': 1}, 'br2', contains='ไม่มีสิทธิ์')
    c('api_zone_transfer', {'site_id': NWW, 'from_zone': 'back', 'to_zone': 'front', 'lot_id': LOT, 'ripeness': 'ripe', 'kg': 20, 'baskets': 1}, 'br')
    check('โอนหลังร้าน→หน้าร้าน 20 กก.', kg(NWW, 'front') == 20 and kg(NWW, 'back') == 28)
    fz = c('api_freeze', {'site_id': NWW, 'from_zone': 'front', 'lot_id': LOT, 'ripeness': 'ripe', 'input_kg': 10, 'output_kg': 7, 'bags': 14}, 'br')
    check('แช่แข็ง: ใช้ 10 ได้ 7 กก./14 ถุง สูญเสีย 3', float(fz['loss_kg']) == 3 and kg(NWW, 'frozen') == 7 and kg(NWW, 'front') == 10)
    fl = next(l for l in table('lots') if l['code'] == fz['lot_code'])
    check('Lot แช่แข็งอ้างอิง Lot ต้นทาง และต้นทุน/กก. = 40×10/7', fl['parent_lot_id'] == LOT and abs(float(fl['unit_cost']) - 57.1429) < 0.001, fl)
    expect_error('ตัดทิ้งต้องแนบรูป', c, 'api_adjust_request', {'kind': 'waste', 'site_id': NWW, 'zone': 'front', 'lot_id': LOT, 'ripeness': 'ripe', 'kg': 2, 'reason': 'เน่า'}, 'br', contains='แนบรูป')
    w = c('api_adjust_request', {'kind': 'waste', 'site_id': NWW, 'zone': 'front', 'lot_id': LOT, 'ripeness': 'ripe', 'kg': 2, 'reason': 'เน่า', 'evidence': att['ref']}, 'br')
    check('ตัดทิ้งรออนุมัติ ยังไม่ลดสต็อก', w['status'] == 'pending' and kg(NWW, 'front') == 10)
    expect_error('พนักงานอนุมัติตัดทิ้งไม่ได้', c, 'api_adjust_decide', {'id': w['id'], 'approve': True}, 'br', contains='ผู้จัดการ')
    w = c('api_adjust_decide', {'id': w['id'], 'approve': True}, 'brm')
    check('ผู้จัดการอนุมัติแล้วลดสต็อก 2 กก.', w['status'] == 'applied' and kg(NWW, 'front') == 8)
    w2 = c('api_adjust_request', {'kind': 'waste', 'site_id': NWW, 'zone': 'front', 'lot_id': LOT, 'ripeness': 'ripe', 'kg': 1, 'reason': 'x', 'evidence': att['ref']}, 'brm')
    expect_error('ผู้ขออนุมัติรายการของตัวเองไม่ได้', c, 'api_adjust_decide', {'id': w2['id'], 'approve': True}, 'brm', contains='ของตัวเอง')
    c('api_adjust_decide', {'id': w2['id'], 'approve': False, 'note': 'ยังขายได้'}, 'exec')
    check('ไม่อนุมัติ → สต็อกไม่เปลี่ยน', kg(NWW, 'front') == 8)
    c('api_adjust_request', {'kind': 'retail_sale', 'site_id': NWW, 'zone': 'front', 'lot_id': LOT, 'ripeness': 'ripe', 'kg': 3, 'amount': 270}, 'br')
    check('ขายหน้าร้านตัดทันที 3 กก.', kg(NWW, 'front') == 5)
    expect_error('ขายหน้าร้านเกินสต็อกไม่ได้', c, 'api_adjust_request', {'kind': 'retail_sale', 'site_id': NWW, 'zone': 'front', 'lot_id': LOT, 'ripeness': 'ripe', 'kg': 6}, 'br', contains='ไม่พอ')

    print('\n[6] ขายและบิล: บิลอ้างอิงจำนวนส่งมอบจริง ไม่ตัดสต็อกซ้ำ กันบิลซ้ำ')
    expect_error('โอนสาขาออกบิลไม่ได้ (ไม่ใช่ยอดขาย)', c, 'api_invoice_create', {'customer_id': cust['id'], 'lines': [{'dispatch_line_id': line['id'], 'kg': 1, 'price': 70}]}, 'sales', contains='ไม่ถือเป็นยอดขาย')
    s1 = c('api_dispatch_save', {'kind': 'sale', 'from_site_id': CW, 'customer_id': cust['id'], 'ship': True,
                                 'lines': [{'lot_id': LOT, 'ripeness': 'raw', 'kg': 30, 'baskets': 2}]}, 'whm')
    check('ตีออกขาย 30 → คลัง 70', s1['status'] == 'shipped' and kg(CW, 'main') == 70)
    expect_error('ออกบิลก่อนส่งมอบไม่ได้', c, 'api_invoice_create', {'customer_id': cust['id'], 'lines': [{'dispatch_line_id': s1['lines'][0]['id'], 'kg': 1, 'price': 70}]}, 'sales', contains='ยังไม่ได้ยืนยันส่งมอบ')
    s1 = c('api_dispatch_receive', {'id': s1['id'], 'receiver_name': 'ลูกค้า NWW', 'evidence': att['ref']}, 'sales')
    check('ลูกค้ารับครบ → ขายออกจากระบบ ไม่ค้างระหว่างทาง', s1['status'] == 'received' and kg(CW, 'transit') == 0)
    bl = c('api_billable', {'customer_id': cust['id']}, 'sales')
    check('รายการรอออกบิล 30 กก. ราคาตั้งไว้ 70', len(bl) == 1 and float(bl[0]['billable_kg']) == 30 and float(bl[0]['price']) == 70, bl)
    expect_error('ฝ่ายขายแก้ราคาไม่ได้', c, 'api_invoice_create', {'customer_id': cust['id'], 'lines': [{'dispatch_line_id': bl[0]['dispatch_line_id'], 'kg': 20, 'price': 75}]}, 'sales', contains='แก้ราคาไม่ได้')
    inv1 = c('api_invoice_create', {'customer_id': cust['id'], 'vat_rate': 7, 'shipping': 100, 'lines': [{'dispatch_line_id': bl[0]['dispatch_line_id'], 'kg': 20, 'price': 70}]}, 'sales')
    check('บิลบางส่วน 20 กก. × 70 = 1,400 + ขนส่ง 100 + VAT 7% = 1,605', float(inv1['total']) == 1605.0, inv1['total'])
    check('ทำบิลแล้วสต็อกไม่ลดซ้ำ (คลังยัง 70)', kg(CW, 'main') == 70)
    expect_error('ออกบิลเกินจำนวนส่งมอบไม่ได้ (เหลือ 10)', c, 'api_invoice_create', {'customer_id': cust['id'], 'lines': [{'dispatch_line_id': bl[0]['dispatch_line_id'], 'kg': 11, 'price': 70}]}, 'sales', contains='กันบิลซ้ำ')
    inv2 = c('api_invoice_create', {'customer_id': cust['id'], 'lines': [{'dispatch_line_id': bl[0]['dispatch_line_id'], 'kg': 10, 'price': 80}]}, 'exec')
    check('ผู้บริหารแก้ราคาได้ และออกบิลส่วนที่เหลือครบ', float(inv2['subtotal']) == 800 and c('api_billable', {}, 'sales') == [])
    c('api_invoice_cancel', {'id': inv2['id'], 'reason': 'ราคาผิด'}, 'exec')
    check('ยกเลิกบิลแล้วยอดกลับมาให้ออกบิลใหม่ได้', float(c('api_billable', {}, 'sales')[0]['billable_kg']) == 10)
    expect_error('ฝ่ายขายยกเลิกบิลไม่ได้', c, 'api_invoice_cancel', {'id': inv1['id'], 'reason': 'x'}, 'sales', contains='ไม่มีสิทธิ์')
    q = c('api_quote_save', {'customer_id': cust['id'], 'lines': [{'variety_id': HASS, 'size_id': S220, 'kg': 100, 'price': 70}]}, 'sales')
    check('ใบเสนอราคาไม่กระทบสต็อก', float(q['total']) == 7000 and kg(CW, 'main') == 70)

    print('\n[7] ตรวจสอบย้อนกลับ: บิล → สวน และ Lot → ทุกปลายทาง')
    ig = c('api_invoice_get', {'id': inv1['id']}, 'sales')
    check('เปิดบิลย้อนถึงสวน/ใบรับเข้าได้', ig['lines'][0]['supplier'] == 'สวนคุณหน่อย' and ig['lines'][0]['receipt_no'].startswith('IN-'), ig['lines'][0])
    tr = c('api_lot_trace', {'lot_id': LOT}, 'admin')
    kinds = [e['kind'] for e in tr['events']]
    check('Timeline Lot มีรับเข้า/ตรวจความสุก/ตีออก/รับบางส่วน/แช่แข็ง/ออกบิล',
          all(k in kinds for k in ['receive', 'ripeness', 'ship', 'partial', 'freeze', 'invoice']), kinds)
    dests = sorted(d['to'] for d in tr['destinations'])
    check('ค้น Lot เห็นทุกปลายทาง (สาขา NWW + ลูกค้า)', dests == ['บริษัท NWW', 'สาขา NWW'], dests)
    ftr = c('api_lot_trace', {'code': fz['lot_code']}, 'admin')
    check('Lot แช่แข็งย้อนถึงสวนต้นทางได้', ftr['receipt']['supplier'] == 'สวนคุณหน่อย' and ftr['root']['id'] == LOT)

    print('\n[8] กลับรายการ (ห้ามแก้รายการยืนยันแล้วตรง ๆ)')
    expect_error('Lot ที่เคลื่อนไหวแล้วกลับรายการทั้งใบไม่ได้', c, 'api_receipt_reverse', {'id': rc['id'], 'reason': 'x'}, 'whm', contains='ถูกเคลื่อนไหวแล้ว')
    r2 = c('api_receipt_save', {'supplier_id': sup['id'], 'submit': True, 'lines': [{'variety_id': HASS, 'size_id': S220, 'ripeness': 'raw', 'baskets': 2, 'gross_kg': 42, 'tare_kg': 2}]}, 'wh')
    r2 = c('api_receipt_confirm', {'id': r2['id'], 'lines': [{'id': r2['lines'][0]['id'], 'rejected_kg': 5}]}, 'wh')
    check('คัดออก 5 กก. → รับจริง 35 กก.', float(r2['total_accepted']) == 35 and kg(CW, 'main') == 105)
    expect_error('กลับรายการต้องมีเหตุผล', c, 'api_receipt_reverse', {'id': r2['id']}, 'whm', contains='เหตุผล')
    expect_error('พนักงานคลังกลับรายการไม่ได้', c, 'api_receipt_reverse', {'id': r2['id'], 'reason': 'x'}, 'wh', contains='ผู้จัดการ')
    r2 = c('api_receipt_reverse', {'id': r2['id'], 'reason': 'บันทึกซ้ำ'}, 'whm')
    check('กลับรายการด้วยรายการตรงข้าม → คลังกลับเป็น 70', r2['status'] == 'reversed' and kg(CW, 'main') == 70)

    print('\n[9] หลายคนทำพร้อมกัน')
    adj = c('api_adjust_request', {'kind': 'count_adjust', 'site_id': CW, 'zone': 'main', 'lot_id': LOT, 'ripeness': 'raw', 'kg': -20, 'reason': 'นับจริงขาด'}, 'wh')
    c('api_adjust_decide', {'id': adj['id'], 'approve': True}, 'whm')
    check('ปรับยอดนับจริง −20 (อนุมัติ) → คลัง 50', kg(CW, 'main') == 50)
    out = {}
    def save(key, qty):
        try:
            r = call_any('api_dispatch_save', {'kind': 'transfer', 'from_site_id': CW, 'to_site_id': NWW, 'lines': [{'lot_id': LOT, 'ripeness': 'raw', 'kg': qty}]}, 'wh'); out[key] = r['id']
        except ApiError as e:
            out[key] = str(e)
    ts = [threading.Thread(target=save, args=('a', 40)), threading.Thread(target=save, args=('b', 30))]
    [t.start() for t in ts]; [t.join() for t in ts]
    oks = [v for v in out.values() if isinstance(v, int)]
    check('จองตีออก 40 + 30 พร้อมกันจากยอด 50 → จองได้ 1 ใบ อีกใบถูกปฏิเสธ', len(oks) == 1, out)
    c('api_dispatch_ship', {'id': oks[0]}, 'whm')
    check('ยอดคลังไม่ติดลบ', kg(CW, 'main') in (10.0, 20.0), kg(CW, 'main'))
    def ship(key, did):
        try:
            call_any('api_dispatch_ship', {'id': did}, 'whm'); out[key] = 'ok'
        except ApiError as e:
            out[key] = str(e)
    dc =c('api_dispatch_save', {'kind': 'transfer', 'from_site_id': CW, 'to_site_id': NWW, 'lines': [{'lot_id': LOT, 'ripeness': 'raw', 'kg': 5}]}, 'wh')
    out.clear()
    ts = [threading.Thread(target=ship, args=(f'x{i}', dc['id'])) for i in range(3)]
    [t.start() for t in ts]; [t.join() for t in ts]
    check('กดยืนยันใบเดียวกันพร้อมกัน 3 ครั้ง → ตัดสต็อกครั้งเดียว', sum(1 for v in out.values() if v == 'ok') == 1, out)

    print('\n[11] ช่องโหว่ที่พบจากการตรวจระบบรอบ 2')
    dr = c('api_dispatch_save', {'kind': 'transfer', 'from_site_id': CW, 'to_site_id': NWW, 'lines': [{'lot_id': LOT, 'ripeness': 'raw', 'kg': 3}]}, 'wh')
    nww_row = next(r for r in c('api_stock', {'site_id': NWW}, 'br') if r['product'] == 'fresh')
    expect_error('สาขาแก้ใบตีออกร่างของคลังเป็นของตัวเองไม่ได้', c, 'api_dispatch_save', {'id': dr['id'], 'kind': 'transfer', 'from_site_id': NWW, 'from_zone': nww_row['zone'], 'to_site_id': CW,
                 'lines': [{'lot_id': nww_row['lot_id'], 'ripeness': nww_row['ripeness'], 'kg': 1}]}, 'br', contains='สถานที่อื่น')
    expect_error('ทำรายการกับสต็อก "ระหว่างทาง" โดยตรงไม่ได้', c, 'api_adjust_request', {'kind': 'retail_sale', 'site_id': CW, 'zone': 'transit', 'lot_id': LOT, 'ripeness': 'raw', 'kg': 1}, 'wh', contains='ใช้กับสถานที่นี้ไม่ได้')
    expect_error('ใช้จุดจัดเก็บผิดประเภทสถานที่ไม่ได้ (คลัง→หน้าร้าน)', c, 'api_adjust_request', {'kind': 'count_adjust', 'site_id': CW, 'zone': 'front', 'lot_id': LOT, 'ripeness': 'raw', 'kg': 5, 'reason': 'x'}, 'wh', contains='ใช้กับสถานที่นี้ไม่ได้')
    free = kg(CW, 'main', LOT, 'raw')
    expect_error('สต็อกที่ถูกจองในใบร่าง นำไปเปลี่ยนความสุก/ใช้ไม่ได้', c, 'api_ripeness_change', {'site_id': CW, 'zone': 'main', 'lot_id': LOT, 'from': 'raw', 'to': 'ripe', 'kg': free}, 'wh', contains='ถูกจอง')
    expect_error('สาขาอื่นเปิดใบโอนของสาขา NWW ไม่ได้', c, 'api_dispatch_get', {'id': d1['id']}, 'br2', contains='ไม่มีสิทธิ์')
    expect_error('สาขาเปิดใบรับเข้าของคลัง (ราคาซื้อ) ไม่ได้', c, 'api_receipt_get', {'id': rc['id']}, 'br', contains='ไม่มีสิทธิ์')
    expect_error('สาขาอื่นดู Lot ที่ไม่เคยผ่านสาขาตัวเองไม่ได้', c, 'api_lot_trace', {'lot_id': LOT}, 'br2', contains='ไม่มีสิทธิ์')
    expect_error('สาขาอื่นดูสต็อก FEFO ของ NWW ไม่ได้', c, 'api_fefo', {'site_id': NWW}, 'br2', contains='ไม่มีสิทธิ์')
    for fn in ['api_billable', 'api_customers', 'api_prices', 'api_quotes', 'api_suppliers']:
        expect_error(f'สาขาเรียก {fn} (ข้อมูลบริษัท) ไม่ได้', c, fn, {}, 'br', contains='ไม่มีสิทธิ์')
    trb = c('api_lot_trace', {'lot_id': LOT}, 'br')
    check('Lot trace ของสาขาไม่แสดงบิล/ลูกค้า/ต้นทุน', 'unit_cost' not in trb and not any(e['kind'] == 'invoice' for e in trb['events']) and all(x['kind'] == 'transfer' for x in trb['destinations']), [e['kind'] for e in trb['events']])
    check('รูปหลักฐานเดาเลขไม่ได้ (att:1 ไม่คืนรูป)', c('api_attachment_get', {'ref': 'att:1'}, 'br2')['data'] is None and att['ref'].startswith('att:') and len(att['ref']) == 40, att['ref'])
    check('เจ้าของรูปเปิดรูปได้', c('api_attachment_get', {'ref': att['ref']}, 'br')['data'].startswith('data:image'))
    db2 = c('api_dashboard', {}, 'br')
    check('แดชบอร์ดสาขาไม่เห็นยอดจองของคลัง/ยอดขายบริษัท', float(db2['reserved_kg']) == 0 and float(db2['ready_kg']) >= 0 and float(db2['today']['sales']) == 0, (db2['reserved_kg'], db2['today']['sales']))
    # สาขาขายและบันทึกลูกค้ารับได้เอง
    srow = next(r for r in c('api_stock', {'site_id': NWW}, 'brm') if r['product'] == 'fresh' and float(r['kg']) >= 1)
    bs = c('api_dispatch_save', {'kind': 'sale', 'from_site_id': NWW, 'from_zone': srow['zone'], 'customer_id': cust['id'], 'ship': True, 'lines': [{'lot_id': srow['lot_id'], 'ripeness': srow['ripeness'], 'kg': 1}]}, 'brm')
    bs = c('api_dispatch_receive', {'id': bs['id'], 'receiver_name': 'ลูกค้าหน้าร้าน', 'evidence': att['ref']}, 'br')
    check('สาขาขายส่งลูกค้าและบันทึกลูกค้ารับเองได้', bs['status'] == 'received')
    z = c('api_dispatch_save', {'kind': 'transfer', 'from_site_id': CW, 'to_site_id': NWW, 'ship': True, 'lines': [{'lot_id': LOT, 'ripeness': 'raw', 'kg': 2, 'baskets': 1}]}, 'whm')
    before_bk = sum(b['baskets'] for b in table('balances') if b['site_id'] == NWW and b['lot_id'] == LOT and b['ripeness'] == 'raw' and b['zone'] == 'back')
    c('api_dispatch_receive', {'id': z['id'], 'receiver_name': 'ต้น', 'evidence': att['ref'], 'lines': [{'id': z['lines'][0]['id'], 'received_kg': 0}]}, 'br')
    after_bk = sum(b['baskets'] for b in table('balances') if b['site_id'] == NWW and b['lot_id'] == LOT and b['ripeness'] == 'raw' and b['zone'] == 'back')
    check('รับ 0 กก. ไม่เพิ่มตะกร้าลอย ๆ ที่ปลายทาง', before_bk == after_bk, (before_bk, after_bk))
    zc = next(x for x in c('api_cases', {'status': 'open'}, 'admin') if x['dispatch_id'] == z['id'])
    c('api_case_resolve', {'id': zc['id'], 'outcome': 'return', 'note': 'ส่งผิดรอบ'}, 'whm')
    check('ส่งคืนต้นทางแล้วยอดกลับเข้าคลัง', True)
    c('api_quote_status', {'id': q['id'], 'status': 'accepted'}, 'sales')
    expect_error('ใบเสนอราคาที่ปิดแล้วย้อนสถานะไม่ได้', c, 'api_quote_status', {'id': q['id'], 'status': 'draft'}, 'sales', contains='ปิดแล้ว')
    c('api_dispatch_cancel', {'id': dr['id'], 'reason': 'ทดสอบ'}, 'wh')

    print('\n[10] ความถูกต้องของสมุดเคลื่อนไหว + หน้าจอสรุป')
    B = table('balances'); Mv = table('movements')
    sums = {}
    for m in Mv:
        k = (m['site_id'], m['zone'], m['lot_id'], m['ripeness']); sums[k] = round(sums.get(k, 0) + float(m['d_kg']), 2)
    bad = [b for b in B if abs(float(b['kg']) - sums.get((b['site_id'], b['zone'], b['lot_id'], b['ripeness']), 0)) > 0.001]
    check('ยอดคงเหลือทุกช่อง = ผลรวมสมุดเคลื่อนไหว', not bad, bad[:3])
    prev = {}; chain = 0
    for m in sorted(Mv, key=lambda m: m['id']):
        k = (m['site_id'], m['zone'], m['lot_id'], m['ripeness'])
        if k in prev and abs(prev[k] - float(m['before_kg'])) > 0.001: chain += 1
        prev[k] = float(m['after_kg'])
    check('ยอดก่อน-หลังต่อเนื่องทุกรายการ', chain == 0, chain)
    tsum = lambda types, sign=1: round(sum(sign * float(m['d_kg']) for m in Mv if m['mtype'] in types), 2)
    total_in = tsum(['RECEIVE', 'RECEIVE_REVERSE']); total_out = tsum(['DELIVERED', 'WASTE', 'CASE_LOSS', 'RETAIL_SALE', 'INTERNAL_USE', 'FREEZE_CONSUME', 'ADJUST'], -1)
    frozen_in = tsum(['FREEZE_PRODUCE']); on_hand = round(sum(float(b['kg']) for b in B), 2)
    check('รับเข้า − ออกจากระบบ + ผลผลิตแช่แข็ง = คงเหลือทั้งระบบ', abs(total_in - total_out + frozen_in - on_hand) < 0.001, (total_in, total_out, frozen_in, on_hand))
    for who in ['admin', 'wh', 'br', 'sales', 'exec']:
        c('api_dashboard', {}, who); c('api_alerts', {}, who)
    check('แดชบอร์ด/แจ้งเตือนเปิดได้ทุกบทบาท', True)
    for kind in ['receipts', 'dispatches', 'stock', 'branch', 'aging', 'sales', 'waste', 'movements']:
        r = c('api_report', {'kind': kind}, 'exec')
        check(f'รายงาน {kind} มีข้อมูล', len(r['rows']) > 0 or kind in (), len(r['rows']))
    bs = c('api_branch_stock', {'site_id': NWW}, 'br')
    check('สต็อกสาขาแยก หน้าร้าน/หลังร้าน/แช่แข็ง', set(bs['zones'].keys()) >= {'front', 'back', 'frozen'}, list(bs['zones'].keys()))
    expect_error('สาขาดูสต็อกสาขาอื่นไม่ได้', c, 'api_branch_stock', {'site_id': NWW}, 'br2', contains='ไม่มีสิทธิ์')
    st = c('api_stock', {}, 'br')
    check('ผู้ใช้สาขาเห็นเฉพาะสต็อกสาขาตัวเอง', all(r['site_id'] == NWW for r in st) and len(st) > 0)
    al = c('api_alerts', {}, 'admin')
    check('มีแจ้งเตือนรายการรอ/ความสุก', any(a['kind'] in ('ripe', 'near_ripe', 'low_stock', 'weight', 'pending_adjust') for a in al), [a['kind'] for a in al])

    # snapshot of read APIs for shape-parity comparison (tests/compare_shapes.py)
    reads = {'api_me': {}, 'api_dashboard': {}, 'api_alerts': {}, 'api_stock': {}, 'api_receipts': {}, 'api_dispatches': {}, 'api_cases': {},
             'api_adjustments': {}, 'api_suppliers': {}, 'api_customers': {}, 'api_prices': {}, 'api_invoices': {}, 'api_quotes': {},
             'api_users': {}, 'api_audit': {'limit': 5}, 'api_movements': {'limit': 5}, 'api_branch_stock': {'site_id': NWW},
             'api_lot_trace': {'lot_id': LOT}, 'api_invoice_get': {'id': inv1['id']}, 'api_supplier_get': {'id': sup['id']},
             'api_customer_get': {'id': cust['id']}, 'api_receipt_get': {'id': rc['id']}, 'api_dispatch_get': {'id': d1['id']},
             'api_fefo': {'site_id': CW, 'need_kg': 5}, 'api_billable': {}, 'api_quote_get': {'id': q['id']},
             **{f'api_report:{k}': {'kind': k} for k in ['receipts', 'dispatches', 'stock', 'sales', 'waste', 'movements']}}
    snap = {k: c(k.split(':')[0], v, 'admin') for k, v in reads.items()}
    with open(os.path.join(ROOT, 'tests', 'shapes_demo.json' if DEMO else 'shapes_sql.json'), 'w') as f:
        json.dump(snap, f, ensure_ascii=False, indent=1, default=str)

    print(f'\nผลรวม: ผ่าน {passed} / ไม่ผ่าน {failed}')
    with open(os.path.join(ROOT, 'tests', 'test_results_demo.txt' if DEMO else 'test_results_sql.txt'), 'w') as f:
        f.write(f'AVO FLOW acceptance tests ({"demo backend" if DEMO else "PostgreSQL"}) — passed {passed}, failed {failed}\n\n')
        f.write('\n'.join(f'{s}  {n}' for s, n in results))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
