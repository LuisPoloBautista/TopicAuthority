import json
import os

from .http_utils import DEFAULT_LIMIT, compact, sparql_json, text_match

UNESCO_SPARQL_URL = os.getenv(
    "UNESCO_SPARQL_URL",
    "https://vocabularies.unesco.org/sparql",
)


def search_unesco(term, limit=DEFAULT_LIMIT):
    lang = os.getenv("AUTHORITY_LANGUAGE", "es")
    term_literal = json.dumps(term.lower(), ensure_ascii=False)
    query = f"""
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?uri ?label ?description WHERE {{
  ?uri skos:prefLabel ?label .
  FILTER(lang(?label) = "{lang}" || lang(?label) = "en")
  FILTER(CONTAINS(LCASE(STR(?label)), {term_literal}))
  OPTIONAL {{ ?uri skos:scopeNote ?description . }}
}}
LIMIT {int(limit)}
"""
    data = sparql_json(UNESCO_SPARQL_URL, query)
    if data is None:
        raise RuntimeError("UNESCO no respondio a la consulta SPARQL")
    bindings = (data or {}).get("results", {}).get("bindings", [])
    results = []
    for row in bindings[:limit]:
        label = row.get("label", {}).get("value", "")
        uri = row.get("uri", {}).get("value", "")
        results.append(
            {
                "source": "UNESCO",
                "label": label,
                "uri": uri,
                "url": uri,
                "type": "Tesauro",
                "description": compact(row.get("description", {}).get("value", "")),
                "match": text_match(term, label),
            }
        )
    return results
