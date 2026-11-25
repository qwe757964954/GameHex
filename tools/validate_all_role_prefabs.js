const { callMcp } = require('./mcp_helper');

async function main() {
  console.log('--- 1. Refreshing Assets in Cocos Editor ---');
  const refreshRes = await callMcp('execute_javascript', {
    context: 'editor',
    code: `(async () => {
      await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/bundles/main-pages/ui/Role');
      return { ok: true, refreshed: 'Role prefabs' };
    })()`
  });
  console.log('Refresh result:', JSON.stringify(refreshRes, null, 2));

  console.log('\n--- 2. Validating Prefabs ---');
  const prefabs = [
    'db://assets/bundles/main-pages/ui/Role/RoleEquipInfoPopup.prefab',
    'db://assets/bundles/main-pages/ui/Role/RoleGemInfoPopup.prefab',
    'db://assets/bundles/main-pages/ui/Role/EquipEvolve.prefab',
    'db://assets/bundles/main-pages/ui/Role/EquipWash.prefab',
    'db://assets/bundles/main-pages/ui/Role/RoleGongMing.prefab'
  ];

  for (const p of prefabs) {
    const valRes = await callMcp('validate_prefab_references', { prefabPath: p });
    console.log(`\nValidation for ${p}:`);
    console.log(valRes.result?.content?.[0]?.text);
  }
}

main().catch(console.error);
