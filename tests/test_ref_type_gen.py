import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'tools' / 'ref' / 'ref_ref_type_all_gen.py'


class RefTypeGeneratorTests(unittest.TestCase):
    def test_skips_chapter_map_json_and_generates_tabular_ref(self):
        with tempfile.TemporaryDirectory(prefix='ref-type-gen-') as temp:
            root = Path(temp)
            script = root / 'tools' / 'ref' / SCRIPT.name
            script.parent.mkdir(parents=True)
            shutil.copyfile(SCRIPT, script)
            source = root / 'client'
            source.mkdir()
            (source / 'sample.json').write_text(json.dumps([{'id': 1, 'name': 'sample'}]), encoding='utf-8')
            (source / 'chapter_01.json').write_text(json.dumps({'version': 1, 'sites': []}), encoding='utf-8')
            output = root / 'assets' / 'script' / 'app' / 'generated' / 'refGen'
            output.mkdir(parents=True)

            result = subprocess.run([sys.executable, str(script), str(source)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            generated = (output / 'ref_type_all.d.ts').read_text(encoding='utf-8')
            self.assertIn('interface IRefsample', generated)
            self.assertNotIn('IRefchapter_01', generated)


if __name__ == '__main__':
    unittest.main()
