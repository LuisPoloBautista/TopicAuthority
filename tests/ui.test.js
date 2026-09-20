import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { headingLabel } from '../headings.js';

const code = (await readFile(new URL('../script.js', import.meta.url), 'utf8')).replace(/^import .*\r?\n/, '');
function element() {
  return {
    value: '', textContent: '', innerHTML: '', children: [], events: {}, dataset: {},
    classList: { contains: () => false },
    setAttribute() {},
    addEventListener(type, handler) { this.events[type] = handler; },
    querySelectorAll: () => [],
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; }
  };
}
function ui() {
  const nodes = new Map();
  const requests = [];
  const messages = [];
  const window = { parent: { postMessage: message => messages.push(message) }, addEventListener() {} };
  const context = vm.createContext({
    document: { getElementById: id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element },
    window, headingLabel, setTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options });
      const mode = options?.body ? JSON.parse(options.body).mode : '';
      const headings = Array.from({ length: mode === 'marc' ? 1 : 5 }, () => ({ main: 'Educación', subdivisions: [{ code: 'z', value: 'México' }], label: 'Educación -- México' }));
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
  assert.doesNotMatch(nodes.get('marcOutput').innerHTML, /search-external|Consulta externa/);
  assert.equal(nodes.get('output').innerHTML, '');
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
  results.children[1].children[1].events.click();
  const message = messages.find(m => m.type === 'TOPIC_AUTHORITY_USE');
  assert.deepEqual(JSON.parse(JSON.stringify(message.authority.subfields)), [{ code: 'a', value: 'Educación' }, { code: 'z', value: 'México' }]);
  assert.equal(message.authority.ind2, '4');
  assert.equal(requests.some(r => r.url.includes('heading-usage')), false);
  assert.match(context.catalogLinks('Educación & México'), /Educaci%C3%B3n%20%26%20M%C3%A9xico/);
});
