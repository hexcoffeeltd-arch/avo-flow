// Bridge so the Python acceptance tests can drive the in-browser demo backend (parity check).
// Protocol: one JSON per line on stdin → one JSON per line on stdout.
import readline from 'node:readline';
import { createDemoBackend } from '../assets/js/demo-backend.js';

globalThis.localStorage = undefined; // no persistence in tests
const be = createDemoBackend('test');
be.reset();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const req = JSON.parse(line);
  try {
    if (req.cmd === 'db') { process.stdout.write(JSON.stringify({ ok: be._db() }) + '\n'); return; }
    if (req.cmd === 'reset') { be.reset(); process.stdout.write(JSON.stringify({ ok: true }) + '\n'); return; }
    be.setClaims({ sub: req.sub, email: req.sub + '@example.com', name: req.sub });
    const out = await be.rpc(req.fn, req.p);
    process.stdout.write(JSON.stringify({ ok: out }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ err: e.message }) + '\n');
  }
});
