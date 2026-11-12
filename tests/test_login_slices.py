import json
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/art'))
import slice_login


class LoginSlicesTest(unittest.TestCase):
    def test_slices_reproduce_approved_source_and_match_cocos_borders(self):
        original = slice_login.OUT
        try:
            with tempfile.TemporaryDirectory() as directory:
                slice_login.OUT = Path(directory)
                slice_login.main()
                manifest = json.loads((slice_login.OUT / 'login-slices.json').read_text())
                self.assertEqual(len(manifest), 14)
                for name, entry in manifest.items():
                    with self.subTest(name=name):
                        self.assertEqual((slice_login.OUT / f'{name}.png').read_bytes(), (original / f'{name}.png').read_bytes())
                        with Image.open(original / f'{name}.png') as image:
                            self.assertEqual(list(image.size), entry['size'])
                            self.assertEqual(image.mode, 'RGBA')
                            self.assertEqual(image.getpixel((0, 0))[3], 0)
                        meta = json.loads((original / f'{name}.png.meta').read_text())
                        data = meta['subMetas']['f9941']['userData']
                        self.assertEqual(data['trimType'], 'custom')
                        if 'borders' in entry:
                            self.assertEqual([data[k] for k in ['borderLeft', 'borderRight', 'borderTop', 'borderBottom']], entry['borders'])
                self.assertTrue((original / 'auto-atlas.pac').is_file())
        finally:
            slice_login.OUT = original


if __name__ == '__main__':
    unittest.main()
