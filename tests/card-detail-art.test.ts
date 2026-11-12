import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const folder = 'assets/bundles/main-pages/image/carddetail';
const frame = (name: string) => JSON.parse(readFileSync(`${folder}/${name}.png.meta`, 'utf8')).subMetas.f9941.uuid;
const readPrefab = (name: string) => JSON.parse(readFileSync(`assets/bundles/main-pages/ui/card/${name}.prefab`, 'utf8'));
const component = (prefab, node, type: string) => node._components.map(ref => prefab[ref.__id__]).find(c => c.__type__ === type);
const named = (prefab, name: string) => prefab.find(n => n.__type__ === 'cc.Node' && n._name === name);

test('详情与单技能弹窗使用各自的蓝湖切图', () => {
    const detail = readPrefab('CardUpgrade');
    const skill = readPrefab('CardSkill');
    for (const [prefab, name] of [[detail, 'BodyPaper']]) {
        const sprite = component(prefab, named(prefab, name), 'cc.Sprite');
        assert.equal(sprite._spriteFrame.__uuid__, frame('upgrade/kp_bg'));
        assert.equal(sprite._type, 1);
        assert.equal(sprite._isTrimmedMode, false);
    }
    for (const name of ['StatsPanel', 'SkillsPanel', 'UpgradePanel']) {
        assert.equal(component(detail, named(detail, name), 'cc.Sprite')._enabled, false, `${name} 不重复绘制带黑边的底板`);
    }
    const panel = named(skill, 'SkillPanel');
    assert.equal(component(skill, panel, 'cc.Sprite')._spriteFrame.__uuid__, frame('skill/jntc_bg'));
    assert.deepEqual(component(skill, panel, 'cc.UITransform')._contentSize, { __type__: 'cc.Size', width: 651, height: 675 });
    assert.equal(component(skill, named(skill, 'UpgradeSkillButton'), 'cc.Sprite')._spriteFrame.__uuid__, frame('skill/btn_01'));
    assert.equal(component(skill, named(skill, 'SkillContent'), 'cc.Widget')._verticalCenter, -20);
    assert.equal(named(skill, 'SkillContent')._lscale.x, 1);
    const iconSize = component(skill, named(skill, 'SkillIcon'), 'cc.UITransform')._contentSize;
    assert.equal(iconSize.width, 103); assert.equal(iconSize.height, 116);
    assert.equal(component(skill, named(skill, 'SkillName'), 'cc.UITransform')._contentSize.width, 444);
    for (const name of ['CoinCount', 'MaterialCount']) assert.equal(component(skill, named(skill, name), 'cc.UITransform')._contentSize.width, 65);
    for (let i = 1; i <= 1; i++) {
        assert.equal(component(skill, named(skill, `Tier${i}Unlocked`), 'cc.Sprite')._spriteFrame.__uuid__, frame('skill/jn_frame_02'));
        assert.equal(component(skill, named(skill, `Tier${i}Locked`), 'cc.Sprite')._spriteFrame.__uuid__, frame('skill/jn_frame_01'));
        // 档位描述是 RichText（数字分两色），字号/行高/宽度口径不变；粗体靠 <b> 保住。
        const desc = component(skill, named(skill, `Tier${i}Desc`), 'cc.RichText');
        assert.equal(desc._fontSize, 22);
        assert.equal(desc._lineHeight, 25);
        assert.equal(desc._maxWidth, 428);
        assert.equal(component(skill, named(skill, `Tier${i}Desc`), 'cc.UITransform')._contentSize.width, 428);
        assert.equal(desc._handleTouchEvent, false);
        assert.equal(desc._fontFamily, 'Microsoft YaHei');
    }
    for (const name of ['StatHp','StatAttack','StatBuildHp','StatSpawn','StatRange','StatSpeed']) {
        const group = named(detail, name);
        const icon = group._children.map(ref => detail[ref.__id__]).find(n => n._name === 'Icon');
        assert.ok(component(detail, icon, 'cc.Sprite')._spriteFrame, `${name} 必须使用独立图标`);
    }
    for (const name of ['skill_popup_skin','stats_panel','skills_panel','power_bar']) {
        assert.equal(existsSync(`${folder}/${name}.png`), false, `${name} 不应重新进入图集`);
    }
});

