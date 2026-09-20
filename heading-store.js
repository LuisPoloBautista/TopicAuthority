import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { headingKey, normalizeTerm, validateHeading } from './headings.js';

// A single Node process serializes writes; use one instance with a persistent disk.
export class HeadingStore {
  constructor(filename) { this.filename = filename; this.queue = Promise.resolve(); }
  async read() {
    try { return JSON.parse(await readFile(this.filename, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { entries: [], records: {} }; throw error; }
  }
  async search(term) {
    await this.queue;
    const query = normalizeTerm(term);
    if (!query) return [];
    const { entries } = await this.read();
    return entries.filter(h => normalizeTerm(h.label).includes(query) || normalizeTerm(h.main) === query)
      .map(h => ({ ...h, exact: normalizeTerm(h.label) === query }))
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.uses - a.uses).slice(0, 50);
  }
  saveRecord(recordId, headings) {
    if (typeof recordId !== 'string' || !recordId.trim() || recordId.length > 300 || !Array.isArray(headings) || headings.length > 100) {
      return Promise.reject(new Error('Se requiere un identificador de registro y hasta 100 encabezamientos.'));
    }
    let clean;
    try { clean = headings.map(validateHeading); } catch (error) { return Promise.reject(error); }
    const action = this.queue.then(async () => {
      const data = await this.read();
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
      for (const entry of data.entries) entry.uses = Object.values(data.records).filter(list => list.includes(entry.id)).length;
      await mkdir(path.dirname(this.filename), { recursive: true });
      await writeFile(this.filename + '.tmp', JSON.stringify(data, null, 2) + '\n', 'utf8');
      await rename(this.filename + '.tmp', this.filename);
      return { saved: true, headings: [...new Set(ids)].length };
    });
    this.queue = action.catch(() => {});
    return action;
  }
}
