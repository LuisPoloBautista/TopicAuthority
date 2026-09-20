import { headingLabel } from "./headings.js";
const pdfInput = document.getElementById("pdfInput");
const processPdfBtn = document.getElementById("processPdfBtn");
const output = document.getElementById("output");
const marcOutput = document.getElementById("marcOutput");
const pdfOutput = document.getElementById("pdfOutput");
const requestsByOutput = new WeakMap();
const dropZone = document.getElementById("dropZone");
const sidebar = document.getElementById("infoSidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const kohaContextMessage = document.getElementById("kohaContextMessage");
const analyzeKohaBtn = document.getElementById("analyzeKohaBtn");
const authorityTermInput = document.getElementById("authorityTermInput");
const searchAuthorityBtn = document.getElementById("searchAuthorityBtn");

let kohaParentOrigin = null;
let kohaContext = null;
let viewVersion = 0;
const generatedHeadings = new Map();

if (sidebarToggle && sidebar) {
  sidebarToggle.setAttribute("aria-expanded", String(!sidebar.classList.contains("collapsed")));
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    sidebarToggle.setAttribute("aria-expanded", String(!sidebar.classList.contains("collapsed")));
  });
}

dropZone.addEventListener("click", () => {
  pdfInput.click();
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const files = e.dataTransfer.files;
  if (files.length && files[0].type === "application/pdf") {
    pdfInput.files = files;
    dropZone.querySelector("p").textContent = `PDF seleccionado: ${files[0].name}`;
  } else {
    alert("Por favor, suelta solo archivos PDF.");
  }
});

pdfInput.addEventListener("change", () => {
  if (pdfInput.files.length) {
    dropZone.querySelector("p").textContent = `PDF seleccionado: ${pdfInput.files[0].name}`;
  }
});

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function extractTextFromPdf(file) {
  const pdfLib = window["pdfjsLib"];
  if (!pdfLib) {
    throw new Error("pdf.js no está disponible. Recarga la página o verifica la conexión a internet.");
  }
  pdfLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    fullText += pageText + "\n\n";
  }

  return fullText.trim();
}

async function requestTopics(text, existingMain = "", mode = "pdf") {
  const res = await fetch("/api/topics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, existingMain, mode }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || res.statusText);
  }

  return res.json();
}

function topicsFromResponse(data) {
  if (Array.isArray(data.topics) && data.topics.length) return data.topics;
  return String(data.result || "")
    .split(/\r?\n\s*\r?\n|\r?\n/)
    .map(line => line.replace(/^\d+[\.)]\s*/, "").trim())
    .filter(Boolean);
}

function catalogLinks(term) {
  if (!term.trim()) return '';
  const q = encodeURIComponent(term);
  const links = {
    UNESCO: `https://vocabularies.unesco.org/unesco/es/search?clang=es&q=${q}`,
    Wikidata: `https://www.wikidata.org/w/index.php?title=Special:Search&search=${q}&uselang=es`,
    LCSH: `https://id.loc.gov/search/?q=${q}&q=cs%3Ahttp%3A%2F%2Fid.loc.gov%2Fauthorities%2Fsubjects`
  };
  return '<span>Buscar manualmente:</span> ' + Object.entries(links).map(([name, url]) =>
    `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${name}</a>`).join(' · ');
}

