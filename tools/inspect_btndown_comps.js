const fs = require('fs');

const p = 'assets/bundles/main-pages/ui/Role/RoleEquipInfoPopup.prefab';
const json = JSON.parse(fs.readFileSync(p, 'utf-8'));

[97, 113, 129, 145, 161].forEach(nodeId => {
  const node = json[nodeId];
  console.log(`Node [${nodeId}] "${node._name}" components:`);
  for (const c of (node._components || [])) {
    console.log(`  comp [${c.__id__}]: ${json[c.__id__].__type__}`);
  }
});
