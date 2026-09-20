import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../docs/topic-authority-koha-integration.js', import.meta.url), 'utf8');
const heading = { main: 'Educación', subdivisions: [{ code: 'z', value: 'México' }] };

async function simulate({ recordId = '15', pendingHeadings = [heading], savedHeadings = [heading], exportOk = true, pending = true, pageId = '15' } = {}) {
  const calls = [];
  let removed = false;
  const fields = savedHeadings.map(h => ({
    getAttribute: () => '650',
    getElementsByTagNameNS: () => [{ code: 'a', value: h.main }, ...h.subdivisions].map(p => ({ getAttribute: () => p.code, textContent: p.value }))
  }));
  const xml = { querySelector: () => null, getElementsByTagNameNS: (_, name) => name === 'record' ? [{}] : fields };
  const element = () => ({ setAttribute() {}, append() {} });
  vm.runInNewContext(script, {
    URLSearchParams, Date, Map, JSON,
    location: { pathname: '/cgi-bin/koha/catalogue/detail.pl', search: '?biblionumber=' + pageId, origin: 'https://koha.test' },
    document: { readyState: 'complete', referrer: 'https://koha.test/cgi-bin/koha/cataloguing/addbiblio.pl', createElement: element, body: { prepend() {} } },
    sessionStorage: {
      getItem: () => pending ? JSON.stringify({ recordId, at: Date.now(), headings: pendingHeadings }) : null,
      removeItem: () => { removed = true; }
    },
    DOMParser: class { parseFromString() { return xml; } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('export.pl')) return { ok: exportOk, text: async () => '<record />' };
      if (url.includes('/api/headings?')) return { ok: true, json: async () => ({ headings: [] }) };
      return { ok: true };
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  return { calls, removed };
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
  }
  const changed = await simulate({ savedHeadings: [{ main: 'Historia', subdivisions: [] }] });
  const body = JSON.parse(changed.calls.find(c => c.url.endsWith('/api/heading-usage')).options.body);
  assert.deepEqual(body.headings, []);
});

test('Koha does not count abandoned edits, failed verification or a different record', async () => {
  for (const options of [{ pending: false }, { exportOk: false }, { pageId: '99' }]) {
    const result = await simulate(options);
    assert.equal(result.calls.some(c => c.url.endsWith('/api/heading-usage')), false);
    assert.equal(result.removed, false);
  }
});
