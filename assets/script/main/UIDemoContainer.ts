/**
 * UIDemoContainer — 演示用 Tab 容器（持有 ListTab + SettingsTab）
 * ------------------------------------------------------------------
 * 节点结构（UIDemoContainer.prefab）：
 *   UIDemoContainer (620×900)
 *     tabBtns/
 *       TabBtn_List       点它切到 ListTab
 *       TabBtn_Settings   点它切到 SettingsTab
 *     content/            Tab 预制体实例化到这里
 *
 * 由 UIDemoLayer.onOpen() 调 setup()，一次性建好两个 Tab 并选中第一个。
 *
 * 迁移说明：旧版继承自 `UITabContainer extends UIBase`，生命周期走 enter(args, done)，
 * 而且因为预制体里 children 曾经缺失，写了一段「主动 inflate 自己的 stub」的兜底。
 * 现在预制体结构是完整的，兜底整段删掉，改成显式的 setup()。
 * ------------------------------------------------------------------
 */
import { _decorator } from 'cc';
import { UITabContainer } from '../framework/ui/UITabContainer';
import { ListTab } from './ListTab';
import { SettingsTab } from './SettingsTab';

const { ccclass } = _decorator;

@ccclass('UIDemoContainer')
export class UIDemoContainer extends UITabContainer {

    /** 容器预制体自身的路径。 */
    public static prefabUrl: string = 'uidemo/UIDemoContainer';

    /** 保证 setup 只真正跑一次。 */
    private _setupDone = false;

    /**
     * 建立两个 Tab 并选中第一个。幂等，重复调用直接返回。
     */
    public async setup(): Promise<void> {
        if (this._setupDone) return;
        this._setupDone = true;

        const [listTab, settingsTab] = await Promise.all([
            this.addTab(ListTab, 'TabBtn_List'),
            this.addTab(SettingsTab, 'TabBtn_Settings'),
        ]);

        console.log(
            '[UIDemoContainer] Tab 就绪:',
            listTab ? 'ListTab ✓' : 'ListTab ✗',
            settingsTab ? 'SettingsTab ✓' : 'SettingsTab ✗',
        );

        const first = listTab ?? settingsTab;
        if (first) this.selectTab(first);
    }
}
