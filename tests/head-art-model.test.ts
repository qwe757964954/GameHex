/**
 * 头像共用方法（`assets/script/app/HeadArtModel.ts`）的单测。
 *
 * `HeadArtModel` 是「id → 资源名 → SpriteFrame」这条链的**唯一实现**：
 *   - 匹配信息条（`MatchProfileLookup.headArt` + `applyHeadArt`）走它；
 *   - 别的页面（`HeadArt.loadHeadFrame`）也走它。
 * 所以它的边界就是全工程头像的边界，这里逐条钉死。
 *
 * 为什么值得单独一个文件：这条链**三层都能静默断**（`head` 表没有 / `icon` 表没键 /
 * 资源名在磁盘上不存在），断了都不报错、只表现为"头像没换成真图"，
 * 靠人眼看界面是查不出来的。
 *
 * `HeadArtModel` 零引擎依赖（`SpriteFrame` 只作类型引入），Node 里可直接 import ——
 * 这也是它能被这么测的前提。含 `cc` 的那一半（`HeadArt.ts`）在
 * `zcds-matching-preload.test.ts` 里以沙箱替身的方式被覆盖。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
import * as ArtPaths from '../assets/script/app/ArtPaths';
import {
    EMPTY_HEAD_ART, applyHeadArt, artNameFromHeadIconPath, createHeadArtResolver,
    loadHeadById, preloadHeadByIds,
} from '../assets/script/app/HeadArtModel';
import type { SpriteFrame } from 'cc';

/** `uint64` 运行时是 protobufjs 自己那份 `Long`；不要 `import Long from 'long'`（理由见 protocol 用例）。 */
const Long = (protobuf.util as unknown as {
    Long: { fromString(value: string, unsigned?: boolean): unknown };
}).Long;

const FRAME = { name: 'fake' } as unknown as SpriteFrame;

test('资源名 = `ui://` 路径的末段；末段是中文名时也照用（磁盘上两种文件名都真存在）', () => {
    // 老端 `icon.json` 的 `path` 是整条 FairyGUI URI，Demo 走 `resources.load` 只认末段
    assert.equal(artNameFromHeadIconPath('ui://图标/icon_hero_head_40010'), 'icon_hero_head_40010');
    // 「包名之后还有一层中文名」的写法（主角 / 九头蛇 / 变节巫师那批就是），末段就是它本身
    assert.equal(artNameFromHeadIconPath('ui://图标/图标_头像_主角'), '图标_头像_主角');
    assert.equal(artNameFromHeadIconPath('icon_hero_head_40010'), 'icon_hero_head_40010', '没有 / 时原样返回');
    assert.equal(artNameFromHeadIconPath(''), '');
});

test('两层查表：head 给中文组件名、icon 给资源名，缺一层就整行丢掉', () => {
    const iconRows = [
        { key: '图标_头像_凯尔萨斯', path: 'ui://图标/icon_hero_head_40010' },
        { key: '图标_头像_主角', path: 'ui://图标/图标_头像_主角' },
        { key: '图标_头像_九头蛇', path: 'ui://图标/图标_头像_九头蛇' },
        // icon 表里有，但 head 表没引用 → 不该出现在结果里
        { key: '图标_头像_冰雪鲛女', path: 'ui://图标/图标_头像_冰雪鲛女' },
        // 路径为空的条目不是有效资源名
        { key: '图标_头像_空路径', path: '' },
    ];
    const headRows = [
        { resId: 70002, type: 2, icon: '图标_头像_凯尔萨斯' },
        { resId: 70001, type: 2, icon: '图标_头像_主角' },
        // icon 表里没这个键 → 这一行解不出资源名，必须整行丢掉，
        // 否则 `artName()` 会返回中文组件名，调用方拿去 load 就是静默留白
        { resId: 70099, type: 2, icon: '图标_头像_不存在的' },
        { resId: 70019, type: 2, icon: '图标_头像_九头蛇' },
        { resId: 70098, type: 2, icon: '图标_头像_空路径' },
        // 非法 id：老端 0 表示"用平台头像 platform_img"（本工程没接），
        // 负数 / 缺列同理 —— 一律不入表
        { resId: 0, icon: '图标_头像_主角' },
        { resId: -1, icon: '图标_头像_主角' },
        { icon: '图标_头像_主角' },
        // 同 id 重复：后者覆盖前者（表里本不该重复，但不能因此查出错的名字）
        { resId: 70001, type: 2, icon: '图标_头像_九头蛇' },
    ];
    const art = createHeadArtResolver(headRows, iconRows).artName;

    assert.equal(art('70002'), 'icon_hero_head_40010', 'ui:// 取末段，不是整条 URI');
    assert.equal(art('70001'), '图标_头像_九头蛇', '重复 id → 后写覆盖先写');
    assert.equal(art('70019'), '图标_头像_九头蛇');
    assert.equal(art('70099'), '', 'icon 表里查不到 → 空串，绝不能退回中文组件名去 load');
    assert.equal(art('70098'), '', 'path 为空 → 空串');
    assert.equal(art('70003'), '', 'head 表里没有这个 resId');
    assert.equal(art('0'), '', 'img == 0（平台头像）→ 空串');
    assert.equal(art(''), '');
    assert.equal(art('abc'), '');
    assert.equal(art('-1'), '');
    // protobufjs 的 sint64/uint64 运行时是 Long，`toCount` 必须能收
    assert.equal(art(Long.fromString('70002', true) as unknown as string), 'icon_hero_head_40010');

    // 两张表缺任何一张 → 恒空串（读表失败时不能抛，也不能拿中文名凑合）
    assert.equal(createHeadArtResolver(headRows, null).artName('70002'), '');
    assert.equal(createHeadArtResolver(null, iconRows).artName('70002'), '');
    assert.equal(createHeadArtResolver(undefined, undefined).artName('70002'), '');
    assert.equal(EMPTY_HEAD_ART.artName('70002'), '', 'EMPTY_HEAD_ART 与"表读不到"同口径');
});

