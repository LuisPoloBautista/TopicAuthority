import unittest

from authority_search.authority_manager import normalize_result, search


class AuthorityManagerTests(unittest.TestCase):
    def test_normalize_result_uses_uri_as_url(self):
        result = normalize_result(
            {
                "source": "BNE",
                "label": "Botánica",
                "uri": "https://datos.bne.es/resource/XX1",
                "type": "Materia",
            }
        )

        self.assertEqual(result["source"], "BNE")
        self.assertEqual(result["term"], "Botánica")
        self.assertEqual(result["url"], "https://datos.bne.es/resource/XX1")
        self.assertEqual(result["type"], "Materia")

    def test_search_ignores_unknown_sources(self):
        result = search("Botánica", sources=["unknown-source"])

        self.assertEqual(result["topic"], "Botánica")
        self.assertEqual(result["authorities"], [])


if __name__ == "__main__":
    unittest.main()

