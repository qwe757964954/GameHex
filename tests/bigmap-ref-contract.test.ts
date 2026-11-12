/**
 * BigMap 配置表 × `RefUtil` 压缩表契约的回归测试。
 *
 * 背景（2026-10-20 线上炸点）：`RefConfigService.getTable()` 只从 `RefUtil` 取数，
 * 而 `RefUtil.compressKeyRefDataFix()` **只在 `data.c === 1` 时**才把 `{k,v}` 解压成对象数组；
 * 没有 `c` 的表会原样返回 `{k,v}` 对象 → `getTable` 的 `Array.isArray()` 判假 → 返回 `[]`
 * → `parseBigMapConfig` 抛「配置表缺失或为空：bigmapWorld」。
 *
 * 为什么原来的单测逮不住：`helpers/bigmap-fixtures.ts` 直接读盘上的 `{k,v}` 喂给
 * `decompressBigMapRows`，**绕过了 `c==1` 这个门槛** —— 测的绿，真机照炸。
 *
 * 所以这里按**运行时口径**复算一遍：直接执行 `RefUtil` 的真实解压方法，再喂给同一个 parse 入口。
 */
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIGMAP_TABLE, parseBigMapConfig, type BigMapRawTables } from '../assets/script/app/bigmap/model/BigMapConfig';

const REF_UTIL_URL = new URL('../assets/script/framework/ref/RefUtil.ts', import.meta.url);

function readTableRaw(name: string): any {
    const url = new URL(`../assets/remoteRef/${name}.json`, import.meta.url);
    return JSON.parse(readFileSync(url, 'utf8'));
}

// Execute the real loader and decompressor; dependencies only stand in for I/O and post-processing.
const refSource=ts.createSourceFile('RefUtil.ts',readFileSync(REF_UTIL_URL,'utf8'),ts.ScriptTarget.Latest,true);
const refClass=refSource.statements.find(ts.isClassDeclaration)!;
const names=['compressKeyRefDataFix','tryGetCompressKeyRefData','loadRefAsset'];
const methods=names.map(name=>{
    const method=refClass.members.find(member=>ts.isMethodDeclaration(member)&&member.name.getText(refSource)===name);
    assert.ok(method,name);return method.getText(refSource);
}).join('\n');
let remotePayload: unknown;
const transforms: string[]=[];
const fw={isRemoteRef:true,GetRefPath:(name:string)=>'ref/'+name,ZJJ:{log(){}}};
const RefProbe=runInNewContext(ts.transpileModule('class RefProbe {'+methods+'}\nglobalThis.RefProbe=RefProbe;',{
    compilerOptions:{target:ts.ScriptTarget.ES2022},
}).outputText+'\nRefProbe;',{
    Object,FW:fw,HttpLoader:{RequestJson:async()=>({json:remotePayload})},
    loadRemoteRefJson:async()=>({json:remotePayload}),
    MergeKeyRefMgr:{inst:()=>({Merge:(_name:string,data:unknown)=>{transforms.push('merge');return data;}})},
    RedirectRefMgr:{inst:()=>({Redirect:(_name:string,data:unknown)=>{transforms.push('redirect');return data;}})},
});
const refProbe=new RefProbe();refProbe.getAllRefFileName=()=>undefined;
const refUtilUnwrap=(payload:unknown)=>refProbe.tryGetCompressKeyRefData('table',payload);

test('12 张 BigMap 表都带 c:1，经 RefUtil 口径解压后是对象数组', () => {
    const bad: string[] = [];
    for (const name of Object.values(BIGMAP_TABLE)) {
        const raw = readTableRaw(name);
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.c !== 1) {
            bad.push(`${name}(缺 c:1)`);
            continue;
        }
        const unwrapped = refUtilUnwrap(raw);
        if (!Array.isArray(unwrapped) || unwrapped.length === 0) bad.push(`${name}(解压后非数组或为空)`);
    }
    assert.deepEqual(bad, [], `这些表在运行时会被 RefConfigService 读成空数组：${bad.join('、')}`);
});

test('按运行时口径取到 12 张表后，parseBigMapConfig 不抛错', () => {
    const tables: Record<string, unknown> = {};
    for (const name of Object.values(BIGMAP_TABLE)) tables[name] = refUtilUnwrap(readTableRaw(name));
    const config = parseBigMapConfig(tables as BigMapRawTables);
    assert.equal(config.world.rows, 40);
    // 策划表 `baseBuilding`：每座田一个 id，共 23 行（旧推算表只有 8 行）。
    assert.equal(config.buildings.size, 23);
});

test("本地与远端配置都执行真实解压、合并和重定向各一次", async () => {
    for(const remote of [true,false]){
        fw.isRemoteRef=remote;
        for(const payload of [{c:1,k:['id','name'],v:[[7,'gold']]},[{id:7,name:'gold'}]]){
            remotePayload=payload;transforms.length=0;
            // Both sources must run decompression, merge and redirect exactly once.
            const rows=await refProbe.loadRefAsset('table');
            assert.deepEqual(JSON.parse(JSON.stringify(rows)),[{id:7,name:'gold'}]);
            assert.deepEqual(transforms,['merge','redirect']);
        }
    }
});
