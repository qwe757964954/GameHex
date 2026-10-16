/**
 * Legacy client skillView -> skillEffect compatibility runtime.
 *
 * Formula strings are data, not JavaScript.  This module deliberately uses a
 * small expression parser instead of eval/new Function so exported Excel data
 * cannot access globals or execute arbitrary code.
 */

export interface ZCLegacySkillEffectRow {
    condition: string;
    script: string;
    effect: Readonly<Record<string, unknown>>;
}

export interface ZCLegacySkillEffectConfig {
    attributes: Readonly<Record<string, unknown>>;
    effectsByKey: Readonly<Record<string, readonly ZCLegacySkillEffectRow[]>>;
    buffDefaults: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    /** legacy skillBuff key -> old Client handler type. */
    buffTypes: Readonly<Record<string, string>>;
    /** legacy skillBuff key -> pvpStatus.statusId */
    legacyStatusIds: Readonly<Record<string, string>>;
}

export interface ZCLegacyBuffApplication {
    legacyKey: string;
    params: Readonly<Record<string, unknown>>;
    /** Frozen at cast time so DOT attribution/damage survives source removal and reconnect. */
    sourceAttack: number;
}

export interface ZCLegacySkillEvaluation {
    /** True when at least one active `基础伤害` row supplied the attack damage. */
    hasDamageFormula: boolean;
    damage: number;
    range?: number;
    hitCount?: number;
    executeChance?: number;
    buffs: readonly ZCLegacyBuffApplication[];
}

export interface ZCLegacySkillContext {
    attributes?: Readonly<Record<string, unknown>>;
    random: () => number;
    targetId?: string | number;
    targetHp?: number;
    targetMaxHp?: number;
    isCritical?: boolean;
    hasStatus?: (targetId: string, legacyBuffKey: string) => boolean;
}

type Scope = Readonly<Record<string, unknown>>;
type Eval = (scope: Scope) => unknown;

interface Token {
    kind: 'number' | 'string' | 'identifier' | 'operator' | 'punctuation' | 'eof';
    value: string;
    offset: number;
}

const FORBIDDEN_MEMBERS = new Set(['__proto__', 'prototype', 'constructor']);
const EXPRESSION_CACHE = new Map<string, Eval>();

class Lexer {
    private offset = 0;

    constructor(private readonly source: string) {}

    next(): Token {
        while (/\s/.test(this.source[this.offset] ?? '')) this.offset += 1;
        const start = this.offset;
        if (start >= this.source.length) return { kind: 'eof', value: '', offset: start };
        const ch = this.source[this.offset];

        if (/\d/.test(ch) || (ch === '.' && /\d/.test(this.source[this.offset + 1] ?? ''))) {
            this.offset += 1;
            while (/[\d.]/.test(this.source[this.offset] ?? '')) this.offset += 1;
            if (/[eE]/.test(this.source[this.offset] ?? '')) {
                this.offset += 1;
                if (/[+-]/.test(this.source[this.offset] ?? '')) this.offset += 1;
                while (/\d/.test(this.source[this.offset] ?? '')) this.offset += 1;
            }
            return { kind: 'number', value: this.source.slice(start, this.offset), offset: start };
        }

        if (ch === '\'' || ch === '"') {
            const quote = ch;
            this.offset += 1;
            let value = '';
            while (this.offset < this.source.length) {
                const current = this.source[this.offset++];
                if (current === quote) return { kind: 'string', value, offset: start };
                if (current !== '\\') {
                    value += current;
                    continue;
                }
                if (this.offset >= this.source.length) break;
                const escaped = this.source[this.offset++];
                const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', '\'': '\'', '"': '"' };
                value += escapes[escaped] ?? escaped;
            }
            throw new Error(`字符串未闭合（位置 ${start}）`);
        }

        if (/[A-Za-z_$\u0080-\uFFFF]/.test(ch)) {
            this.offset += 1;
            while (/[\w$\u0080-\uFFFF]/.test(this.source[this.offset] ?? '')) this.offset += 1;
            return { kind: 'identifier', value: this.source.slice(start, this.offset), offset: start };
        }

        for (const op of ['===', '!==', '&&', '||', '>=', '<=', '==', '!=']) {
            if (this.source.startsWith(op, start)) {
                this.offset += op.length;
                return { kind: 'operator', value: op, offset: start };
            }
        }
        if ('+-*/%><!'.includes(ch)) {
            this.offset += 1;
            return { kind: 'operator', value: ch, offset: start };
        }
        if ('().,?:[]'.includes(ch)) {
            this.offset += 1;
            return { kind: 'punctuation', value: ch, offset: start };
        }
        throw new Error(`不支持的字符“${ch}”（位置 ${start}）`);
    }
}

