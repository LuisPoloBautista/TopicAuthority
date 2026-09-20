import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HeadingStore } from '../heading-store.js';
import { parseGeneratedHeadings, validateHeading } from '../headings.js';

const heading = { main: 'Educación', subdivisions: [{ code: 'z', value: 'México' }, { code: 'v', value: 'Bibliografías' }] };

test('five proposals, typed subdivisions and preservation of existing 650$a', () => {
  const raw = JSON.stringify(Array.from({ length: 5 }, () => heading));
  const result = parseGeneratedHeadings(raw, 'EDUCACIÓN');
  assert.equal(result.length, 5);
  assert.equal(result[0].label, 'EDUCACIÓN -- México -- Bibliografías');
  assert.equal(result[0].subdivisions[0].code, 'z');
  assert.throws(() => parseGeneratedHeadings(raw, 'Historia'));
  assert.throws(() => parseGeneratedHeadings(JSON.stringify([heading])));
  assert.equal(parseGeneratedHeadings(JSON.stringify([heading]), 'Educación', 'marc').length, 1);
  assert.throws(() => parseGeneratedHeadings(raw, 'Educación', 'marc'));
  assert.throws(() => validateHeading({ ...heading, subdivisions: [...heading.subdivisions, { code: 'x', value: 'Historia' }] }));
  assert.throws(() => validateHeading({ ...heading, subdivisions: [{ code: 'a', value: 'Incorrecto' }] }));
});

test('persistent history: concurrent saves, deduplication, removal and normalization', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'topic-history-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'headings.json');
  const store = new HeadingStore(filename);
  assert.deepEqual(await store.search('Educación'), []);
  await Promise.all([
    store.saveRecord('koha:1', [heading, heading]),
    store.saveRecord('koha:2', [{ ...heading, main: ' EDUCACION ' }]),
    store.saveRecord('koha:1', [heading])
  ]);
  const reopened = new HeadingStore(filename);
  const matches = await reopened.search('educacion');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].uses, 2);
  assert.equal(matches[0].main, 'Educación');
  assert.equal((await reopened.search('Educacion -- Argentina'))[0].main, 'Educación');
  assert.equal((await reopened.search('Educasion'))[0].main, 'Educación');
  assert.equal((await reopened.search('Química cuántica')).length, 0);
  assert.equal((await reopened.search('educacion--mexico--bibliografias'))[0].exact, true);
  await reopened.saveRecord('koha:1', []);
  assert.equal((await reopened.search('Educación'))[0].uses, 1);
  await reopened.saveRecord('koha:2', []);
  assert.equal((await reopened.search('Educación'))[0].uses, 0);
});

test('invalid history is not silently overwritten and a failed write does not block later saves', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'topic-history-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'headings.json');
  const store = new HeadingStore(filename);
  await writeFile(filename, 'broken');
  await assert.rejects(store.saveRecord('koha:1', [heading]));
  await writeFile(filename, JSON.stringify({ entries: [], records: {} }));
  await store.saveRecord('koha:1', [heading]);
  assert.equal((await store.search('Educación'))[0].uses, 1);
});

test('the search index reuses the JSON snapshot and refreshes after external edits', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'topic-index-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'headings.json');
  const store = new HeadingStore(filename);
  await store.saveRecord('koha:1', [heading]);
  const first = await store.read();
  assert.equal(await store.read(), first);
  await writeFile(filename, JSON.stringify({ entries: [{ main: 'Física', label: 'Física', subdivisions: [], uses: 3 }], records: {} }));
  assert.equal((await store.search('Física'))[0].uses, 3);
  assert.equal((await store.search('Educación')).length, 0);
  await rm(filename);
  assert.equal((await store.search('Física')).length, 0);
});

test('related words ignore parenthetical qualifiers without merging distinct headings; record references survive restart', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'topic-related-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'headings.json');
  const store = new HeadingStore(filename);
  const h = { main: 'Modelos grandes de lenguaje', subdivisions: [] };
  await store.saveRecord('https://koha.example:8443:42', [h]);
  await store.saveRecord('https://koha.example:8443:55', [h]);
  const reopened = new HeadingStore(filename);
  const results = await reopened.search('Modelos de lenguaje (Ciencia de la computación)');
  assert.equal(results[0].main, h.main);
  assert.equal(results[0].exact, false);
  assert.equal(results[0].uses, 2);
  assert.deepEqual(results[0].records, [
    { origin: 'https://koha.example:8443', biblionumber: '42' },
    { origin: 'https://koha.example:8443', biblionumber: '55' }
  ]);
  assert.equal((await reopened.search('Modelos de negocios')).length, 0);
  await reopened.saveRecord('https://koha.example:8443:42', []);
  assert.equal((await reopened.search(h.main))[0].records.length, 1);
});

test('legacy usage counts remain intact and resaving backfills biblionumber', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'topic-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'headings.json');
  const store = new HeadingStore(filename);
  await store.saveRecord('https://koha.test:7', [heading]);
  const data = structuredClone(await store.read());
  delete data.recordInfo;
  await writeFile(filename, JSON.stringify(data));
  assert.deepEqual((await store.search('Educación'))[0].records, []);
  await store.saveRecord('https://koha.test:7', [heading]);
  const result = (await store.search('Educación'))[0];
  assert.equal(result.uses, 1);
  assert.equal(result.records[0].biblionumber, '7');
});
