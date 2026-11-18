import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'map-editor'))
import copy_territory_maps as publisher
import presets_io
from territory_format import TerritoryValidationError, validate_territory_map


def patrol_map(battle_id):
    return {
        'version': 1, 'mapKind': 'territoryChapter', 'id': 'patrol_test', 'chapterId': 1,
        'rows': 4, 'columns': 4, 'startCellId': 0, 'defaults': {},
        'sites': [{'id': 'patrol_1', 'type': 'patrolChest', 'cellId': 1, 'battleId': battle_id}],
    }


class TerritoryPatrolChestTests(unittest.TestCase):
    def test_same_site_id_defines_patrol_group_and_dependency_uses_cell_id(self):
        data = patrol_map(60001)
        data['sites'].append({'id': 'patrol_1', 'type': 'patrolChest', 'cellId': 5,
                              'battleId': 60001, 'unlock': {'requiredCells': [1]}})
        self.assertEqual(len(validate_territory_map(data)[0]['sites']), 2)
        data['sites'][1]['cellId'] = 15
        with self.assertRaisesRegex(TerritoryValidationError, 'contiguous'):
            validate_territory_map(data)
        data['sites'][1] = {'id': 'patrol_1', 'type': 'stage', 'cellId': 5}
        with self.assertRaisesRegex(TerritoryValidationError, 'duplicate site id'):
            validate_territory_map(data)

    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.object(presets_io, 'DOC_SEVER_DIR', Path(directory) / 'sever'))

    def test_battle_id_survives_publishing_to_both_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'patrol_test.json'
            data = patrol_map(10002)
            data['sites'][0]['patrolId'] = 60001
            source.write_text(json.dumps(data), encoding='utf-8')
            resources, server = root / 'resources', root / 'sever'
            with patch.object(publisher, 'TARGET', resources), patch.object(publisher, 'DOC_TARGETS', (server,)):
                targets, _ = publisher.copy_one(source, False)
            self.assertEqual(len(targets), 2)
            self.assertEqual(json.loads(targets[0].read_text(encoding='utf-8'))['sites'][0]['patrolId'], 60001)
            self.assertEqual(targets[0].read_bytes(), targets[1].read_bytes())
            self.assertEqual(json.loads(targets[0].read_text(encoding='utf-8'))['sites'][0]['battleId'], 10002)

    def test_invalid_patrol_id_is_rejected_and_legacy_maps_are_accepted(self):
        self.assertNotIn('patrolId', validate_territory_map(patrol_map(10001))[0]['sites'][0])
        for patrol_id in [None, 0, -1, 1.5, '60001', True, 9007199254740992]:
            data = patrol_map(10001)
            data['sites'][0]['patrolId'] = patrol_id
            with self.subTest(patrol_id=patrol_id), self.assertRaisesRegex(TerritoryValidationError, 'patrolId'):
                validate_territory_map(data)
        data = patrol_map(10001)
        data['sites'][0] = {'id': 'stage_1', 'type': 'stage', 'cellId': 1, 'patrolId': 60001}
        with self.assertRaisesRegex(TerritoryValidationError, 'patrolId'):
            validate_territory_map(data)

    def test_invalid_battle_id_is_rejected_and_legacy_array_is_deprecated(self):
        for battle_id in [None, 0, -1, 1.5, '10001', True, 9007199254740992]:
            with self.subTest(battle_id=battle_id), self.assertRaisesRegex(TerritoryValidationError, 'battleId'):
                validate_territory_map(patrol_map(battle_id))
        missing = patrol_map(10001)
        del missing['sites'][0]['battleId']
        with self.assertRaisesRegex(TerritoryValidationError, 'battleId'):
            validate_territory_map(missing)
        # 旧的数组字段直接判错，别让它悄悄退回「按下标摊分」那套。
        legacy = patrol_map(10001)
        legacy['sites'][0]['battleIds'] = [10001]
        with self.assertRaisesRegex(TerritoryValidationError, 'deprecated'):
            validate_territory_map(legacy)

    def test_ordinary_sites_reject_patrol_battle_id(self):
        data = patrol_map(10001)
        data['sites'][0]['type'] = 'stage'
        with self.assertRaisesRegex(TerritoryValidationError, 'only valid for patrolChest'):
            validate_territory_map(data)


if __name__ == '__main__':
    unittest.main()
