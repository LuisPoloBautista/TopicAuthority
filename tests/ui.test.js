import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { headingLabel } from '../headings.js';

const code = (await readFile(new URL('../script.js', import.meta.url), 'utf8')).replace(/^import .*\r?\n/, '');
function element(tagName) {
  return {
    tagName,
    value: '', textContent: '', innerHTML: '', children: [], events: {}, dataset: {},
    classList: { contains: () => false },
    setAttribute() {},
    addEventListener(type, handler) { this.events[type] = handler; },
    querySelectorAll: () => [],
    querySelector: () => null,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }
  };
}
function ui() {
  const nodes = new Map();
  const requests = [];
  const messages = [];
  const window = { parent: { postMessage: message => messages.push(message) }, addEventListener() {} };
  const context = vm.createContext({
    document: { getElementById: id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    window, headingLabel, setTimeout, URL,
    fetch: async (url, options) => {
      requests.push({ url, options });
      const mode = options?.body ? JSON.parse(options.body).mode : '';
      const headings = Array.from({ length: mode === 'marc' ? 1 : 5 }, () => ({ main: 'Educación', subdivisions: [{ code: 'z', value: 'México' }], label: 'Educación -- México', uses: 1, records: [{ origin: 'https://koha.test', biblionumber: '42' }] }));
      return { ok: true, json: async () => ({ headings, topics: headings.map(h => h.label) }) };
    }
  });
  vm.runInContext(code, context);
  return { nodes, context, requests, messages };
}

test('UI offers subdivision generation for an existing 650$a and heading generation for an empty one', async () => {
  const { nodes, context, requests } = ui();
  context.receiveKohaContext({ existingMain: 'Educación', existingTerm: 'Educación', marcText: '=245 $a Educación en México' }, 'https://koha.test');
  assert.match(nodes.get('analyzeKohaBtn').textContent, /subdivisiones/);
  assert.equal(requests.length, 0);
  await nodes.get('analyzeKohaBtn').events.click();
  assert.equal(JSON.parse(requests[0].options.body).existingMain, 'Educación');
  assert.equal((nodes.get('marcOutput').innerHTML.match(/class="topic-card"/g) || []).length, 1);
  assert.match(nodes.get('marcOutput').innerHTML, /catalog-results/);
  assert.match(nodes.get('output').innerHTML, /Educación/);
  await context.analyzeText('Texto PDF', '', 'pdf', nodes.get('pdfOutput'));
  assert.equal((nodes.get('pdfOutput').innerHTML.match(/class="topic-card"/g) || []).length, 5);
  assert.equal((nodes.get('marcOutput').innerHTML.match(/class="topic-card"/g) || []).length, 1);
  context.receiveKohaContext({ existingMain: '', existingTerm: '', marcText: '=245 $a Historia' }, 'https://koha.test');
  assert.match(nodes.get('analyzeKohaBtn').textContent, /un encabezamiento/);
  assert.equal(nodes.get('authorityTermInput').value, '');
});

test('automatic history warning imports typed MARC data without recording a use', async () => {
  const { context, messages, requests } = ui();
  context.receiveKohaContext({ existingMain: '', marcText: '=245 $a Educación' }, 'https://koha.test');
  const results = element();
  const card = { dataset: {}, querySelector: () => results };
  await context.showLocalMatches(card, { main: 'Educación', label: 'Educación -- México' }, true);
  assert.match(results.children[0].textContent, /Advertencia/);
  const table = results.children[1].children[0];
  assert.equal(table.tagName, 'table');
  const row = table.children[2].children[0];
  assert.equal(row.children[3].children[0].href, 'https://koha.test/cgi-bin/koha/catalogue/detail.pl?biblionumber=42');
  row.children[4].children[0].events.click();
  const message = messages.find(m => m.type === 'TOPIC_AUTHORITY_USE');
  assert.deepEqual(JSON.parse(JSON.stringify(message.authority.subfields)), [{ code: 'a', value: 'Educación' }, { code: 'z', value: 'México' }]);
  assert.equal(message.authority.ind2, '4');
  assert.equal(requests.some(r => r.url.includes('heading-usage')), false);
  assert.match(context.catalogLinks('Educación & México'), /Educaci%C3%B3n%20%26%20M%C3%A9xico/);
});

test('catalogs run in parallel without AI and import to the selected target only', async () => {
  const { context, messages } = ui();
  context.receiveKohaContext({ existingMain: '', targetId: 'second-650' }, 'https://koha.test');
  const pending = [];
  context.fetch = url => new Promise(resolve => pending.push({ url, resolve }));
  const container = element('div');
  const card = { isConnected: true, querySelector: () => container };
  const done = context.showCatalogMatches(card, { main: 'Botánica sistemática' });
  assert.equal(pending.length, 3);
  assert.equal(pending.every(p => p.url.startsWith('/api/authorities?')), true);
  for (const p of pending) {
    p.resolve({ ok: true, json: async () => ({ queries: ['Botánica sistemática', 'Botánica'], results: [
      { source: 'UNESCO', label: 'Botánica', uri: 'http://vocabularies.unesco.org/thesaurus/concept230', canImport: true, match: 'related' }
    ] }) });
  }
  await done;
  const row = container.children[0].children[2];
  assert.match(row.children[1].textContent, /relacionado/);
  row.children[2].events.click();
  const imported = messages.at(-1);
  assert.equal(imported.targetId, 'second-650');
  assert.equal(imported.authority.label, 'Botánica');
  assert.equal(imported.authority.sourceCode, 'unescot');
  assert.equal(imported.authority.ind2, '7');
  context.receiveKohaContext({ existingMain: '', targetId: 'third-650' }, 'https://koha.test');
  const count = messages.length;
  row.children[2].events.click();
  assert.equal(messages.length, count);
});

test('late catalog responses cannot populate a different 650', async () => {
  const { context } = ui();
  context.receiveKohaContext({ existingMain: '', targetId: 'first' }, 'https://koha.test');
  const pending = [];
  context.fetch = () => new Promise(resolve => pending.push(resolve));
  const container = element('div');
  const done = context.showCatalogMatches({ isConnected: true, querySelector: () => container }, { main: 'Botánica' });
  context.receiveKohaContext({ existingMain: '', targetId: 'second' }, 'https://koha.test');
  pending.forEach(resolve => resolve({ ok: true, json: async () => ({ queries: ['Botánica'], results: [] }) }));
  await done;
  assert.equal(container.children.every(section => section.children[1].textContent === 'Buscando…'), true);
});