test('applyHeadArt：名字与根目录**成对**换，解不出来时一个字段都不碰', () => {
    const resolver = createHeadArtResolver(
        [{ resId: 70010, icon: '图标_头像_萨穆罗' }],
        [{ key: '图标_头像_萨穆罗', path: 'ui://图标/icon_hero_head_40018' }],
    );

    // 写入成功：两个字段一起变 —— 只换名字不换根就是去占位图目录找一个真头像的名字（静默留白）
    const target = { avatarIcon: 'img_people', avatarRoot: ArtPaths.MATCH_ART_ROOT as string | undefined };
    assert.equal(applyHeadArt(target, '70010', resolver), true);
    assert.equal(target.avatarIcon, 'icon_hero_head_40018');
    assert.equal(target.avatarRoot, ArtPaths.HEAD_ART_ROOT);
    assert.notEqual(target.avatarRoot, ArtPaths.MATCH_ART_ROOT, '真头像不在占位图那个目录里');

    // 解不出来（表里没有 / img == 0 / 没给 resolver）：**两个字段都保持原样**。
    // 关键在 `avatarRoot` 不能被单独写上 —— 那会造成"名字还是占位图的名字、根却指向真头像目录"。
    for (const id of ['0', '900001', '']) {
        const kept = { avatarIcon: 'img_people' } as { avatarIcon: string; avatarRoot?: string };
        assert.equal(applyHeadArt(kept, id, resolver), false, `id=${id} 不该写入`);
        assert.equal(kept.avatarIcon, 'img_people');
        assert.equal(kept.avatarRoot, undefined, 'avatarRoot 不能被单独写上');
    }
    const noResolver = { avatarIcon: 'img_people' } as { avatarIcon: string; avatarRoot?: string };
    assert.equal(applyHeadArt(noResolver, '70010', null), false);
    assert.equal(applyHeadArt(noResolver, '70010', undefined), false);
    assert.equal(noResolver.avatarRoot, undefined);
});

test('loadHeadById / preloadHeadByIds：解不出名字就**不调加载器**，且永远不 reject', async () => {
    const resolver = createHeadArtResolver(
        [{ resId: 70010, icon: '图标_头像_萨穆罗' }],
        [{ key: '图标_头像_萨穆罗', path: 'ui://图标/icon_hero_head_40018' }],
    );
    const asked: { name: string; root: string }[] = [];
    const loader = (name: string, root: string) => {
        asked.push({ name, root });
        return Promise.resolve(name === 'icon_hero_head_40018' ? FRAME : null);
    };

    assert.equal(await loadHeadById('70010', resolver, loader), FRAME);
    assert.deepEqual(asked, [{ name: 'icon_hero_head_40018', root: ArtPaths.HEAD_ART_ROOT }], '加载用 HEAD_ART_ROOT');

    // 解不出名字时**不该发这次加载**：发了就是拿空串去 load，只会换回一条 warn + null，
    // 而调用方通常把 null 理解成"还没回来"，于是白等一轮。
    asked.length = 0;
    assert.equal(await loadHeadById('0', resolver, loader), null);
    assert.equal(await loadHeadById('900001', resolver, loader), null);
    assert.equal(await loadHeadById('70010', null, loader), null);
    assert.deepEqual(asked, [], '解不出名字就不该调 loader');

    // 预取：一次给一串 id，无效的跳过、有效的各调一次
    asked.length = 0;
    await preloadHeadByIds(['70010', '', '0', '70010'], resolver, loader);
    assert.deepEqual(asked, [
        { name: 'icon_hero_head_40018', root: ArtPaths.HEAD_ART_ROOT },
        { name: 'icon_hero_head_40018', root: ArtPaths.HEAD_ART_ROOT },
    ]);
    // 预取**不 reject**：它是可选增强，失败只该少一张图，不能把调它的 `onPreload` 带崩
    // （那会连匹配界面都进不去）。加载器真坏掉时，页面按需加载那次还会再报一次。
    await preloadHeadByIds(['70010'], resolver, () => Promise.reject(new Error('load 炸了')));
});

test('loadHeadById 是底层原语：加载器的错误**原样透传**，由调用方决定怎么兜', async () => {
    const resolver = createHeadArtResolver(
        [{ resId: 70010, icon: '图标_头像_萨穆罗' }],
        [{ key: '图标_头像_萨穆罗', path: 'ui://图标/icon_hero_head_40018' }],
    );
    await assert.rejects(
        loadHeadById('70010', resolver, () => Promise.reject(new Error('load 炸了'))),
        /load 炸了/,
        '底层不吞错 —— 吞在这里，调用方就分不清"没有这张图"和"加载器坏了"',
    );
});
