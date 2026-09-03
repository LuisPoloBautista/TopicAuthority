import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, '.env');
if (existsSync(envPath)) {
  const envFile = readFileSync(envPath, 'utf-8');
  envFile.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length && !process.env[key.trim()]) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_RESPONSES_URL = process.env.OPENAI_RESPONSES_URL || 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const AUTHORITY_CLI_TIMEOUT_MS = Number(process.env.AUTHORITY_CLI_TIMEOUT_MS || 45000);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowAll = allowedOrigins.includes('*');
  if (allowAll || (origin && allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname)));

function buildTopicPrompt(text) {
  return `Eres un experto catalogador bibliotecario. Analiza el siguiente contenido y genera 10 encabezamientos de materia en formato LEMB (Lista de Encabezamientos de Materia para Bibliotecas).

Para cada tema, usa esta estructura cuando aplique:
- Encabezamiento principal
- -- Subdivision de materia
- -- Subdivision geografica
- -- Subdivision cronologica
- -- Subdivision de forma

Devuelve UNICAMENTE un arreglo JSON de strings, sin markdown ni explicaciones. Cada string debe contener un encabezamiento completo.

Texto a analizar:
${text}`;
}

function parseTopics(rawText) {
  const cleaned = String(rawText || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map(item => String(item.tema || item.topic || item).trim()).filter(Boolean);
    }
  } catch {
    // Fallback to line-based parsing below.
  }

  return cleaned
    .split(/\r?\n/)
    .map(line => line.replace(/^\d+[\.)]\s*/, '').trim())
    .filter(Boolean);
}

function formatTopicsAsLemb(topics) {
  return topics.map(topic => topic.replace(/\s+--\s+/g, '\n-- ')).join('\n\n');
}

async function generateTopics(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured on the server');
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [{ role: 'user', content: [{ type: 'input_text', text: buildTopicPrompt(text) }] }],
      max_output_tokens: 2500,
      store: false,
    }),
    signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS || 120000)),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI API error: ${response.status}`);
  }

  const outputText = data.output_text
    || (data.output || [])
      .flatMap(item => item.content || [])
      .map(content => content.text || '')
      .join('\n')
      .trim();
  const topics = parseTopics(outputText);
  return { result: formatTopicsAsLemb(topics), topics, raw: outputText };
}

async function searchAuthorities(topic) {
  const fallbackPayload = {
    topic,
    queries: [{ term: topic, role: 'encabezamiento principal', priority: 0 }],
    sources: [
      { source: 'Wikidata', status: 'error', count: 0 },
      { source: 'BNE', status: 'error', count: 0 },
      { source: 'DBpedia', status: 'error', count: 0 },
      { source: 'LCSH', status: 'error', count: 0 },
      { source: 'UNESCO', status: 'error', count: 0 },
      { source: 'VIAF', status: 'error', count: 0 },
    ],
    authorities: [],
    partial: true,
  };

  try {
    const { stdout, stderr } = await execFileAsync(
      PYTHON_BIN,
      ['-m', 'authority_search.authority_manager', topic],
      {
        cwd: __dirname,
        timeout: AUTHORITY_CLI_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: process.env,
      },
    );
    if (stderr) console.warn(stderr.trim());
    return JSON.parse(stdout);
  } catch (error) {
    if (error.stderr) console.warn(String(error.stderr).trim());
    if (error.stdout) {
      const jsonStart = String(error.stdout).indexOf('{');
      if (jsonStart >= 0) {
        return JSON.parse(String(error.stdout).slice(jsonStart));
      }
    }
    return fallbackPayload;
  }
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    provider: 'openai',
    model: OPENAI_MODEL,
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    authoritySearch: true,
  });
});

app.post('/api/topics', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    const payload = await generateTopics(text);
    res.json(payload);
  } catch (error) {
    console.error('Error in /api/topics:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get(['/topics/:topic/authorities', '/api/topics/:topic/authorities'], async (req, res) => {
  try {
    const topic = req.params.topic;
    if (!topic) return res.status(400).json({ error: 'Topic is required' });
    const payload = await searchAuthorities(topic);
    res.json(payload);
  } catch (error) {
    console.error('Error in authority search:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`OpenAI model: ${OPENAI_MODEL}`);
});
