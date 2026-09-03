import os

from .http_utils import DEFAULT_LIMIT, compact, get_json, text_match

WIKIDATA_API_URL = os.getenv("WIKIDATA_API_URL", "https://www.wikidata.org/w/api.php")
_SEARCH_CACHE = {}

NOISY_DESCRIPTIONS = {
    "album",
    "argentine band",
    "band",
    "book",
    "film",
    "journal",
    "magazine",
    "newspaper",
    "novel",
    "periodical",
    "podcast",
    "song",
    "television series",
    "video game",
    "written work",
    "álbum",
    "banda",
    "canción",
    "libro",
    "obra escrita",
    "película",
    "periódico",
    "publicación periódica",
    "revista",
    "serie de televisión",
    "videojuego",
}


def wikidata_languages():
    raw = os.getenv("WIKIDATA_LANGUAGES", "es,en,pt,fr,de,it,ca")
    return [lang.strip() for lang in raw.split(",") if lang.strip()]


def _search_language(term, language, limit):
    data = get_json(
        WIKIDATA_API_URL,
        {
            "action": "wbsearchentities",
            "search": term,
            "language": language,
            "uselang": os.getenv("AUTHORITY_LANGUAGE", "es"),
            "format": "json",
            "limit": limit,
        },
    )
    if data is None:
        raise RuntimeError("Wikidata no respondio")
    return data.get("search", [])


def _entity_details(entity_ids):
    if not entity_ids:
        return {}
    data = get_json(
        WIKIDATA_API_URL,
        {
            "action": "wbgetentities",
            "ids": "|".join(entity_ids),
            "props": "labels|aliases|descriptions",
            "languages": "|".join(wikidata_languages()),
            "format": "json",
        },
    )
    if data is None:
        return {}
    return data.get("entities", {})


def _variants_for_entity(entity):
    variants = []
    languages = wikidata_languages()
    priority_languages = [lang for lang in ["en", os.getenv("AUTHORITY_LANGUAGE", "es")] if lang in languages]
    ordered_languages = priority_languages + [lang for lang in languages if lang not in priority_languages]

    for lang in ordered_languages:
        label = entity.get("labels", {}).get(lang, {}).get("value")
        if label:
            variants.append(label)
    for lang in ordered_languages:
        for alias in entity.get("aliases", {}).get(lang, []):
            value = alias.get("value")
            if value:
                variants.append(value)

    unique = []
    seen = set()
    for value in variants:
        key = value.lower()
        if key not in seen:
            seen.add(key)
            unique.append(value)
    return unique


def _description_for_item(item, entity):
    description = compact(item.get("description", ""))
    if description:
        return description

    user_language = os.getenv("AUTHORITY_LANGUAGE", "es")
    for language in [user_language, "es", "en"]:
        value = entity.get("descriptions", {}).get(language, {}).get("value")
        if value:
            return compact(value)
    return ""


def _is_noisy_work(description):
    if os.getenv("WIKIDATA_INCLUDE_WORKS", "false").lower() == "true":
        return False

    lowered = (description or "").lower()
    return any(noise in lowered for noise in NOISY_DESCRIPTIONS)


def search_wikidata(term, limit=DEFAULT_LIMIT):
    cache_key = term.lower().strip()
    if cache_key in _SEARCH_CACHE:
        return _SEARCH_CACHE[cache_key][:limit]

    result_limit = max(limit, DEFAULT_LIMIT)
    found = []
    seen_ids = set()
    candidate_limit = max(result_limit * 4, result_limit, 10)
    for language in wikidata_languages():
        for item in _search_language(term, language, min(candidate_limit, 50)):
            entity_id = item.get("id", "")
            if not entity_id or entity_id in seen_ids:
                continue
            seen_ids.add(entity_id)
            item["_search_language"] = language
            found.append(item)
            if len(found) >= candidate_limit:
                break
        if len(found) >= candidate_limit:
            break

    details = _entity_details([item.get("id", "") for item in found])
    results = []
    for item in found:
        entity_id = item.get("id", "")
        entity = details.get(entity_id, {})
        variants = _variants_for_entity(entity)
        label = item.get("label", "")
        if variants and text_match(term, label) == "related":
            label = variants[0]
        description = _description_for_item(item, entity)
        if _is_noisy_work(description):
            continue
        results.append(
            {
                "source": "Wikidata",
                "label": label,
                "id": entity_id,
                "url": item.get("concepturi") or f"https://www.wikidata.org/wiki/{entity_id}",
                "description": description,
                "type": "Entidad relacionada",
                "match": item.get("match", {}).get("type", "related"),
                "variants": variants,
                "language": item.get("_search_language", ""),
            }
        )
        if len(results) >= result_limit:
            break
    _SEARCH_CACHE[cache_key] = results
    return results[:limit]


def get_wikidata_variants(term, limit=3):
    variants = []
    for item in search_wikidata(term, limit=limit):
        variants.extend(item.get("variants") or [])

    unique = []
    seen = {term.lower()}
    for value in variants:
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(value)
    return unique
