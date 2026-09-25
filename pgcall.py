"""Tiny helper: call public.api_* functions on a real Postgres through the psql CLI.
Claims are set exactly like the Data API does (request.jwt.claims), so the SQL is
exercised the same way it will be in production."""
import json, os, subprocess

PG = dict(host=os.environ.get('PGHOST', 'localhost'), user=os.environ.get('PGUSER', 'avo'),
          db=os.environ.get('PGDATABASE', 'avo'), pw=os.environ.get('PGPASSWORD', 'avo'))


class ApiError(Exception):
    pass


def psql(sql, variables=None, db=None):
    env = dict(os.environ, PGPASSWORD=PG['pw'])
    args = ['psql', '-h', PG['host'], '-U', PG['user'], '-d', db or PG['db'], '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
    for k, v in (variables or {}).items():
        args += ['-v', f'{k}={v}']
    r = subprocess.run(args, input=sql, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        msg = r.stderr.strip().split('\n')[0]
        msg = msg.split('ERROR:', 1)[-1].strip()
        raise ApiError(msg)
    return r.stdout


def call(fn, p=None, sub=None, email=None, name=None, db=None):
    """Call public.<fn>(p) as the user identified by `sub` (JWT subject)."""
    assert fn.startswith('api_')
    claims = json.dumps({'sub': sub, 'email': email or f'{sub}@example.com', 'name': name or sub, 'role': 'authenticated'})
    sql = ("select set_config('request.jwt.claims', :'c', false);\n"
           f"select public.{fn}(:'p'::jsonb);\n")
    out = psql(sql, {'c': claims, 'p': json.dumps(p or {}, ensure_ascii=False)}, db=db)
    lines = [l for l in out.strip().split('\n') if l]
    return json.loads(lines[-1]) if lines else None
