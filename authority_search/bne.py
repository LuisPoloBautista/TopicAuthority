import json
import os

from .http_utils import DEFAULT_LIMIT, compact, sparql_json, text_match

BNE_SPARQL_URL = os.getenv("BNE_SPARQL_URL", "https://datos.bne.es/sparql")


def search_bne(term, limit=DEFAULT_LIMIT):
    term_literal = json.dumps(term.lower(), ensure_ascii=False)
    query = f"""
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?uri ?label ?type ?description WHERE {{
  ?uri skos:prefLabel ?label .
  FILTER(lang(?label) = "es")
  FILTER(CONTAINS(LCASE(STR(?label)), {term_literal}))
  OPTIONAL {{ ?uri a ?type . }}
  OPTIONAL {{ ?uri skos:scopeNote ?description . }}
}}
LIMIT {int(limit)}
"""
    data = sparql_json(BNE_SPARQL_URL, query)
    if data is None:
        raise RuntimeError("BNE no respondio a la consulta SPARQL")
    bindings = (data or {}).get("results", {}).get("bindings", [])
    results = []
    for row in bindings[:limit]:
        label = row.get("label", {}).get("value", "")
        uri = row.get("uri", {}).get("value", "")
        type_uri = row.get("type", {}).get("value", "")
        results.append(
            {
                "source": "BNE",
                "label": label,
                "uri": uri,
                "url": uri,
                "type": type_uri.rsplit("/", 1)[-1] if type_uri else "Autoridad",
                "description": compact(row.get("description", {}).get("value", "")),
                "match": text_match(term, label),
            }
        )
    return results
