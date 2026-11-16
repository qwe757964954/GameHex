import json
import os
import sys

import psutil

TARGET = '技能设计案2'
SKIP_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'tmp', 'skip_pids.json')

skip = set()
if os.path.exists(SKIP_FILE):
    skip = set(json.load(open(SKIP_FILE, encoding='utf-8')))

for proc in psutil.process_iter(['pid', 'name']):
    pid = proc.info['pid']
    if pid in skip:
        continue
    print('SCAN %d %s' % (pid, proc.info['name']), flush=True)
    try:
        for handle in proc.open_files():
            if TARGET in handle.path:
                print('HIT %d %s %s' % (pid, proc.info['name'], handle.path), flush=True)
    except Exception:
        pass
print('DONE', flush=True)