const pendingHistorySearches = new Map();
async function localMatches(term) {
  if (pendingHistorySearches.has(term)) return pendingHistorySearches.get(term);
  const request = (async () => {
    const res = await fetch(`/api/headings?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo consultar el historial.');
    return data.headings;
  })();
  pendingHistorySearches.set(term, request);
  try { return await request; }
  finally { pendingHistorySearches.delete(term); }
}

function sendHeading(heading) {
  useAuthority({ ...heading, label: headingLabel(heading), source: 'Local', localHeading: heading });
}

async function showLocalMatches(card, heading, automatic = false) {
  const container = card.querySelector('.local-results');
  container.textContent = 'Consultando historial...';
  try {
    const matches = await localMatches(heading.label);
    const related = matches;
    container.replaceChildren();
    const message = document.createElement('p');
    message.className = related.length ? 'duplicate-warning' : '';
    message.textContent = related.length
      ? `${automatic ? 'Advertencia: ' : ''}Ya hay ${related.length} encabezamiento(s) coincidente(s) en el historial. Revisa e importa la forma usada para normalizarla.`
      : 'No hay coincidencias en el historial. Puedes usarlo como nuevo.';
    container.append(message);
    if (related.length) {
      const wrapper = document.createElement('div');
      wrapper.className = 'history-table-wrapper';
      const table = document.createElement('table');
      table.className = 'history-table';
      const caption = document.createElement('caption');
      caption.textContent = 'Encabezamientos recuperados del historial';
      const thead = document.createElement('thead');
      const header = document.createElement('tr');
      for (const title of ['Encabezamiento usado', 'Coincidencia', 'Registros', 'Biblionumber', 'Acción']) {
        const cell = document.createElement('th');
        cell.scope = 'col'; cell.textContent = title; header.append(cell);
      }
      thead.append(header);
      const tbody = document.createElement('tbody');
      for (const match of related) {
        const row = document.createElement('tr');
        const cell = text => { const td = document.createElement('td'); td.textContent = text; row.append(td); return td; };
        cell(match.label);
        cell(match.exact ? 'Exacta' : `Similar (${match.similarity}%)`);
        cell(String(match.uses || 0));
        const records = cell('');
        for (const ref of match.records || []) {
          try {
            const origin = new URL(ref.origin);
            if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== ref.origin || !/^\d+$/.test(ref.biblionumber)) continue;
            const link = document.createElement('a');
            link.href = origin.origin + '/cgi-bin/koha/catalogue/detail.pl?biblionumber=' + encodeURIComponent(ref.biblionumber);
            link.textContent = ref.biblionumber;
            link.title = origin.origin;
            link.target = '_blank'; link.rel = 'noopener noreferrer';
            records.append(link);
          } catch { /* Invalid record references are not rendered as links. */ }
        }
        if (!records.children.length) records.textContent = match.uses ? 'No disponible para usos anteriores' : 'Sin registros actuales';
        else if ((match.records || []).length < match.uses) {
          const note = document.createElement('span'); note.textContent = 'Hay usos anteriores sin identificador.'; records.append(note);
        }
        const action = cell('');
        if (kohaParentOrigin) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = 'Importar encabezamiento';
          button.addEventListener('click', () => sendHeading(match));
          action.append(button);
        } else action.textContent = 'Abre desde Koha para importar';
        tbody.append(row);
      }
      table.append(caption, thead, tbody);
      wrapper.append(table); container.append(wrapper);
    }
    card.dataset.historyChecked = 'true';
    return related;
  } catch (error) {
    container.textContent = error.message + ' Reintenta la búsqueda antes de usarlo.';
    throw error;
  }
}

function renderTopics(headings, generated = false, output = document.getElementById("output")) {
  const version = viewVersion;
  output.innerHTML = '<div class="topic-list">' + headings.map((heading, index) => `
    <article class="topic-card">
      <div class="topic-title"><span class="topic-number">${index + 1}</span><span>${escapeHtml(heading.label)}</span></div>
      ${generated ? `<p>Candidato de IA · ${escapeHtml(heading.subdivisions.map(p => '$' + p.code + ' ' + p.value).join(' · '))}</p>` : ''}
      <div class="koha-actions">
        <button type="button" class="search-local">Buscar en el historial</button>
        ${(generated || heading.canUse) && kohaParentOrigin ? '<button type="button" class="use-new">Usar como nuevo</button>' : ''}
      </div>
      <div class="local-results" aria-live="polite"></div>
    </article>`).join('') + '</div>';
  [...output.querySelectorAll('.topic-card')].forEach((card, index) => {
    const heading = headings[index];
    card.querySelector('.search-local').addEventListener('click', () => showLocalMatches(card, heading).catch(() => {}));
    card.querySelector('.use-new')?.addEventListener('click', async (event) => {
      event.target.disabled = true;
      try {
        const matches = await showLocalMatches(card, heading, true);
        if (version !== viewVersion) return;
        if (matches.length && !window.confirm('Ya existe un encabezamiento coincidente. Recomendamos importar la forma usada. ¿Deseas continuar con esta propuesta?')) return;
        sendHeading(heading);
      } catch { /* The inline error remains visible. */ }
      finally { event.target.disabled = false; }
    });
    if (generated) showLocalMatches(card, heading, true).catch(() => {});
  });
}

function marcAuthority(item) {
  const source = String(item.source || "");
  const map = {
    LCSH: { ind2: "0", sourceCode: "" },
    BNE: { ind2: "7", sourceCode: "embne" },
    UNESCO: { ind2: "7", sourceCode: "unescot" },
    EuroVoc: { ind2: "7", sourceCode: "eurovoc" },
    VIAF: { ind2: "4", sourceCode: "" },
    Wikidata: { ind2: "7", sourceCode: "wikidata" },
    DBpedia: { ind2: "4", sourceCode: "" }
  };
  return {
    label: item.label || item.term || "",
    uri: item.uri || item.url || "",
    source,
    ind1: " ",
    ind2: (map[source] || {}).ind2 || "4",
    ...(item.localHeading ? { localHeading: item.localHeading, subfields: [{ code: "a", value: item.localHeading.main }, ...item.localHeading.subdivisions] } : {}),
    sourceCode: (map[source] || {}).sourceCode || ""
  };
}

function useAuthority(item) {
  if (!kohaParentOrigin || window.parent === window) return;
  window.parent.postMessage({
    type: "TOPIC_AUTHORITY_USE",
    version: 1,
    authority: marcAuthority(item)
  }, kohaParentOrigin);
}

async function searchOneTopic(topic) {
  if (!topic) return;
  const previous = generatedHeadings.get(topic)
    || (kohaContext?.existingHeading && headingLabel(kohaContext.existingHeading) === topic ? kohaContext.existingHeading : null);
  const heading = previous
    ? { ...previous, label: topic, canUse: previous.subdivisions.length <= 2 }
    : { main: topic.split(/\s*--\s*/)[0], label: topic, subdivisions: [], canUse: !topic.includes('--') };
  renderTopics([heading]);
  await showLocalMatches(output.querySelector('.topic-card'), heading).catch(() => {});
}

function receiveKohaContext(context, origin) {
  const signature = JSON.stringify(context);
  if (kohaParentOrigin === origin && JSON.stringify(kohaContext) === signature) return;
  kohaParentOrigin = origin;
  kohaContext = context || {};
  viewVersion++;
  const existing = String(kohaContext.existingMain || kohaContext.existingTerm?.split(/\s*--\s*/)[0] || '').trim();
  analyzeKohaBtn.hidden = !String(kohaContext.marcText || '').trim();
  analyzeKohaBtn.textContent = existing ? 'Sugerir hasta 2 subdivisiones' : 'Sugerir un encabezamiento desde MARC';
  authorityTermInput.value = kohaContext.existingTerm || existing;
  updateCatalogLinks();
  output.textContent = 'Busca este encabezamiento o uno similar en el historial JSON.';
  marcOutput.textContent = 'Aquí aparecerá un solo encabezamiento con hasta dos subdivisiones.';
  pdfOutput.textContent = 'Aquí aparecerán las cinco propuestas del PDF.';
  kohaContextMessage.textContent = existing ? `650$a: ${existing}. Se conserva el encabezamiento principal y se sugieren hasta dos subdivisiones en total, no cinco alternativas.` : '650$a vacío: se propondrá un solo encabezamiento con hasta dos subdivisiones. Las cinco propuestas se generan únicamente desde un PDF.';
}

function updateCatalogLinks() {
  document.getElementById('catalogLinks').innerHTML = catalogLinks(authorityTermInput.value.trim());
}
authorityTermInput.addEventListener('input', updateCatalogLinks);

async function analyzeText(sourceText, existingMain = "", mode = "pdf", output = pdfOutput) {
  if (!sourceText) {
    output.textContent = "No hay texto para analizar.";
    return;
  }

  const version = viewVersion;
  const request = (requestsByOutput.get(output) || 0) + 1;
  requestsByOutput.set(output, request);
  output.textContent = mode === 'pdf' ? 'Generando cinco temas desde el PDF...' : 'Preparando un encabezamiento con hasta dos subdivisiones desde MARC...';

  try {
    const data = await requestTopics(sourceText, existingMain, mode);
    if (version !== viewVersion || requestsByOutput.get(output) !== request) return;
    const topics = topicsFromResponse(data);
    if (!topics.length) {
      output.textContent = "No se pudieron identificar candidatos temáticos en el contenido proporcionado.";
      return;
    }

    data.headings.forEach(heading => generatedHeadings.set(heading.label, heading));
    renderTopics(data.headings, true, output);
  } catch (error) {
    if (version === viewVersion && requestsByOutput.get(output) === request) output.textContent = `Error: ${error.message}`;
  }
}

processPdfBtn.addEventListener("click", async () => {
  const output = pdfOutput;
  const file = pdfInput.files?.[0];
  if (!file) {
    output.textContent = "Selecciona un archivo PDF primero.";
    alert("Selecciona un PDF primero.");
    return;
  }

  output.textContent = "Extrayendo texto del PDF...";
  const version = viewVersion;
  processPdfBtn.disabled = true;

  try {
    const pdfText = await extractTextFromPdf(file);
    if (version !== viewVersion) return;
    if (!pdfText) {
      output.textContent = "El PDF no contiene texto legible.";
      return;
    }
    await analyzeText(pdfText, '', 'pdf', pdfOutput);
  } catch (error) {
    if (version === viewVersion) output.textContent = `Error leyendo PDF: ${error.message}`;
  } finally {
    processPdfBtn.disabled = false;
  }
});

analyzeKohaBtn?.addEventListener("click", async () => {
  analyzeKohaBtn.disabled = true;
  try { await analyzeText(String(kohaContext?.marcText || ''), String(kohaContext?.existingMain || kohaContext?.existingTerm?.split(/\s*--\s*/)[0] || ''), 'marc', marcOutput); }
  finally { analyzeKohaBtn.disabled = false; }
});
searchAuthorityBtn?.addEventListener("click", () => {
  const term = authorityTermInput.value.trim();
  if (!term) {
    authorityTermInput.focus();
    output.textContent = "Escribe un término de materia para buscarlo.";
    return;
  }
  searchOneTopic(term);
});
authorityTermInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchAuthorityBtn.click();
  }
});

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.type !== "TOPIC_AUTHORITY_KOHA_CONTEXT") return;
  receiveKohaContext(event.data.context, event.origin);
});

if (window.parent !== window) {
  window.parent.postMessage({ type: "TOPIC_AUTHORITY_READY", version: 1 }, "*");
}
