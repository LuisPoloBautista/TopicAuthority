import os
import unicodedata
import json

from .http_utils import DEFAULT_LIMIT, compact, get_json, sparql_json, strip_markup, text_match

DBPEDIA_LOOKUP_URL = os.getenv("DBPEDIA_LOOKUP_URL", "https://lookup.dbpedia.org/api/search")
DBPEDIA_ES_SPARQL_URL = os.getenv("DBPEDIA_ES_SPARQL_URL", "https://es.dbpedia.org/sparql")


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
}}
LIMIT {int(limit)}
"""
    data = sparql_json(DBPEDIA_ES_SPARQL_URL, query)
    if data is None:
        return []

    results = []
    for row in data.get("results", {}).get("bindings", []):
        label = row.get("label", {}).get("value", "")
        uri = row.get("uri", {}).get("value", "")
        type_uri = row.get("type", {}).get("value", "")
        results.append(
            {
                "source": "DBpedia",
                "label": compact(label, 180),
                "uri": uri,
                "url": uri,
                "abstract": compact(row.get("abstract", {}).get("value", "")),
                "type": type_uri.rsplit("/", 1)[-1] if type_uri else "Concepto",
                "match": text_match(term, label),
            }
        )
    return results


def _search_dbpedia_lookup(term, limit):
    data = get_json(
        DBPEDIA_LOOKUP_URL,
        {
            "query": term,
            "maxResults": limit,
            "format": "JSON",
        },
    )
    if data is None:
        raise RuntimeError("DBpedia no respondio")
    docs = (data or {}).get("docs") or (data or {}).get("results") or []
    results = []

    for item in docs:
        raw_label = _first(item.get("label") or item.get("Label"))
        label = compact(strip_markup(raw_label), 180)
        uri = _first(item.get("resource") or item.get("URI") or item.get("uri"))
        abstract = _first(item.get("comment") or item.get("Description") or item.get("abstract"))
        match = text_match(term, label)
        overlap, token_count = _token_overlap(term, label)
        highlighted = "<B>" in raw_label or "<b>" in raw_label
        translated_single_term = highlighted and token_count == 1
        if match == "related" and not translated_single_term and not (highlighted and overlap >= 0.6) and overlap < 0.8:
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
            }
        )
        if len(results) >= limit:
            break
    return results


def search_dbpedia(term, limit=DEFAULT_LIMIT):
    results = _search_dbpedia_es(term, limit)
    if len(results) < limit:
        results.extend(_search_dbpedia_lookup(term, limit))

    seen = set()
    unique = []
    for item in results:
        key = item.get("uri") or item.get("label")
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(item)
        if len(unique) >= limit:
            break
    return unique
