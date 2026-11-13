/**
 * 引导配置与资源的加载入口（application 层）。
 *
 * 三段数据分开取，互不阻塞：
 *   · `guideStep`   步骤链（纯表）
 *   · `guideDialog` 台词（纯表）
 *   · 立绘          图片资源（走 `AssetService`，归属调用方的 `ResourceScope`）
 *
 * 全部「失败即空、不抛」—— 任何一段没打进包，只让对应表现缺失，不该让人进不去主界面。
 */

import { Prefab, SpriteFrame } from 'cc';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import { RefUtil } from '../../../framework/ref/RefUtil';
import {
    GUIDE_PORTRAIT_ENTRIES,
    groupGuideDialogLines,
    parseGuideDialogLines,
} from '../model/GuideDialogConfig';
import type { GuideDialogLine } from '../model/GuideDialogConfig';
import { parseGuideSteps } from '../model/GuideStepConfig';
import type { GuideStep } from '../model/GuideStepConfig';

/** 表名（对应 `assets/remoteRef/guideStep.json`，不带后缀）。 */
export const GUIDE_STEP_TABLE = 'guideStep';
/** 台词表（`assets/remoteRef/guideDialog.json`）。 */
export const GUIDE_DIALOG_TABLE = 'guideDialog';

/**
 * 读引导表。
 *
 * @returns 解析后的步骤；表缺失 / 加载失败 / 内容为空时返回**空数组**（调用方据此跳过引导），
 *   不抛 —— 引导表没打进包不该让人进不去主界面。
 */
export async function loadGuideSteps(): Promise<GuideStep[]> {
    try {
        const rows = await RefUtil.instance.getRefAllAsync(GUIDE_STEP_TABLE);
        if (!Array.isArray(rows) || rows.length === 0) {
            console.warn(`[GuideLoader] 引导表 ${GUIDE_STEP_TABLE} 为空或未打进包，本次不做引导`);
            return [];
        }
        const steps = parseGuideSteps(rows);
        if (steps.length === 0) {
            // 原始行有数据但解析为 0：多半是列名改了 / stepId 列被改名，
            // 这种"表在、但一步都没有"的情况原先完全静默，真机上表现为"没有引导且没有任何日志"。
            console.warn(`[GuideLoader] 引导表解析后为空（原始 ${rows.length} 行），检查 stepId / completeCond 列名`);
        }
        return steps;
    } catch (error) {
        console.warn(`[GuideLoader] 引导表 ${GUIDE_STEP_TABLE} 加载失败，本次不做引导`, error);
        return [];
    }
}

/** 读台词表并按组切好。返回空 Map 时表现层只显示遮罩、不显示对话。 */
export async function loadGuideDialog(): Promise<{
    lines: readonly GuideDialogLine[];
    groups: ReadonlyMap<string, readonly GuideDialogLine[]>;
}> {
    try {
        const rows = await RefUtil.instance.getRefAllAsync(GUIDE_DIALOG_TABLE);
        const lines = Array.isArray(rows) ? parseGuideDialogLines(rows) : [];
        if (lines.length === 0) {
            console.warn(`[GuideLoader] 台词表 ${GUIDE_DIALOG_TABLE} 为空或未打进包，对话条将不可见`);
        }
        return { lines, groups: groupGuideDialogLines(lines) };
    } catch (error) {
        console.warn(`[GuideLoader] 台词表 ${GUIDE_DIALOG_TABLE} 加载失败，对话条将不可见`, error);
        return { lines: [], groups: new Map() };
    }
}

/**
 * 预加载所有已登记的立绘。
 *
 * 两种形态走两条路：`sprite` 取 `SpriteFrame`（路径带 `/spriteFrame`），`prefab` 取 `Prefab`
 * （骨骼动画，豌豆游侠复用战场那份）。
 *
 * @returns `asset 路径 → 资源`。缺图 / 加载失败的角色**不进 Map**，表现层据此隐藏立绘（不留白框）。
 */
export async function loadGuidePortraits(
    resources: Pick<IControllerResources, 'assets'>,
    scope?: ResourceScope,
): Promise<Map<string, SpriteFrame | Prefab>> {
    const loaded = new Map<string, SpriteFrame | Prefab>();
    await Promise.all(GUIDE_PORTRAIT_ENTRIES.map(async ({ speaker, kind, asset }) => {
        const path = kind === 'sprite' ? `${asset}/spriteFrame` : asset;
        try {
            const value = kind === 'sprite'
                ? await resources.assets.load(path, SpriteFrame, scope ? { scope } : undefined)
                : await resources.assets.load(path, Prefab, scope ? { scope } : undefined);
            if (value) loaded.set(asset, value);
            else console.warn(`[GuideLoader] 立绘为空：${asset}`);
        } catch (error) {
            console.warn(`[GuideLoader] 立绘加载失败：${path}（${speaker}）`, error);
        }
    }));
    return loaded;
}
