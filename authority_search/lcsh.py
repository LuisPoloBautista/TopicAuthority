import os

from .http_utils import DEFAULT_LIMIT, compact, get_json, text_match

LCSH_SUGGEST_URL = os.getenv(
    "LCSH_SUGGEST_URL",
    "https://id.loc.gov/authorities/subjects/suggest/",
)


def search_lcsh(term, limit=DEFAULT_LIMIT):
    data = get_json(LCSH_SUGGEST_URL, {"q": term, "count": limit})
    if data is None:
        raise RuntimeError("LCSH no respondio")
    if not isinstance(data, list) or len(data) < 4:
        return []

    labels = data[1] if len(data) > 1 else []
    descriptions = data[2] if len(data) > 2 else []
    uris = data[3] if len(data) > 3 else []

    results = []
    for idx, label in enumerate(labels[:limit]):
        uri = uris[idx] if idx < len(uris) else ""
        results.append(
            {
                "source": "LCSH",
                "label": label,
                "uri": uri,
                "url": uri,
                "type": "Materia",
                "description": compact(descriptions[idx] if idx < len(descriptions) else ""),
                "match": text_match(term, label),
            }
        )
    return results
