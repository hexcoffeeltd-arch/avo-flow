"""Local development server: serves the static app and emulates the Neon/Supabase Data API
(POST /rest/v1/rpc/<fn>) on a local PostgreSQL through the psql CLI.
The Bearer token is base64(JSON claims) — for local testing only, never for production.

  python3 tools/dev_server.py --db avo_dev --port 8080 [--reset]
  open http://localhost:8080/?backend=local
"""
import argparse, base64, json, os, subprocess, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tests'))
import pgcall

ap = argparse.ArgumentParser(); ap.add_argument('--db', default='avo_dev'); ap.add_argument('--port', type=int, default=8080); ap.add_argument('--reset', action='store_true')
args = ap.parse_args()

if args.reset:
    env = dict(os.environ, PGPASSWORD=pgcall.PG['pw'])
    subprocess.run(['psql', '-h', pgcall.PG['host'], '-U', pgcall.PG['user'], '-d', 'postgres', '-q', '-c', f'drop database if exists {args.db}', '-c', f'create database {args.db}'], check=True, env=env)
    pgcall.psql(open(os.path.join(ROOT, 'sql/avo_flow_install.sql')).read(), db=args.db)
    print('database reset:', args.db)


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def do_POST(self):
        if not self.path.startswith('/rest/v1/rpc/'):
            return self.send_error(404)
        fn = self.path.rsplit('/', 1)[-1]
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0)) or 0) or b'{}')
        auth = self.headers.get('Authorization', '')
        claims = json.loads(base64.b64decode(auth[7:]).decode()) if auth.startswith('Bearer ') else None
        try:
            if not fn.startswith('api_') or not claims:
                raise pgcall.ApiError('permission denied')
            out = pgcall.call(fn, body.get('p') or {}, sub=claims['sub'], email=claims.get('email'), name=claims.get('name'), db=args.db)
            data, code = json.dumps(out, ensure_ascii=False).encode(), 200
        except pgcall.ApiError as e:
            data, code = json.dumps({'message': str(e), 'code': 'P0001'}, ensure_ascii=False).encode(), 400
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)


print(f'AVO FLOW dev server on http://localhost:{args.port}/?backend=local  (db={args.db})')
ThreadingHTTPServer(('0.0.0.0', args.port), H).serve_forever()