test('CardUpgrade 蓝湖切图、底部导航与属性图标接线保持完整', () => {
    const detail = readPrefab('CardUpgrade');
    const expected = {
        Bg: 'kp_bg_02', TitleBar: 'bg_01', CloseBtn: 'btn_fanhui',
        BtnUpgrade: 'btn_s_02', PowerBadge: 'xxk_di',
        PowerIcon: 'icon_zhanli', LevelPlaque: 'dj_bg', RowBg: 'frame_02',
    };
    for (const [name, art] of Object.entries(expected)) {
        const sprite = component(detail, named(detail, name), 'cc.Sprite');
        assert.equal(sprite._spriteFrame.__uuid__, frame(`upgrade/${art}`), name);
        assert.equal(sprite._isTrimmedMode, false, name);
    }
    for (const [name, art] of Object.entries({
        StatHp: 'icon_bzxl', StatAttack: 'icon_gjl', StatBuildHp: 'icon_jzxl',
        StatSpawn: 'icon_scsj', StatRange: 'icon_gjfw', StatSpeed: 'icon_ydsd',
    })) {
        const group = named(detail, name);
        const icon = group._children.map(ref => detail[ref.__id__]).find(n => n._name === 'Icon');
        assert.equal(component(detail, icon, 'cc.Sprite')._spriteFrame.__uuid__, frame(`upgrade/${art}`));
        assert.equal(component(detail, group, 'cc.Sprite')._spriteFrame.__uuid__, frame('upgrade/frame_03'));
    }
    const next = named(detail, 'NextBtn');
    assert.equal(next._lscale.x, -1, '右箭头复用左箭头并镜像');
    assert.equal(detail[named(detail, 'LevelPlaque')._parent.__id__]._name, 'SkillHeader');
    assert.equal(detail.some(n => n.__type__ === 'cc.Node' && n._name === 'Title' && n._active), false, '设计稿上方没有旧木质标题栏');
    const panel = component(detail, named(detail, 'SkillsPanel'), 'cc.Widget');
    const viewport = component(detail, named(detail, 'MilestoneViewport'), 'cc.Widget');
    assert.equal(panel._isAbsBottom, false);
    for (const height of [1280, 1560, 1610]) {
        assert.ok(height - panel._top - height * panel._bottom - viewport._top - viewport._bottom > 0,
            `${height} 高度仍有可滚动的技能说明区域`);
    }
});

test('CardUpgrade 按蓝湖标注校准字体、基线与列表行宽', () => {
    const detail = readPrefab('CardUpgrade');
    const label = name => component(detail, named(detail, name), 'cc.Label');
    const transform = name => component(detail, named(detail, name), 'cc.UITransform');
    const header = named(detail, 'Header');
    const name = header._children.map(ref => detail[ref.__id__]).find(n => n._name === 'NameLabel');
    assert.equal(name._lpos.x, -249);
    assert.equal(component(detail, name, 'cc.UITransform')._anchorPoint.x, 0, '标题从品质图标右边开始');
    assert.equal(component(detail, name, 'cc.Label')._fontFamily, 'Microsoft YaHei');
    assert.equal(component(detail, name, 'cc.Label')._fontSize, 34);
    assert.equal(component(detail, name, 'cc.Label')._isBold, true);
    assert.equal(label('PowerLabel')._fontSize, 33);
    assert.deepEqual(label('PowerLabel')._color, { __type__: 'cc.Color', r:250, g:184, b:3, a:255 });
    assert.equal(transform('Hero')._anchorPoint.y, 0, '模型脚底基线不随 RAW 立绘尺寸变化');
    assert.equal(named(detail, 'Hero')._lpos.y, -179, '锚点 y=0，这个值就是脚点；展示栏压缩后跟着上移');
    // DescLabel 是 RichText（数字要分两色），字号/宽度口径不变。
    const desc = component(detail, named(detail, 'DescLabel'), 'cc.RichText');
    assert.equal(desc._fontSize, 24);
    assert.equal(desc._lineHeight, 28);
    assert.equal(desc._fontFamily, 'Microsoft YaHei');
    assert.equal(transform('DescLabel')._contentSize.width, 514);
    assert.equal(transform('Row0')._contentSize.height, 61);
    assert.equal(component(detail, named(detail, 'LevelTab'), 'cc.Sprite')._spriteFrame.__uuid__, frame('upgrade/btn_s_02'));
    const layout = named(detail, 'Layout');
    const order = layout._children.map(ref => detail[ref.__id__]._name);
    assert.ok(order.indexOf('BodyPaper') < order.indexOf('TopRegion'));
    const page = detail.find(c => c.closeButton);
    for (const key of ['pageTransform', 'topRegion', 'skillsWidget', 'paperWidget']) assert.equal(key in page, false);
});

test('CardUpgrade 使用 Widget 调整区域间距，短屏不缩放内容，底部控件仍容纳在各自区域', () => {
    const detail = readPrefab('CardUpgrade');
    const widget = name => component(detail, named(detail, name), 'cc.Widget');
    const heightOf = name => component(detail, named(detail, name), 'cc.UITransform')._contentSize.height;
    const areaHeight = (name, parentHeight) => {
        const w = widget(name);
        return parentHeight - w._top * (w._isAbsTop ? 1 : parentHeight) - w._bottom * (w._isAbsBottom ? 1 : parentHeight);
    };
    const root = detail[detail[0].data.__id__];
    assert.equal(component(detail, root, 'cc.Widget')._top, 0);
    assert.equal(component(detail, root, 'cc.Widget')._bottom, 0);
    for (const name of ['TopRegion', 'BottomRegion', 'SkillsPanel', 'BtnUpgrade', 'CloseBtn', 'LevelTab']) {
        assert.deepEqual(named(detail, name)._lscale, { __type__:'cc.Vec3', x:1, y:1, z:1 }, name);
    }
    for (const height of [1280, 1560, 1610]) {
        const footer = areaHeight('BottomRegion', height);
        const nav = areaHeight('TitleBar', footer);
        const materials = areaHeight('UpgradePanel', footer);
        assert.ok(nav >= Math.max(heightOf('CloseBtn'), heightOf('LevelTab')));
        assert.ok(materials >= heightOf('BtnUpgrade'));
        assert.ok(areaHeight('RewardStrip', footer) >= heightOf('Hint'));
        assert.ok(areaHeight('SkillsPanel', height) - heightOf('SkillHeader') > 0);
        assert.ok(Math.abs(widget('SkillsPanel')._bottom * height - footer) < 0.001);
        assert.ok(Math.abs(widget('BodyPaper')._bottom * height - nav) < 0.001);
        if (height === 1610) assert.ok(Math.abs(footer - 350) < 0.001);
    }
});

