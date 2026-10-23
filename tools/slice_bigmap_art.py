import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


BUILDINGS = [
    'headquarters', 'farm', 'sawmill', 'barracks',
    'ironworks', 'warehouse', 'construction', 'fortress',
]
DETAILS = [
    'mutant_camp', 'water_tower', 'rocks', 'grass',
    'grain', 'wood', 'iron', 'coin',
]
PANELS = ['header', 'detail', 'button', 'tab_idle', 'tab_active', 'badge', 'plot', 'stamina', 'home']


def slice_sheet(source, names, columns, output, category):
    sheet = Image.open(source).convert('RGBA')
    rows = (len(names) + columns - 1) // columns
    if sheet.getchannel('A').getextrema()[0] == 255:
        raise ValueError(f'{source}: 图集缺少透明通道')
    target = output / category
    target.mkdir(parents=True, exist_ok=True)
    records = []
    for index, name in enumerate(names):
        column, row = index % columns, index // columns
        region = (
            round(column * sheet.width / columns), round(row * sheet.height / rows),
            round((column + 1) * sheet.width / columns), round((row + 1) * sheet.height / rows),
        )
        cell = sheet.crop(region)
        alpha = cell.getchannel('A')
        bounds = alpha.point(lambda value: 255 if value > 16 else 0).getbbox()
        if bounds is None:
            raise ValueError(f'{source}: {name} 所在单元格为空')
        cell = cell.crop(bounds)
        padded = Image.new('RGBA', (cell.width + 8, cell.height + 8))
        padded.paste(cell, (4, 4))
        destination = target / f'{name}.png'
        padded.save(destination, optimize=True)
        records.append({
            'path': destination.relative_to(output).as_posix(),
            'size': list(padded.size), 'cell': index, 'sourceRect': list(region),
            'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
        })
    return records


def main():
    parser = argparse.ArgumentParser(description='拆分大地图与基地设计图资源，保留真实透明边缘。')
    parser.add_argument('--sprites', type=Path, required=True)
    parser.add_argument('--details', type=Path)
    parser.add_argument('--ui', type=Path, required=True)
    parser.add_argument('--background', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('assets/resources/image/bigmap/concept'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    records = slice_sheet(args.sprites, BUILDINGS, 4, args.output, 'sprites')
    if args.details:
        records += slice_sheet(args.details, DETAILS, 4, args.output, 'sprites')
    records += slice_sheet(args.ui, PANELS, 3, args.output, 'ui')
    backdrop = Image.open(args.background).convert('RGB')
    backdrop.thumbnail((900, 1600), Image.Resampling.LANCZOS)
    destination = args.output / 'base_ground.png'
    backdrop.save(destination, optimize=True)
    records.append({'path': 'base_ground.png', 'size': list(backdrop.size),
                    'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()})
    manifest = {'version': 1, 'source': '废土远征与我的基地效果图分层重建', 'assets': records}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'assets': len(records), 'output': str(args.output)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