class Parser {
    private token: Token;

    constructor(private readonly source: string, private readonly lexer = new Lexer(source)) {
        this.token = lexer.next();
    }

    parse(): Eval {
        const result = this.ternary();
        if (this.token.kind !== 'eof') this.fail(`意外的“${this.token.value}”`);
        return result;
    }

    private ternary(): Eval {
        const condition = this.binary(0);
        if (!this.take('?')) return condition;
        const yes = this.ternary();
        this.expect(':');
        const no = this.ternary();
        return (scope) => condition(scope) ? yes(scope) : no(scope);
    }

    private binary(minPrecedence: number): Eval {
        let left = this.unary();
        const precedence: Record<string, number> = {
            '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3,
            '>': 4, '>=': 4, '<': 4, '<=': 4, '+': 5, '-': 5,
            '*': 6, '/': 6, '%': 6,
        };
        while (this.token.kind === 'operator' && (precedence[this.token.value] ?? -1) >= minPrecedence) {
            const op = this.token.value;
            const level = precedence[op];
            this.advance();
            const right = this.binary(level + 1);
            const previous = left;
            left = (scope) => applyBinary(op, previous, right, scope);
        }
        return left;
    }

    private unary(): Eval {
        if (this.token.kind === 'operator' && ['!', '+', '-'].includes(this.token.value)) {
            const op = this.token.value;
            this.advance();
            const operand = this.unary();
            if (op === '!') return (scope) => !operand(scope);
            if (op === '+') return (scope) => +Number(operand(scope));
            return (scope) => -Number(operand(scope));
        }
        return this.postfix(this.primary());
    }

    private postfix(base: Eval): Eval {
        let result = base;
        while (true) {
            if (this.take('.')) {
                if (this.token.kind !== 'identifier') this.fail('成员名必须是标识符');
                const member = this.token.value;
                this.advance();
                result = memberAccess(result, () => member);
                continue;
            }
            if (this.take('[')) {
                const key = this.ternary();
                this.expect(']');
                result = memberAccess(result, key);
                continue;
            }
            if (this.take('(')) {
                const args: Eval[] = [];
                if (!this.take(')')) {
                    do args.push(this.ternary()); while (this.take(','));
                    this.expect(')');
                }
                const callable = result;
                result = (scope) => {
                    const fn = callable(scope);
                    if (typeof fn !== 'function') throw new Error('表达式尝试调用非函数值');
                    return fn(...args.map((arg) => arg(scope)));
                };
                continue;
            }
            return result;
        }
    }

    private primary(): Eval {
        const current = this.token;
        if (current.kind === 'number') {
            this.advance();
            const value = Number(current.value);
            if (!Number.isFinite(value)) this.fail(`非法数字“${current.value}”`);
            return () => value;
        }
        if (current.kind === 'string') {
            this.advance();
            return () => current.value;
        }
        if (current.kind === 'identifier') {
            this.advance();
            if (current.value === 'true') return () => true;
            if (current.value === 'false') return () => false;
            if (current.value === 'null') return () => null;
            if (current.value === 'undefined') return () => undefined;
            if (FORBIDDEN_MEMBERS.has(current.value)) this.fail(`禁止访问“${current.value}”`);
            return (scope) => scope[current.value];
        }
        if (this.take('(')) {
            const value = this.ternary();
            this.expect(')');
            return value;
        }
        this.fail(`缺少表达式，得到“${current.value}”`);
    }

    private take(value: string): boolean {
        if (this.token.value !== value) return false;
        this.advance();
        return true;
    }

    private expect(value: string): void {
        if (!this.take(value)) this.fail(`缺少“${value}”`);
    }

    private advance(): void {
        this.token = this.lexer.next();
    }

    private fail(message: string): never {
        throw new Error(`${message}（位置 ${this.token.offset}，公式：${this.source}）`);
    }
}

function memberAccess(parent: Eval, keyEval: Eval): Eval {
    return (scope) => {
        const target = parent(scope);
        const key = String(keyEval(scope));
        if (FORBIDDEN_MEMBERS.has(key)) throw new Error(`禁止访问成员“${key}”`);
        if (target == null || (typeof target !== 'object' && typeof target !== 'function')) return undefined;
        const value = (target as Record<string, unknown>)[key];
        return typeof value === 'function' ? value.bind(target) : value;
    };
}

