/**
 * 守护怪格的锁定态渲染 —— 用户 2026-11-24 需求：
 * 「4 级解锁文案写在 icon 下方（同数量 UI 对齐）；锁 icon 居中显示，提前披露出具体的怪物
 * 样式 icon，不用纯色的底」。
 *
 * 版面位置由 `territory-monster-box-prefab-refs.test.ts` 钉在 prefab 上（锁 y=0、
 * 解锁文案与数量同 y 同色、`LockBg` 已删）；这里钉**行为**：锁定也要画头像，只有锁与文案变。
 *
 * 视图组件拖 `cc` 运行时 ⇒ 走统一沙箱 `loadTsModule` + `ccStub`（桩表不完整就断言失败，
 * 免得测到空气）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ccStub, loadTsModule } from './helpers/cc-sandbox';

const SLOT_TS = 'assets/script/app/territory/view/TerritoryMonsterBoxGuardSlot.ts';

interface IActive {
    active: boolean;
}

interface ILabelBox {
    string: string;
    node: IActive;
}

/** 建一个注入了「假节点」的守护格组件（`@property` 字段运行时就是普通属性）。 */
function createSlot(): {
    render: (guard?: { icon: unknown; unlocked: boolean; unlockText: string; countText: string }) => void;
    node: IActive;
    cardBg: IActive;
    iconNode: IActive;
    icon: { spriteFrame: unknown };
    lock: IActive;
    unlockLabel: ILabelBox;
    countLabel: ILabelBox;
} {
    const { exports, unresolved } = loadTsModule<{ TerritoryMonsterBoxGuardSlot: new () => unknown }>(SLOT_TS, {
        modules: { cc: ccStub() },
    });
    assert.deepEqual(unresolved, [], 'cc 桩表必须完整：漏桩会让未走到的分支静默变绿');
    const slot = new exports.TerritoryMonsterBoxGuardSlot() as {
        render: (guard?: unknown) => void;
    };
    const iconNode: IActive = { active: false };
    const boxes = {
        node: { active: true } as IActive,
        cardBg: { active: false } as IActive,
        iconNode,
        icon: { spriteFrame: null as unknown, node: iconNode },
        lock: { active: false } as IActive,
        unlockLabel: { string: '', node: { active: false } } as ILabelBox,
        countLabel: { string: '', node: { active: false } } as ILabelBox,
    };
    Object.assign(slot, boxes);
    return { ...boxes, render: slot.render.bind(slot) };
}

const FRAME = { name: 'head-1' };

test('★★锁定态也画头像：米黄底常开、锁压在中间、解锁文案顶替「数量」那一行', () => {
    const slot = createSlot();
    slot.render({ icon: FRAME, unlocked: false, unlockText: '4 级解锁', countText: '' });

    assert.equal(slot.node.active, true);
    assert.equal(slot.cardBg.active, true, '锁定态也要米黄卡底（不再换深棕纯色底）');
    assert.equal(slot.iconNode.active, true, '★提前披露：未解锁也要画怪物头像');
    assert.equal(slot.icon.spriteFrame, FRAME, '头像要真的赋上去，不能只开节点');
    assert.equal(slot.lock.active, true, '锁标要出来（位置由 prefab 钉在正中）');
    assert.equal(slot.unlockLabel.string, '4 级解锁');
    assert.equal(slot.unlockLabel.node.active, true, '解锁文案在头像下方那一行');
    assert.equal(slot.countLabel.node.active, false, '未解锁没有数量，同一行不许两条文案叠加');
});

test('解锁后：锁与解锁文案收起、「数量：NN」回到同一行', () => {
    const slot = createSlot();
    slot.render({ icon: FRAME, unlocked: true, unlockText: '', countText: '数量：44' });

    assert.equal(slot.cardBg.active, true);
    assert.equal(slot.iconNode.active, true);
    assert.equal(slot.lock.active, false, '解锁后不能留锁');
    assert.equal(slot.unlockLabel.node.active, false);
    assert.equal(slot.countLabel.string, '数量：44');
    assert.equal(slot.countLabel.node.active, true);
});

test('锁定但没取到头像 ⇒ 只收图标（底、锁、文案照常），不许连格子一起藏', () => {
    const slot = createSlot();
    slot.render({ icon: null, unlocked: false, unlockText: '7 级解锁', countText: '' });

    assert.equal(slot.node.active, true, '格子要留着，否则与「这一格不配怪」同形');
    assert.equal(slot.cardBg.active, true);
    assert.equal(slot.iconNode.active, false, '没图就关节点，避免槽位复用时串上一只怪');
    assert.equal(slot.icon.spriteFrame, null, '帧必须清掉');
    assert.equal(slot.lock.active, true);
    assert.equal(slot.unlockLabel.node.active, true);
});

test('这一格没有守护怪 ⇒ 整格隐藏（不复用上一只怪的残留）', () => {
    const slot = createSlot();
    slot.render(undefined);
    assert.equal(slot.node.active, false);
});
