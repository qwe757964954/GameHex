import { MAIN_PAGES_BUNDLE } from '../../core/asset/BundleCatalog';

export const enum MainTab {
    Shop = 0, Hero = 1, Role = 2, Territory = 3, Challenge = 4, Alliance = 5, World = 6,
}

export type IMainTabTarget =
    | { readonly kind: 'page'; readonly path: string; readonly bundle?: string }
    | { readonly kind: 'overlay' }
    | { readonly kind: 'locked' };

export function mainTabTarget(tab: number): IMainTabTarget | null {
    switch (tab) {
        case MainTab.Shop: return { kind: 'page', path: 'ui/Store/Store', bundle: MAIN_PAGES_BUNDLE };
        case MainTab.Hero: return { kind: 'page', path: 'ui/card/CardLineup', bundle: MAIN_PAGES_BUNDLE };
        case MainTab.Role: return { kind: 'page', path: 'ui/Role/Role', bundle: MAIN_PAGES_BUNDLE };
        case MainTab.Territory: return { kind: 'page', path: 'ui/main/ArenaRoot' };
        case MainTab.Alliance: return { kind: 'page', path: 'ui/League/LeagueTab', bundle: MAIN_PAGES_BUNDLE };
        case MainTab.World: return { kind: 'overlay' };
        case MainTab.Challenge: return { kind: 'locked' };
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
