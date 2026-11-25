const fs = require('fs');

const p = 'assets/bundles/main-pages/ui/Role/RoleEquipInfoPopup.prefab';
const json = JSON.parse(fs.readFileSync(p, 'utf-8'));

for (let i = 0; i < json.length; i++) {
  const item = json[i];
  if (item.__type__ === '9c8bawIn8BBfpf2fERHnCy1') {
    console.log(`Component [${i}] on node ${item.node?.__id__}:`, item);
    console.log('  descLabel:', json[item.descLabel?.__id__]);
    console.log('  btnDown:', json[item.btnDown?.__id__]);
    console.log('  iconSprite:', json[item.iconSprite?.__id__]);
  }
}
