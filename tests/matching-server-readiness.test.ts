import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as MatchTypes from '../assets/script/app/matching/MatchTypes';

function fixture() {
    const exports: Record<string, any> = {};
    const stopped: object[] = [];
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/matching/MatchingPage.ts','utf8'), {
        compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,experimentalDecorators:true },
    }).outputText, { exports, console, require:(name:string)=> {
        if(name==='cc') return { Component:class{}, Tween: { stopAllByTarget: (target: object) => stopped.push(target) },
            _decorator:{ccclass:()=>(type:unknown)=>type, property:()=>()=>{}} };
        if(name==='./MatchTypes') return MatchTypes;
        if(name==='./MatchPlayerItem') return {};
        throw new Error(`Unexpected import: ${name}`);
    } });
    const page=new exports.MatchingPage();
    const phases:string[]=[], scheduled:Array<()=>void>=[];
    Object.assign(page,{isValid:true,itemViews:[{}, {refresh(){}}],layout(){},
        setPhase:(phase:string)=>phases.push(phase),scheduleOnce:(callback:()=>void)=>scheduled.push(callback),
        unschedule(callback: () => void) {
            const index = scheduled.indexOf(callback);
            if (index >= 0) scheduled.splice(index, 1);
        }});
    return { page, phases, scheduled, stopped };
}

for(const result of [false, 'rejected'] as const) test(`服务端就绪为 ${result} 时不选假对手、不显示成功、不排进场回调`,async()=> {
    const h=fixture(); let picks=0;
    const options={awaitReady:async()=>{if(result==='rejected')throw new Error('server rejected');return result;},
        pickOpponents:()=>{picks++;return[{name:'fake'}];},onMatched(){}};
    h.page.options=options;
    await h.page.settleOpponent(options);
    assert.equal(picks,0);
    assert.deepEqual(h.phases,[]);
    assert.equal(h.scheduled.length,0);
});

test('有效开战回包才显示匹配成功并排入场回调',async()=> {
    const h=fixture(); let matched=0;
    const options={awaitReady:async()=>true,pickOpponents:()=>[{name:'server'}],onMatched:()=>matched++};
    h.page.options=options;
    await h.page.settleOpponent(options);
    assert.deepEqual(h.phases,['matched']);
    h.scheduled[0]();
    assert.equal(matched,1);
});

test('匹配页销毁只停动画，不再修改已销毁的字节点和 Label', () => {
    const h = fixture();
    const character = { set active(_value: boolean) { throw new Error('字节点已销毁'); } };
    h.page.waveNodes = [character];
    h.page.statusLabel = { set enabled(_value: boolean) { throw new Error('Label.node 已为空'); } };
    assert.doesNotThrow(() => h.page.onDestroy());
    assert.deepEqual(h.stopped, [character]);
    assert.equal(h.page.waveNodes.length, 0);
});

test('匹配成功停止波浪时仍隐藏字节点并恢复原 Label', () => {
    const h = fixture();
    const character = { active: true };
    const label = { enabled: false };
    h.page.waveNodes = [character];
    h.page.statusLabel = label;
    h.page.stopWaveText();
    assert.deepEqual(h.stopped, [character]);
    assert.equal(character.active, false);
    assert.equal(label.enabled, true);
});

test('重新匹配解除上一轮进场定时器，销毁时解除当前定时器', async () => {
    const h = fixture();
    let matched = 0;
    const options = { mine: {}, tips: [], iconLoader: async () => null,
        pickOpponents: () => [], onMatched: () => matched++ };
    h.page.options = options;
    await h.page.settleOpponent(options);
    assert.equal(h.scheduled.length, 1);
    const item = { setIconLoader() {}, applySlot: async () => {}, refresh: async () => {}, clear() {} };
    Object.assign(h.page, { itemViews: [item, item], applyTips() {}, ensureItems() {} });
    h.page.beginMatch({ ...options });
    assert.equal(h.scheduled.length, 0, '重开匹配应主动解除旧调度');
    await h.page.settleOpponent(h.page.options);
    assert.equal(h.scheduled.length, 1);
    h.page.onDestroy();
    assert.equal(h.scheduled.length, 0, '销毁只清理，不等待回调执行后判断');
    assert.equal(matched, 0);
});

function playerFixture() {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/matching/MatchPlayerItem.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require(name: string) {
        if (name === 'cc') return { Component: class {}, Vec3: class {},
            _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} } };
        if (name.endsWith('/ArtPaths')) return { MATCH_SLOT_BARS: ['bar'], MATCH_SLOT_FRAMES: ['frame'] };
        if (name === './MatchTypes') return { MATCH_STAT_SLOTS: 5 };
        return {};
    } });
    const item = new exports.MatchPlayerItem();
    let complete!: (frame: object) => void;
    const frame = new Promise<object>((resolve) => { complete = resolve; });
    let writes = 0;
    const sprite = { set spriteFrame(_value: unknown) { writes++; } };
    Object.assign(item, { barFrame: sprite, avatarFrame: sprite, avatar: sprite, artifactIcon: sprite,
        nameLabel: {}, rankLabel: {}, trophyLabel: {}, powerValueLabel: {}, artifactNameLabel: {}, artifactRow: {},
        syncRankRowWidth() {}, renderStats() { writes++; } });
    item.setIconLoader(() => frame);
    return { item, complete, get writes() { return writes; } };
}

test('信息条销毁使配色和内容加载失效，迟到图标不再写组件', async () => {
    const h = playerFixture();
    const slot = h.item.applySlot(0);
    const content = h.item.refresh({ name: '我方', rank: '', trophy: 0, power: 0,
        artifactName: '', artifactIcon: '', avatarIcon: '', stats: [] });
    h.item.onDestroy();
    h.complete({});
    await Promise.all([slot, content]);
    assert.equal(h.writes, 0);
});

test('信息条仍存活时正常应用异步图标', async () => {
    const h = playerFixture();
    const slot = h.item.applySlot(0);
    h.complete({});
    await slot;
    assert.equal(h.writes, 2);
});
