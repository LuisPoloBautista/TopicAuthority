import json
import os

from .http_utils import DEFAULT_LIMIT, sparql_json, text_match

EUROVOC_SPARQL_URL = os.getenv(
    "EUROVOC_SPARQL_URL",
    "https://publications.europa.eu/webapi/rdf/sparql",
)


def search_eurovoc(term, limit=DEFAULT_LIMIT):
    """Search preferred EuroVoc descriptors, prioritising Spanish labels."""
    lang = os.getenv("AUTHORITY_LANGUAGE", "es")
    term_literal = json.dumps(term.lower(), ensure_ascii=False)
    query = f"""
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT DISTINCT ?uri ?label WHERE {{
  ?uri skos:inScheme <http://eurovoc.europa.eu/100141> ;
       skos:prefLabel ?label .
  FILTER(lang(?label) = "{lang}" || lang(?label) = "en")
  FILTER(CONTAINS(LCASE(STR(?label)), {term_literal}))
}}
LIMIT {int(limit)}
"""
    data = sparql_json(EUROVOC_SPARQL_URL, query)
    if data is None:
        raise RuntimeError("EuroVoc no respondio a la consulta SPARQL")

    results = []
    for row in (data or {}).get("results", {}).get("bindings", [])[:limit]:
        label = row.get("label", {}).get("value", "")
        uri = row.get("uri", {}).get("value", "")
        results.append(
            {
                "source": "EuroVoc",
                "label": label,
                "uri": uri,
                "url": uri,
                "type": "Tesauro multilingue",
                "description": "Descriptor preferido de EuroVoc.",
                "match": text_match(term, label),
            }
        )
    return results