test('技能链使用 103×116 原始六边形、独立金色图案和锁定层，蓝紫标签与角标按标注定位', () => {
    const detail = readPrefab('CardUpgrade');
    for (const name of ['HexTemplate']) {
        const slot = named(detail, name);
        const children = slot._children.map(ref => detail[ref.__id__]);
        const child = name => children.find(n => n._name === name);
        const data = slot._components.map(ref => detail[ref.__id__]).find(c => c.hexSprite);
        for (const key of ['hexSprite', 'skillArt', 'nameLabel', 'nameTransform', 'namePlate', 'namePlateTransform', 'badgeTransform', 'badgeWidget', 'badgeSprite', 'badgeLabel']) {
            assert.ok(detail[data[key].__id__].node, `${slot._name}.${key} 绑定组件`);
        }
        assert.equal(detail[data.lockRoot.__id__]._name, 'LockRoot');
        const bounds = component(detail, child('HexSprite'), 'cc.UITransform')._contentSize;
        assert.equal(bounds.width, 103);
        assert.equal(bounds.height, 116);
        assert.equal(data.normalNamePlateFrame.__uuid__, frame('upgrade/frame_s_01'));
        assert.equal(data.activeNamePlateFrame.__uuid__, frame('upgrade/frame_s_02'));
        for (const [name, art] of Object.entries({ HexSprite:'jineng_bg', SkillArt:'jineng_01', LockRoot:'zhezhap_02', NamePlate:'frame_s_01' })) {
            const sprite = component(detail, child(name), 'cc.Sprite');
            assert.equal(sprite._spriteFrame.__uuid__, frame(`upgrade/${art}`));
            assert.equal(sprite._isTrimmedMode, false);
        }
        const lock = detail[child('LockRoot')._children[0].__id__];
        assert.equal(component(detail, lock, 'cc.Sprite')._spriteFrame.__uuid__, frame('upgrade/icon_lock'));
        assert.equal(component(detail, slot, 'cc.Widget'), undefined, '模板位置交给虚拟列表，不能由 Widget 覆盖');
        assert.equal(component(detail, child('NameLabel'), 'cc.Label')._overflow, 2, '长技能名在标签内缩字，锁定说明单独展开宽度');
        assert.equal(component(detail, child('Badge'), 'cc.Widget')._left, 73);
        assert.deepEqual(children.map(n => n._name), ['HexSprite','SkillArt','LockRoot','NamePlate','NameLabel','Badge']);
    }
    const source = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
    assert.doesNotMatch(source, /loadDetailFrame|loadCardDetailArt|hex_counter|hex_passive|hex_lock/);
});


test('单技能弹窗按 720×1610 蓝湖原尺寸定位，短屏由 Widget 居中而不缩放', () => {
    const prefab = readPrefab('CardSkill');
    const root = prefab[prefab[0].data.__id__];
    const group = named(prefab, 'SkillContent');
    assert.equal(component(prefab, root, 'cc.Widget')._alignFlags, 45);
    const center = component(prefab, group, 'cc.Widget');
    assert.equal(center._alignFlags, 18);
    assert.equal(center._horizontalCenter, -0.5);
    assert.equal(center._verticalCenter, -20);
    for (const [name, expected] of [['SkillPanel', [34,416,651,675]], ['UpgradeSkillButton', [215,1126,277,108]]] as const) {
        const node = named(prefab, name);
        const size = component(prefab, node, 'cc.UITransform')._contentSize;
        const x = 360 + group._lpos.x + node._lpos.x - size.width / 2;
        const y = 805 - group._lpos.y - node._lpos.y - size.height / 2;
        assert.deepEqual([x,y,size.width,size.height], expected);
        assert.equal(node._lscale.x, 1); assert.equal(node._lscale.y, 1);
    }
    const resUuid = JSON.parse(readFileSync('assets/resources/ui/common/ResBar.prefab.meta', 'utf8')).uuid;
    assert.ok(prefab.some(n => n.__type__ === 'cc.PrefabInfo' && n.asset?.__uuid__ === resUuid));
    assert.ok(prefab.some(n => n.__type__ === 'CCPropertyOverrideInfo' && n.propertyPath?.join('.') === 'resKeys' && n.value === 'gold'));
});
