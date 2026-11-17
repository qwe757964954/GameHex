import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'map-editor'))
import copy_territory_maps as publisher
from territory_format import TerritoryValidationError, validate_territory_map


def patrol_map(battle_ids):
    return {
        'version': 1, 'mapKind': 'territoryChapter', 'id': 'patrol_test', 'chapterId': 1,
        'rows': 4, 'columns': 4, 'startCellId': 0, 'defaults': {},
        'sites': [{'id': 'patrol_1', 'type': 'patrolChest', 'cellId': 1, 'battleIds': battle_ids}],
    }


class TerritoryPatrolChestTests(unittest.TestCase):
    def test_battle_ids_survive_publishing_to_both_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'patrol_test.json'
            data = patrol_map([10002, 10001, 10002])
            data['sites'][0]['patrolId'] = 60001
            source.write_text(json.dumps(data), encoding='utf-8')
            resources, server = root / 'resources', root / 'sever'
            with patch.object(publisher, 'TARGET', resources), patch.object(publisher, 'DOC_TARGETS', (server,)):
                targets, _ = publisher.copy_one(source, False)
            self.assertEqual(len(targets), 2)
            self.assertEqual(json.loads(targets[0].read_text(encoding='utf-8'))['sites'][0]['patrolId'], 60001)
            self.assertEqual(targets[0].read_bytes(), targets[1].read_bytes())
            self.assertEqual(json.loads(targets[0].read_text(encoding='utf-8'))['sites'][0]['battleIds'],
                             [10002, 10001, 10002])

    def test_invalid_patrol_id_is_rejected_and_legacy_maps_are_accepted(self):
        self.assertNotIn('patrolId', validate_territory_map(patrol_map([10001]))[0]['sites'][0])
        for patrol_id in [None, 0, -1, 1.5, '60001', True, 9007199254740992]:
            data = patrol_map([10001])
            data['sites'][0]['patrolId'] = patrol_id
            with self.subTest(patrol_id=patrol_id), self.assertRaisesRegex(TerritoryValidationError, 'patrolId'):
                validate_territory_map(data)
        data = patrol_map([10001])
        data['sites'][0] = {'id': 'stage_1', 'type': 'stage', 'cellId': 1, 'patrolId': 60001}
        with self.assertRaisesRegex(TerritoryValidationError, 'patrolId'):
            validate_territory_map(data)

    def test_invalid_battle_ids_are_rejected(self):
        for battle_ids in [None, [], '10001', [0], [-1], [1.5], ['10001'], [True], [9007199254740992]]:
            with self.subTest(battle_ids=battle_ids), self.assertRaisesRegex(TerritoryValidationError, 'battleIds'):
                validate_territory_map(patrol_map(battle_ids))
        missing = patrol_map([10001])
        del missing['sites'][0]['battleIds']
        with self.assertRaisesRegex(TerritoryValidationError, 'battleIds'):
            validate_territory_map(missing)

    def test_ordinary_sites_reject_patrol_battle_ids(self):
        data = patrol_map([10001])
        data['sites'][0]['type'] = 'stage'
        with self.assertRaisesRegex(TerritoryValidationError, 'only valid for patrolChest'):
            validate_territory_map(data)


if __name__ == '__main__':
    unittest.main()
