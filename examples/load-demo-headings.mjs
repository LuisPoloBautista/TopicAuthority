// Explicit, repeatable demo import. No automatic startup seeding or fictitious usage.
import { readFile, writeFile } from 'node:fs/promises';
import { headingKey, headingLabel } from '../headings.js';

const origin = new URL(process.argv[2] || 'https://topicauthority.onrender.com').origin;
const headings = JSON.parse(await readFile(new URL('./demo-headings.json', import.meta.url), 'utf8'));
const receiptFile = new URL('./demo-headings-receipt.json', import.meta.url);
let receipt;
try { receipt = JSON.parse(await readFile(receiptFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
receipt ||= { origin, purpose: 'Temporary demonstration headings; no bibliographic records', entries: [] };
if (receipt.origin !== origin) throw new Error('Use a separate receipt for a different server.');
async function request(path, options = {}) {
  const response = await fetch(origin + path, { ...options, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}
for (const heading of headings) {
  const key = headingKey(heading);
  const label = headingLabel(heading);
  const before = await request('/api/headings?q=' + encodeURIComponent(label));
  const existing = before.headings.find(row => headingKey(row) === key);
  if (existing) {
    console.log('Already present: ' + label);
    continue; // Never claim ownership of pre-existing real data.
  }
  const result = await request('/api/headings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heading })
  });
  if (result.saved !== true || !result.id) throw new Error('Server did not confirm the import: ' + label);
  if (!receipt.entries.some(entry => entry.id === result.id)) {
    receipt.entries.push({ id: result.id, heading, insertedAt: new Date().toISOString() });
  }
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
  const after = await request('/api/headings?q=' + encodeURIComponent(label));
  if (!after.headings.some(row => row.id === result.id)) throw new Error('Imported heading is not searchable: ' + label);
  console.log('Saved and searchable: ' + label);
}
