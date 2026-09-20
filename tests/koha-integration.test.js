import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../docs/topic-authority-koha-integration.js', import.meta.url), 'utf8');
const heading = { main: 'Educación', subdivisions: [{ code: 'z', value: 'México' }] };

async function simulate({ recordId = '15', pendingHeadings = [heading], savedHeadings = [heading], exportOk = true, apiOk = false, invalidExport = false, pending = true, pageId = '15' } = {}) {
  const calls = [];
  const notices = [];
  let removed = false;
  const fields = savedHeadings.map(h => ({
    getAttribute: () => '650',
    getElementsByTagNameNS: () => [{ code: 'a', value: h.main }, ...h.subdivisions].map(p => ({ getAttribute: () => p.code, textContent: p.value }))
  }));
  const xml = { querySelector: () => null, getElementsByTagNameNS: (_, name) => name === 'record' ? [{}] : fields };
  const element = () => ({ setAttribute() {}, append() {} });
  vm.runInNewContext(script, {
    URLSearchParams, Date, Map, JSON, AbortSignal,
    location: { pathname: '/cgi-bin/koha/catalogue/detail.pl', search: '?biblionumber=' + pageId, origin: 'https://koha.test' },
    document: { readyState: 'complete', referrer: 'https://koha.test/cgi-bin/koha/cataloguing/addbiblio.pl', createElement: element, body: { prepend(node) { notices.push(node.textContent); } } },
    sessionStorage: {
      getItem: () => pending ? JSON.stringify({ recordId, at: Date.now(), headings: pendingHeadings }) : null,
      removeItem: () => { removed = true; }
    },
    DOMParser: class { parseFromString(text) { return text === '<html />' ? { querySelector: () => null, getElementsByTagNameNS: () => [] } : xml; } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('export.pl')) {
        assert.equal(new URL(url, 'https://koha.test').searchParams.get('op'), 'export');
        return { ok: exportOk, status: exportOk ? 200 : 403, text: async () => invalidExport ? '<html />' : '<record />' };
      }
      if (url.includes('/api/v1/biblios/')) return { ok: apiOk, status: apiOk ? 200 : 403, text: async () => '<record />' };
      if (url.includes('/api/headings?')) return { ok: true, json: async () => ({ headings: [] }) };
      return { ok: true };
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  return { calls, removed, notices };
}

test('Koha counts only headings present in the exported saved MARC, including new records', async () => {
  for (const recordId of ['15', '']) {
    const result = await simulate({ recordId });
    const usage = result.calls.find(c => c.url.endsWith('/api/heading-usage'));
    const body = JSON.parse(usage.options.body);
    assert.equal(body.recordId, 'https://koha.test:15');
    assert.deepEqual(body.headings, [heading]);
    assert.equal(body.confirmed, true);
    assert.equal(result.removed, true);
    assert.equal(result.calls.some(c => c.url.includes('/api/v1/biblios/')), false);
  }
  const changed = await simulate({ savedHeadings: [{ main: 'Historia', subdivisions: [] }] });
  const body = JSON.parse(changed.calls.find(c => c.url.endsWith('/api/heading-usage')).options.body);
  assert.deepEqual(body.headings, []);
});

test('Koha falls back to authenticated MARCXML API after failed export or a login HTML page', async () => {
  for (const options of [{ exportOk: false, apiOk: true }, { invalidExport: true, apiOk: true }]) {
    const result = await simulate(options);
    const api = result.calls.find(c => c.url.includes('/api/v1/biblios/15'));
    assert.equal(api.options.headers.Accept, 'application/marcxml+xml');
    assert.equal(api.options.credentials, 'same-origin');
    assert.equal(result.removed, true);
    assert.equal(result.notices.length, 0);
  }
});

test('failed verification preserves pending usage and reports the HTTP status', async () => {
  const result = await simulate({ exportOk: false });
  assert.equal(result.removed, false);
  assert.equal(result.calls.some(c => c.url.endsWith('/api/heading-usage')), false);
  assert.match(result.notices[0], /HTTP 403/);
});

test('Koha does not count abandoned edits, failed verification or a different record', async () => {
  for (const options of [{ pending: false }, { exportOk: false }, { pageId: '99' }]) {
    const result = await simulate(options);
    assert.equal(result.calls.some(c => c.url.endsWith('/api/heading-usage')), false);
    assert.equal(result.removed, false);
  }
});
