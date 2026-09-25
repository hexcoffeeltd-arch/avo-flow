"""Real-browser walkthrough (Playwright/Chromium) of the AVO FLOW UI.
Runs every page for several roles and performs the core flows through the UI:
receive → QC confirm → dispatch (FEFO suggest) → ship → branch partial receive with photo → case → invoice.
Usage: python3 tests/ui_walkthrough.py --backend demo|local [--base http://localhost:8080]
Screenshots go to tests/screens/<backend>/
"""
import argparse, os, sys, io, re
from playwright.sync_api import sync_playwright, expect
from PIL import Image

ap = argparse.ArgumentParser(); ap.add_argument('--backend', default='demo'); ap.add_argument('--base', default='http://localhost:8080')
args = ap.parse_args()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'screens', args.backend); os.makedirs(OUT, exist_ok=True)
PHOTO = os.path.join(OUT, '_photo.jpg')
Image.new('RGB', (800, 600), (60, 120, 90)).save(PHOTO, 'JPEG')

errors = []; steps = []
def ok(name): steps.append(name); print('  ✓', name)


def attach(page):
    page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' and 'fonts.g' not in m.text and 'ERR_TUNNEL' not in m.text and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))


def shot(page, name, full=True):
    page.wait_for_timeout(250)
    page.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)


def login(page, sub):
    page.goto(f'{args.base}/?backend={args.backend}#/dashboard')
    page.evaluate("() => sessionStorage.clear()"); page.reload()
    if args.backend == 'demo':
        page.click(f'.role-btn[data-sub="{sub}"]')
    else:
        page.fill('[name=email]', f'{sub}@demo.local'); page.fill('[name=password]', 'password123'); page.click('button[type=submit]')
    page.wait_for_selector('.sidebar')
    page.wait_for_selector('#content .page-head')


def goto(page, route):
    page.evaluate(f"location.hash = '#/{route}'")
    page.wait_for_timeout(150)
    page.wait_for_selector('#content .page-head'); page.wait_for_function("!document.querySelector('#content .spinner')")


def toast_text(page, want):
    page.wait_for_selector(f'.toast:has-text("{want}")', timeout=15000)
    return page.locator(f'.toast:has-text("{want}")').last.inner_text()


