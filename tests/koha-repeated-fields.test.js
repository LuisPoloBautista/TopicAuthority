import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('a copied launcher targets its own 650 even with duplicate DOM IDs and stages the correct heading', async () => {
  const source = await readFile(new URL('../docs/topic-authority-koha-integration.js', import.meta.url), 'utf8');
  // Expose internal handlers only inside the test VM; no test hooks ship to Koha.
  const instrumented = source.replace('  function initialize() {', '  globalThis.handlers = { onLauncherClick, useAuthority, stageSave };\n  function initialize() {');
  function field(value) {
    const editor = { value, dispatchEvent() {} };
    const line = {
      id: 'subfield650a',
      querySelector(selector) { return selector.startsWith('input[name') ? (selector.includes('_code_a_') ? {} : null) : editor; }
    };
    const node = {
      id: 'tag_650_duplicate', isConnected: true,
      querySelector(selector) { return selector.includes('_code_a_') ? { closest: () => line } : null; },
      querySelectorAll(selector) { return selector === '.subfield_line' ? [line] : []; }
    };
    return { node, editor };
  }
  const first = field('Primero'), second = field('Segundo');
  const modal = { style: {} };
  let pending;
  const context = vm.createContext({
    Map, WeakMap, URLSearchParams, Date, JSON,
    Event: class {},
    location: { search: '?biblionumber=42' },
    document: {
      readyState: 'loading', addEventListener() {}, body: { style: {} },
      querySelector: () => ({ value: '42' }),
      // Duplicate IDs deliberately resolve to the first field, as in the browser.
      getElementById: id => id === 'topic-authority-modal' ? modal : first.node
    },
    window: { setTimeout() {} },
    sessionStorage: { setItem: (_, value) => { pending = JSON.parse(value); } }
  });
  vm.runInContext(instrumented, context);
  const click = node => {
    const copiedButton = { closest: () => node }; // No listener on the copied button.
    context.handlers.onLauncherClick({ target: { closest: () => copiedButton }, preventDefault() {} });
  };
  click(first.node);
  click(second.node);
  assert.equal(modal.style.display, 'flex');
  context.handlers.useAuthority({
    label: 'Modelos grandes de lenguaje',
    subfields: [{ code: 'a', value: 'Modelos grandes de lenguaje' }],
    localHeading: { main: 'Modelos grandes de lenguaje', subdivisions: [] }
  });
  assert.equal(first.editor.value, 'Primero');
  assert.equal(second.editor.value, 'Modelos grandes de lenguaje');
  context.handlers.stageSave();
  assert.equal(pending.headings.length, 1);
  assert.equal(pending.headings[0].main, second.editor.value);
  second.node.isConnected = false;
  context.handlers.stageSave();
  assert.equal(pending.headings.length, 0);
});
