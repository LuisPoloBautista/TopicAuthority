import unittest
from unittest.mock import patch

from authority_search.authority_manager import search_source_for_topic
from authority_search.http_utils import text_match
from authority_search.wikidata import get_wikidata_variants, search_wikidata, _SEARCH_CACHE
from authority_search.unesco import search_unesco

from authority_search.authority_manager import normalize_result, query_plan, search, split_heading


class AuthorityManagerTests(unittest.TestCase):
    def test_match_normalizes_accents_without_matching_word_fragments(self):
        self.assertEqual(text_match("Botanica", "Botánica"), "exact")
        self.assertEqual(text_match("art", "Artificial intelligence"), "related")
        self.assertEqual(text_match("Artificial intelligence", "Artificial intelligence in art"), "partial")
        self.assertEqual(text_match("Artificial intelligence", "Intelligence"), "related")

    def test_source_keeps_hits_after_a_variant_fails_and_deduplicates(self):
        def lookup(term, limit):
            if term == "failure":
                raise RuntimeError("timeout")
            return [{"label": term, "uri": "urn:one", "match": "exact"}]
        plan = [{"term": term, "priority": priority, "role": "test"}
                for term, priority in [("botany", 0), ("botanique", 10), ("failure", 10)]]
        results = search_source_for_topic("lcsh", lookup, plan, 3)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["label"], "botany")

    def test_all_failed_queries_are_reported_as_error(self):
        with self.assertRaises(RuntimeError):
            search_source_for_topic("lcsh", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("offline")),
                                    [{"term": "botany", "priority": 0}], 3)

    @patch("authority_search.wikidata.search_wikidata")
    def test_translations_require_an_exact_entity_or_alias(self, lookup):
        lookup.return_value = [
            {"match": "partial", "variants": ["Wrong translation"]},
            {"match": "alias", "variants": ["Botánica", "Botany", "Botanique"]},
        ]
        self.assertEqual(get_wikidata_variants("Botánica"), ["Botany", "Botanique"])

    @patch("authority_search.wikidata._entity_details", return_value={})
    @patch("authority_search.wikidata.wikidata_languages", return_value=["es", "fr"])
    @patch("authority_search.wikidata._search_language")
    def test_language_failure_does_not_discard_other_language(self, lookup, languages, details):
        _SEARCH_CACHE.clear()
        def response(term, language, limit):
            if language == "es":
                raise RuntimeError("offline")
            return [{"id": "Q1", "label": "Botanique", "match": {"type": "label", "text": "Botanique"}}]
        lookup.side_effect = response
        self.assertEqual(search_wikidata("Botanique")[0]["match"], "exact")
        _SEARCH_CACHE.clear()

    @patch("authority_search.unesco.sparql_json")
    def test_unesco_accepts_foreign_authorized_alias(self, lookup):
        lookup.return_value = {"results": {"bindings": [{
            "uri": {"value": "urn:education"}, "label": {"value": "Éducation"},
            "matchedLabel": {"value": "Enseignement"},
        }]}}
        results = search_unesco("Enseignement")
        self.assertEqual(results[0]["match"], "alias")
        self.assertEqual(results[0]["label"], "Éducation")
        self.assertIn("skos:altLabel", lookup.call_args.args[1])

    def test_normalize_result_uses_uri_as_url(self):
        result = normalize_result(
            {
                "source": "VIAF",
                "label": "Botánica",
                "uri": "https://viaf.org/viaf/123/",
                "type": "Autoridad",
            }
        )

        self.assertEqual(result["source"], "VIAF")
        self.assertEqual(result["term"], "Botánica")
        self.assertEqual(result["url"], "https://viaf.org/viaf/123/")
        self.assertEqual(result["type"], "Autoridad")

    def test_search_ignores_unknown_sources(self):
        result = search("Botánica", sources=["unknown-source"])

        self.assertEqual(result["topic"], "Botánica")
        self.assertEqual(result["authorities"], [])

    def test_split_heading_identifies_main_heading(self):
        parts = split_heading("Mineralogía -- Investigación -- México -- 1895-1901")

        self.assertEqual(parts[0]["term"], "Mineralogía")
        self.assertEqual(parts[0]["role"], "encabezamiento principal")
        self.assertEqual(parts[-1]["role"], "subdivision cronologica")
        self.assertTrue(parts[-1]["skip"])

    def test_split_heading_identifies_plural_centuries_as_chronological(self):
        parts = split_heading("Botánica -- Investigaciones -- México -- Siglos XVIII-XIX")

        self.assertEqual(parts[-1]["term"], "Siglos XVIII-XIX")
        self.assertEqual(parts[-1]["role"], "subdivision cronologica")
        self.assertTrue(parts[-1]["skip"])

    def test_query_plan_skips_dates(self):
        plan = query_plan("Comunicación científica -- México -- 1895-1901")
        terms = [item["term"] for item in plan]

        self.assertIn("Comunicación científica", terms)
        self.assertNotIn("México", terms)
        self.assertNotIn("1895-1901", terms)


if __name__ == "__main__":
    unittest.main()
