/**
 * 章节格子的 bitSet 编解码。
 *
 * 服务端用 `repeated uint64` 传格子集合（`CmdCityChapterCellInfoRspMsg.unlockCells / passCells`），
 * protobuf 只把它解成一串 uint64，位运算得自己做。
 *
 * ## uint64 在本工程解出来是 **Long 对象**（实测，2026-10-09）
 *
 * runtime 是 `protobufjs@7.6.2`（`protoCompiledStatic.ts:23` 的
 * `import $protobuf from 'protobufjs/minimal.js'`），而 **protobufjs 自带 `util.Long`**
 * ⇒ `Reader.uint64()` 返回 `{low, high, unsigned}` 的 Long，**64 位全可用**。
 * 实测：格子 63 解出 `low=0, high=-2147483648, unsigned=true`，第 63 位完整取出。
 *
 * ⚠️ **别被同名文件骗了**（我第一版就踩了，白改一轮编码口径）：
 * `assets/script/lib/protobuf/protobuf.js` 里那段 `define(["long"], ...)` 加载代码
 * 是**被注释掉的**，实测它的 `util.Long` 为 `false` ⇒ 解出来是普通 number、
 * `2^53` 以上静默丢位。**那个文件全工程零引用，是没被引用的旧副本**。
 * ⇒ 验 protobuf 行为**必须 import `protobufjs/minimal.js`**，别拿它当探针。
 *
 * ## ⚠️ 仍然保留 number 形态的防御
 *
 * 万一 runtime 换成不带 Long 的精简实现（`util.Long === false`），
 * 解出来会是 number，此时超过 2^53 的块**明确判 invalid** 并给原因，
 * 而不是丢位给玩家看"莫名少了几格领地"。
 *
 * 两条实现约定（都是踩过的坑）：
 *   ① 位为 1 的判定一律用**取模**（`Math.floor(v / 2**bit) % 2`），不用 `&` ——
 *      `1 << 31` 是**负数**（JS `<<` 是 32 位有符号），位 31 以上全判错。
 *   ② 编码用 `+=` 位值 + `Set` 先去重（天然幂等）；**不用**按位或，
 *      因为 `| 0` / `>>> 0` 会把 ≥2^31 的 word 截成负数，格子 31/63 直接丢。
 */

/** 一个 uint64 word = 64 格。 */
const BITS_PER_WORD = 64;
/** Long 的 low / high 各 32 位。 */
const BITS_PER_HALF = 32;

/**
 * 单次编解码允许的最大 word 数（`2^16` = 65536，足够表达 400 万格）。
 *
 * ⚠️ 内存保险：脏格子号（`2^53`）会让 `new Array(2^53 / 64)` 把进程内存打爆
 * （实测 Node 直接 SIGTERM）。正常章节只有 4 个 word（240 格 ÷ 64）。
 */
export const MAX_BITSET_WORDS = 1 << 16;

/**
 * number 形态（runtime 未装 Long 时）能无损承载的最大格子号 + 1 = 53。
 *
 * ⚠️ 实测得出的天花板：word 覆盖 64 格，格子 53 就把 word 顶出 2^53 安全区，
 * 之后**连低位都不可信**（`encode([0,1,62,63,64,65])` 解回来丢了 0/1/64/65）。
 * 只在 number 形态下生效；**Long 形态（本工程的真实情况）不受此限**。
 */
export const MAX_EXACT_CELL_IN_NUMBER = 53;

/** 解码失败时的返回（与"空集合"区分开）。 */
export interface IBitSetDecodeResult {
    /** `null` = 解码失败，原因见 `reason`；**不返回半截格子集**。 */
    readonly cells: number[] | null;
    readonly reason?: string;
}

/** 一个 32 位块里的第 bit 位对应的数值。 */
function bitValue(bit: number): number {
    // ⚠️ **不能用 `1 << bit`**：JS 的 `<<` 是 32 位**有符号**运算，
    // `1 << 31 === -2147483648`（负数！）⇒ 位 31 及以上全判错。
    return Math.pow(2, bit);
}

/** 判一个 32 位块的第 bit 位是否为 1（取模，不受块值是否 ≥2^31 影响）。 */
function isBitSet(block: number, bit: number): boolean {
    return Math.floor(block / bitValue(bit)) % 2 === 1;
}

