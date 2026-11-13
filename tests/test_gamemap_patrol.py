import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/map-editor"))
from map_format import validate_preset


class GamemapPatrolTest(unittest.TestCase):
    def setUp(self):
        self.layout = json.loads((ROOT / "tests/fixtures/zcds-map-v3-neutral-2p.json").read_text(encoding="utf-8"))
        self.layout["id"] = "patrol_test"
        self.layout["resourcePoints"] = [{"row": 8, "column": 5, "groupId": 1, "patrolCells": [93, 104]}]

    def test_publish_preserves_patrol_and_legacy_map(self):
        saved = validate_preset(self.layout, "patrol_test")
        self.assertEqual(saved["resourcePoints"][0]["patrolCells"], [93, 104])
        del self.layout["resourcePoints"][0]["patrolCells"]
        self.assertNotIn("patrolCells", validate_preset(self.layout, "patrol_test")["resourcePoints"][0])

    def test_rejects_invalid_ranges(self):
        for cells in ([104], [93, 0], [93, -1], [93, 220], [93, 93], [93, True], "93"):
            with self.subTest(cells=cells), self.assertRaisesRegex(ValueError, "巡逻"):
                layout = copy.deepcopy(self.layout)
                layout["resourcePoints"][0]["patrolCells"] = cells
                validate_preset(layout, "patrol_test")
        for row, column in ((-1, 16), (8, 11), (20, 0), (True, 5)):
            with self.subTest(row=row, column=column), self.assertRaisesRegex(ValueError, "巡逻"):
                layout = copy.deepcopy(self.layout)
                layout["resourcePoints"][0].update(row=row, column=column)
                validate_preset(layout, "patrol_test")

    def test_rejects_home_void_and_resource_conflicts(self):
        for point in (
            {"row": 3, "column": 1, "groupId": 1, "patrolCells": [34, 23, 12]},
            {"row": 8, "column": 5, "groupId": 1, "patrolCells": [93, 104, 115, 126]},
        ):
            with self.subTest(point=point), self.assertRaisesRegex(ValueError, "巡逻"):
                self.layout["resourcePoints"] = [point, {"row": 11, "column": 5, "groupId": 1}]
                validate_preset(self.layout, "patrol_test")
        self.layout["ascii"][0] = ".....0....."
        self.layout["resourcePoints"] = [{"row": 10, "column": 5, "groupId": 1, "patrolCells": [115, 114]}]
        with self.assertRaisesRegex(ValueError, "巡逻"):
            validate_preset(self.layout, "patrol_test")


if __name__ == "__main__":
    unittest.main()
