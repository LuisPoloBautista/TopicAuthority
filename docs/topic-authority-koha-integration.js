/**
 * Integracion TopicAuthority + Koha.
 * Pegue este archivo DESPUES de koha-staff-integration.js en IntranetUserJS.
 */
(function () {
  "use strict";

  const AUTHORITY_ORIGIN = "https://topicauthority.onrender.com";
  const AUTHORITY_URL = AUTHORITY_ORIGIN + "/?koha=1&integration=20260923";
  const CATALOGUING_PATH = "/cgi-bin/koha/cataloguing/addbiblio.pl";
  let authorityFrame = null;
  let target650Node = null;
  const targetTokens = new WeakMap();
  let nextTargetToken = 0;
  function currentTarget() { return target650Node?.isConnected ? target650Node : null; }
  const staged = new Map();
  const PENDING_KEY = 'topic-authority-pending-save-v2';
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:]$/, '');
  const key = h => JSON.stringify([normalize(h.main), ...h.subdivisions.map(p => [p.code, normalize(p.value)])]);

  function headingFromNode(node) {
    const main = fieldValue(node, '650', 'a');
    const subdivisions = [];
    node.querySelectorAll('.subfield_line').forEach(line => {
      const code = line.querySelector('input[name^="tag_650_code_"]')?.name.match(/^tag_650_code_([xyzv])_/);
      const editor = line.querySelector('.input_marceditor, input[id^=tag_], textarea[id^=tag_], select[id^=tag_]');
      if (code && editor?.value.trim()) subdivisions.push({ code: code[1], value: editor.value.trim() });
    });
    return { main, subdivisions };
  }

  function stageSave() {
    const headings = [];
    staged.forEach((heading, node) => {
      if (node.isConnected && key(headingFromNode(node)) === key(heading)) headings.push(heading);
    });
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      recordId: document.querySelector('[name="biblionumber"]')?.value || new URLSearchParams(location.search).get('biblionumber') || '',
      at: Date.now(), headings
    }));
  }

  function restoreStagedHeadings() {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const pending = JSON.parse(raw);
    const recordId = document.querySelector('[name="biblionumber"]')?.value || new URLSearchParams(location.search).get('biblionumber') || '';
    if (pending.recordId !== recordId || Date.now() - pending.at > 30 * 60 * 1000) return;
    document.querySelectorAll('.tag[id^="tag_650_"]').forEach(node => {
      const match = pending.headings.find(h => key(h) === key(headingFromNode(node)));
      if (match) staged.set(node, match);
    });
  }

  async function readSavedMarc(id) {
    const sources = [
      { name: 'exportación', url: '/cgi-bin/koha/catalogue/export.pl?format=marcxml&op=export&bib=' + encodeURIComponent(id) },
      { name: 'API', url: '/api/v1/biblios/' + encodeURIComponent(id), headers: { Accept: 'application/marcxml+xml' } }
    ];
    const failures = [];
    for (const source of sources) {
      try {
        const response = await fetch(source.url, { credentials: 'same-origin', cache: 'no-store', headers: source.headers, signal: AbortSignal.timeout(15000) });
        if (!response.ok) { failures.push(source.name + ': HTTP ' + response.status); continue; }
        const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
        if (xml.querySelector('parsererror') || !xml.getElementsByTagNameNS('*', 'record').length) {
          failures.push(source.name + ': no devolvió MARCXML');
          continue;
        }
        return xml;
      } catch (error) {
        failures.push(source.name + ': ' + (error.name === 'TimeoutError' ? 'tiempo de espera agotado' : 'falló la conexión'));
      }
    }
    throw new Error('La sincronización quedó pendiente: no se pudo leer el registro guardado (' + failures.join('; ') + '). Comprueba la sesión y los permisos de lectura en Koha.');
  }

  async function confirmSavedRecord() {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const pending = JSON.parse(raw);
    if (Date.now() - pending.at > 30 * 60 * 1000) { sessionStorage.removeItem(PENDING_KEY); return; }
    if (!/\/(?:catalogue\/(?:detail|MARCdetail)|cataloguing\/additem)\.pl$/.test(location.pathname)) return;
    const id = new URLSearchParams(location.search).get('biblionumber');
    if (!id || (pending.recordId && pending.recordId !== id)) return;
    if (!pending.recordId && !document.referrer.includes(CATALOGUING_PATH)) return;
    const xml = await readSavedMarc(id);
    const saved = [...xml.getElementsByTagNameNS('*', 'datafield')].filter(f => f.getAttribute('tag') === '650').map(field => {
      const parts = [...field.getElementsByTagNameNS('*', 'subfield')];
      return { main: parts.find(p => p.getAttribute('code') === 'a')?.textContent.trim() || '',
        subdivisions: parts.filter(p => ['x','y','z','v'].includes(p.getAttribute('code'))).map(p => ({ code: p.getAttribute('code'), value: p.textContent.trim() })) };
    }).filter(h => h.main && h.subdivisions.length <= 2);
    const confirmed = [];
    const cache = new Map();
    for (const heading of saved) {
      if (pending.headings.some(h => key(h) === key(heading))) { confirmed.push(heading); continue; }
      if (!cache.has(key(heading))) {
        const lookup = await fetch(AUTHORITY_ORIGIN + '/api/headings?q=' + encodeURIComponent([heading.main, ...heading.subdivisions.map(p => p.value)].join(' -- ')));
        if (!lookup.ok) throw new Error('No se pudo consultar el historial.');
        cache.set(key(heading), (await lookup.json()).headings);
      }
      const known = cache.get(key(heading)).find(h => key(h) === key(heading));
      if (known) confirmed.push(known);
    }
    const result = await fetch(AUTHORITY_ORIGIN + '/api/heading-usage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true, recordId: location.origin + ':' + id, headings: confirmed })
    });
    if (!result.ok) throw new Error('El registro está guardado, pero no se pudo actualizar el historial.');
    sessionStorage.removeItem(PENDING_KEY);
  }

  function reportSyncFailure(error) {
    const message = document.createElement('div');
    message.className = 'alert alert-warning';
    message.setAttribute('role', 'alert');
    message.textContent = 'Historial TopicAuthority: ' + error.message + ' ';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = 'Reintentar sincronización';
    retry.onclick = () => { message.remove(); confirmSavedRecord().catch(reportSyncFailure); };
    message.append(retry); document.body.prepend(message);
  }

  function tagNumber(node) {
    const match = String(node && node.id || "").match(/^tag_(\d{3})_/);
    return match ? match[1] : "";
  }

  function fieldEditor(node, tag, code) {
    if (!node) return null;
    const codeInput = node.querySelector('input[name^="tag_' + tag + '_code_' + code + '_"]');
    const line = (codeInput && (codeInput.closest(".subfield_line") || codeInput.parentElement))
      || node.querySelector('.subfield_line[id^="subfield' + tag + code + '"]');
    return line && line.querySelector(".input_marceditor, input[id^=tag_], textarea[id^=tag_], select[id^=tag_]");
  }

  function fieldValue(node, tag, code) {
    const editor = fieldEditor(node, tag, code);
    return editor ? String(editor.value || "").trim() : "";
  }

  function setFieldValue(node, tag, code, value) {
    const editor = fieldEditor(node, tag, code);
    if (!editor) return false;
    editor.value = value || "";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function marcContext() {
    const lines = [];
    document.querySelectorAll("#f .tag").forEach(function (node) {
      const tag = tagNumber(node);
      if (!tag || tag === "650" || Number(tag) >= 650) return;
      const parts = [];
      node.querySelectorAll('.subfield_line input[name^="tag_' + tag + '_code_"]').forEach(function (codeInput) {
        const match = codeInput.name.match(new RegExp('^tag_' + tag + '_code_(.)_'));
        if (!match) return;
        const value = fieldValue(node, tag, match[1]);
        if (value) parts.push("$" + match[1] + value);
      });
      if (parts.length) lines.push("=" + tag + "  " + parts.join(" "));
    });
    return lines.join("\n");
  }

  function current650(node) {
    if (!node) return '';
    const heading = headingFromNode(node);
    return [heading.main, ...heading.subdivisions.map(p => p.value)].filter(Boolean).join(' -- ');
  }

  function sendContext() {
    if (!authorityFrame || !authorityFrame.contentWindow) return;
    const node = currentTarget();
    authorityFrame.contentWindow.postMessage({
      type: "TOPIC_AUTHORITY_KOHA_CONTEXT",
      version: 1,
      context: {
        mode: current650(node) ? "edit" : "new",
        existingTerm: current650(node),
        existingMain: fieldValue(node, "650", "a"),
        existingHeading: node ? headingFromNode(node) : null,
        targetId: node ? targetTokens.get(node) : null,
        marcText: marcContext()
      }
    }, AUTHORITY_ORIGIN);
  }

  function openAuthority(node) {
    target650Node = node;
    if (!targetTokens.has(node)) targetTokens.set(node, 'topic-650-' + (++nextTargetToken));
    document.getElementById("topic-authority-modal").style.display = "flex";
    document.body.style.overflow = "hidden";
    sendContext();
    window.setTimeout(sendContext, 250);
    window.setTimeout(sendContext, 1000);
  }

  function closeAuthority() {
    const modal = document.getElementById("topic-authority-modal");
    if (modal) modal.style.display = "none";
    document.body.style.overflow = "";
  }

  function onLauncherClick(event) {
    const button = event.target.closest?.('.topic-authority-launcher');
    if (!button) return;
    const node = button.closest('.tag');
    if (!node || tagNumber(node) !== '650') return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    openAuthority(node);
  }

  function addButtons() {
    document.querySelectorAll('.tag[id^="tag_650_"]').forEach(function (node) {
      if (node.querySelector(".topic-authority-launcher")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-sm btn-primary topic-authority-launcher";
      button.innerHTML = '<i class="fa fa-lightbulb" aria-hidden="true"></i> Sugerencia de autoridad';
      const controls = node.querySelector(".field_controls");
      (controls || node.querySelector(".tag_title") || node).appendChild(button);
    });
  }

  function useAuthority(authority) {
    const node = currentTarget();
    if (!node) throw new Error("Ya no se encuentra la etiqueta 650 seleccionada");
    const subfields = authority.subfields || [{ code: 'a', value: authority.label }];
    const desired = [...subfields, { code: '0', value: authority.uri || '' }, { code: '2', value: authority.sourceCode || '' }];
    // Heading components are required; optional authority metadata depends on the framework.
    const destinations = [];
    const used = new Map();
    for (const part of desired) {
      const editors = [...node.querySelectorAll('.subfield_line')].filter(line =>
        line.querySelector('input[name^="tag_650_code_' + part.code + '_"]') || line.id.startsWith('subfield650' + part.code)
      ).map(line => line.querySelector('.input_marceditor, input[id^=tag_], textarea[id^=tag_], select[id^=tag_]')).filter(Boolean);
      const offset = used.get(part.code) || 0;
      if (!editors[offset] && part.value && !['0', '2'].includes(part.code)) throw new Error('Agrega al framework la ocurrencia ' + (offset + 1) + ' de 650$' + part.code + ' y vuelve a importar.');
      used.set(part.code, offset + 1);
      if (editors[offset]) destinations.push([editors[offset], part.value]);
    }
    // Clear obsolete subdivisions and authority identifiers on replacement.
    for (const code of ['x', 'y', 'z', 'v', '0', '2']) {
      node.querySelectorAll('.subfield_line').forEach(line => {
        if (!line.querySelector('input[name^="tag_650_code_' + code + '_"]') && !line.id.startsWith('subfield650' + code)) return;
        const editor = line.querySelector('.input_marceditor, input[id^=tag_], textarea[id^=tag_], select[id^=tag_]');
        if (editor) { editor.value = ''; editor.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    }
    destinations.forEach(([editor, value]) => {
      editor.value = value;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const indicators = node.querySelectorAll('input.indicator');
    if (indicators[0]) indicators[0].value = authority.ind1 || ' ';
    // Indicator 7 requires a source code in $2. Never leave an incomplete source designation.
    const ind2 = authority.ind2 || '4';
    if (indicators[1]) indicators[1].value = ind2 === '7' && !fieldValue(node, '650', '2') ? '4' : ind2;
    // Track every imported heading, including external catalogs without localHeading.
    // Capture what actually reached the form; usage is confirmed only after Koha saves it.
    staged.set(node, headingFromNode(node));
    closeAuthority();
  }

  function initialize() {
    confirmSavedRecord().catch(reportSyncFailure);
    if (location.pathname !== CATALOGUING_PATH || document.getElementById("topic-authority-modal")) return;
    const form = document.getElementById('f');
    if (form) {
      restoreStagedHeadings();
      form.addEventListener('submit', stageSave, true);
      const nativeSubmit = HTMLFormElement.prototype.submit;
      form.submit = function () { stageSave(); nativeSubmit.call(form); };
    }
    const style = document.createElement("style");
    style.textContent = [
      ".topic-authority-launcher{margin-left:10px!important;padding:4px 9px!important;font-size:12px!important}",
      "#topic-authority-modal{display:none;position:fixed;inset:0;z-index:2100;background:#0008;align-items:center;justify-content:center;padding:24px}",
      "#topic-authority-dialog{width:min(1200px,96vw);height:92vh;background:#fff;border-radius:8px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px #0007}",
      "#topic-authority-header{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#b94720;color:#fff}",
      "#topic-authority-close{border:0;background:transparent;color:#fff;font-size:28px}",
      "#topic-authority-modal.expanded{padding:0}",
      "#topic-authority-modal.expanded #topic-authority-dialog{width:100vw;height:100vh;border-radius:0}",
      "#topic-authority-expand{border:1px solid #fff;background:transparent;color:#fff;padding:6px 12px;margin-right:12px}",
      "#topic-authority-frame{width:100%;height:100%;border:0}"
    ].join("");
    document.head.appendChild(style);

    const modal = document.createElement("div");
    modal.id = "topic-authority-modal";
    modal.innerHTML = '<div id="topic-authority-dialog" role="dialog" aria-modal="true" aria-label="Sugerencias de autoridad">' +
      '<div id="topic-authority-header"><strong>Sugerencias de autoridad para 650</strong>' +
      '<div><button id="topic-authority-expand" type="button" aria-expanded="false">Ampliar ventana</button><button id="topic-authority-close" type="button" aria-label="Cerrar">&times;</button></div></div>' +
      '<iframe id="topic-authority-frame" title="TopicAuthority"></iframe></div>';
    document.body.appendChild(modal);
    authorityFrame = document.getElementById("topic-authority-frame");
    authorityFrame.src = AUTHORITY_URL;
    authorityFrame.addEventListener("load", sendContext);
    document.getElementById('topic-authority-expand').addEventListener('click', function () {
      const expanded = modal.classList.toggle('expanded');
      this.textContent = expanded ? 'Restaurar tamaño' : 'Ampliar ventana';
      this.setAttribute('aria-expanded', String(expanded));
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAuthority(); });
    document.getElementById("topic-authority-close").addEventListener("click", closeAuthority);
    modal.addEventListener("click", function (event) { if (event.target === modal) closeAuthority(); });

    // Delegation also handles buttons copied by Koha when a 650 is repeated.
    document.addEventListener('click', onLauncherClick, true);
    addButtons();
    new MutationObserver(addButtons).observe(document.getElementById("f") || document.body, { childList: true, subtree: true });
    window.addEventListener("message", function (event) {
      if (event.origin !== AUTHORITY_ORIGIN || event.source !== authorityFrame.contentWindow || !event.data) return;
      if (event.data.type === "TOPIC_AUTHORITY_READY") sendContext();
      if (event.data.type === "TOPIC_AUTHORITY_USE") {
        if (event.data.targetId !== targetTokens.get(currentTarget())) return;
        try { useAuthority(event.data.authority || {}); }
        catch (error) { alert("No se pudo usar la autoridad: " + error.message); }
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
}());
