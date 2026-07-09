import json
import logging
import os
import sys

from .bne import search_bne
from .dbpedia import search_dbpedia
from .lcsh import search_lcsh
from .unesco import search_unesco
from .wikidata import search_wikidata

logging.basicConfig(
    level=os.getenv("AUTHORITY_LOG_LEVEL", "INFO"),
    format="%(levelname)s:%(name)s:%(message)s",
)

SEARCHERS = {
    "bne": search_bne,
    "wikidata": search_wikidata,
    "dbpedia": search_dbpedia,
    "unesco": search_unesco,
    "lcsh": search_lcsh,
}


def configured_sources():
    raw = os.getenv("AUTHORITY_SOURCES", "bne,wikidata,dbpedia,unesco,lcsh")
    sources = [source.strip().lower() for source in raw.split(",") if source.strip()]
    return [source for source in sources if source in SEARCHERS]


def normalize_result(item):
    label = item.get("label") or item.get("term") or ""
    url = item.get("url") or item.get("uri") or ""
    return {
        "source": item.get("source", ""),
        "label": label,
        "term": label,
        "url": url,
        "uri": item.get("uri") or url,
        "id": item.get("id", ""),
        "type": item.get("type", ""),
        "description": item.get("description", ""),
        "abstract": item.get("abstract", ""),
        "match": item.get("match", "related"),
    }


def search(topic, sources=None):
    authorities = []
    selected_sources = sources or configured_sources()

    for source in selected_sources:
        searcher = SEARCHERS.get(source)
        if not searcher:
            continue
        try:
            authorities.extend(normalize_result(item) for item in searcher(topic))
        except Exception as exc:
            logging.exception("Authority source %s failed for topic %r: %s", source, topic, exc)

    seen = set()
    unique = []
    for item in authorities:
        key = (item.get("source"), item.get("url") or item.get("label"))
        if not item.get("label") or key in seen:
            continue
        seen.add(key)
        unique.append(item)

    return {"topic": topic, "authorities": unique}


def main(argv=None):
    argv = argv or sys.argv[1:]
    if not argv:
        print(json.dumps({"error": "topic is required"}, ensure_ascii=False))
        return 2

    topic = " ".join(argv)
    payload = search(topic)
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

