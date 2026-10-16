import json

with open(r'g:\Warcraft1001\client\assets\remoteRef\guankaReward.json', encoding='utf-8') as f:
    d = json.load(f)

ks = d['k']
rows = d['v']

def idx(name):
    return ks.index(name)

print('=== keys ===')
print(ks)
print('=== total rows ===')
print(len(rows))

print('\n=== first 15 rows (level, instanceType, chapter, stage, relateId) ===')
for row in rows[:15]:
    print({
        'level': row[idx('level')],
        'instanceType': row[idx('instanceType')],
        'chapter': row[idx('chapter')],
        'stage': row[idx('stage')],
        'relateId': row[idx('relateId')],
    })
