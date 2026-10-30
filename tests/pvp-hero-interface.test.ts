import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
import { parseCardCatalogRow } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { ZCCardType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { assetPath } from './helpers/asset-paths';

function readRef(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as {
        k: string[];
        v: unknown[][];
    };
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

test('运行时 protobuf 包含 PVP 英雄列表请求、响应与消息号', () => {
    const schema = JSON.parse(readFileSync(assetPath('config/protoCompiled.json'), 'utf8'));
    const root = protobuf.Root.fromJSON(schema);
    const request = root.lookupType('com.xkhy.tafang.cmd.CmdPvpHeroInfoListReqMsg');
    const response = root.lookupType('com.xkhy.tafang.cmd.CmdPvpHeroInfoListRspMsg');
    const messageId = root.lookupEnum('com.xkhy.tafang.cmd.MessageId');

    assert.equal(messageId.values.CmdPvpHeroInfoListRspMsg, 1516169721);
    assert.equal(request.encode(request.create({})).finish().byteLength, 0);

    const bytes = response.encode(response.create({ infos: [{ heroId: 68003, level: 12 }] })).finish();
    const decoded = response.decode(bytes) as unknown as { infos: Array<{ heroId: number; level: number }> };
    assert.deepEqual(decoded.infos.map((info) => [info.heroId, info.level]), [[68003, 12]]);
});

test('pvpCard 的 35 张可收藏卡（非建筑）都能按后端 heroId 解析', () => {
    // 2026-09-17 起卡 id == 单位源表 id（武将 general.id / 兵种 army.id / 怪物 monster.id /
    // 近卫 guards.id），不再是一个连续的 68003~68037 段，所以按「有没有单位」筛而不是按 id 区间。
    const cards = readRef('pvpCard')
        .filter((row) => Number(row.type) !== ZCCardType.Mine && Number(row.type) !== ZCCardType.Hq)
        .map(parseCardCatalogRow);

    assert.equal(cards.length, 35);
    assert.equal(cards[0].id, '68001', '第一张非建筑卡是出战卡组的精灵弓箭手');
    assert.equal(cards.at(-1)?.id, '68035', '末张是卡池里的希尔瓦娜斯');
    assert.ok(cards.every((card) => card.enabled));
    assert.ok(cards.every((card) => card.unitId !== undefined), '非建筑卡都引用了单位');
});

test('卡牌 Tab 通过 Repository 请求英雄数据，并由页面使用等级渲染', () => {
    const request = readFileSync('assets/script/app/generated/requestMsg/RequestPvpMsg.ts', 'utf8');
    const service = readFileSync('assets/script/app/card/PvpHeroService.ts', 'utf8');
    const repository = readFileSync('assets/script/app/card/CardRepository.ts', 'utf8');
    const page = readFileSync('assets/script/app/card/CardLineupPage.ts', 'utf8');
    const board = readFileSync('assets/script/app/card/LineupBoardPage.ts', 'utf8');

    assert.match(request, /return ['"]CmdPvpHeroInfoListReqMsg['"]/);
    assert.match(service, /new RequestPvpHeroInfoList/);
    assert.match(repository, /fetchPvpHeroInfos\(\)/);
    assert.match(page, /new CardLineupPresenter\(cardRepository\)/);
    assert.match(page, /this\.levelOf\(card\)/);
    assert.match(page, /deployedIds\.has\(card\.id\)/);
    // 2026-09-18：阵容页卡库（CardGrid）改成**配置驱动**（pvpCard 全表图鉴），
    // 后端英雄列表只负责填等级 + 标「已出战！」，不再用它过滤卡库。
    // 布阵弹窗的卡池仍是「我的卡」，所以那边继续用 loadPvpHeroCards。
    assert.match(repository, /loadPvpCatalogCards\(\)/);
    assert.match(page, /heroListKnown/);
    assert.doesNotMatch(page, /loadPvpHeroCards/);
    assert.match(repository, /loadPvpHeroCards\(heroInfos\)/);
    // 2026-09-22：阵容页的八卡改成读服务端**选中阵型**（布阵面板保存时把它置为选中），
    // 拿不到阵型数据才退回本地卡表 —— 所以 `loadLineup` 也必须拉阵型，不能只在 `loadBoard` 里拉。
    assert.match(repository, /resolveSelectedDeck\(/);
    assert.match(repository, /const deck = resolveSelectedDeck\(/);
    // 空 deck 的两种成因必须分开：卡表压根没读到（catalog 也空）才保留 prefab 占位外观；
    // 「服务端说选中的阵型是空的」要真渲染成空站台 —— 写成「deck 空就 return」会把
    // 玩家一键下阵后保存的效果吃掉，看起来像下阵没生效。
    assert.match(page, /deck\.length === 0 && cards\.length === 0/);
    assert.match(board, /new LineupBoardPresenter\(cardRepository\)/);
    assert.match(board, /this\.levelOf\(card, this\.fallbackPoolLevel\)/);
});

test('阵容编辑入口不再自建状态锁，下一帧等待统一走弹窗生命周期', () => {
    const page = readFileSync('assets/script/app/card/CardLineupPage.ts', 'utf8');
    const board = readFileSync('assets/script/app/card/LineupBoardPage.ts', 'utf8');

    // 打开参数里带「本次会话有没有落库」的共享对象：保存后本页要重刷（八卡读的是选中阵型）。
    assert.match(page, /await LineupBoardPage\.open\(\{/);
    assert.match(page, /userData: session/);
    assert.match(page, /if \(session\.saved\) void this\.refresh\(\)/,
        '只在真保存过时重刷 —— 没改就关面板不该白发一次英雄列表请求');
    assert.doesNotMatch(page, /teamEditOpening|const unlock|onClose: unlock/);
    assert.match(board, /await this\.nextPopupFrame\(\)/);
    assert.doesNotMatch(board, /scheduleOnce|director\.once/);
});
