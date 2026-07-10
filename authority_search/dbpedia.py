import os
import unicodedata
import json
import re
import urllib.parse

from .http_utils import DEFAULT_LIMIT, compact, get_json, sparql_json, strip_markup, text_match

DBPEDIA_LOOKUP_URL = os.getenv("DBPEDIA_LOOKUP_URL", "https://lookup.dbpedia.org/api/search")
DBPEDIA_ES_SPARQL_URL = os.getenv("DBPEDIA_ES_SPARQL_URL", "https://es.dbpedia.org/sparql")
DBPEDIA_SPARQL_URL = os.getenv("DBPEDIA_SPARQL_URL", "https://dbpedia.org/sparql")
DBPEDIA_EXACT_HINTS = {
    "botany": ("Botany", "AcademicSubject"),
    "typhus": ("Typhus", "Disease"),
}


def has_dbpedia_exact_hint(term):
    return _ascii_fold(term) in DBPEDIA_EXACT_HINTS


def _first(value):
    if isinstance(value, list):
        return value[0] if value else ""
    return value or ""


def _token_overlap(query, label):
    stopwords = {"de", "del", "la", "el", "los", "las", "y", "en", "the", "of", "and"}
    query_tokens = {token for token in _ascii_fold(query).split() if len(token) > 3 and token not in stopwords}
    label_tokens = {token for token in _ascii_fold(label).split() if len(token) > 3 and token not in stopwords}
    if not query_tokens:
        return 0, 0
    return len(query_tokens & label_tokens) / len(query_tokens), len(query_tokens)


def _ascii_fold(value):
    return "".join(
        char for char in unicodedata.normalize("NFKD", value.lower())
        if not unicodedata.combining(char)
    )


def _looks_english_resource_term(term):
    folded = _ascii_fold(term)
    return bool(re.fullmatch(r"[a-z][a-z0-9 ]{2,80}", folded))


def _direct_resource(term):
    folded = _ascii_fold(term)
    if folded not in DBPEDIA_EXACT_HINTS:
        return []
    title, resource_type = DBPEDIA_EXACT_HINTS[folded]
    uri = f"http://dbpedia.org/resource/{urllib.parse.quote(title)}"
    return [
        {
            "source": "DBpedia",
            "label": title.replace("_", " "),
            "uri": uri,
            "url": uri,
            "abstract": "",
            "type": resource_type,
            "match": "exact",
            "_score": 95,
        }
    ]


def _is_category(uri):
    return "/Categoría:" in uri or "/Category:" in uri


def _score_label(term, label, uri=""):
    match = text_match(term, label)
    score = 100 if match == "exact" else 80 if match == "partial" else 40
    if _is_category(uri):
        score -= 60
    return score, match


def _search_dbpedia_global(term, limit):
    term_literal = json.dumps(term.lower(), ensure_ascii=False)
    query = f"""
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dbo: <http://dbpedia.org/ontology/>
SELECT ?uri ?label ?abstract ?description ?type WHERE {{
  ?uri rdfs:label ?label .
  FILTER(lang(?label) = "es" || lang(?label) = "en")
  FILTER(CONTAINS(LCASE(STR(?label)), {term_literal}))
  OPTIONAL {{ ?uri dbo:abstract ?abstract . FILTER(lang(?abstract) = "es") }}
  OPTIONAL {{ ?uri dbo:description ?description . FILTER(lang(?description) = "es") }}
  OPTIONAL {{ ?uri a ?type . FILTER(STRSTARTS(STR(?type), "http://dbpedia.org/ontology/")) }}
  FILTER(!CONTAINS(STR(?uri), "/Category:"))
  FILTER(!CONTAINS(STR(?uri), "/Categoría:"))
}}
LIMIT {int(limit * 4)}
"""
    data = sparql_json(DBPEDIA_SPARQL_URL, query, timeout=float(os.getenv("DBPEDIA_SPARQL_TIMEOUT_SECONDS", "3")))
    if data is None:
        return []

    results = []
    for row in data.get("results", {}).get("bindings", []):
        label = row.get("label", {}).get("value", "")
        uri = row.get("uri", {}).get("value", "")
        type_uri = row.get("type", {}).get("value", "")
        score, match = _score_label(term, label, uri)
        results.append(
            {
                "source": "DBpedia",
                "label": compact(label, 180),
                "uri": uri,
                "url": uri,
                "abstract": compact(
                    row.get("description", {}).get("value", "")
                    or row.get("abstract", {}).get("value", "")
                ),
                "type": type_uri.rsplit("/", 1)[-1] if type_uri else "Concepto",
                "match": match,
                "_score": score,
            }
        )
    results.sort(key=lambda item: item.get("_score", 0), reverse=True)
    return results[:limit]


