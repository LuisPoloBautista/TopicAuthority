import os

from .http_utils import DEFAULT_LIMIT, compact, get_json, text_match

DBPEDIA_LOOKUP_URL = os.getenv("DBPEDIA_LOOKUP_URL", "https://lookup.dbpedia.org/api/search")


def _first(value):
    if isinstance(value, list):
      return value[0] if value else ""
    return value or ""


def search_dbpedia(term, limit=DEFAULT_LIMIT):
    data = get_json(
        DBPEDIA_LOOKUP_URL,
        {
            "query": term,
            "maxResults": limit,
            "format": "JSON",
        },
    )
    docs = (data or {}).get("docs") or (data or {}).get("results") or []
    results = []

    for item in docs[:limit]:
        label = _first(item.get("label") or item.get("Label"))
        uri = _first(item.get("resource") or item.get("URI") or item.get("uri"))
        abstract = _first(item.get("comment") or item.get("Description") or item.get("abstract"))
        results.append(
            {
                "source": "DBpedia",
                "label": label,
                "uri": uri,
                "url": uri,
                "abstract": compact(abstract),
                "type": "Concepto",
                "match": text_match(term, label),
            }
        )
    return results

