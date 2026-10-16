/**
 * SettingsTab — 演示 Tab：简单设置面板
 * ------------------------------------------------------------------
 * 用来说明「同一个 Tab 容器里切换不同子页」：
 * 和 ListTab 一样继承自新的 `UITab`（只依赖 cc + UIResources），
 * 不再依赖旧的 UIBase / UIMgr。
 * ------------------------------------------------------------------
 */
import { _decorator, Label } from 'cc';
import { UITab } from '../framework/ui/UITab';

const { ccclass, property } = _decorator;

@ccclass('SettingsTab')
export class SettingsTab extends UITab {

    public static prefabUrl: string = 'uidemo/SettingsTab';

    @property({
        type: Label,
        group: '设置',
        tooltip: '面板上的说明文字',
    })
    titleLabel: Label | null = null;

    protected onInit(): void {
        if (this.titleLabel) this.titleLabel.string = '设置页（演示）';
        console.log('[SettingsTab] onInit');
    }

    protected onSelected(): void {
        console.log('[SettingsTab] 被选中');
    }

    protected onUnselected(): void {
        console.log('[SettingsTab] 被切走');
    }
}
