import json
import os
import unicodedata

from .http_utils import DEFAULT_LIMIT, compact, sparql_json, text_match

BNE_SPARQL_URL = os.getenv("BNE_SPARQL_URL", "https://datos.bne.es/sparql")


def _fold(value):
    return "".join(
        char for char in unicodedata.normalize("NFKD", value.lower())
        if not unicodedata.combining(char)
    )


def _search(term, limit):
    terms = []
    for value in [term.lower(), _fold(term)]:
        if value and value not in terms:
            terms.append(value)
    filters = " || ".join(
        f"CONTAINS(LCASE(STR(?label)), {json.dumps(value, ensure_ascii=False)})"
        for value in terms
    )
    query = f"""
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?concepto ?label WHERE {{
  ?concepto skos:prefLabel ?label .
  FILTER({filters})
}}
LIMIT {int(limit)}
"""
    return sparql_json(BNE_SPARQL_URL, query, timeout=float(os.getenv("BNE_TIMEOUT_SECONDS", "5")))


def search_bne(term, limit=DEFAULT_LIMIT):
    data = _search(term, max(limit * 4, 12))
    if data is None:
        raise RuntimeError("BNE no respondio a la consulta SPARQL")

    rows = data.get("results", {}).get("bindings", [])
    scored = []
    for row in rows:
        label = row.get("label", {}).get("value", "")
        uri = row.get("concepto", {}).get("value", "")
        match = text_match(term, label)
        score = 100 if match == "exact" else 80 if match == "partial" else 40
        scored.append((score, label, uri, match))

    scored.sort(key=lambda item: item[0], reverse=True)
    results = []
    seen = set()
    for _, label, uri, match in scored:
        key = uri or label.lower()
        if not label or key in seen:
            continue
        seen.add(key)
        results.append(
            {
                "source": "BNE",
                "label": label,
                "uri": uri,
                "url": uri,
                "type": "Autoridad",
                "description": compact(uri),
                "match": match,
            }
        )
        if len(results) >= limit:
            break
    return results
