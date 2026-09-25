// Seed the local dev database with the same demo data used in the browser demo, through the Data API emulator.
// Usage: node tools/seed_local.mjs http://localhost:8080
import { seedDemo, DEMO_USERS } from '../assets/js/seed.js';
const base = process.argv[2] || 'http://localhost:8080';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
await seedDemo(async (sub, fn, p) => {
  const u = DEMO_USERS.find((x) => x.sub === sub);
  const claims = { sub, email: sub + '@demo.local', name: u?.name || sub };
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + b64(JSON.stringify(claims)) }, body: JSON.stringify({ p }) });
  const body = await r.json();
  if (!r.ok) throw new Error(`${fn}: ${body.message}`);
  return body;
});
console.log('seeded');
