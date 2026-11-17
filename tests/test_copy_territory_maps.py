import json
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parents[1] / 'tools' / 'map-editor'
sys.path.insert(0, str(SCRIPT_DIR))
import copy_territory_maps as publisher
import presets_io
import copy_maps
import copy_bigmap_maps


class CopyTerritoryMapsTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.sever = Path(directory) / 'sever'
        self.enterContext(patch.object(presets_io, 'DOC_SEVER_DIR', self.sever))

    def test_default_server_targets_are_classified(self):
        sever = presets_io.DOC_JSON_ROOT / 'sever'
        self.assertEqual(copy_maps.SEVER_TARGET, sever / 'battlemap')
        self.assertEqual(publisher.DOC_TARGETS, (sever / 'territorymap',))
        self.assertEqual(copy_bigmap_maps.DOC_TARGETS, (sever / 'slgmap',))

    def test_all_publishers_clean_flat_copies_only_after_success(self):
        for module, folder, preset_id in (
            (copy_maps, 'battlemap', 'river'),
            (publisher, 'territorymap', 'chapter_01'),
            (copy_bigmap_maps, 'slgmap', 'bigMap'),
        ):
            with self.subTest(folder=folder), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                sever = root / 'sever'
                sever.mkdir()
                source = module.SOURCE / f'{preset_id}.json'
                stale = sever / source.name
                stale.write_text('{"old":true}', encoding='utf-8')
                meta = stale.with_name(stale.name + '.meta')
                meta.write_text('{}', encoding='utf-8')
                unrelated = sever / 'item.json'
                unrelated.write_text('[]', encoding='utf-8')
                grouped = sever / folder / source.name
                with contextlib.ExitStack() as stack:
                    stack.enter_context(patch.object(presets_io, 'DOC_SEVER_DIR', sever))
                    stack.enter_context(patch.object(module, 'TARGET', root / 'resources'))
                    if module is copy_maps:
                        stack.enter_context(patch.object(module, 'SEVER_TARGET', grouped.parent))
                    else:
                        stack.enter_context(patch.object(module, 'DOC_TARGETS', (grouped.parent,)))
                    if module is copy_bigmap_maps:
                        stack.enter_context(patch.object(module, 'validate', return_value=(
                            json.loads(source.read_text(encoding='utf-8')), [], [])))
                    for dry_run in (True, False):
                        with contextlib.redirect_stdout(io.StringIO()):
                            if module is copy_maps:
                                argv = ['copy_maps.py', '--id', preset_id]
                                if dry_run:
                                    argv.append('--dry-run')
                                with patch.object(sys, 'argv', argv):
                                    module.main()
                            else:
                                module.copy_one(source, dry_run)
                        self.assertEqual(stale.exists(), dry_run)
                        self.assertEqual(meta.exists(), dry_run)
                        self.assertEqual(grouped.exists(), not dry_run)
                        self.assertTrue(unrelated.exists())
                    self.assertEqual(grouped.read_bytes(), (root / 'resources' / source.name).read_bytes())
                    self.assertFalse(grouped.with_name(grouped.name + '.meta').exists())

    def test_failed_publish_keeps_flat_copy(self):
        self.sever.mkdir()
        source = publisher.SOURCE / 'chapter_01.json'
        stale = self.sever / source.name
        stale.write_text('{"old":true}', encoding='utf-8')
        with patch.object(presets_io, 'publish', side_effect=OSError('write failed')):
            with self.assertRaises(OSError):
                publisher.copy_one(source, False)
        self.assertEqual(stale.read_text(encoding='utf-8'), '{"old":true}')

    def test_publishes_same_map_to_resources_and_server(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = root / 'resources'
            server = root / 'sever'
            source = publisher.SOURCE / 'chapter_01.json'
            with patch.object(publisher, 'TARGET', resources), patch.object(
                publisher, 'DOC_TARGETS', (server,)
            ):
                targets, _warnings = publisher.copy_one(source, False)

            expected = [resources / source.name, server / source.name]
            self.assertEqual(targets, expected)
            contents = [path.read_bytes() for path in expected]
            self.assertEqual(contents[0], contents[1])
            self.assertEqual(json.loads(contents[0].decode('utf-8'))['id'], 'chapter_01')
            self.assertTrue((resources / 'chapter_01.json.meta').exists())
            self.assertFalse((server / 'chapter_01.json.meta').exists())

    def test_dry_run_lists_all_targets_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = root / 'resources'
            server = root / 'sever'
            with patch.object(publisher, 'TARGET', resources), patch.object(
                publisher, 'DOC_TARGETS', (server,)
            ):
                targets, _warnings = publisher.copy_one(publisher.SOURCE / 'chapter_01.json', True)

            self.assertEqual(targets, [resources / 'chapter_01.json',
                                       server / 'chapter_01.json'])
            self.assertFalse(resources.exists())
            self.assertFalse(server.exists())

    def test_refuses_to_publish_into_planner_client(self):
        """护栏：落点落在策划 client 下必须报错，而不是悄悄生成 remoteRef 副本。"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = root / 'doc' / 'json' / 'client'
            server = root / 'sever'
            with patch.object(publisher, 'TARGET', client), patch.object(
                publisher, 'DOC_TARGETS', (server,)
            ), patch.object(presets_io, 'DOC_CLIENT_DIR', client):
                with self.assertRaises(ValueError):
                    publisher.copy_one(publisher.SOURCE / 'chapter_01.json', False)

            self.assertFalse(client.exists())
            self.assertFalse(server.exists())

    def test_purges_stale_client_copy(self):
        """自愈：client 里历史遗留的同名布局，发布时顺手删掉（含 .meta）。"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = root / 'doc' / 'json' / 'client'
            resources = root / 'resources'
            server = root / 'sever'
            client.mkdir(parents=True)
            stale = client / 'chapter_01.json'
            stale.write_text('{"stale":true}', encoding='utf-8')
            stale_meta = client / 'chapter_01.json.meta'
            stale_meta.write_text('{}', encoding='utf-8')
            with patch.object(publisher, 'TARGET', resources), patch.object(
                publisher, 'DOC_TARGETS', (server,)
            ), patch.object(presets_io, 'DOC_CLIENT_DIR', client):
                _targets, warnings = publisher.copy_one(publisher.SOURCE / 'chapter_01.json', False)

            self.assertFalse(stale.exists())
            self.assertFalse(stale_meta.exists())
            self.assertTrue(any('removed stale client copy' in item for item in warnings))

    def test_dry_run_reports_stale_client_copy_without_deleting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client = root / 'doc' / 'json' / 'client'
            resources = root / 'resources'
            server = root / 'sever'
            client.mkdir(parents=True)
            stale = client / 'chapter_01.json'
            stale.write_text('{"stale":true}', encoding='utf-8')
            with patch.object(publisher, 'TARGET', resources), patch.object(
                publisher, 'DOC_TARGETS', (server,)
            ), patch.object(presets_io, 'DOC_CLIENT_DIR', client):
                _targets, warnings = publisher.copy_one(publisher.SOURCE / 'chapter_01.json', True)

            self.assertTrue(stale.exists())
            self.assertTrue(any('would remove stale client copy' in item for item in warnings))


if __name__ == '__main__':
    unittest.main()
