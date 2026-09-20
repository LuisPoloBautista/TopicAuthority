import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { headingKey, normalizeTerm, validateHeading } from './headings.js';

// A single Node process serializes writes; use one instance with a persistent disk.
export class HeadingStore {
  constructor(filename) { this.filename = filename; this.queue = Promise.resolve(); this.snapshot = null; this.index = []; }
  async read() {
    try {
      const info = await stat(this.filename);
      const version = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
      if (this.snapshot && this.version === version) return this.snapshot;
      const data = JSON.parse(await readFile(this.filename, 'utf8'));
      this.index = data.entries.map(h => ({ heading: h, label: normalizeTerm(h.label), main: normalizeTerm(h.main) }));
      this.version = version;
      this.snapshot = data;
      return data;
    }
    catch (error) { if (error.code === 'ENOENT') { this.snapshot = null; this.index = []; return { entries: [], records: {} }; } throw error; }
  }
  async search(term) {
    await this.queue;
    const query = normalizeTerm(term);
    if (!query) return [];
    await this.read();
    const main = query.split(' -- ')[0];
    return this.index.map(item => {
      const exact = item.label === query;
      const score = exact ? 1 : item.main === main ? 0.98
        : item.label.includes(query) || query.includes(item.label) ? 0.9 : similarity(main, item.main);
      return { ...item.heading, exact, similarity: Math.round(score * 100), score };
    }).filter(h => h.score >= 0.72)
      .sort((a, b) => b.score - a.score || b.uses - a.uses).slice(0, 50)
      .map(({ score, ...heading }) => heading);
  }
  saveRecord(recordId, headings) {
    if (typeof recordId !== 'string' || !recordId.trim() || recordId.length > 300 || !Array.isArray(headings) || headings.length > 100) {
      return Promise.reject(new Error('Se requiere un identificador de registro y hasta 100 encabezamientos.'));
    }
    let clean;
    try { clean = headings.map(validateHeading); } catch (error) { return Promise.reject(error); }
    const action = this.queue.then(async () => {
      const data = structuredClone(await this.read());
      const ids = [];
      for (const h of clean) {
        const id = createHash('sha256').update(headingKey(h)).digest('hex');
        let entry = data.entries.find(item => item.id === id);
        if (!entry) {
          entry = { ...h, id, source: 'Local', createdAt: new Date().toISOString(), uses: 0 };
          data.entries.push(entry);
        }
        ids.push(id);
      }
      // Snapshot by catalogue + biblionumber: retries and repeated saves do not inflate usage.
      const recordKey = createHash('sha256').update(recordId).digest('hex');
      data.records[recordKey] = [...new Set(ids)];
      const counts = new Map();
      for (const list of Object.values(data.records)) for (const id of list) counts.set(id, (counts.get(id) || 0) + 1);
      for (const entry of data.entries) entry.uses = counts.get(entry.id) || 0;
      await mkdir(path.dirname(this.filename), { recursive: true });
      await writeFile(this.filename + '.tmp', JSON.stringify(data, null, 2) + '\n', 'utf8');
      await rename(this.filename + '.tmp', this.filename);
      this.snapshot = null;
      return { saved: true, headings: [...new Set(ids)].length };
    });
    this.queue = action.catch(() => {});
    return action;
  }
}

// Character bigrams tolerate small spelling differences without external services.
function similarity(a, b) {
  if (Math.min(a.length, b.length) < 4) return 0;
  const pairs = value => {
    const counts = new Map();
    for (let i = 0; i < value.length - 1; i++) counts.set(value.slice(i, i + 2), (counts.get(value.slice(i, i + 2)) || 0) + 1);
    return counts;
  };
  const left = pairs(a), right = pairs(b);
  let overlap = 0;
  for (const [pair, count] of left) overlap += Math.min(count, right.get(pair) || 0);
  return 2 * overlap / (a.length + b.length - 2);
}
