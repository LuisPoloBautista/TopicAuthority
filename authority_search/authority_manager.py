import json
import logging
import os
import re
import sys

from .dbpedia import has_dbpedia_exact_hint, search_dbpedia
from .bne import search_bne
from .http_utils import normalize_spaces, text_match
from .lcsh import search_lcsh
from .unesco import search_unesco
from .viaf import search_viaf
from .wikidata import get_wikidata_variants, search_wikidata

logging.basicConfig(
    level=os.getenv("AUTHORITY_LOG_LEVEL", "INFO"),
    format="%(levelname)s:%(name)s:%(message)s",
)

SEARCHERS = {
    "viaf": search_viaf,
    "wikidata": search_wikidata,
    "bne": search_bne,
    "dbpedia": search_dbpedia,
    "unesco": search_unesco,
    "lcsh": search_lcsh,
}

SOURCE_LABELS = {
    "viaf": "VIAF",
    "wikidata": "Wikidata",
    "bne": "BNE",
    "dbpedia": "DBpedia",
    "unesco": "UNESCO",
    "lcsh": "LCSH",
}

DATE_RE = re.compile(
    r"^("
    r"\d{3,4}([-/]\d{2,4})?"
    r"|siglos?\s+[ivxlcdm0-9]+([-/][ivxlcdm0-9]+)?"
    r"|s\.\s*[ivxlcdm0-9]+"
    r")$",
    re.IGNORECASE,
)

GEOGRAPHIC_TERMS = {
    "mexico",
    "méxico",
    "nueva españa",
    "america",
    "américa",
    "america latina",
    "américa latina",
    "españa",
    "colombia",
    "argentina",
    "peru",
    "perú",
    "chile",
}


def configured_sources():
    raw = os.getenv("AUTHORITY_SOURCES", "viaf,wikidata,bne,dbpedia,unesco,lcsh")
    sources = [source.strip().lower() for source in raw.split(",") if source.strip()]
    return [source for source in sources if source in SEARCHERS]


def strip_numbering(value):
    return re.sub(r"^\s*\d+[\.)]\s*", "", value or "").strip()


def split_heading(topic):
    cleaned = strip_numbering(normalize_spaces(topic))
    parts = [
        normalize_spaces(part)
        for part in re.split(r"\s*--\s*", cleaned)
        if normalize_spaces(part)
    ]
    if not parts:
        return []

    components = [{"term": parts[0], "role": "encabezamiento principal", "priority": 0}]
    for part in parts[1:]:
        lower = part.lower()
        if DATE_RE.match(lower):
            components.append({"term": part, "role": "subdivision cronologica", "priority": 90, "skip": True})
        elif lower in GEOGRAPHIC_TERMS:
            components.append({"term": part, "role": "subdivision geografica", "priority": 40})
        else:
            components.append({"term": part, "role": "subdivision de materia", "priority": 30})
    return components


def fallback_queries(topic):
    cleaned = strip_numbering(normalize_spaces(topic))
    cleaned = re.sub(r"\s*--\s*", " ", cleaned)
    cleaned = re.sub(r"\b\d{3,4}([-/]\d{2,4})?\b", "", cleaned)
    cleaned = normalize_spaces(cleaned)
    return [{"term": cleaned, "role": "encabezamiento completo normalizado", "priority": 80}] if cleaned else []


def query_plan(topic):
    components = split_heading(topic)
    include_geographic = os.getenv("AUTHORITY_INCLUDE_GEOGRAPHIC", "false").lower() == "true"
    searchable = [
        item for item in components
        if not item.get("skip") and (include_geographic or item.get("role") != "subdivision geografica")
    ]
    if searchable:
        return searchable
    return fallback_queries(topic)


