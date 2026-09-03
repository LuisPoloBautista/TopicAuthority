import os

from .http_utils import DEFAULT_LIMIT, compact, get_json, text_match

VIAF_AUTOSUGGEST_URL = os.getenv(
    "VIAF_AUTOSUGGEST_URL",
    "https://www.viaf.org/viaf/AutoSuggest",
)


def search_viaf(term, limit=DEFAULT_LIMIT):
    data = get_json(VIAF_AUTOSUGGEST_URL, {"query": term})
    if data is None:
        raise RuntimeError("VIAF no respondio")

    results = []
    include_related = os.getenv("VIAF_INCLUDE_RELATED", "false").lower() == "true"
    include_partial = os.getenv("VIAF_INCLUDE_PARTIAL", "false").lower() == "true"
    for item in data.get("result") or []:
        viaf_id = str(item.get("viafid") or "").strip()
        label = item.get("term") or item.get("displayForm") or ""
        match = text_match(term, label)
        if match == "partial" and not include_partial:
            continue
        if match == "related" and not include_related:
            continue

        url = f"https://viaf.org/viaf/{viaf_id}/" if viaf_id else ""
        name_type = item.get("nametype") or item.get("type") or "Autoridad"
        sources = [
            source for source in [
                item.get("lc"),
                item.get("isni"),
                item.get("wikidata"),
            ] if source
        ]

        results.append(
            {
                "source": "VIAF",
                "label": label,
                "id": viaf_id,
                "uri": url,
                "url": url,
                "type": name_type,
                "description": compact(", ".join(sources)),
                "match": match,
            }
        )
        if len(results) >= limit:
            break
    return results