/** 把一个 32 位块里的 1 位翻成格子序号塞进 out。 */
function pushCells(block: number, base: number, out: number[]): void {
    // ⚠️ 先 `>>> 0` 归一：Long 的 low/high 是有符号 32 位，`-1` 要当 `4294967295`。
    const value32 = block >>> 0;
    for (let bit = 0; bit < BITS_PER_HALF; bit += 1) {
        if (!isBitSet(value32, bit)) continue;
        out.push(base + bit);
    }
}

/**
 * 把一个 uint64 word 翻成它代表的格子序号。
 *
 * @param base 该 word 对应的格子起点（= `wordIndex * 64`）
 */
function wordToCells(word: unknown, base: number, invalid: string[], wordIndex: number): number[] {
    const cells: number[] = [];
    if (typeof word === 'number') {
        if (!Number.isFinite(word) || word < 0 || !Number.isInteger(word)) {
            invalid.push(`第 ${wordIndex} 块不是非负整数：${String(word)}`);
            return cells;
        }
        // ⚠️ number 形态的安全区检查：超过 2^53 后连低位都不可信 ⇒ 明确判 invalid。
        // 本工程的真实 runtime（protobufjs）返回 Long，走下面那个分支 ⇒ 这条永不触发。
        if (word >= Math.pow(2, MAX_EXACT_CELL_IN_NUMBER)) {
            invalid.push(
                `第 ${wordIndex} 块的值 ${word} 超出 number 形态的无损上限`
                + `（格子号须 < ${MAX_EXACT_CELL_IN_NUMBER}；当前 runtime 未装 Long）`,
            );
            return cells;
        }
        pushCells(word % 0x100000000, base, cells);
        pushCells(Math.floor(word / 0x100000000), base + BITS_PER_HALF, cells);
        return cells;
    }
    if (word && typeof word === 'object') {
        // ★ 本工程的真实形态：protobufjs 的 Long。
        const record = word as { low?: unknown; high?: unknown };
        const low = Number(record.low);
        const high = Number(record.high);
        if (!Number.isFinite(low) || !Number.isFinite(high)) {
            invalid.push(`第 ${wordIndex} 块不是 Long 形状：${JSON.stringify(word)}`);
            return cells;
        }
        pushCells(low, base, cells);
        pushCells(high, base + BITS_PER_HALF, cells);
        return cells;
    }
    invalid.push(`第 ${wordIndex} 块类型不支持：${typeof word}`);
    return cells;
}

/**
 * 解码服务端给的格子 bitSet。
 *
 * @param words `repeated uint64` 解出来的数组（Long 对象与 number 都认）
 * @param maxCell 可选上界（通常传 `rows × columns`），超出的位**丢弃**
 *   —— 服务端可能已扩容章节而客户端拿的是旧地图，不裁剪会让 UI 算出越界坐标。
 * @returns 格子序号（升序、去重）；任一块坏掉时 `cells` 为 `null`。
 */
export function decodeCellBitSet(words: readonly unknown[] | null | undefined, maxCell?: number): IBitSetDecodeResult {
    if (words === null || words === undefined) return { cells: [] };
    if (!Array.isArray(words)) return { cells: null, reason: 'bitSet 不是数组' };
    if (words.length > MAX_BITSET_WORDS) {
        return { cells: null, reason: `bitSet 块数 ${words.length} 超过上限 ${MAX_BITSET_WORDS}` };
    }
    const invalid: string[] = [];
    const cells: number[] = [];
    for (let index = 0; index < words.length; index += 1) {
        for (const cell of wordToCells(words[index], index * BITS_PER_WORD, invalid, index)) cells.push(cell);
    }
    // ⚠️ 半截数据比全空更糟：领地页会按"缺格子"渲染 ⇒ 凭空吃掉玩家已通关的领地。
    if (invalid.length) return { cells: null, reason: invalid.join('；') };
    const limit = typeof maxCell === 'number' && Number.isFinite(maxCell) && maxCell > 0 ? maxCell : Infinity;
    return { cells: Array.from(new Set(cells.filter((cell) => cell >= 0 && cell < limit))).sort((a, b) => a - b) };
}

