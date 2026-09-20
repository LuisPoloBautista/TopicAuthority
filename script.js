import { headingLabel } from "./headings.js";
const pdfInput = document.getElementById("pdfInput");
const processPdfBtn = document.getElementById("processPdfBtn");
const output = document.getElementById("output");
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

async function requestTopics(text, existingMain = "") {
  const res = await fetch("/api/topics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, existingMain }),
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

async function localMatches(term) {
  const res = await fetch(`/api/headings?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'No se pudo consultar el historial.');
  return data.headings;
}

function sendHeading(heading) {
  useAuthority({ ...heading, label: headingLabel(heading), source: 'Local', localHeading: heading });
}

async function showLocalMatches(card, heading, automatic = false) {
  const container = card.querySelector('.local-results');
  container.textContent = 'Consultando historial...';
  try {
    const matches = await localMatches(heading.label);
    // A full heading may be new even when its main term has previous subdivisions.
    const related = matches.length ? matches : await localMatches(heading.main);
    container.replaceChildren();
    const message = document.createElement('p');
    message.className = related.length ? 'duplicate-warning' : '';
    message.textContent = related.length
      ? `${automatic ? 'Advertencia: ' : ''}Ya hay ${related.length} encabezamiento(s) coincidente(s) en el historial. Revisa e importa la forma usada para normalizarla.`
      : 'No hay coincidencias en el historial. Puedes usarlo como nuevo.';
    container.append(message);
    for (const match of related) {
      const row = document.createElement('div');
      row.className = 'history-match';
      const label = document.createElement('span');
      label.textContent = `${match.label} — ${match.uses} registro(s) · ${match.exact ? 'Coincidencia exacta' : 'Encabezamiento relacionado'}`;
      row.append(label);
      if (kohaParentOrigin) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Importar encabezamiento usado';
        button.addEventListener('click', () => sendHeading(match));
        row.append(button);
      }
      container.append(row);
    }
    card.dataset.historyChecked = 'true';
    return related;
  } catch (error) {
    container.textContent = error.message + ' Reintenta la búsqueda antes de usarlo.';
    throw error;
  }
}

function renderTopics(headings, generated = false) {
  const version = viewVersion;
  output.innerHTML = '<div class="topic-list">' + headings.map((heading, index) => `
    <article class="topic-card">
      <div class="topic-title"><span class="topic-number">${index + 1}</span><span>${escapeHtml(heading.label)}</span></div>
      ${generated ? `<p>Candidato de IA · ${escapeHtml(heading.subdivisions.map(p => '$' + p.code + ' ' + p.value).join(' · '))}</p>` : ''}
      <div class="koha-actions">
        <button type="button" class="search-local">Buscar en el historial</button>
        ${(generated || heading.canUse) && kohaParentOrigin ? '<button type="button" class="use-new">Usar como nuevo</button>' : ''}
        <button type="button" class="search-external">Consultar autoridades en la app</button>
      </div>
      <div class="catalog-links">${catalogLinks(heading.label)}</div>
      <div class="local-results" aria-live="polite"></div>
      <div class="authority-results"></div>
    </article>`).join('') + '</div>';
  [...output.querySelectorAll('.topic-card')].forEach((card, index) => {
    const heading = headings[index];
    card.querySelector('.search-local').addEventListener('click', () => showLocalMatches(card, heading).catch(() => {}));
    card.querySelector('.search-external').addEventListener('click', async (event) => {
      event.target.disabled = true;
      await loadAuthoritiesForTopic(heading.label, card);
      event.target.disabled = false;
    });
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

function sourcePriority(source) {
  return ({ LCSH: 0, BNE: 1, UNESCO: 2, EuroVoc: 3, Wikidata: 4, VIAF: 5, DBpedia: 6 })[source] ?? 99;
}

function sourceDisplayName(source) {
  return source === "LCSH" ? "Library of Congress Subject Headings (LCSH)" : source;
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

function renderAuthorities(container, authorities, sources = []) {
  if (!authorities.length && !sources.length) {
    container.innerHTML = "<p class='authority-empty'>No se encontró una autoridad suficientemente cercana. Prueba un término más general o una variante.</p>";
    return;
  }

  authorities.sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source));
  const bySource = authorities.reduce((acc, item) => {
    const source = item.source || "Fuente";
    acc[source] ||= [];
    acc[source].push(item);
    return acc;
  }, {});

  const resultHtml = Object.entries(bySource).map(([source, items]) => `
    <div class="authority-source">
      <h3>${escapeHtml(sourceDisplayName(source))}</h3>
      <ul>
        ${items.map(item => `
          <li>
            <a href="${escapeHtml(item.url || item.uri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label || item.term)}</a>
            ${item.type ? `<span class="authority-type">${escapeHtml(item.type)}</span>` : ""}
            ${item.match ? `<span class="authority-match-badge authority-match-${escapeHtml(item.match)}">${escapeHtml({exact:"Coincidencia exacta",label:"Término preferido",partial:"Coincidencia parcial",alias:"Variante autorizada",fuzzy:"Coincidencia aproximada"}[item.match] || "Relacionado")}</span>` : ""}
            ${item.confidence ? `<span class="authority-score">${escapeHtml(item.confidence)}%</span>` : ""}
            ${item.component || item.query ? `<div class="authority-match">Coincidencia: ${escapeHtml(item.component || "consulta")} ${item.query ? `(${escapeHtml(item.query)})` : ""}</div>` : ""}
            ${item.description || item.abstract ? `<p>${escapeHtml(item.description || item.abstract)}</p>` : ""}
            ${kohaParentOrigin ? `<button type="button" class="use-authority-btn">Usar autoridad</button>` : ""}
          </li>
        `).join("")}
      </ul>
    </div>
  `).join("");

  const sourcesWithResults = new Set(Object.keys(bySource));
  const statusHtml = sources
    .filter(source => !sourcesWithResults.has(source.source) && source.status !== "ok")
    .map(source => `
      <div class="authority-source authority-source-empty">
        <h3>${escapeHtml(sourceDisplayName(source.source))}</h3>
        <p>${source.status === "error" ? "La fuente no estuvo disponible durante esta consulta." : "No encontró una autoridad con relevancia suficiente."}</p>
      </div>
    `).join("");

  container.innerHTML = resultHtml + statusHtml;
  if (kohaParentOrigin) {
    const orderedItems = Object.values(bySource).flat();
    container.querySelectorAll(".use-authority-btn").forEach((button, index) => {
      button.addEventListener("click", () => useAuthority(orderedItems[index]));
    });
  }
}

async function searchOneTopic(topic) {
  if (!topic) return;
  viewVersion++;
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
  analyzeKohaBtn.textContent = existing ? 'Sugerir subdivisiones desde los campos MARC' : 'Sugerir 5 encabezamientos desde los campos MARC';
  authorityTermInput.value = kohaContext.existingTerm || existing;
  updateCatalogLinks();
  output.textContent = existing ? 'Busca este encabezamiento en el historial o solicita subdivisiones basadas en el registro.' : 'Genera encabezamientos a partir de los campos MARC o de un PDF.';
  kohaContextMessage.textContent = existing ? `650$a: ${existing}. Se conservará el encabezamiento principal al sugerir subdivisiones.` : '650$a vacío: se propondrán cinco encabezamientos con hasta dos subdivisiones.';
}

function updateCatalogLinks() {
  document.getElementById('catalogLinks').innerHTML = catalogLinks(authorityTermInput.value.trim());
}
authorityTermInput.addEventListener('input', updateCatalogLinks);

async function loadAuthoritiesForTopic(topic, card) {
  const container = card.querySelector(".authority-results");
  container.textContent = 'Consultando catálogos de autoridades...';
  try {
    const res = await fetch(`/api/topics/${encodeURIComponent(topic)}/authorities`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || res.statusText);
    }
    const data = await res.json();
    renderAuthorities(container, data.authorities || [], data.sources || []);
  } catch (error) {
    container.innerHTML = `<p class="authority-error">No se pudieron consultar autoridades en este momento. Intenta de nuevo más tarde.</p>`;
  }
}

async function analyzeText(sourceText, existingMain = "") {
  if (!sourceText) {
    output.textContent = "No hay texto para analizar.";
    return;
  }

  const version = ++viewVersion;
  output.textContent = "Generando cinco propuestas con hasta dos subdivisiones...";

  try {
    const data = await requestTopics(sourceText, existingMain);
    if (version !== viewVersion) return;
    const topics = topicsFromResponse(data);
    if (!topics.length) {
      output.textContent = "No se pudieron identificar candidatos temáticos en el contenido proporcionado.";
      return;
    }

    data.headings.forEach(heading => generatedHeadings.set(heading.label, heading));
    renderTopics(data.headings, true);
  } catch (error) {
    if (version === viewVersion) output.textContent = `Error: ${error.message}`;
  }
}

processPdfBtn.addEventListener("click", async () => {
  const file = pdfInput.files?.[0];
  if (!file) {
    output.textContent = "Selecciona un archivo PDF primero.";
    alert("Selecciona un PDF primero.");
    return;
  }

  output.textContent = "Extrayendo texto del PDF...";
  const version = ++viewVersion;
  const existingMain = String(kohaContext?.existingMain || kohaContext?.existingTerm?.split(/\s*--\s*/)[0] || '');
  processPdfBtn.disabled = true;

  try {
    const pdfText = await extractTextFromPdf(file);
    if (version !== viewVersion) return;
    if (!pdfText) {
      output.textContent = "El PDF no contiene texto legible.";
      return;
    }
    await analyzeText(pdfText, existingMain);
  } catch (error) {
    if (version === viewVersion) output.textContent = `Error leyendo PDF: ${error.message}`;
  } finally {
    processPdfBtn.disabled = false;
  }
});

analyzeKohaBtn?.addEventListener("click", async () => {
  analyzeKohaBtn.disabled = true;
  try { await analyzeText(String(kohaContext?.marcText || ''), String(kohaContext?.existingMain || kohaContext?.existingTerm?.split(/\s*--\s*/)[0] || '')); }
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