def expand_plan_with_wikidata(plan):
    if os.getenv("AUTHORITY_EXPAND_WITH_WIKIDATA", "true").lower() != "true":
        return plan

    max_variants = int(os.getenv("AUTHORITY_QUERY_VARIANTS", "4"))
    expanded = list(plan)
    seen = {item["term"].lower() for item in expanded}
    main_terms = [item["term"] for item in plan if item.get("priority") == 0]

    for term in main_terms:
        try:
            variants = get_wikidata_variants(term, limit=2)
        except Exception as exc:
            logging.warning("Wikidata variant expansion failed for %r: %s", term, exc)
            continue
        for variant in variants:
            key = variant.lower()
            if key in seen:
                continue
            seen.add(key)
            expanded.append(
                {
                    "term": variant,
                    "role": "variante Wikidata",
                    "priority": 10,
                }
            )
            if len([item for item in expanded if item.get("role") == "variante Wikidata"]) >= max_variants:
                return expanded
    return expanded


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
        "query": item.get("query", ""),
        "component": item.get("component", ""),
        "score": item.get("score", 0),
    }


def score_result(query, item):
    label = item.get("label", "")
    match = item.get("match") or text_match(query, label)
    if match in {"exact", "label"}:
        return 100
    if match in {"partial", "alias"}:
        return 80
    if text_match(query, label) == "partial":
        return 70
    return 40


def search_source_for_topic(source, searcher, plan, per_source_limit):
    collected = []
    source_plan = plan
    if source == "viaf":
        source_plan = [item for item in plan if item["priority"] == 0]
    if source == "dbpedia":
        hint_plan = [item for item in plan if has_dbpedia_exact_hint(item["term"])]
        source_plan = hint_plan or [item for item in plan if item["priority"] == 0]

    for component in sorted(source_plan, key=lambda item: item["priority"]):
        term = component["term"]
        try:
            results = searcher(term, limit=per_source_limit)
        except TypeError:
            results = searcher(term)

        for result in results:
            result["query"] = term
            result["component"] = component["role"]
            result["score"] = score_result(term, result) - component["priority"]
            collected.append(result)

        # A main-heading hit is the best authority signal. Avoid letting broad
        # geographic subdivisions dominate the display when the main term worked.
        if component["priority"] == 0 and results and source not in {"dbpedia", "bne", "lcsh"}:
            break

    collected.sort(key=lambda item: item.get("score", 0), reverse=True)
    return collected[:per_source_limit]


def search(topic, sources=None):
    authorities = []
    source_status = []
    selected_sources = sources or configured_sources()
    selected_sources = [source for source in selected_sources if source in SEARCHERS]
    plan = query_plan(topic)
    expanded_plan = expand_plan_with_wikidata(plan) if selected_sources else plan
    per_source_limit = int(os.getenv("AUTHORITY_MAX_RESULTS_PER_SOURCE", os.getenv("AUTHORITY_MAX_RESULTS", "3")))

    for source in selected_sources:
        searcher = SEARCHERS.get(source)
        if not searcher:
            continue
        try:
            source_plan = plan if source in {"wikidata", "viaf"} else expanded_plan
            source_results = search_source_for_topic(source, searcher, source_plan, per_source_limit)
            authorities.extend(normalize_result(item) for item in source_results)
            source_status.append(
                {
                    "source": SOURCE_LABELS.get(source, source),
                    "status": "ok" if source_results else "no_matches",
                    "count": len(source_results),
                }
            )
        except Exception as exc:
            logging.warning("Authority source %s failed for topic %r: %s", source, topic, exc)
            source_status.append(
                {
                    "source": SOURCE_LABELS.get(source, source),
                    "status": "error",
                    "count": 0,
                    "error": str(exc),
                }
            )

    seen = set()
    unique = []
    for item in authorities:
        key = (item.get("source"), item.get("url") or item.get("label"))
        if not item.get("label") or key in seen:
            continue
        seen.add(key)
        unique.append(item)

    return {"topic": topic, "queries": expanded_plan, "sources": source_status, "authorities": unique}


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
