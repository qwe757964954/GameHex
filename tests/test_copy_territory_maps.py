import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parents[1] / 'tools' / 'map-editor'
sys.path.insert(0, str(SCRIPT_DIR))
import copy_territory_maps as publisher


class CopyTerritoryMapsTests(unittest.TestCase):
    def test_publishes_same_map_to_resources_server_and_client(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = root / 'resources'
            server = root / 'sever'
            client = root / 'client'
            source = publisher.SOURCE / 'chapter_01.json'
            with patch.object(publisher, 'TARGET', resources), patch.object(
                publisher, 'DOC_TARGETS', (server, client)
            ):
                targets, _warnings = publisher.copy_one(source, False)

            expected = [resources / source.name, server / source.name, client / source.name]
            self.assertEqual(targets, expected)
            contents = [path.read_bytes() for path in expected]
            self.assertEqual(contents[0], contents[1])
            self.assertEqual(contents[0], contents[2])
            self.assertEqual(json.loads(contents[0].decode('utf-8'))['id'], 'chapter_01')
            self.assertTrue((resources / 'chapter_01.json.meta').exists())
            self.assertFalse((server / 'chapter_01.json.meta').exists())
            self.assertFalse((client / 'chapter_01.json.meta').exists())

    def test_dry_run_lists_all_targets_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = root / 'resources'
            server = root / 'sever'
            client = root / 'client'
            with patch.object(publisher, 'TARGET', resources), patch.object(
                publisher, 'DOC_TARGETS', (server, client)
            ):
                targets, _warnings = publisher.copy_one(publisher.SOURCE / 'chapter_01.json', True)

            self.assertEqual(targets, [resources / 'chapter_01.json',
                                       server / 'chapter_01.json', client / 'chapter_01.json'])
            self.assertFalse(resources.exists())
            self.assertFalse(server.exists())
            self.assertFalse(client.exists())


if __name__ == '__main__':
    unittest.main()
