import json, re, sys

path = sys.argv[1] if len(sys.argv) > 1 else '../assets/resources/config/protoCompiled.json'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Remove "edition": "proto2" lines (with optional trailing comma)
content = re.sub(r',?\s*"edition":\s*"proto2"', '', content)

# Clean up resulting double commas: }, , → },
content = re.sub(r',\s*,', ',', content)

# Clean up { , → {
content = re.sub(r'\{\s*,', '{', content)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'edition stripped from {path}')
