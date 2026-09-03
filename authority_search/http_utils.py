import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_TIMEOUT = float(os.getenv("AUTHORITY_TIMEOUT_SECONDS", "5"))
DEFAULT_LIMIT = int(os.getenv("AUTHORITY_MAX_RESULTS", "3"))
USER_AGENT = os.getenv(
    "AUTHORITY_USER_AGENT",
    "topicIA-authority-search/1.0 (direct authority lookup)",
)

_JSON_CACHE = {}


def get_json(url, params=None, headers=None, timeout=DEFAULT_TIMEOUT):
    query = urllib.parse.urlencode(params or {})
    full_url = f"{url}?{query}" if query else url
    cache_key = (full_url, tuple(sorted((headers or {}).items())))
    if cache_key in _JSON_CACHE:
        return _JSON_CACHE[cache_key]

    request_headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    request_headers.update(headers or {})
    request = urllib.request.Request(full_url, headers=request_headers)

    attempts = 2 if os.getenv("AUTHORITY_RETRY_ON_429", "true").lower() == "true" else 1
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                body = response.read().decode(charset, errors="replace")
                data = json.loads(body)
                _JSON_CACHE[cache_key] = data
                return data
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt + 1 < attempts:
                retry_after = exc.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else 1.0
                time.sleep(min(delay, 3.0))
                continue
            logging.warning("Authority request failed for %s: %s", url, exc)
            return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            logging.warning("Authority request failed for %s: %s", url, exc)
            return None
    return None


def sparql_json(endpoint, query, timeout=DEFAULT_TIMEOUT):
    return get_json(
        endpoint,
        {
            "query": query,
            "format": "application/sparql-results+json",
        },
        headers={"Accept": "application/sparql-results+json"},
        timeout=timeout,
    )


def text_match(term, label):
    term_norm = " ".join((term or "").lower().split())
    label_norm = " ".join((label or "").lower().split())
    if not term_norm or not label_norm:
        return "related"
    if term_norm == label_norm:
        return "exact"
    if term_norm in label_norm or label_norm in term_norm:
        return "partial"
    return "related"


def strip_markup(value):
    if not value:
        return ""
    return re.sub(r"<[^>]+>", "", str(value))


def compact(value, max_len=320):
    if not value:
        return ""
    value = strip_markup(value)
    value = " ".join(value.split())
    return value if len(value) <= max_len else value[: max_len - 1].rstrip() + "…"


def normalize_spaces(value):
    return " ".join(str(value or "").strip().split())
