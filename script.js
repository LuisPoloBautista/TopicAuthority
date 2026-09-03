const pdfInput = document.getElementById("pdfInput");
const processPdfBtn = document.getElementById("processPdfBtn");
const textInput = document.getElementById("textInput");
const processTextBtn = document.getElementById("processTextBtn");
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

async function requestTopics(text) {
  const res = await fetch("/api/topics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
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

function renderTopics(topics) {
  const html = topics.map((topic, index) => `
    <article class="topic-card" data-topic="${escapeHtml(topic)}">
      <div class="topic-title">
        <span class="topic-number">${index + 1}</span>
        <span>${escapeHtml(topic)}</span>
      </div>
      <div class="authority-section">
        <strong>Comprobación en vocabularios controlados:</strong>
        <div class="authority-results">Consultando fuentes de autoridad...</div>
      </div>
    </article>
  `).join("");
  output.innerHTML = `<div class="topic-list">${html}</div>`;
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
    ind2: (map[source] || {}).ind2 || "7",
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
  renderTopics([topic]);
  await loadAuthorities([topic]);
}

function receiveKohaContext(context, origin) {
  kohaParentOrigin = origin;
  kohaContext = context || {};
  const existing = String(kohaContext.existingTerm || "").trim();
  analyzeKohaBtn.hidden = !String(kohaContext.marcText || "").trim();
  authorityTermInput.value = existing;
  kohaContextMessage.textContent = existing
    ? `Koha proporcionó el término de la etiqueta 650: ${existing}`
    : "Koha proporcionó el contexto bibliográfico. Escriba un término o genere sugerencias desde los campos MARC.";
  if (existing) searchOneTopic(existing);
}

async function loadAuthoritiesForTopic(topic, card) {
  const container = card.querySelector(".authority-results");
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

async function loadAuthorities(topics) {
  const cards = [...document.querySelectorAll(".topic-card")];
  for (let index = 0; index < cards.length; index++) {
    await loadAuthoritiesForTopic(topics[index], cards[index]);
    await new Promise(resolve => setTimeout(resolve, 350));
  }
}

async function analyzeText(sourceText) {
  if (!sourceText) {
    output.textContent = "No hay texto para analizar.";
    return;
  }

  output.textContent = "Identificando conceptos y verificándolos en vocabularios de autoridad...";

  try {
    const data = await requestTopics(sourceText);
    const topics = topicsFromResponse(data);
    if (!topics.length) {
      output.textContent = "No se pudieron identificar candidatos temáticos en el contenido proporcionado.";
      return;
    }

    renderTopics(topics);
    await loadAuthorities(topics);
  } catch (error) {
    output.textContent = `Error: ${error.message}`;
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

  try {
    const pdfText = await extractTextFromPdf(file);
    if (!pdfText) {
      output.textContent = "El PDF no contiene texto legible.";
      return;
    }
    await analyzeText(pdfText);
  } catch (error) {
    output.textContent = `Error leyendo PDF: ${error.message}`;
  }
});

processTextBtn.addEventListener("click", async () => {
  const text = textInput.value.trim();
  if (!text) {
    output.textContent = "Ingresa texto para analizar.";
    alert("Ingresa texto primero.");
    return;
  }
  await analyzeText(text);
});

analyzeKohaBtn?.addEventListener("click", () => analyzeText(String(kohaContext?.marcText || "")));
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
