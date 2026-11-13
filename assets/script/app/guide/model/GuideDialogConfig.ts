/**
 * 引导台词与角色立绘配置（纯 TS，不 import `cc`）。
 *
 * ## 两段数据
 *
 * - **台词**：`assets/remoteRef/guideDialog.json`（44 行，从设计案「NPC与文案」页提取）。
 *   列：`id`（D01a）/ `group`（D01）/ `order`（1=组内第 1 句）/ `speaker` / `content`。
 * - **立绘**：不进表，走下面的 {@link GUIDE_PORTRAITS} 映射。
 *
 * ## 为什么立绘不进表
 *
 * 只有两个 NPC，加列会让「美术换图」也要动配表。用代码映射还能拿到编译期收窄
 * （`keyof typeof`），写错角色名直接编译不过 —— 与 `ZCGuideConfig.GUIDE_ICON_PATHS` 同一套口径。
 *
 * 埃莉斯是静图（美术给的 1147×1263 白底 JPG 抠出来的），豌豆游侠直接复用战场骨骼
 * `skel/豌豆射手/豌豆射手.prefab`（`sp.Skeleton` + `defaultAnimation='idle'`）——
 * 两者都不需要再单独出立绘。未登记的角色返回 `null` ⇒ 表现层只显示台词、不显示立绘。
 */

/** 一句台词。 */
export interface GuideDialogLine {
    /**
     * 句 id，**数字**：`组序号 × 100 + 句序号`（`D01a` → `101`、`D16c` → `1603`）。
     *
     * 用数字是为了和其它表的主键口径一致（配表主键统一 int），也能从 id 反推组与顺序。
     */
    readonly id: number;
    /** 组 id（`D01`），与 `guideStep.dialogId` 对齐。 */
    readonly group: string;
    /** 组内顺序，从 1 开始。 */
    readonly order: number;
    /** 说话人显示名。 */
    readonly speaker: string;
    readonly content: string;
}

/**
 * 说话人的立绘来源。
 *
 * 两种形态：
 *   · `sprite` —— 单张静图（埃莉斯，`main-pages` 分包 `image/guide/`）
 *   · `prefab` —— **骨骼动画**（豌豆游侠直接复用战场那份 `skel/豌豆射手/豌豆射手.prefab`，
 *     里面是 `sp.Skeleton` + `defaultAnimation='idle'`，不用另出立绘）
 */
export interface GuidePortraitAsset {
    readonly kind: 'sprite' | 'prefab';
    /** `sprite` = 图片资源路径（不带 `/spriteFrame`）；`prefab` = prefab 路径。 */
    readonly asset: string;
}

const GUIDE_PORTRAITS = {
    埃莉斯: { kind: 'sprite', asset: 'image/guide/guide_elis' },
    豌豆游侠: { kind: 'prefab', asset: 'skel/豌豆射手/豌豆射手' },
} as const;

/** 已登记的说话人。写错名字编译期就报错。 */
export type GuidePortraitSpeaker = keyof typeof GUIDE_PORTRAITS;

/** 已登记的立绘清单（`speaker` + 来源描述），供 application 层批量预加载。 */
export const GUIDE_PORTRAIT_ENTRIES: readonly ({ readonly speaker: string } & GuidePortraitAsset)[] =
    (Object.keys(GUIDE_PORTRAITS) as GuidePortraitSpeaker[]).map((speaker) => ({
        speaker,
        ...GUIDE_PORTRAITS[speaker],
    }));

/** 立绘来源；未登记 / 空名返回 `null`（表现层据此藏立绘，不留白框）。 */
export function getGuidePortraitAsset(speaker: string): GuidePortraitAsset | null {
    return speaker in GUIDE_PORTRAITS ? GUIDE_PORTRAITS[speaker as GuidePortraitSpeaker] : null;
}

/**
 * 资源加载路径。
 *
 * `sprite` 必须带 `/spriteFrame` —— `resources.load` 裸路径会报
 * 「Bundle resources doesn't contain xxx」（`spriteFramePathOf` 那条规则的由来）。
 * `prefab` 直接用原路径。
 */
export function getGuidePortraitLoadPath(speaker: string): string | null {
    const portrait = getGuidePortraitAsset(speaker);
    if (!portrait) return null;
    return portrait.kind === 'sprite' ? `${portrait.asset}/spriteFrame` : portrait.asset;
}

/** 解析台词表。缺 `id` / `content` 的行丢弃（半行数据无法播放）。 */
export function parseGuideDialogLines(rows: readonly unknown[]): GuideDialogLine[] {
    const out: GuideDialogLine[] = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const raw = row as Record<string, unknown>;
        const id = Number(raw.id);
        const content = typeof raw.content === 'string' ? raw.content : '';
        if (!Number.isSafeInteger(id) || id <= 0 || !content) continue;
        const order = Number(raw.order);
        out.push({
            id,
            // 缺 group 时从数字 id 反推：101 → D01
            group: typeof raw.group === 'string' && raw.group
                ? raw.group
                : `D${String(Math.floor(id / 100)).padStart(2, '0')}`,
            order: Number.isFinite(order) ? order : 0,
            speaker: typeof raw.speaker === 'string' ? raw.speaker : '',
            content,
        });
    }
    return out;
}

/**
 * 按组切分并排序（组内按 `order` 升序）。
 *
 * 表里行序已经是播出序，这里再按 `order` 排一次是防御：策划插行时不用保证位置。
 */
export function groupGuideDialogLines(
    lines: readonly GuideDialogLine[],
): Map<string, readonly GuideDialogLine[]> {
    const groups = new Map<string, GuideDialogLine[]>();
    for (const line of lines) {
        const bucket = groups.get(line.group);
        if (bucket) bucket.push(line);
        else groups.set(line.group, [line]);
    }
    for (const bucket of groups.values()) {
        bucket.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }
    return groups;
}
