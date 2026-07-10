const pdfInput = document.getElementById("pdfInput");
const processPdfBtn = document.getElementById("processPdfBtn");
const textInput = document.getElementById("textInput");
const processTextBtn = document.getElementById("processTextBtn");
const output = document.getElementById("output");
const dropZone = document.getElementById("dropZone");
const sidebar = document.getElementById("infoSidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

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
        <strong>Equivalencias encontradas:</strong>
        <div class="authority-results">Consultando catálogos de autoridad...</div>
      </div>
    </article>
  `).join("");
  output.innerHTML = `<div class="topic-list">${html}</div>`;
}

function renderAuthorities(container, authorities, sources = []) {
  if (!authorities.length && !sources.length) {
    container.innerHTML = "<p class='authority-empty'>No se encontraron equivalencias directas.</p>";
    return;
  }

  const bySource = authorities.reduce((acc, item) => {
    const source = item.source || "Fuente";
    acc[source] ||= [];
    acc[source].push(item);
    return acc;
  }, {});

  const resultHtml = Object.entries(bySource).map(([source, items]) => `
    <div class="authority-source">
      <h3>${escapeHtml(source)}</h3>
      <ul>
        ${items.map(item => `
          <li>
            <a href="${escapeHtml(item.url || item.uri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label || item.term)}</a>
            ${item.type ? `<span class="authority-type">${escapeHtml(item.type)}</span>` : ""}
            ${item.component || item.query ? `<div class="authority-match">Coincidencia: ${escapeHtml(item.component || "consulta")} ${item.query ? `(${escapeHtml(item.query)})` : ""}</div>` : ""}
            ${item.description || item.abstract ? `<p>${escapeHtml(item.description || item.abstract)}</p>` : ""}
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
        <h3>${escapeHtml(source.source)}</h3>
        <p>${source.status === "error" ? "El catálogo no respondió durante esta consulta." : "Sin coincidencias directas para el encabezamiento consultado."}</p>
      </div>
    `).join("");

  container.innerHTML = resultHtml + statusHtml;
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

  output.textContent = "Analizando con OpenAI y preparando búsqueda de autoridades...";

  try {
    const data = await requestTopics(sourceText);
    const topics = topicsFromResponse(data);
    if (!topics.length) {
      output.textContent = "No se obtuvo ningún tema de la API.";
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
