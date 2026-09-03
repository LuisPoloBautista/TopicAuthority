import json
import gzip
import os
import pickle
import re
import sys
import unicodedata
from functools import lru_cache
from pathlib import Path

try:
    from rapidfuzz import fuzz, process
except ImportError:  # pragma: no cover - covered in deployment by requirements.txt
    fuzz = None
    process = None

from .http_utils import DEFAULT_LIMIT, compact, normalize_spaces

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BNE_DOC_DIR = Path(os.getenv("BNE_LOCAL_DIR", PROJECT_ROOT / "doc_bne"))
BNE_INDEX_CACHE = Path(os.getenv("BNE_INDEX_CACHE", BNE_DOC_DIR / "bne_authority_index.pkl.gz"))
BNE_SCORE_CUTOFF = float(os.getenv("BNE_LOCAL_SCORE_CUTOFF", "74"))

LABEL_FIELDS = {
    "agencia_bibliografica_nacional": "Materia BNE",
    "lugar_relacionado": "Lugar BNE",
    "otro_nombres_de_lugar": "Variante BNE",
    "subencabezamiento_materia": "Subencabezamiento de materia",
    "subencabezamiento_forma": "Subencabezamiento de forma",
    "subencabezamiento_geografico": "Subencabezamiento geografico",
}

ALT_LABEL_FIELDS = {
    "termino_subencabezamiento_materia_no_aceptado": "Termino no aceptado",
    "termino_subencabezamiento_forma_no_aceptado": "Termino no aceptado",
    "termino_forma_relacionado": "Termino relacionado",
}


def _fold(value):
    return "".join(
        char for char in unicodedata.normalize("NFKD", str(value or "").lower())
        if not unicodedata.combining(char)
    )


