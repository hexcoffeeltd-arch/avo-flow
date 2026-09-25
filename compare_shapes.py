"""Compare JSON shapes (keys + value types) returned by the SQL backend and the demo backend
after running the same scenario. Any difference means the UI could behave differently in demo vs production."""
import json, os, sys
D = os.path.dirname(__file__)
a = json.load(open(os.path.join(D, 'shapes_sql.json'))); b = json.load(open(os.path.join(D, 'shapes_demo.json')))
issues = []

def kind(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'bool'
    if isinstance(v, (int, float)): return 'num'
    if isinstance(v, str): return 'str'
    if isinstance(v, list): return 'list'
    return 'obj'

def cmp(x, y, path):
    kx, ky = kind(x), kind(y)
    if 'null' in (kx, ky):
        return
    if kx != ky:
        issues.append(f'{path}: type {kx} (sql) vs {ky} (demo) — {str(x)[:40]!r} / {str(y)[:40]!r}'); return
    if kx == 'obj':
        for k in set(x) | set(y):
            if k not in x: issues.append(f'{path}.{k}: missing in sql')
            elif k not in y: issues.append(f'{path}.{k}: missing in demo')
            else: cmp(x[k], y[k], f'{path}.{k}')
    elif kx == 'list':
        if len(x) != len(y): issues.append(f'{path}: length {len(x)} (sql) vs {len(y)} (demo)')
        for i, (p, q) in enumerate(zip(x, y)): cmp(p, q, f'{path}[{i}]')

for k in a:
    cmp(a[k], b.get(k), k)
ignore = ('.updated_at', '.created_at')
issues = [i for i in issues if not any(s in i for s in ignore)]
print('\n'.join(issues[:80]) or 'shapes identical')
print(f'{len(issues)} differences')
sys.exit(1 if issues else 0)