/**
 * 编码：格子序号数组 → `repeated uint64`。
 *
 * ## ⚠️ 必须产出 **Long 形态**（`{low, high, unsigned}`），不能是纯 number
 *
 * 因为工程 runtime（protobufjs）解出来就是 Long，编码若给纯 number，
 * 往返时 word 一旦含格子 53 以上就会撞上解码的 number 安全区判invalid ——
 * **编码与解码必须用同一套形状，否则往返必然自相矛盾**（实测 `[63,64,65]` 直接失败）。
 *
 * Long 的 low / high 各 32 位，整套 64 位无损，且 `protoCompiledStatic` 的
 * 编码侧走 `LongBits.from`，对 Long 对象与十进制字符串都认。
 *
 * 与 {@link decodeCellBitSet} 严格互逆（`decode(encode(ids)).cells` 必须等于去重排序后的 `ids`）。
 * 空集合返回 `[]` 而不是 `[0]` —— 否则服务端会凭空多出格子 0。
 */
export function encodeCellBitSet(cells: readonly number[]): Array<{ low: number; high: number; unsigned: boolean }> {
    if (!Array.isArray(cells) || cells.length === 0) return [];
    // 先去重 + 过滤非法格子号。**不能**因为一个脏格子号就丢掉整批 —— 那等于清空玩家进度。
    const valid: number[] = [];
    const seen = new Set<number>();
    for (const cell of cells) {
        if (!Number.isInteger(cell) || cell < 0 || cell > MAX_BITSET_WORDS * BITS_PER_WORD) continue;
        if (seen.has(cell)) continue;
        seen.add(cell);
        valid.push(cell);
    }
    if (!valid.length) return [];
    let maxCell = 0;
    for (const cell of valid) if (cell > maxCell) maxCell = cell;
    const wordCount = Math.floor(maxCell / BITS_PER_WORD) + 1;
    if (wordCount > MAX_BITSET_WORDS) {
        console.warn(`[TerritoryCell] bitSet 编码被拒绝：需要 ${wordCount} 个块，超过上限 ${MAX_BITSET_WORDS}`);
        return [];
    }
    // 每个 word 拆成 low / high 两个 32 位，各自精确（≤ 2^32-1）。
    const lows = new Array<number>(wordCount).fill(0);
    const highs = new Array<number>(wordCount).fill(0);
    for (const cell of valid) {
        const wordIndex = Math.floor(cell / BITS_PER_WORD);
        const bit = cell % BITS_PER_WORD;
        // ⚠️ 必须用「+= 位值」而不是按位或：
        //   `1 << 31` 是负数（JS `<<` 是 32 位有符号）、`| 0` 会截断 ⇒ 格子 31/63 丢。
        // 「先 Set 去重 + 再累加」保证同一格只加一次，天然幂等。
        if (bit < BITS_PER_HALF) lows[wordIndex] += bitValue(bit);
        else highs[wordIndex] += bitValue(bit - BITS_PER_HALF);
    }
    return lows.map((low, index) => ({ low, high: highs[index], unsigned: true }));
}

/**
 * 服务端快照：一章的格子状态。
 *
 * 与本地 `TerritoryProgressData` 的差别：这是**只读回包**，落地要走
 * `TerritoryProgress` 的规则（起点必占领、探索中的格不可重复占领），
 * 所以这里只保留服务端给的三项，不预判任何本地约束。
 */
export interface ITerritoryCellState {
    readonly levelChapter: number;
    /** 0 = 奖励未领取，1 = 已领取。 */
    readonly rewardState: number;
    /** 已解锁（可探索）的格子。 */
    readonly unlockCells: readonly number[];
    /** 已通关（已占领）的格子。 */
    readonly passCells: readonly number[];
}

/** 空快照：请求失败 / 服务端还没数据时用它，避免各处判 null。 */
export function emptyCellState(levelChapter: number): ITerritoryCellState {
    return { levelChapter, rewardState: 0, unlockCells: [], passCells: [] };
}

/** 奖励是否已领。协议说 0 未领 / 1 已领，其它值一律按未领（宁可让玩家再领一次也别卡住）。 */
export function isRewardClaimed(state: ITerritoryCellState): boolean {
    return state.rewardState === 1;
}