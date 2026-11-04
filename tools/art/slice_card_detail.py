"""Slice the approved 887x1774 card detail skin; Cocos generates all metadata.

Usage: python tools/art/slice_card_detail.py <text-free-skin.png> [clean-forest.png]
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/bundles/main-pages/image/carddetail'
SLICES = {
    'title_bar': (0, 0, 887, 92),
    'forest': (0, 92, 887, 606),
    'power_bar': (0, 606, 887, 700),
    'stats_panel': (0, 700, 887, 1018),
    'skills_panel': (0, 1018, 887, 1565),
    # Only the empty title timber: the footer's apparent gap contains the exp icon.
    'wood': (350, 8, 760, 79),
    'footer_panel': (8, 1568, 879, 1755),
    'upgrade_button': (492, 1587, 860, 1733),
    'hex_counter': (53, 1093, 211, 1219),
    'hex_passive': (213, 1093, 371, 1219),
    'hex_lock': (372, 1093, 530, 1219),
    'milestone_row': (39, 1276, 847, 1347),
    'tag_camp': (25, 188, 147, 242),
    'tag_class': (152, 188, 277, 242),
    'arrow_left': (57, 349, 136, 428),
    'arrow_right': (750, 349, 829, 428),
    'level_plaque': (309, 537, 577, 606),
    'quality_purple': (241, 101, 331, 191),
}

def main():
    source = Image.open(sys.argv[1]).convert('RGBA')
    if source.size != (887, 1774):
        raise ValueError(f'Expected 887x1774 approved skin, got {source.size}')
    OUT.mkdir(parents=True, exist_ok=True)
    for name, bounds in SLICES.items():
        tile = source.crop(bounds)
        if name == 'skills_panel':
            # One complete frame, with a clean interior for real skill slots and recycled rows.
            paper = source.crop((280, 1290, 800, 1338))
            tile.paste(paper.resize((817, 438), Image.Resampling.LANCZOS), (35, 76))
            tile = tile.resize((720, 395), Image.Resampling.LANCZOS)
        if name == 'title_bar':
            # Replace the baked right-hand X with empty timber from the same header.
            tile.paste(source.crop((680, 0, 784, 92)).transpose(Image.Transpose.FLIP_LEFT_RIGHT), (783, 0))
        if name in ('tag_camp', 'tag_class', 'arrow_left', 'arrow_right', 'quality_purple', 'level_plaque'):
            mask = Image.new('L', tile.size)
            draw = ImageDraw.Draw(mask)
            w, h = tile.size
            if name == 'quality_purple':
                draw.polygon([(w/2,0),(w-1,h/2),(w/2,h-1),(0,h/2)], fill=255)
            elif name == 'level_plaque':
                draw.polygon([(0,47),(8,31),(12,16),(24,22),(40,30),(41,18),(57,1),
                              (211,1),(230,18),(227,31),(240,24),(251,14),(258,30),
                              (267,38),(265,50),(252,65),(14,65)], fill=255)
            else:
                draw.rounded_rectangle((1,1,w-2,h-2), radius=12, fill=255)
            tile.putalpha(mask)
        tile.save(OUT / f'{name}.png')
    if len(sys.argv) > 2:
        forest = Image.open(sys.argv[2]).convert('RGBA')
        if abs(forest.width / forest.height - 887 / 514) > .03:
            raise ValueError(f'Forest aspect ratio differs from the design: {forest.size}')
        forest = forest.resize((887, 514), Image.Resampling.LANCZOS)
        forest.save(OUT / 'forest.png')
    (OUT / 'slices.json').write_text(json.dumps({
        'sourceSize': list(source.size), 'slices': SLICES,
        'source': 'output/card-detail/skin.png',
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Sliced {len(SLICES)} images into {OUT}')

if __name__ == '__main__':
    main()