function applyBinary(op: string, left: Eval, right: Eval, scope: Scope): unknown {
    if (op === '&&') return left(scope) && right(scope);
    if (op === '||') return left(scope) || right(scope);
    const a = left(scope), b = right(scope);
    switch (op) {
        case '+': return (a as never) + (b as never);
        case '-': return Number(a) - Number(b);
        case '*': return Number(a) * Number(b);
        case '/': return Number(a) / Number(b);
        case '%': return Number(a) % Number(b);
        case '>': return (a as never) > (b as never);
        case '>=': return (a as never) >= (b as never);
        case '<': return (a as never) < (b as never);
        case '<=': return (a as never) <= (b as never);
        // Legacy formulas intentionally used loose equality; preserve that data contract.
        // eslint-disable-next-line eqeqeq
        case '==': return a == b;
        // eslint-disable-next-line eqeqeq
        case '!=': return a != b;
        case '===': return a === b;
        case '!==': return a !== b;
        default: throw new Error(`不支持的运算符：${op}`);
    }
}

/** Compile a formula once. Exported for focused validator/tests. */
export function compileZCLegacyExpression(source: string): Eval {
    const normalized = source.trim();
    const cached = EXPRESSION_CACHE.get(normalized);
    if (cached) return cached;
    const compiled = new Parser(normalized).parse();
    EXPRESSION_CACHE.set(normalized, compiled);
    return compiled;
}

export class ZCLegacyAttributeBag {
    private readonly values: Readonly<Record<string, unknown>>;

    constructor(defaults: Readonly<Record<string, unknown>>, overrides: Readonly<Record<string, unknown>>, private readonly rng: () => number) {
        this.values = { ...defaults, ...overrides };
    }

    GetValue(key: string): unknown {
        const value = this.values[key];
        if (value == null || value === '') return 0;
        if (typeof value === 'number' || typeof value === 'boolean') return value;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : value;
    }

    random(): number {
        return this.rng();
    }

    /** Legacy Utils.randomInt is inclusive at both ends. */
    randomInt(min: number, max: number): number {
        const low = Math.ceil(Math.min(min, max));
        const high = Math.floor(Math.max(min, max));
        return low + Math.floor(this.rng() * (high - low + 1));
    }
}

const SUPPORTED_SCRIPTS = new Set(['基础伤害', '伤害加成', '伤害增幅', '伤害范围', '伤害次数', '伤害百分比', '斩杀', 'buff']);

function conditionFormula(value: unknown): string | null {
    const text = value == null ? '' : String(value).trim();
    return !text || text === '默认' || text === 'default' ? null : text;
}

function expressionValue(value: unknown, scope: Scope, label: string): unknown {
    if (typeof value !== 'string') return value;
    const source = value.trim();
    if (!source) return '';
    try {
        return compileZCLegacyExpression(source)(scope);
    } catch (error) {
        throw new Error(`${label} 公式执行失败：${error instanceof Error ? error.message : String(error)}`);
    }
}

function finite(value: unknown, label: string): number {
    const result = Number(value);
    if (!Number.isFinite(result)) throw new Error(`${label} 必须得到有限数字，实际为 ${String(value)}`);
    return result;
}

