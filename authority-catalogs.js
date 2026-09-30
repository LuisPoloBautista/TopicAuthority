// Public vocabulary lookups only. This module never calls a generation service.
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const catalogSources = ['UNESCO', 'Wikidata', 'LCSH'];

export function searchVariants(term) {
  const main = term.split(/\s*--\s*/)[0].trim();
  const words = main.split(/\s+/).filter(word => word.length > 2 && !/^(de|del|las|los|para|con)$/i.test(word));
  return [...new Set([main, words[0]].filter(Boolean))];
}

async function requestJson(url, fetcher, signal) {
  const response = await fetcher(url, { signal, headers: { Accept: 'application/json', 'User-Agent': 'TopicAuthority/1.0 (library vocabulary lookup)' } });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  if (!data || data.error) throw new Error('Catálogo no disponible');
  return data;
}

async function englishVariants(term, fetcher, signal) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({ action: 'wbsearchentities', search: term, language: 'es', uselang: 'en', format: 'json', limit: '5', type: 'item' });
  const data = await requestJson(url, fetcher, signal);
  if (!Array.isArray(data.search)) throw new Error('Respuesta Wikidata inválida');
  // Require a matching Spanish label/alias and an explicitly English display label.
  // Search rank alone is not evidence that two concepts are equivalent.
  return [...new Set(data.search.filter(row =>
    row.match?.language === 'es' && typeof row.match.text === 'string' &&
    normalize(row.match.text) === normalize(term) &&
    row.display?.label?.language === 'en'
  ).map(row => row.display.label.value).filter(label =>
    typeof label === 'string' && label.trim() && label.length <= 300 && normalize(label) !== normalize(term)
  ))].slice(0, 3);
}

async function lookup(source, term, fetcher, signal) {
  let url;
  if (source === 'UNESCO') {
    url = new URL('https://vocabularies.unesco.org/rest/v1/search');
    url.search = new URLSearchParams({ vocab: 'unesco', query: term + '*', lang: 'es', maxhits: '5' });
  } else if (source === 'Wikidata') {
    url = new URL('https://www.wikidata.org/w/api.php');
    url.search = new URLSearchParams({ action: 'wbsearchentities', search: term, language: 'es', uselang: 'es', format: 'json', limit: '5', type: 'item' });
  } else {
    url = new URL('https://id.loc.gov/authorities/subjects/suggest/');
    url.search = new URLSearchParams({ q: term, count: '5' });
  }
  const data = await requestJson(url, fetcher, signal);
  let rows;
  if (source === 'UNESCO') {
    if (!Array.isArray(data.results)) throw new Error('Respuesta UNESCO inválida');
    rows = data.results.map(row => ({ label: row.prefLabel, uri: row.uri, description: row.altLabel || '' }));
  } else if (source === 'Wikidata') {
    if (!Array.isArray(data.search)) throw new Error('Respuesta Wikidata inválida');
    rows = data.search.map(row => ({ label: row.label, uri: row.concepturi, description: row.description || '' }));
  } else {
    if (!Array.isArray(data) || !Array.isArray(data[1]) || !Array.isArray(data[3])) throw new Error('Respuesta LCSH inválida');
    rows = data[1].map((label, i) => ({ label, uri: data[3][i], description: typeof data[2]?.[i] === 'string' ? data[2][i] : '' }));
  }
  const hosts = { UNESCO: 'vocabularies.unesco.org', Wikidata: 'www.wikidata.org', LCSH: 'id.loc.gov' };
  const unique = new Map();
  for (const row of rows) {
    try {
      const uri = new URL(row.uri);
      if (!['http:', 'https:'].includes(uri.protocol) || uri.hostname !== hosts[source] || typeof row.label !== 'string' || !row.label.trim()) continue;
      // Compound LCSH labels cannot safely be inferred as a single MARC $a.
      unique.set(row.uri, { ...row, source, canImport: !row.label.includes('--') });
    } catch { /* Discard malformed identifiers from upstream. */ }
  }
  return [...unique.values()].slice(0, 5);
}

export function createCatalogSearch({ fetcher = fetch, timeoutMs = 4500, lcshTimeoutMs = timeoutMs * 2, ttlMs = 600000 } = {}) {
  const cache = new Map();
  return async function search(source, term) {
    if (!catalogSources.includes(source) || typeof term !== 'string' || !term.trim() || term.length > 300) {
      throw Object.assign(new Error('Fuente o término inválido (máximo 300 caracteres).'), { status: 400 });
    }
    term = term.trim();
    const key = JSON.stringify([source, term.toLowerCase()]);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.promise;
    const promise = (async () => {
      const signal = AbortSignal.timeout(source === 'LCSH' ? lcshTimeoutMs : timeoutMs);
      const queries = [];
      const attempt = async (query, expandedFrom) => {
        if (queries.some(previous => normalize(previous) === normalize(query))) return null;
        queries.push(query);
        const results = await lookup(source, query, fetcher, signal);
        if (!results.length) return null;
        return { source, queries, results: results.map(row => ({ ...row, query,
          ...(expandedFrom ? { expandedFrom, expansionSource: 'Wikidata' } : {}),
          match: !expandedFrom && normalize(row.label) === normalize(term) ? 'exact' : 'related'
        })) };
      };
      for (const query of searchVariants(term)) {
        const direct = await attempt(query);
        if (direct && (source !== 'LCSH' || direct.results.some(row => normalize(row.label) === normalize(query)))) return direct;
        if (source === 'LCSH') {
          for (const english of await englishVariants(query, fetcher, signal)) {
            const expanded = await attempt(english, query);
            if (expanded) return expanded;
          }
        }
        if (direct) return direct;
      }
      return { source, queries, results: [] };
    })();
    cache.set(key, { promise, expires: Date.now() + ttlMs });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    try { return await promise; }
    catch (error) { cache.delete(key); throw error; }
  };
}