def close_modals(page):
    while page.locator('.overlay .x').count():
        page.locator('.overlay .x').last.click(); page.wait_for_timeout(80)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='th-TH', timezone_id='Asia/Bangkok')
    page = ctx.new_page(); attach(page)

    # ---------- เข้าสู่ระบบ ----------
    page.goto(f'{args.base}/?backend={args.backend}')
    page.wait_for_selector('.auth-card')
    shot(page, '00-login', full=False); ok('หน้าเข้าสู่ระบบแสดงผล')
    if args.backend == 'demo':
        page.click('#reset-demo'); page.wait_for_timeout(300)

    login(page, 'demo-admin')
    shot(page, '01-dashboard'); ok('แดชบอร์ด (Admin)')
    kpi = page.locator('.kpi .value').first.inner_text()
    assert '866' in kpi.replace(',', ''), kpi; ok(f'KPI สต็อกในคลัง = {kpi}')

    for route, name in [('warehouse', '02-warehouse-stock'), ('warehouse/receipts', '03-receipts'), ('warehouse/dispatch', '04-dispatch'), ('warehouse/ripeness', '05-ripeness'),
                        ('warehouse/history', '06-history'), ('branches', '07-branches'), ('sales', '08-sales'), ('sales/billable', '09-billable'), ('sales/quotes', '10-quotes'),
                        ('sales/customers', '11-customers'), ('suppliers', '12-suppliers'), ('reports', '13-reports'), ('settings', '14-settings'), ('settings/master', '15-master'),
                        ('settings/prices', '16-prices'), ('settings/users', '17-users'), ('settings/audit', '18-audit'), ('alerts', '19-alerts')]:
        goto(page, route); shot(page, name); ok(f'เปิดหน้า {route}')

    # รายงานทุกประเภท + สรุปตามกลุ่ม
    goto(page, 'reports')
    for k in ['receipts', 'dispatches', 'branch', 'aging', 'sales', 'waste', 'movements', 'stock']:
        page.click(f'.seg [data-k="{k}"]'); page.wait_for_selector('#rep .card-title'); page.wait_for_function("!document.querySelector('#rep .spinner')")
    page.click('.seg [data-k="waste"]'); page.wait_for_selector('#g'); page.select_option('#g', 'supplier'); page.wait_for_timeout(300)
    shot(page, '20-report-waste-by-supplier'); ok('รายงานทุกประเภท + สรุปตามสวน')

    # Lot trace
    goto(page, 'warehouse')
    page.locator('tr[data-lot]').first.click(); page.wait_for_selector('.drawer .tl-item')
    shot(page, '21-lot-trace', full=False); ok('Lot trace drawer')
    page.click('.drawer .x')

    # ---------- พนักงานคลัง: รับเข้า ----------
    login(page, 'demo-wh')
    goto(page, 'warehouse'); page.click('#new-r'); page.wait_for_selector('#rl select')
    page.select_option('[name=supplier_id]', label='สวนภูเขา')
    row = page.locator('#rl tbody tr').first
    row.locator('[data-k=size_id]').select_option(label='220+')
    row.locator('[data-k=baskets]').fill('10'); row.locator('[data-k=gross_kg]').fill('215'); row.locator('[data-k=tare_kg]').fill('10')
    page.click('#add-line'); r2 = page.locator('#rl tbody tr').nth(1)
    r2.locator('[data-k=variety_id]').select_option(label='บัคคาเนีย'); r2.locator('[data-k=size_id]').select_option(label='M')
    r2.locator('[data-k=baskets]').fill('5'); r2.locator('[data-k=gross_kg]').fill('104'); r2.locator('[data-k=tare_kg]').fill('5'); r2.locator('[data-k=unit_cost]').fill('30')
    page.set_input_files('[data-photo=evidence] input[type=file]', PHOTO); page.wait_for_selector('[data-photo=evidence] [data-st]:has-text("แนบแล้ว")')
    shot(page, '22-receipt-form', full=False)
    page.click('#save-submit'); page.wait_for_selector('.modal-head h3:has-text("ใบรับเข้า")')
    ok('สร้างใบรับเข้า 2 Lot และส่งตรวจรับ')
    page.locator('[data-rej]').first.fill('3')
    shot(page, '23-receipt-confirm', full=False)
    page.click('#confirm'); t = toast_text(page, 'ยืนยันรับเข้า'); ok(f'ยืนยันตรวจรับ: {t}')

    # ---------- ผจก.คลัง: ตีออกด้วยระบบแนะนำ FEFO ----------
    login(page, 'demo-whm')
    goto(page, 'branches'); page.click('#tr'); page.wait_for_selector('#lots tbody tr')
    page.fill('#need', '70'); page.click('#suggest'); page.wait_for_timeout(200)
    page.fill('[name=carrier]', 'รถบริษัท')
    shot(page, '24-dispatch-form', full=False)
    summary = page.locator('#dsum').inner_text(); assert '70' in summary, summary
    page.click('#ship'); page.wait_for_selector('.modal-head h3:has-text("ใบโอนสินค้า")'); page.wait_for_selector('.overlay .badge:has-text("ส่งแล้ว รอรับ")')
    t = toast_text(page, 'ตีออก'); ok(f'ตีออก FEFO 70 กก.: {t}')
    dispatch_no = re.search(r'TR-\d{4}-\d{3}', page.locator('.modal-head h3').inner_text()).group(0)
    shot(page, '25-dispatch-shipped', full=False)
    close_modals(page)

    # ห้ามจ่ายเกิน (ผ่านหน้าจอ)
    goto(page, 'warehouse'); page.click('#new-d'); page.wait_for_selector('#lots tbody tr [data-kg]')
    page.locator('#lots [data-kg]').first.fill('999999'); page.select_option('[name=to_site_id]', label='สาขา NWW'); page.click('#save')
    t = toast_text(page, 'ห้ามจ่ายเกิน'); ok(f'หน้าจอแสดงการปฏิเสธจ่ายเกิน: {t}')
    close_modals(page)

    # ---------- สาขา: รับบางส่วน + รูป ----------
    login(page, 'demo-br')
    goto(page, 'branches'); shot(page, '26-branch-staff')
    page.locator(f'tr[data-d]:has-text("{dispatch_no}")').first.click(); page.wait_for_selector('#receive')
    page.locator('[data-rk]').first.fill(str(float(page.locator('[data-rk]').first.input_value()) - 1.5))
    page.set_input_files('[data-photo=evidence] input[type=file]', PHOTO); page.wait_for_selector('[data-photo=evidence] [data-st]:has-text("แนบแล้ว")')
    shot(page, '27-branch-receive', full=False)
    page.click('#receive'); t = toast_text(page, 'บางส่วน'); ok(f'สาขารับบางส่วน: {t}')
    page.wait_for_selector('.overlay .badge:has-text("รอตรวจสอบส่วนต่าง")'); close_modals(page)
    # ขอตัดทิ้ง
    goto(page, 'branches'); page.click('[data-op=waste]'); page.wait_for_function("document.querySelector('[name=lot]') && document.querySelector('[name=lot]').value")
    page.fill('[name=kg]', '1'); page.fill('[name=reason]', 'ผลช้ำ'); page.set_input_files('[data-photo=evidence] input[type=file]', PHOTO)
    page.wait_for_selector('[data-photo=evidence] [data-st]:has-text("แนบแล้ว")'); page.click('#ok'); t = toast_text(page, 'อนุมัติ'); ok(f'ขอตัดทิ้ง: {t}')
    # แช่แข็ง
    goto(page, 'branches'); page.click('[data-op=freeze]'); page.wait_for_function("document.querySelector('[name=lot]') && document.querySelector('[name=lot]').value")
    page.fill('[name=input_kg]', '2'); page.fill('[name=output_kg]', '1.4'); page.fill('[name=bags]', '4')
    shot(page, '28-freeze', full=False)
    page.click('#ok'); t = toast_text(page, 'Lot แช่แข็ง'); ok(f'แปรรูปแช่แข็ง: {t}')

    # ---------- ผจก.สาขา: อนุมัติ + ปิดส่วนต่าง ----------
    login(page, 'demo-brm')
    goto(page, 'branches'); page.click('[data-op=approve]'); page.wait_for_selector('[data-ok]')
    shot(page, '29-approvals', full=False)
    page.locator('[data-ok]').first.click(); t = toast_text(page, 'อนุมัติแล้ว'); ok('ผู้จัดการสาขาอนุมัติตัดทิ้ง')
    page.wait_for_timeout(600); page.wait_for_selector('.overlay .modal-head h3:has-text("รายการรออนุมัติ")'); close_modals(page)
    goto(page, 'branches'); page.locator(f'tr[data-d]:has-text("{dispatch_no}")').first.click(); page.wait_for_selector('[data-case]')
    page.locator('[data-case]').first.click(); page.fill('.overlay:last-child [name=note]', 'ผลช้ำระหว่างขนส่ง'); page.click('.overlay:last-child #ok')
    t = toast_text(page, 'ปิดงานส่วนต่าง'); ok('ปิดงานส่วนต่าง (สูญเสีย)')
    page.wait_for_selector('.overlay .badge:has-text("ปิดงาน")'); close_modals(page)

    # ---------- ฝ่ายขาย: สร้างบิลจากรายการรอออกบิล ----------
    login(page, 'demo-sales')
    goto(page, 'sales/billable'); page.locator('[data-bill]').first.click(); page.wait_for_selector('#bl [data-kg]')
    ro = page.locator('#bl [data-price]').first.get_attribute('readonly'); assert ro is not None, 'price should be readonly for sales'
    page.select_option('[name=vat_rate]', '7'); page.wait_for_timeout(100)
    shot(page, '30-invoice-form', full=False)
    page.click('#ok'); page.wait_for_selector('.modal-head h3:has-text("INV-")'); t = toast_text(page, 'ออกบิล'); ok(f'ฝ่ายขายออกบิล (ราคาล็อก): {t}')
    shot(page, '31-invoice-view', full=False)
    close_modals(page)
    goto(page, 'sales'); shot(page, '32-sales-after')

    # ---------- ผู้บริหาร: ดูแดชบอร์ด ----------
    login(page, 'demo-exec'); shot(page, '33-dashboard-exec'); ok('ผู้บริหารเห็นแดชบอร์ด')

    # ---------- มือถือ ----------
    m = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='th-TH', timezone_id='Asia/Bangkok')
    mp = m.new_page(); attach(mp)
    login(mp, 'demo-br'); shot(mp, '40-mobile-dashboard')
    goto(mp, 'branches'); shot(mp, '41-mobile-branches')
    mp.click('#menu-btn'); mp.wait_for_timeout(300); shot(mp, '42-mobile-menu', full=False); mp.click('.nav a[data-nav=dashboard]')
    goto(mp, 'branches'); mp.click('[data-op=rip]'); mp.wait_for_selector('.modal'); shot(mp, '43-mobile-ripeness-modal', full=False)
    sw = mp.evaluate('document.documentElement.scrollWidth'); assert sw <= 390, f'horizontal scroll on mobile: {sw}'
    ok('มือถือ: ไม่มีการเลื่อนแนวนอนทั้งหน้า')
    close_modals(mp)
    login(mp, 'demo-wh'); goto(mp, 'warehouse'); shot(mp, '44-mobile-warehouse')
    mp.click('#new-r'); mp.wait_for_selector('#rl select'); shot(mp, '45-mobile-receipt-form', full=False)
    b.close()

print(f'\n{len(steps)} steps passed')
if errors:
    print('ERRORS:'); print('\n'.join(errors[:40])); sys.exit(1)
print('no console/page errors')
