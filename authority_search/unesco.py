import json
import os

from .http_utils import DEFAULT_LIMIT, compact, sparql_json, text_match

UNESCO_SPARQL_URL = os.getenv(
    "UNESCO_SPARQL_URL",
    "https://vocabularies.unesco.org/sparql",
)


def search_unesco(term, limit=DEFAULT_LIMIT):
    term_literal = json.dumps(term.lower(), ensure_ascii=False)
    query = f"""
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT DISTINCT ?uri ?label ?matchedLabel WHERE {{
  ?uri skos:prefLabel ?label ; (skos:prefLabel|skos:altLabel) ?matchedLabel .
  FILTER(lang(?label) = lang(?matchedLabel))
  FILTER(CONTAINS(LCASE(STR(?matchedLabel)), {term_literal}))
}}
ORDER BY DESC(LCASE(STR(?matchedLabel)) = {term_literal}) STRLEN(STR(?matchedLabel))
LIMIT {int(limit) * 5}
"""
    data = sparql_json(UNESCO_SPARQL_URL, query)
    if data is None:
        raise RuntimeError("UNESCO no respondio a la consulta SPARQL")
    bindings = (data or {}).get("results", {}).get("bindings", [])
    results = []
    for row in bindings:
        label = row.get("label", {}).get("value", "")
        uri = row.get("uri", {}).get("value", "")
        matched = row.get("matchedLabel", {}).get("value", label)
        match = text_match(term, matched)
        if match == "exact" and text_match(term, label) != "exact":
            match = "alias"
        results.append(
            {
                "source": "UNESCO",
                "label": label,
                "uri": uri,
                "url": uri,
                "type": "Tesauro",
                "description": compact(row.get("description", {}).get("value", "")),
                "match": match,
            }
        )
    unique = {}
    for item in results:
        if item["match"] != "related":
            unique.setdefault(item["uri"], item)
    return list(unique.values())[:limit]