def _search_dbpedia_es(term, limit):
    term_literal = json.dumps(term.lower(), ensure_ascii=False)
    query = f"""
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dbo: <http://dbpedia.org/ontology/>
SELECT ?uri ?label ?abstract ?type WHERE {{
  ?uri rdfs:label ?label .
  FILTER(lang(?label) = "es")
  FILTER(CONTAINS(LCASE(STR(?label)), {term_literal}))
  OPTIONAL {{ ?uri dbo:abstract ?abstract . FILTER(lang(?abstract) = "es") }}
  OPTIONAL {{ ?uri a ?type . FILTER(STRSTARTS(STR(?type), "http://dbpedia.org/ontology/")) }}
  FILTER(!CONTAINS(STR(?uri), "/Category:"))
  FILTER(!CONTAINS(STR(?uri), "/Categoría:"))
}}
LIMIT {int(limit * 4)}
"""
    data = sparql_json(DBPEDIA_ES_SPARQL_URL, query, timeout=float(os.getenv("DBPEDIA_SPARQL_TIMEOUT_SECONDS", "3")))
    if data is None:
        return []

    results = []
    for row in data.get("results", {}).get("bindings", []):
        label = row.get("label", {}).get("value", "")
        uri = row.get("uri", {}).get("value", "")
        if _is_category(uri):
            continue
        type_uri = row.get("type", {}).get("value", "")
        score, match = _score_label(term, label, uri)
        results.append(
            {
                "source": "DBpedia",
                "label": compact(label, 180),
                "uri": uri,
                "url": uri,
                "abstract": compact(row.get("abstract", {}).get("value", "")),
                "type": type_uri.rsplit("/", 1)[-1] if type_uri else "Concepto",
                "match": match,
                "_score": score,
            }
        )
    results.sort(key=lambda item: item.get("_score", 0), reverse=True)
    return results[:limit]


def _search_dbpedia_lookup(term, limit):
    data = get_json(
        DBPEDIA_LOOKUP_URL,
        {
            "query": term,
            "maxResults": limit,
            "format": "JSON",
        },
        timeout=float(os.getenv("DBPEDIA_LOOKUP_TIMEOUT_SECONDS", "4")),
    )
    if data is None:
        raise RuntimeError("DBpedia no respondio")
    docs = (data or {}).get("docs") or (data or {}).get("results") or []
    results = []

    for item in docs:
        raw_label = _first(item.get("label") or item.get("Label"))
        label = compact(strip_markup(raw_label), 180)
        uri = _first(item.get("resource") or item.get("URI") or item.get("uri"))
        if _is_category(uri):
            continue
        abstract = _first(item.get("comment") or item.get("Description") or item.get("abstract"))
        abstract_lc = abstract.lower()
        if any(noise in abstract_lc for noise in ["retail", "hierbería", "botica"]):
            continue
        match = text_match(term, label)
        overlap, token_count = _token_overlap(term, label)
        highlighted = "<B>" in raw_label or "<b>" in raw_label
        translated_single_term = highlighted and token_count == 1
        if match == "related" and not translated_single_term and not (highlighted and overlap >= 0.6) and overlap < 0.8:
            continue
        score = _score_label(term, label, uri)[0]
        if score < 70:
            continue
        results.append(
            {
                "source": "DBpedia",
                "label": label,
                "uri": uri,
                "url": uri,
                "abstract": compact(abstract),
                "type": "Concepto",
                "match": match,
                "_score": score,
            }
        )
        if len(results) >= limit:
            break
    return results


def search_dbpedia(term, limit=DEFAULT_LIMIT):
    results = _direct_resource(term)
    use_sparql = os.getenv("DBPEDIA_ENABLE_SPARQL", "false").lower() == "true"
    if use_sparql and len(results) < limit:
        results.extend(_search_dbpedia_global(term, limit))
    if use_sparql and len(results) < limit:
        results.extend(_search_dbpedia_es(term, limit))
    if len(results) < limit:
        results.extend(_search_dbpedia_lookup(term, limit))

    seen = set()
    unique = []
    for item in results:
        key = item.get("uri") or item.get("label")
        if not key or key in seen:
            continue
        seen.add(key)
        item.pop("_score", None)
        unique.append(item)
        if len(unique) >= limit:
            break
    return unique
