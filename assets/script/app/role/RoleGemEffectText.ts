/**
 * 宝石效果文案 → 「短标签 + 数值」的纯函数（**零 `cc` 依赖**，可直接被 tsx 测试跑）。
 *
 * 背景：`gemAttribute.modifyDesc` 是策划配的一整句（`惊雷咒伤害+19%`、
 * `攻击力+11，攻击力+0.5%`、`每击杀1名敌人，城墙和拒马回血+0.05%`）。
 * 换宝石面板要做成「一行一颗宝石 + 4~6 字 + 数字」，长句必须拆开：
 *  - 效果值 = 落在句尾、后面不再挂中文的那个数字（带正负号 / `%`）；
 *  - 主体（数值之前）→ 短标签，常用前缀走 `EFFECT_SHORT`，其余按「取最后一个『的』之后 + 去动词」压到 6 字。
 *
 * 拆不出来的（整句没有落尾数字）只保证不崩：主体走压缩文案、数值留空。
 */

/** 常用效果主体的短标签（取自 `gemAttribute.modifyDesc` 的高频前缀）。 */
const EFFECT_SHORT: Readonly<Record<string, string>> = {
    攻击力: '攻击',
    暴击率: '暴击率',
    暴击伤害: '暴击伤',
    城墙血量: '城墙血',
    范围伤害: '范围伤',
    骑兵系伤害: '骑兵伤',
    斗士系伤害: '斗士伤',
    射手系伤害: '射手伤',
    重装系伤害: '重装伤',
    魔法系伤害: '魔法伤',
    物理伤害: '物理伤',
    召唤系伤害: '召唤伤',
    民兵造成的所有伤害: '民兵伤',
    民兵造成伤害时有: '民兵特效',
    民兵受到远程伤害减免: '民兵减伤',
    猎头者伤害: '猎头伤',
    猎头者流血和血爆伤害: '猎头流血',
    猎头者攻速: '猎头攻速',
    对有负面状态敌人伤害: '负面增伤',
    对有负面状态的怪物伤害提升: '负面增伤',
    对精英和领主伤害: '精英增伤',
    出兵冷却: '出兵CD',
    召唤物的持续时间: '召唤时长',
    所有远程单位射程和攻速: '远程射速',
    精灵弓箭手伤害: '弓手伤害',
    精灵弓箭手每射击: '弓手射击',
    女猎手伤害: '女猎伤害',
    女猎手攻速: '女猎攻速',
    女猎手的箭矢数量: '女猎箭数',
    雷击伤害: '雷击伤',
    火球术伤害: '火球伤',
    冰锥伤害: '冰锥伤',
    飓风术伤害: '飓风伤',
    御剑术伤害: '御剑伤',
    惊雷咒伤害: '惊雷咒',
    狼骑兵伤害: '狼骑伤',
    亡灵骑士冲锋和践踏伤害: '亡灵冲锋',
    亡灵骑士冲锋和践踏伤害半径: '亡灵半径',
    城墙和拒马回血: '城墙回血',
    城墙和拒马前: '城墙前',
    距离城墙: '城墙距离',
    拒马每被击破: '拒马被破',
    拒马首次血量低于: '拒马残血',
    技能冷却时间减少: '技能CD',
    召唤物攻速: '召唤攻速',
    召唤物造成伤害时标记目标: '召唤标记',
    对生命值高于: '高血增伤',
    对前5波: '前5波增伤',
    对敌方城墙的伤害: '城墙增伤',
    步兵受到伤害时额外反弹: '步兵反弹',
    步兵所有伤害: '步兵伤',
    怪物携带负面效果持续时间延长: '负面持续',
    精英或领主刷新时我方全体恢复: '刷新回血',
    精英或领主刷新时我方全体恢复生命值: '刷新回血',
    对满血敌人必定暴击: '满血必暴',
    伤害: '增伤',
};

/** 数值后面可能拖的计量单位（这些不算「条件尾巴」）。 */
const UNIT_TAIL = /[点秒个格次层%]/g;

interface IValueHit {
    readonly head: string;
    readonly value: string;
}

/** 在一句里挑出「落在句尾的效果值」；挑不到返回 null（说明这半句是条件）。 */
function pickValue(segment: string): IValueHit | null {
    const pattern = /[-+＋]?\d+(?:\.\d+)?%?/g;
    let chosen: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(segment)) !== null) {
        const end = match.index + match[0].length;
        const tail = segment.slice(end).replace(UNIT_TAIL, '').trim();
        if (tail.length === 0) chosen = match;
    }
    if (!chosen) return null;
    const head = segment.slice(0, chosen.index).replace(/[：:]\s*$/, '').trim();
    const value = chosen[0].replace('＋', '+');
    if (!head) return null;
    return { head, value };
}

/**
 * 主体太长时的兜底压缩：
 * 去数字 → 取最后一个「的」之后 → 去条件状语前缀与动词后缀 → 还超就截到 6 字。
 */
export function compressGemHead(head: string): string {
    let text = head.replace(/[+＋]$/, '').replace(/\d+(?:\.\d+)?%?/g, '').trim();
    const clauses = text.split(/[，,]/);
    if (clauses.length > 1) text = clauses[clauses.length - 1];
    text = text.replace(/^(赋予|使|当|每|对|其|该|自身|初始修炼|修炼)+/, '');
    const afterDe = text.split('的');
    if (afterDe.length > 1) text = afterDe[afterDe.length - 1];
    text = text.replace(/(提升|增加|减少|回复|提高|延长|缩短|造成|获得|效果)$/, '');
    text = text.replace(/额外/g, '').replace(/所有/g, '').replace(/的/g, '').replace(/[-–—]$/, '').trim();
    if (text.length > 6) text = text.slice(0, 6);
    return text;
}

/** `modifyDesc` → `{ keyword, value }`。永远返回非空 keyword，value 可能为空串。 */
export function gemEffectBadge(desc: string): { keyword: string; value: string } {
    const text = (desc || '')
        .replace(/（[^）]*）/g, '')
        .replace(/\([^)]*\)/g, '')
        .trim();
    if (!text) return { keyword: '宝石效果', value: '—' };

    const segments = text.split(/[，,、；;]/).filter(part => part.trim().length > 0);
    const heads: string[] = [];
    const values: string[] = [];
    let first: IValueHit | null = null;

    for (const segment of segments) {
        const hit = pickValue(segment);
        if (!hit) continue;
        if (!first) first = hit;
        const at = heads.indexOf(hit.head);
        if (at < 0) {
            heads.push(hit.head);
            values.push(hit.value);
        } else {
            values[at] = `${values[at]} · ${hit.value}`;
        }
    }

    // 整句都没有「落尾数字」（数值只夹在条件句中间）：退化成「第一个数字 + 就近取词」
    if (!first) {
        const num = text.match(/[-+＋]?\d+(?:\.\d+)?%?\d*/);
        if (!num || num.index === undefined) {
            return { keyword: compressGemHead(text), value: '' };
        }
        const before = compressGemHead(text.slice(0, num.index));
        const after = compressGemHead(text.slice(num.index + num[0].length));
        const keyword = before.length >= 3 ? before : (after || before || '宝石效果');
        return { keyword, value: num[0].replace('＋', '+') };
    }

    const compressed = compressGemHead(first.head);
    const keyword = EFFECT_SHORT[first.head] || EFFECT_SHORT[compressed] || compressed;
    return { keyword, value: values.join(' · ') };
}
