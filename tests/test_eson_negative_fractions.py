"""Exercise the actual Java exporter with float and double workbook columns."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/config'))
from patch_dawtianlu_aura_punch_excel import sheet_member
from sync_treant_excel import set_cell

ESON = ROOT.parent / 'doc/eson'
SOURCE = ROOT.parent / 'doc/塔防数据配置/PVP-克制羁绊.xlsx'


@unittest.skipUnless(SOURCE.is_file() and ESON.is_dir(), 'requires the local eSon toolchain')
class NegativeFractionExportTest(unittest.TestCase):
    def test_float_and_double_preserve_negative_and_positive_fractions(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            classes = stage / 'classes'
            classes.mkdir()
            classpath = str(ESON / 'lib/*') + ';' + str(ESON / 'lib64/*')
            subprocess.run(['javac', '--release', '8', '-encoding', 'UTF-8', '-cp', classpath,
                            '-d', str(classes), str(ROOT / 'tools/config/EsonCli.java')], check=True, capture_output=True)
            member = sheet_member(SOURCE, '羁绊')
            for kind in ['float', 'double']:
                book = stage / (kind + '.xlsx')
                with zipfile.ZipFile(SOURCE) as source, zipfile.ZipFile(book, 'w') as output:
                    for info in source.infolist():
                        data = source.read(info.filename)
                        if info.filename == member:
                            xml = set_cell(data.decode('utf-8'), 'I6', kind)
                            for row, value in zip(range(7, 11), [-0.1, -1.5, -2, 0.125]):
                                xml = set_cell(xml, 'I' + str(row), str(value))
                            data = xml.encode('utf-8')
                        output.writestr(info, data)
                destination = stage / kind
                subprocess.run(['java', '-Dfile.encoding=UTF-8', '-cp', str(classes) + ';' + classpath,
                                'EsonCli', str(book), str(destination)], check=True, capture_output=True)
                for side in ['client']:
                    rows = json.loads((destination / side / 'pvpBond.json').read_text(encoding='utf-8'))
                    self.assertEqual([row['effectValue'] for row in rows[:4]], [-0.1, -1.5, -2, 0.125])


if __name__ == '__main__':
    unittest.main()