function round2(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

export class ZCLegacySkillEffectRuntime {
    constructor(readonly config: ZCLegacySkillEffectConfig) {}

    evaluate(effectKeys: readonly string[], context: ZCLegacySkillContext): ZCLegacySkillEvaluation {
        const attr = new ZCLegacyAttributeBag(this.config.attributes, context.attributes ?? {}, context.random);
        const targetId = String(context.targetId ?? '');
        const scope: Scope = {
            attr,
            attrBase: attr,
            tid: targetId,
            damageInfo: { damageTag: { isCrit: context.isCritical === true } },
            buff: { has: (id: unknown, key: unknown) => context.hasStatus?.(String(id), String(key)) ?? false },
            var: {
                HpRateLe: (_id: unknown, percent: unknown) => {
                    const maxHp = context.targetMaxHp ?? 0;
                    return maxHp > 0 && ((context.targetHp ?? maxHp) / maxHp * 100) <= Number(percent);
                },
            },
        };
        let baseDamage = 0;
        let additivePct = 0;
        let amplificationPct = 0;
        let range: number | undefined;
        let hitCount: number | undefined;
        let executeChance: number | undefined;
        let hasDamageFormula = false;
        const buffs: ZCLegacyBuffApplication[] = [];

        for (const key of effectKeys) {
            for (const row of this.config.effectsByKey[key] ?? []) {
                if (!SUPPORTED_SCRIPTS.has(row.script)) continue;
                const condition = conditionFormula(row.condition);
                if (condition && !compileZCLegacyExpression(condition)(scope)) continue;
                switch (row.script) {
                    case '基础伤害':
                        hasDamageFormula = true;
                        baseDamage += finite(expressionValue(row.effect['基础伤害'], scope, `${key}.基础伤害`), `${key}.基础伤害`);
                        break;
                    case '伤害加成':
                        additivePct += finite(expressionValue(row.effect['伤害加成'], scope, `${key}.伤害加成`), `${key}.伤害加成`);
                        break;
                    case '伤害增幅':
                        amplificationPct += finite(expressionValue(row.effect['伤害增幅'], scope, `${key}.伤害增幅`), `${key}.伤害增幅`);
                        break;
                    case '伤害范围':
                        range = (range ?? 0) + finite(expressionValue(row.effect['伤害范围'], scope, `${key}.伤害范围`), `${key}.伤害范围`);
                        break;
                    case '伤害次数':
                        hitCount = (hitCount ?? 0) + finite(expressionValue(row.effect['伤害次数'], scope, `${key}.伤害次数`), `${key}.伤害次数`);
                        break;
                    case '斩杀': {
                        const raw = row.effect['斩杀概率'] ?? row.effect['概率'] ?? row.effect['斩杀'];
                        executeChance = Math.max(0, Math.min(1, finite(expressionValue(raw, scope, `${key}.斩杀`), `${key}.斩杀`)));
                        break;
                    }
                    case '伤害百分比': {
                        const rate = finite(expressionValue(row.effect['伤害百分比'] ?? row.effect['百分比'], scope, `${key}.伤害百分比`), `${key}.伤害百分比`) * .01;
                        const cap = finite(expressionValue(row.effect['不超过自身攻击的倍数'] ?? Number.MAX_SAFE_INTEGER, scope, `${key}.伤害上限`), `${key}.伤害上限`);
                        const attack = Number(attr.GetValue('角色攻击力')) || 0;
                        baseDamage += Math.min((context.targetMaxHp ?? 0) * rate, attack * cap);
                        hasDamageFormula = true;
                        break;
                    }
                    case 'buff': {
                        const legacyKey = String(row.effect.id ?? '').trim();
                        if (!legacyKey) break;
                        const defaults = this.config.buffDefaults[legacyKey] ?? {};
                        const overrides = row.effect.param && typeof row.effect.param === 'object'
                            ? row.effect.param as Record<string, unknown>
                            : {};
                        const params: Record<string, unknown> = { ...defaults };
                        for (const [name, value] of Object.entries(overrides)) {
                            params[name] = expressionValue(value, scope, `${key}.buff.${legacyKey}.${name}`);
                        }
                        // Old TF_BuffSustainHurt stores several attribute *names* in params and
                        // resolves them from the caster when each tick fires. Freeze those lookups
                        // now so a replay does not depend on a later config/source-unit mutation.
                        for (const field of [
                            '伤害加成属性名', '额外伤害加成属性名',
                            '额外伤害触发属性名', '额外伤害间隔属性名',
                        ]) {
                            const attrName = typeof params[field] === 'string' ? String(params[field]).trim() : '';
                            if (attrName) params[`${field}值`] = attr.GetValue(attrName);
                        }
                        buffs.push({
                            legacyKey,
                            params,
                            sourceAttack: Math.max(0, Number(attr.GetValue('角色攻击力')) || 0),
                        });
                        break;
                    }
                }
            }
        }

        return {
            hasDamageFormula,
            damage: hasDamageFormula ? round2(baseDamage * (1 + additivePct * .01) * (1 + amplificationPct * .01)) : 0,
            range,
            hitCount,
            executeChance,
            buffs,
        };
    }
}

type PackedRows = { k?: unknown; v?: unknown };

export function normalizeZCLegacyRows(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
    if (!value || typeof value !== 'object') return [];
    const packed = value as PackedRows;
    if (!Array.isArray(packed.k) || !Array.isArray(packed.v)) return [];
    const keys = packed.k.map(String);
    return packed.v.flatMap((cells) => Array.isArray(cells)
        ? [Object.fromEntries(keys.map((key, index) => [key, cells[index]]))]
        : []);
}

function list(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    if (value == null || value === '') return [];
    return [String(value).trim()].filter(Boolean);
}

/** Attach skillView.hurt/exHurt effect keys to the PVP normal/empowered profiles. */
export function parseZCLegacySkillViewBindings(
    value: unknown,
    empoweredByNormal?: ReadonlyMap<number, number | undefined>,
): Readonly<Record<number, readonly string[]>> {
    const result: Record<number, string[]> = {};
    for (const row of normalizeZCLegacyRows(value)) {
        const skillId = Number(row.skillId);
        if (Number.isFinite(skillId)) result[skillId] = list(row.hurt);
        const empoweredId = Number(row.exSkillId ?? empoweredByNormal?.get(skillId));
        if (Number.isFinite(empoweredId) && empoweredId > 0) result[empoweredId] = list(row.exHurt);
    }
    return result;
}

export function parseZCLegacySkillEffectConfig(
    skillAttr: unknown,
    skillEffect: unknown,
    skillBuff: unknown,
    pvpStatus: unknown,
    referencedKeys?: ReadonlySet<string>,
): ZCLegacySkillEffectConfig {
    const attributes: Record<string, unknown> = {};
    for (const row of normalizeZCLegacyRows(skillAttr)) {
        const key = String(row.key ?? '').trim();
        if (!key) continue;
        const raw = row.value;
        const numeric = Number(raw);
        attributes[key] = row.type === 'number' && Number.isFinite(numeric) ? numeric : raw;
    }

    const effectsByKey: Record<string, ZCLegacySkillEffectRow[]> = {};
    const firstEffectRunByKey = new Map<string, Map<string, number>>();
    let previousEffectKey = '';
    let effectRun = 0;
    for (const row of normalizeZCLegacyRows(skillEffect)) {
        const key = String(row.key ?? '').trim();
        if (key !== previousEffectKey) {
            effectRun += 1;
            previousEffectKey = key;
        }
        if (!key || (referencedKeys && !referencedKeys.has(key))) continue;
        const effects = Array.isArray(row.effects) ? row.effects : [];
        for (const item of effects) {
            if (!item || typeof item !== 'object') continue;
            const raw = item as Record<string, unknown>;
            const script = String(raw.script ?? '').trim();
            const effect = raw.effect && typeof raw.effect === 'object' ? raw.effect as Record<string, unknown> : {};
            const parsed: ZCLegacySkillEffectRow = {
                condition: String(raw.condiction ?? raw.condition ?? '默认'),
                script,
                effect,
            };
            // J 表曾把整段技能效果复制到后面的不同 key 段；同段重复仍是可叠加的配置。
            const signature = JSON.stringify([parsed.condition, parsed.script, parsed.effect]);
            const firstRun = firstEffectRunByKey.get(key) ?? new Map<string, number>();
            if (!firstEffectRunByKey.has(key)) firstEffectRunByKey.set(key, firstRun);
            const previousRun = firstRun.get(signature);
            if (previousRun !== undefined && previousRun !== effectRun) continue;
            if (previousRun === undefined) firstRun.set(signature, effectRun);
            (effectsByKey[key] ??= []).push(parsed);
            if (SUPPORTED_SCRIPTS.has(script)) {
                const condition = conditionFormula(parsed.condition);
                if (condition) compileZCLegacyExpression(condition);
                const candidates = script === 'buff'
                    ? Object.values(effect.param && typeof effect.param === 'object' ? effect.param as Record<string, unknown> : {})
                    : Object.values(effect);
                for (const candidate of candidates) if (typeof candidate === 'string' && candidate.trim()) compileZCLegacyExpression(candidate);
            }
        }
    }

    const buffDefaults: Record<string, Readonly<Record<string, unknown>>> = {};
    const buffTypes: Record<string, string> = {};
    for (const row of normalizeZCLegacyRows(skillBuff)) {
        const key = String(row.key ?? '').trim();
        if (key && !buffDefaults[key]) {
            buffDefaults[key] = row.param && typeof row.param === 'object' ? row.param as Record<string, unknown> : {};
            buffTypes[key] = String(row.type ?? '').trim();
        }
    }

    const legacyStatusIds: Record<string, string> = {};
    for (const row of normalizeZCLegacyRows(pvpStatus)) {
        const legacyKey = String(row.legacyBuffKey ?? '').trim();
        const statusId = String(row.statusId ?? '').trim();
        if (legacyKey && statusId) legacyStatusIds[legacyKey] = statusId;
    }
    return { attributes, effectsByKey, buffDefaults, buffTypes, legacyStatusIds };
}
