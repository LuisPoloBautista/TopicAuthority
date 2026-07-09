import os
import unicodedata

from .http_utils import DEFAULT_LIMIT, compact, get_json, strip_markup, text_match

DBPEDIA_LOOKUP_URL = os.getenv("DBPEDIA_LOOKUP_URL", "https://lookup.dbpedia.org/api/search")


def _first(value):
    if isinstance(value, list):
        return value[0] if value else ""
    return value or ""


def _token_overlap(query, label):
    stopwords = {"de", "del", "la", "el", "los", "las", "y", "en", "the", "of", "and"}
    query_tokens = {token for token in _ascii_fold(query).split() if len(token) > 3 and token not in stopwords}
    label_tokens = {token for token in _ascii_fold(label).split() if len(token) > 3 and token not in stopwords}
    if not query_tokens:
        return 0, 0
    return len(query_tokens & label_tokens) / len(query_tokens), len(query_tokens)


def _ascii_fold(value):
    return "".join(
        char for char in unicodedata.normalize("NFKD", value.lower())
        if not unicodedata.combining(char)
    )


def search_dbpedia(term, limit=DEFAULT_LIMIT):
    data = get_json(
        DBPEDIA_LOOKUP_URL,
        {
            "query": term,
            "maxResults": limit,
            "format": "JSON",
        },
    )
    if data is None:
        raise RuntimeError("DBpedia no respondio")
    docs = (data or {}).get("docs") or (data or {}).get("results") or []
    results = []

    for item in docs:
        raw_label = _first(item.get("label") or item.get("Label"))
        label = compact(strip_markup(raw_label), 180)
        uri = _first(item.get("resource") or item.get("URI") or item.get("uri"))
        abstract = _first(item.get("comment") or item.get("Description") or item.get("abstract"))
        match = text_match(term, label)
        overlap, token_count = _token_overlap(term, label)
        highlighted = "<B>" in raw_label or "<b>" in raw_label
        translated_single_term = highlighted and token_count == 1
        if match == "related" and not translated_single_term and not (highlighted and overlap >= 0.6) and overlap < 0.8:
            continue
        results.append(
            {
                "source": "DBpedia",
                "label": label,
                "uri": uri,
                "url": uri,
                "abstract": compact(abstract),
                "type": "Concepto",
                "match": match,
            }
        )
        if len(results) >= limit:
            break
    return results
