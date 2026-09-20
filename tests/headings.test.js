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
