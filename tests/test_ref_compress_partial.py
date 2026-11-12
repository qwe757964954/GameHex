import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PartialRefExportTests(unittest.TestCase):
    def test_partial_export_preserves_other_tables_and_small_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scripts = root / 'tools/ref'
            scripts.mkdir(parents=True)
            for name in ['ref_compress_json.py', 'small.txt', 'exclude.txt', 'nocompressed.txt']:
                shutil.copyfile(ROOT / 'tools/ref' / name, scripts / name)
            source = root / 'client'
            source.mkdir()
            output = root / 'assets/remoteRef'
            output.mkdir(parents=True)
            for name in ['pvpBond', 'activity', 'unrelated']:
                (source / (name + '.json')).write_text(json.dumps([{'id': 1, 'value': -0.1}]), encoding='utf8')
            unchanged = b'[ { "existing": true } ]\r\n'
            (output / 'unrelated.json').write_bytes(unchanged)
            aggregate = b'{ "keep": {"id": 8} }\r\n'
            (output / 'refSmallAll.json').write_bytes(aggregate)

            def run(table):
                result = subprocess.run([sys.executable, str(scripts / 'ref_compress_json.py'),
                                         str(source), '--table', table], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)

            run('pvpBond')
            self.assertTrue((output / 'pvpBond.json').exists())
            self.assertEqual((output / 'refSmallAll.json').read_bytes(), aggregate)
            self.assertEqual((output / 'unrelated.json').read_bytes(), unchanged)
            run('activity')
            small = json.loads((output / 'refSmallAll.json').read_text(encoding='utf8'))
            self.assertEqual(small['keep'], {'id': 8})
            self.assertIn('activity', small)
            self.assertEqual((output / 'unrelated.json').read_bytes(), unchanged)


if __name__ == '__main__':
    unittest.main()
