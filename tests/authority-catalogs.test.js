import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogSearch, searchVariants } from '../authority-catalogs.js';

const englishCandidate = (spanish, english) => ({
  match: { language: 'es', text: spanish },
  display: { label: { language: 'en', value: english } }
});
const lcshResponse = (query, labels = []) => [query, labels, [], labels.map((_, i) => `http://id.loc.gov/authorities/subjects/sh${i}`)];

test('LCSH resolves Spanish through English Wikidata labels, verifies in LOC and caches', async () => {
  const calls = [];
  const search = createCatalogSearch({ fetcher: async url => {
    calls.push(url);
    if (url.hostname === 'www.wikidata.org') {
      assert.equal(url.searchParams.get('language'), 'es');
      assert.equal(url.searchParams.get('uselang'), 'en');
      return { ok: true, json: async () => ({ search: [englishCandidate('Botánica', 'botany')] }) };
    }
    assert.equal(url.hostname, 'id.loc.gov');
    const query = url.searchParams.get('q');
    return { ok: true, json: async () => lcshResponse(query, query === 'botany' ? ['Botany', 'Botany--Mexico'] : []) };
  } });
  const [result, duplicate] = await Promise.all([search('LCSH', 'Botánica -- México'), search('LCSH', 'Botánica -- México')]);
  assert.deepEqual(result, duplicate);
  assert.deepEqual(result.queries, ['Botánica', 'botany']);
  assert.equal(result.results[0].source, 'LCSH');
  assert.equal(result.results[0].label, 'Botany');
  assert.equal(result.results[0].expandedFrom, 'Botánica');
  assert.equal(result.results[0].expansionSource, 'Wikidata');
  assert.equal(result.results[0].match, 'related');
  assert.deepEqual(result.results.map(row => row.canImport), [true, false]);
  await search('LCSH', 'Botánica -- México');
  assert.equal(calls.length, 3);
});

test('LCSH translates the full phrase before broadening to its first word', async () => {
  const search = createCatalogSearch({ fetcher: async url => {
    if (url.hostname === 'www.wikidata.org') return { ok: true, json: async () => ({ search: [englishCandidate('Inteligencia artificial', 'artificial intelligence')] }) };
    const query = url.searchParams.get('q');
    return { ok: true, json: async () => lcshResponse(query, query === 'artificial intelligence' ? ['Artificial intelligence'] : []) };
  } });
  const result = await search('LCSH', 'Inteligencia artificial');
  assert.deepEqual(result.queries, ['Inteligencia artificial', 'artificial intelligence']);
});

test('prefix suggestions do not hide a better English candidate for a Spanish term', async () => {
  const search = createCatalogSearch({ fetcher: async url => {
    if (url.hostname === 'www.wikidata.org') return { ok: true, json: async () => ({ search: [englishCandidate('Botánica', 'botany')] }) };
    const query = url.searchParams.get('q');
    return { ok: true, json: async () => lcshResponse(query, query === 'botany' ? ['Botany'] : ['Botanical apparatus']) };
  } });
  const result = await search('LCSH', 'Botánica');
  assert.equal(result.results[0].label, 'Botany');
  assert.deepEqual(result.queries, ['Botánica', 'botany']);
});

test('LCSH skips unrelated or non-English candidates and broadens when there is no mapping', async () => {
  const search = createCatalogSearch({ fetcher: async url => {
    if (url.hostname === 'www.wikidata.org') return { ok: true, json: async () => ({ search: [
      englishCandidate('Otro concepto', 'unrelated'),
      { match: { language: 'es', text: 'Botánica sistemática' }, display: { label: { language: 'es', value: 'Botánica' } } },
      { label: 'Unverified fallback' }
    ] }) };
    const query = url.searchParams.get('q');
    return { ok: true, json: async () => lcshResponse(query) };
  } });
  const result = await search('LCSH', 'Botánica sistemática');
  assert.deepEqual(result.queries, ['Botánica sistemática', 'Botánica']);
  assert.deepEqual(result.results, []);
});

test('LCSH expansion failures are retryable and are not cached as empty results', async () => {
  let expansions = 0;
  const search = createCatalogSearch({ fetcher: async url => {
    if (url.hostname === 'www.wikidata.org') { expansions++; return { ok: false, status: 503 }; }
    return { ok: true, json: async () => lcshResponse('Botánica') };
  } });
  await assert.rejects(search('LCSH', 'Botánica'), /HTTP 503/);
  await assert.rejects(search('LCSH', 'Botánica'), /HTTP 503/);
  assert.equal(expansions, 2);
});

test('one LCSH deadline also bounds the English expansion', async () => {
  let originalSignal;
  const search = createCatalogSearch({ lcshTimeoutMs: 20, fetcher: async (url, { signal }) => {
    if (url.hostname === 'id.loc.gov') {
      originalSignal = signal;
      return { ok: true, json: async () => lcshResponse('Botánica') };
    }
    assert.equal(signal, originalSignal);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 500);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  } });
  await assert.rejects(search('LCSH', 'Botánica'), { name: 'TimeoutError' });
});

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
