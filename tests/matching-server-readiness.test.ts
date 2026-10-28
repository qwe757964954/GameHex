import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as MatchTypes from '../assets/script/app/matching/MatchTypes';

function fixture() {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/matching/MatchingPage.ts','utf8'), {
        compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,experimentalDecorators:true },
    }).outputText, { exports, console, require:(name:string)=> {
        if(name==='cc') return { Component:class{}, _decorator:{ccclass:()=>(type:unknown)=>type, property:()=>()=>{}} };
        if(name==='./MatchTypes') return MatchTypes;
        if(name==='./MatchPlayerItem') return {};
        throw new Error(`Unexpected import: ${name}`);
    } });
    const page=new exports.MatchingPage();
    const phases:string[]=[], scheduled:Array<()=>void>=[];
    Object.assign(page,{isValid:true,itemViews:[{}, {refresh(){}}],layout(){},
        setPhase:(phase:string)=>phases.push(phase),scheduleOnce:(callback:()=>void)=>scheduled.push(callback)});
    return { page, phases, scheduled };
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
