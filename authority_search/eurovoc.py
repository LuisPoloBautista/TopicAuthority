import json
import os

from .http_utils import DEFAULT_LIMIT, sparql_json, text_match

EUROVOC_SPARQL_URL = os.getenv(
    "EUROVOC_SPARQL_URL",
    "https://publications.europa.eu/webapi/rdf/sparql",
)


def search_eurovoc(term, limit=DEFAULT_LIMIT):
    """Search preferred and alternative EuroVoc labels in every available language."""
    term_literal = json.dumps(term.lower(), ensure_ascii=False)
    query = f"""
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT DISTINCT ?uri ?label ?matchedLabel WHERE {{
  ?uri skos:inScheme <http://eurovoc.europa.eu/100141> ;
       skos:prefLabel ?label ; (skos:prefLabel|skos:altLabel) ?matchedLabel .
  FILTER(lang(?label) = lang(?matchedLabel))
  FILTER(CONTAINS(LCASE(STR(?matchedLabel)), {term_literal}))
}}
ORDER BY DESC(LCASE(STR(?matchedLabel)) = {term_literal}) STRLEN(STR(?matchedLabel))
LIMIT {int(limit) * 5}
"""
    data = sparql_json(EUROVOC_SPARQL_URL, query)
    if data is None:
        raise RuntimeError("EuroVoc no respondio a la consulta SPARQL")

    results = []
    for row in (data or {}).get("results", {}).get("bindings", []):
        label = row.get("label", {}).get("value", "")
        uri = row.get("uri", {}).get("value", "")
        matched = row.get("matchedLabel", {}).get("value", label)
        match = text_match(term, matched)
        if match == "exact" and text_match(term, label) != "exact":
            match = "alias"
        results.append(
            {
                "source": "EuroVoc",
                "label": label,
                "uri": uri,
                "url": uri,
                "type": "Tesauro multilingue",
                "description": "Descriptor preferido de EuroVoc.",
                "match": match,
            }
        )
    unique = {}
    for item in results:
        if item["match"] != "related":
            unique.setdefault(item["uri"], item)
    return list(unique.values())[:limit]
