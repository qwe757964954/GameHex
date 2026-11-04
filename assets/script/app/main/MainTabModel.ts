import { MAIN_PAGES_BUNDLE } from '../../core/asset/BundleCatalog';

export const enum MainTab {
    Shop = 0, Hero = 1, Role = 2, Territory = 3, Challenge = 4, Alliance = 5, World = 6,
}

export type IMainTabTarget =
    | { readonly kind: 'page'; readonly path: string; readonly bundle?: string }
    | { readonly kind: 'overlay' }
    | { readonly kind: 'locked' };

/**
 * 暂未开放的页签 —— 底栏仍显示该格（名称/图标照常），但压暗、右上角挂锁、点击不切页。
 *
 * ⚠️ **这是「未开放」的唯一真源**：`MainTabHost`（决定要不要 `setEnabled(false)`）与
 * `mainTabTarget`（决定 controller 拦不拦）都只读这一份，别在宿主里再写一个 `type !== xxx`。
 *
 * 开放某一格时：从这里删掉，并在 `mainTabTarget` 里补回它的页面路径 ——
 *   - `Role`     → `ui/Role/Role`（`MAIN_PAGES_BUNDLE`）
 *   - `Alliance` → `ui/League/LeagueTab`（`MAIN_PAGES_BUNDLE`）
 *   - `Challenge`→ 老章节地图已移除，暂无目标页（见 `tests/main-tab-adventure-route.test.ts`）
 */
const LOCKED_TABS: ReadonlySet<number> = new Set<number>([MainTab.Role, MainTab.Alliance, MainTab.Challenge]);

/** 该页签是否处于「未开放」状态（底栏锁与点击拦截同源）。 */
export function isMainTabLocked(tab: number): boolean {
    return LOCKED_TABS.has(tab);
}

export function mainTabTarget(tab: number): IMainTabTarget | null {
    if (isMainTabLocked(tab)) return { kind: 'locked' };
    switch (tab) {
        case MainTab.Shop: return { kind: 'page', path: 'ui/Store/Store', bundle: MAIN_PAGES_BUNDLE };
        case MainTab.Hero: return { kind: 'page', path: 'ui/card/CardLineup', bundle: MAIN_PAGES_BUNDLE };
        case MainTab.Territory: return { kind: 'page', path: 'ui/main/ArenaRoot' };
        case MainTab.World: return { kind: 'overlay' };
        default: return null;
    }
}

export interface IMainTabState {
    readonly currentTab: number;
    readonly loadingTab: number;
    readonly revision: number;
    readonly worldVisible: boolean;
}

export class MainTabModel {
    private state: IMainTabState = { currentTab: -1, loadingTab: -1, revision: 0, worldVisible: false };
    get snapshot(): IMainTabState { return this.state; }
    begin(tab: number): number {
        this.state = { ...this.state, revision: this.state.revision + 1, loadingTab: tab };
        return this.state.revision;
    }
    commit(tab: number): void { this.state = { ...this.state, currentTab: tab }; }
    showWorld(visible: boolean): void { this.state = { ...this.state, worldVisible: visible }; }
    settle(): void { this.state = { ...this.state, loadingTab: -1 }; }
}
