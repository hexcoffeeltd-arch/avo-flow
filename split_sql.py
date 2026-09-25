"""Split a SQL file into individual statements (dollar-quote and comment aware)."""
import json, re, sys

def split(sql):
    out, buf, i, n = [], [], 0, len(sql)
    tag = None
    while i < n:
        c = sql[i]
        if tag:
            if sql.startswith(tag, i):
                buf.append(tag); i += len(tag); tag = None; continue
            buf.append(c); i += 1; continue
        if sql.startswith('--', i):
            j = sql.find('\n', i); i = n if j < 0 else j; continue
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and (j + 1 >= n or sql[j + 1] != "'"): break
                if sql[j] == "'": j += 2; continue
                j += 1
            buf.append(sql[i:j + 1]); i = j + 1; continue
        m = re.match(r'\$[A-Za-z_]*\$', sql[i:])
        if m:
            tag = m.group(0); buf.append(tag); i += len(tag); continue
        if c == ';':
            st = re.sub(r'[ \t]+\n', '\n', ''.join(buf)).strip()
            if st: out.append(st)
            buf = []; i += 1; continue
        buf.append(c); i += 1
    st = ''.join(buf).strip()
    if st: out.append(st)
    return out

if __name__ == '__main__':
    sts = [s for s in split(open(sys.argv[1]).read()) if s.lower() not in ('begin', 'commit')]
    json.dump(sts, open(sys.argv[2], 'w'), ensure_ascii=False)
    print(len(sts), 'statements', sum(len(s) for s in sts), 'chars')
