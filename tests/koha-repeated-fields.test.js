import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('authority metadata is optional but missing heading subfields still block before mutation', async () => {
  const source = await readFile(new URL('../docs/topic-authority-koha-integration.js', import.meta.url), 'utf8');
  const instrumented = source.replace('  function initialize() {', '  globalThis.importInto = (node, authority) => { target650Node = node; useAuthority(authority); };\n  function initialize() {');
  const context = vm.createContext({
    Event: class {},
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => ({ style: {} }), body: { style: {} } }
  });
  vm.runInContext(instrumented, context);
  const authority = { label: 'Botánica', uri: 'http://vocabularies.unesco.org/thesaurus/concept230', sourceCode: 'unescot', ind2: '7' };
  function field(codes) {
    const editors = Object.fromEntries(codes.map(code => [code, { value: 'previous-' + code, dispatchEvent() {} }]));
    const lines = codes.map(code => ({
      id: 'subfield650' + code,
      querySelector(selector) {
        if (selector.startsWith('input[name')) return selector.includes('_code_' + code + '_') ? { closest: () => this } : null;
        return editors[code];
      }
    }));
    const indicators = [{ value: ' ' }, { value: '4' }];
    return {
      isConnected: true, editors, indicators,
      querySelector: selector => selector.startsWith('.subfield_line')
        ? lines.find(line => selector.includes(line.id))
        : lines.map(line => line.querySelector(selector)).find(Boolean),
      querySelectorAll: selector => selector === '.subfield_line' ? lines : indicators
    };
  }
  for (const codes of [['a'], ['a', '2'], ['a', '0'], ['a', '0', '2']]) {
    const node = field(codes);
    context.importInto(node, authority);
    assert.equal(node.editors.a.value, 'Botánica');
    if (node.editors['0']) assert.equal(node.editors['0'].value, authority.uri);
    if (node.editors['2']) assert.equal(node.editors['2'].value, 'unescot');
    assert.equal(node.indicators[1].value, codes.includes('2') ? '7' : '4');
  }
  const lcsh = field(['a']);
  context.importInto(lcsh, { label: 'Botany', uri: 'http://id.loc.gov/authorities/subjects/sh85015976', ind2: '0' });
  assert.equal(lcsh.indicators[1].value, '0');
  const missingSubdivision = field(['a', '0', '2']);
  assert.throws(() => context.importInto(missingSubdivision, {
    ...authority, subfields: [{ code: 'a', value: 'Botánica' }, { code: 'x', value: 'Historia' }]
  }), /650\$x/);
  assert.equal(missingSubdivision.editors.a.value, 'previous-a');
  assert.equal(missingSubdivision.editors['0'].value, 'previous-0');
  assert.equal(missingSubdivision.editors['2'].value, 'previous-2');
});

test('a copied launcher targets its own 650 even with duplicate DOM IDs and stages the correct heading', async () => {
  const source = await readFile(new URL('../docs/topic-authority-koha-integration.js', import.meta.url), 'utf8');
  assert.match(source, /addEventListener\('click', onLauncherClick, true\)/);
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
    let stopped = false;
    context.handlers.onLauncherClick({ target: { closest: () => copiedButton }, preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
    assert.equal(stopped, true);
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
