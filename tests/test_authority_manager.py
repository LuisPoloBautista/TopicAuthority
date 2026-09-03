import unittest

from authority_search.authority_manager import normalize_result, query_plan, search, split_heading


class AuthorityManagerTests(unittest.TestCase):
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
