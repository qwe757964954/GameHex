"""Audit source images against asset UUIDs, runtime strings/configs and dynamic names.

Read-only: deletion is deliberately handled by Cocos after reviewing this report.
Image metadata's references to itself and auto-atlas membership are not consumers.
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tga', '.svg'}
TEXT_EXTENSIONS = {'.ts', '.js', '.json', '.prefab', '.scene', '.mtl', '.effect',
                   '.anim', '.fnt', '.txt', '.atlas', '.meta', '.plist', '.fire'}
UUID = re.compile(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}')
COMPRESSED = re.compile(r'(?<![\w+/])[A-Za-z0-9+/]{22}(?=@|[\s\"\x27,}]|$)')
BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

# Reviewed loadDir selectors. Whole-directory loading alone does not prove usage:
# buildings are selected by configuration; cloud art is filtered by these prefixes.
DIRECTORY_CONSUMERS = [
    ('assets/script/app/zcds/application/ZCGameLoader.ts',
     'image/effects/artifact_claim_burst', r'artifact_claim_burst_\d+',
     ['this.loadSortedSpriteFrames(ARTIFACT_CLAIM_BURST_DIRECTORY']),
    ('assets/script/app/zcds/application/ZCGameLoader.ts',
     'image/effects/hex_ground_glow', r'hex_ground_glow_\d+',
     ['this.loadSortedSpriteFrames(HEX_GROUND_GLOW_DIRECTORY']),
    ('assets/script/app/zcds/application/ZCGameLoader.ts',
     'image/effects/hex_pulse_seq', r'hex_pulse_\d+',
     ['this.loadSortedSpriteFrames(HEX_FLIP_PULSE_DIRECTORY']),
    ('assets/script/app/main/MainTerritoryMap.ts',
     'image/territory/cloud', r'cloud_(?:(?:body|shadow)_|dissolve_(?:body|shadow)_)\d+',
     ['loadDir(TERRITORY_CLOUD_ART_ROOT', "body: 'cloud_body_'", "shadow: 'cloud_shadow_'",
      "dissolveBody: 'cloud_dissolve_body_'", "dissolveShadow: 'cloud_dissolve_shadow_'"]),
]


def source_strings(source):
    """Read literals without treating apostrophes/backticks in TS comments as code."""
    index = 0
    while index < len(source):
        if source.startswith('//', index):
            end = source.find('\n', index + 2)
            index = end if end >= 0 else len(source)
        elif source.startswith('/*', index):
            end = source.find('*/', index + 2)
            index = end + 2 if end >= 0 else len(source)
        elif source[index] in "\"'`":
            quote = source[index]
            start = index = index + 1
            while index < len(source):
                if source[index] == '\\':
                    index += 2
                elif source[index] == quote:
                    yield source[start:index]
                    index += 1
                    break
                else:
                    index += 1
        else:
            index += 1


def compressed_uuid(uuid):
    value = uuid.replace('-', '')
    return value[:2] + ''.join(BASE64[int(value[i:i + 3], 16) >> 6]
                              + BASE64[int(value[i:i + 3], 16) & 63]
                              for i in range(2, 32, 3))


def audit(root):
    assets = root / 'assets'
    images = sorted(path for path in assets.rglob('*') if path.suffix.lower() in IMAGE_EXTENSIONS)
    consumers = []
    # Do not count tests, documentation, tools or generated build output as game consumers.
    for base in [assets, root / 'settings']:
        if not base.exists():
            continue
        for path in base.rglob('*'):
            if path.suffix not in TEXT_EXTENSIONS or path.name.endswith('.d.ts'):
                continue
            if path.suffix == '.meta' and Path(str(path)[:-5]).suffix.lower() in IMAGE_EXTENSIONS:
                continue
            consumers.append((path.relative_to(root).as_posix(), path.read_text('utf-8', errors='replace')))

    uuids, names, constants, templates = {}, {}, {}, []
    for path, source in consumers:
        own = None
        if path.endswith('.meta'):
            try:
                own = json.loads(source).get('uuid')
            except (ValueError, AttributeError):
                pass
        for uuid in [*UUID.findall(source), *COMPRESSED.findall(source)]:
            if uuid != own:
                uuids.setdefault(uuid.lower(), path)
        for value in source_strings(source):
            if '${' in value:
                templates.append((value, path))
            else:
                leaf = value.replace('\\', '/').rsplit('/', 1)[-1]
                if leaf:
                    names.setdefault(leaf, path)
                    if Path(leaf).suffix.lower() in IMAGE_EXTENSIONS:
                        names.setdefault(Path(leaf).stem, path)
        for filename in re.findall(r'(?m)^([^\r\n]+\.(?:png|jpg|jpeg))\s*$', source):
            names.setdefault(Path(filename).stem, path)
        if path.endswith('.ts'):
            for match in re.finditer(r'\bconst\s+(\w+)\s*=\s*([\x27"`])([^\r\n]*?)\2\s*;', source):
                constants.setdefault(match[1], match[3])

    for _ in range(8):
        for key, value in constants.items():
            constants[key] = re.sub(r'\$\{(\w+)\}', lambda m: constants.get(m[1], m[0]), value)
    dynamic = []
    for value, path in templates:
        if value.count('${') != value.count('}'):
            continue
        resolved = re.sub(r'\$\{(\w+)\}', lambda m: constants.get(m[1], m[0]), value)
        literal = re.sub(r'\$\{[^}]*\}', '', resolved)
        # A directory-only loader such as image/${path} is not proof that every image is used.
        leaf = literal.rsplit('/', 1)[-1]
        leaf = re.sub(r'\.(png|jpg|jpeg)$', '', leaf)
        if len(re.sub(r'[^\w\u4e00-\u9fff]', '', leaf)) < 3:
            continue
        parts = re.split(r'(\$\{[^}]*\})', resolved)
        pattern = ''.join('.*' if part.startswith('${') else re.escape(part) for part in parts)
        dynamic.append((re.compile('^(?:.*/)?' + pattern + '$'), path, value))

    used, unused = [], []
    consumer_sources = dict(consumers)
    for image in images:
        relative = image.relative_to(root).as_posix()
        meta_path = Path(str(image) + '.meta')
        meta = json.loads(meta_path.read_text('utf-8')) if meta_path.exists() else {}
        uuid = meta.get('uuid', '')
        reason = None
        for candidate in [uuid, compressed_uuid(uuid) if uuid else '']:
            if candidate and candidate.lower() in uuids:
                reason = {'kind': 'uuid', 'consumer': uuids[candidate.lower()]}
                break
        if reason is None and image.stem in names:
            reason = {'kind': 'name', 'consumer': names[image.stem]}
        if reason is None:
            parts = image.parts
            offset = parts.index('bundles') + 2 if 'bundles' in parts else parts.index('resources') + 1
            asset_path = '/'.join(parts[offset:])
            values = [image.stem, image.name, asset_path, asset_path.rsplit('.', 1)[0]]
            for pattern, consumer, expression in dynamic:
                if any(pattern.fullmatch(value) for value in values):
                    reason = {'kind': 'dynamic', 'consumer': consumer, 'expression': expression}
                    break
            if reason is None:
                for consumer, directory, selection, tokens in DIRECTORY_CONSUMERS:
                    source = consumer_sources.get(consumer, '')
                    if (asset_path.rsplit('/', 1)[0] == directory
                            and re.fullmatch(selection, image.stem)
                            and all(token in source for token in tokens)):
                        reason = {'kind': 'directory-selection', 'consumer': consumer,
                                  'selection': selection}
                        break
        record = {'path': relative, 'bytes': image.stat().st_size}
        if reason:
            used.append({**record, **reason})
        else:
            unused.append(record)
    return {'imageCount': len(images), 'usedCount': len(used), 'unusedCount': len(unused),
            'unusedBytes': sum(item['bytes'] for item in unused), 'used': used, 'unused': unused}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--report', type=Path, default=Path('tmp/image-usage-audit.json'))
    args = parser.parse_args()
    result = audit(args.root.resolve())
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in result.items() if key not in ['used', 'unused']}))
    print(json.dumps(dict(Counter('/'.join(item['path'].split('/')[:-1]) for item in result['unused'])), ensure_ascii=False))


if __name__ == '__main__':
    main()
