import os

from .http_utils import DEFAULT_LIMIT, compact, get_json

WIKIDATA_API_URL = os.getenv("WIKIDATA_API_URL", "https://www.wikidata.org/w/api.php")


def search_wikidata(term, limit=DEFAULT_LIMIT):
    data = get_json(
        WIKIDATA_API_URL,
        {
            "action": "wbsearchentities",
            "search": term,
            "language": os.getenv("AUTHORITY_LANGUAGE", "es"),
            "uselang": os.getenv("AUTHORITY_LANGUAGE", "es"),
            "format": "json",
            "limit": limit,
        },
    )
    results = []
    for item in (data or {}).get("search", [])[:limit]:
        entity_id = item.get("id", "")
        results.append(
            {
                "source": "Wikidata",
                "label": item.get("label", ""),
                "id": entity_id,
                "url": item.get("concepturi") or f"https://www.wikidata.org/wiki/{entity_id}",
                "description": compact(item.get("description", "")),
                "type": "Entidad relacionada",
                "match": item.get("match", {}).get("type", "related"),
            }
        )
    return results