def _clean_label(value):
    if not value:
        return ""
    value = str(value)
    value = re.sub(r"/\*\*/", " ", value)
    value = re.sub(r"\s*\|\s*[a-z]\s*", " -- ", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*//\s*", " | ", value)
    value = re.sub(r"\s+-\s+", " -- ", value)
    value = re.sub(r"\s*--\s*", " -- ", value)
    return normalize_spaces(value).strip(" |")


def _bne_url(record):
    value = record.get("subencabezamiento_aceptado_otro_vocabulario") or ""
    if value.startswith("http"):
        return value

    identifier = (record.get("idBNE") or record.get("id") or "").strip()
    if identifier.startswith("XX"):
        return f"https://datos.bne.es/resource/{identifier}"
    return ""


def _description(record):
    chunks = []
    for field in ["fuente_informacion", "informacion_encontrada", "nota_uso", "fuentes_de_informacion"]:
        value = _clean_label(record.get(field))
        if value:
            chunks.append(value)
    return compact(" ".join(chunks), 260)


def _add_entry(entries, seen, label, record, record_type, source_file):
    label = _clean_label(label)
    if not label:
        return

    identifier = (record.get("idBNE") or record.get("id") or "").strip()
    key = (_fold(label), identifier, record_type)
    if key in seen:
        return
    seen.add(key)

    entries.append(
        {
            "label": label,
            "search_label": _fold(label),
            "url": _bne_url(record),
            "id": identifier,
            "type": record_type,
            "description": _description(record),
            "source_file": source_file,
        }
    )


def _load_json_file(path, entries, seen):
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        return

    for record in data:
        if not isinstance(record, dict):
            continue
        for field, record_type in LABEL_FIELDS.items():
            _add_entry(entries, seen, record.get(field), record, record_type, path.name)
        for field, record_type in ALT_LABEL_FIELDS.items():
            for label in _clean_label(record.get(field)).split("|"):
                _add_entry(entries, seen, label, record, record_type, path.name)


def _load_nt_file(path, entries, seen):
    line_re = re.compile(
        r'^<(?P<uri>[^>]+)>\s+<[^>]+(?:prefLabel|altLabel|label)>\s+"(?P<label>[^"]+)"@es\s+\.$'
    )
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            match = line_re.match(line.strip())
            if not match:
                continue
            record = {
                "id": match.group("uri").rsplit("/", 1)[-1],
                "subencabezamiento_aceptado_otro_vocabulario": match.group("uri"),
            }
            _add_entry(entries, seen, match.group("label"), record, "Concepto BNE", path.name)


def _source_signature():
    if not BNE_DOC_DIR.exists():
        return []
    patterns = ["*.json"]
    if os.getenv("BNE_INCLUDE_NT", "false").lower() == "true":
        patterns.append("*.nt")

    files = []
    for pattern in patterns:
        files.extend(sorted(BNE_DOC_DIR.glob(pattern)))
    return [(str(path), path.stat().st_mtime_ns, path.stat().st_size) for path in files]


def _build_entries():
    entries = []
    seen = set()
    for path in sorted(BNE_DOC_DIR.glob("*.json")):
        _load_json_file(path, entries, seen)
    if os.getenv("BNE_INCLUDE_NT", "false").lower() == "true":
        for path in sorted(BNE_DOC_DIR.glob("*.nt")):
            _load_nt_file(path, entries, seen)
    return entries, [entry["search_label"] for entry in entries]


def _load_cache(signature):
    if not BNE_INDEX_CACHE.exists():
        return None
    try:
        opener = gzip.open if BNE_INDEX_CACHE.suffix == ".gz" else open
        with opener(BNE_INDEX_CACHE, "rb") as handle:
            payload = pickle.load(handle)
    except (OSError, pickle.PickleError, EOFError):
        return None
    trust_cache = os.getenv("BNE_TRUST_INDEX_CACHE", "true").lower() == "true"
    if not trust_cache and payload.get("signature") != signature:
        return None
    return payload.get("entries"), payload.get("choices")


def build_index():
    if process is None or fuzz is None:
        raise RuntimeError("RapidFuzz no esta instalado. Ejecuta: pip install -r requirements.txt")
    if not BNE_DOC_DIR.exists():
        raise RuntimeError(f"No existe el directorio local BNE: {BNE_DOC_DIR}")

    signature = _source_signature()
    entries, choices = _build_entries()
    BNE_INDEX_CACHE.parent.mkdir(parents=True, exist_ok=True)
    opener = gzip.open if BNE_INDEX_CACHE.suffix == ".gz" else open
    with opener(BNE_INDEX_CACHE, "wb") as handle:
        pickle.dump({"signature": signature, "entries": entries, "choices": choices}, handle, protocol=pickle.HIGHEST_PROTOCOL)
    return entries, choices


@lru_cache(maxsize=1)
def _local_entries():
    if process is None or fuzz is None:
        raise RuntimeError("RapidFuzz no esta instalado. Ejecuta: pip install -r requirements.txt")
    if not BNE_DOC_DIR.exists():
        raise RuntimeError(f"No existe el directorio local BNE: {BNE_DOC_DIR}")

    signature = _source_signature()
    cached = _load_cache(signature)
    if cached:
        return cached
    return build_index()


def _match_label(term, label):
    term_norm = _fold(term)
    if term_norm == label:
        return "exact"
    if term_norm in label or label in term_norm:
        return "partial"
    return "fuzzy"


def _token_coverage(query, label):
    stopwords = {"de", "del", "la", "el", "los", "las", "y", "en", "s", "siglos"}

    def normalize_token(token):
        if token.endswith("ciones"):
            return token[:-2]
        if len(token) > 5 and token.endswith("es"):
            return token[:-2]
        if len(token) > 4 and token.endswith("s"):
            return token[:-1]
        return token

    query_tokens = {
        normalize_token(token)
        for token in _fold(query).split()
        if len(token) > 2 and token not in stopwords
    }
    label_tokens = {
        normalize_token(token)
        for token in _fold(label).split()
        if len(token) > 2 and token not in stopwords
    }
    if not query_tokens:
        return 1, 0
    return len(query_tokens & label_tokens) / len(query_tokens), len(query_tokens)


def search_bne(term, limit=DEFAULT_LIMIT):
    entries, choices = _local_entries()
    query = _fold(term)
    if not query:
        return []

    matches = process.extract(
        query,
        choices,
        scorer=fuzz.WRatio,
        limit=max(limit * 8, 20),
        score_cutoff=BNE_SCORE_CUTOFF,
    )

    results = []
    seen = set()
    for _, score, index in matches:
        entry = entries[index]
        coverage, token_count = _token_coverage(term, entry["search_label"])
        adjusted_score = score
        if token_count >= 3:
            adjusted_score = score * (0.65 + (0.35 * coverage))
        if adjusted_score < BNE_SCORE_CUTOFF:
            continue

        key = entry["url"] or entry["id"] or entry["label"].lower()
        if key in seen:
            continue
        seen.add(key)
        results.append(
            {
                "source": "BNE",
                "label": entry["label"],
                "uri": entry["url"],
                "url": entry["url"],
                "id": entry["id"],
                "type": entry["type"],
                "description": entry["description"] or f"Coincidencia local BNE: {round(adjusted_score, 1)}%",
                "match": _match_label(term, entry["search_label"]),
                "score": round(adjusted_score, 1),
                "confidence": round(adjusted_score, 1),
                "source_file": entry["source_file"],
            }
        )
        if len(results) >= limit:
            break
    return results


def main(argv=None):
    argv = argv or sys.argv[1:]
    if argv and argv[0] == "--build-index":
        entries, _ = build_index()
        print(f"Indice BNE construido: {len(entries)} etiquetas")
        return 0
    print(json.dumps(search_bne(" ".join(argv) if argv else "Botánica"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
