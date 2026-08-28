import unittest
from pathlib import Path

from worker import main


class RetryConsistencyTest(unittest.TestCase):
    def test_element_upsert_preserves_id_for_same_global_id(self):
        sql = " ".join(main.UPSERT_ELEMENT.split())

        self.assertIn("ON CONFLICT (model_id, global_id) DO UPDATE", sql)
        self.assertNotIn("DO UPDATE SET id =", sql)

    def test_only_elements_missing_from_new_ifc_are_deleted(self):
        sql = " ".join(main.DELETE_MISSING_ELEMENTS.split())

        self.assertIn("model_id=%s", sql)
        self.assertIn("NOT (global_id = ANY(%s))", sql)

    def test_glb_object_key_is_versioned_and_only_known_unpublished_object_is_removed(self):
        source = Path(main.__file__).read_text(encoding="utf-8")

        self.assertIn('glb_key = f"glb/{model_id}/{lease_owner}.glb"', source)
        self.assertIn("except LeaseLost:", source)
        self.assertIn("s3.remove_object(BUCKET, glb_key)", source)


if __name__ == "__main__":
    unittest.main()
