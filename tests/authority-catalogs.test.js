import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogSearch, searchVariants } from '../authority-catalogs.js';

test('broadens a missing phrase, shares pending requests, caches results and never calls AI', async () => {
  const calls = [];
  const search = createCatalogSearch({ fetcher: async url => {
    calls.push(url);
    assert.equal(url.hostname, 'vocabularies.unesco.org');
    const results = url.searchParams.get('query') === 'Botánica*'
      ? [{ prefLabel: 'Botánica', uri: 'http://vocabularies.unesco.org/thesaurus/concept1' }] : [];
    return { ok: true, json: async () => ({ results }) };
  } });
  const [a, b] = await Promise.all([search('UNESCO', 'Botánica sistemática'), search('UNESCO', 'Botánica sistemática')]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.queries, ['Botánica sistemática', 'Botánica']);
  assert.equal(a.results[0].match, 'related');
  assert.equal(a.results[0].canImport, true);
  await search('UNESCO', 'Botánica sistemática');
  assert.equal(calls.length, 2);
  assert.deepEqual(searchVariants('Botánica sistemática -- México'), ['Botánica sistemática', 'Botánica']);
});

test('parses Wikidata and LCSH, rejects unsafe URIs and prevents flattening compound LCSH into $a', async () => {
  const search = createCatalogSearch({ fetcher: async url => ({ ok: true, json: async () =>
    url.hostname === 'www.wikidata.org'
      ? { search: [{ label: 'Botánica', concepturi: 'http://www.wikidata.org/entity/Q1', description: 'Ciencia' }, { label: 'Bad', concepturi: 'javascript:alert(1)' }] }
      : ['Botany', ['Botany', 'Botany--Mexico'], [], ['http://id.loc.gov/authorities/subjects/sh1', 'http://id.loc.gov/authorities/subjects/sh2']]
  }) });
  const wiki = await search('Wikidata', 'Botánica');
  assert.equal(wiki.results.length, 1);
  assert.equal(wiki.results[0].match, 'exact');
  const lc = await search('LCSH', 'Botany');
  assert.deepEqual(lc.results.map(r => r.canImport), [true, false]);
  await assert.rejects(search('Unknown', 'test'), { status: 400 });
  await assert.rejects(search('UNESCO', 'x'.repeat(301)), { status: 400 });
});

test('failure is not cached or mistaken for no matches; timeout bounds both attempts', async () => {
  let calls = 0;
  const search = createCatalogSearch({ fetcher: async () => { calls++; throw new Error('offline'); } });
  await assert.rejects(search('UNESCO', 'Botánica sistemática'));
  await assert.rejects(search('UNESCO', 'Botánica sistemática'));
  assert.equal(calls, 2);
  const timed = createCatalogSearch({ timeoutMs: 15, fetcher: async (_, { signal }) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 500);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  } });
  await assert.rejects(timed('Wikidata', 'Botánica'), { name: 'TimeoutError' });
});
