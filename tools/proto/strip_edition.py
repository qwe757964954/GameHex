import json, re, sys
import os

# 脚本位于 <项目根>/tools/proto/，项目根 = 上两级目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(PROJECT_ROOT, 'assets', 'resources', 'config', 'protoCompiled.json')

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
