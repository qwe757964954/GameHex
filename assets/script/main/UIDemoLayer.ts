/**
 * UIDemoLayer — 旧 UI 框架演示页（已迁移到弹窗框架）
 * ------------------------------------------------------------------
 * 内容：一个居中弹窗面板，面板里是 Tab 容器（ListTab / SettingsTab）。
 *
 * 迁移说明（重要）：
 *   旧写法是 `extends UILayer` + `UIMgr.inst().openLayer(UIDemoLayer)`。
 *   但 `UIMgr.registerCanvas()` 在全项目里从未被调用过，
 *   `openLayer()` 必然走 `console.error('[UIMgr] openLayer 之前必须 registerCanvas')`
 *   然后 return null —— 也就是说这个页面**一直打不开**，是条断链。
 *
 *   新写法 `extends PopupBase` + `UIDemoLayer.open()`，由常驻节点 `Popup` 上的
 *   `PopupManager` 统一管理栈、深度与关闭，和 ZCGuidePanel / GameRunAway 同一套。
 *
 * 面板比屏幕小（620×900），所以四周的边距会走基类的「点击空白关闭」。
 * ------------------------------------------------------------------
 */
import { _decorator } from 'cc';
import { PopupBase } from '../framework/ui/PopupBase';
import { PopupCloseReason } from '../framework/ui/PopupDef';
import { UIDemoContainer } from './UIDemoContainer';

const { ccclass, property } = _decorator;

@ccclass('UIDemoLayer')
export class UIDemoLayer extends PopupBase {

    /** 预制体在 assets/resources/ui/ 下的相对路径（不含扩展名）。 */
    static prefabPath: string = 'ui/uidemo/UIDemoLayer';

    @property({
        type: UIDemoContainer,
        group: '演示',
        tooltip: '子节点 container 上的 UIDemoContainer（Tab 容器）',
    })
    container: UIDemoContainer | null = null;

    /** 每次打开：让 Tab 容器把两个子页建出来。 */
    protected async onOpen(): Promise<void> {
        const container = this.resolveContainer();
        if (!container) {
            console.warn('[UIDemoLayer] 未找到 UIDemoContainer，Tab 不会创建');
            return;
        }
        await container.setup();
        console.log('[UIDemoLayer] 打开完成，Tab 容器就绪');
    }

    /** 关闭：容器里的 Tab 节点由 UIDemoContainer.onDestroy 统一收。 */
    protected onClose(reason: PopupCloseReason): void {
        console.log(`[UIDemoLayer] 关闭 reason=${reason}`);
    }

    /**
     * 取容器组件。优先用 Inspector 绑的引用；
     * 兜底再按子节点遍历找一次（Cocos 3.x 在 async 流程里偶发重置 @property 组件引用）。
     */
    private resolveContainer(): UIDemoContainer | null {
        if (this.container && this.container.isValid) return this.container;
        for (const child of this.node.children) {
            const found = child.getComponent(UIDemoContainer);
            if (found) {
                this.container = found;
                return found;
            }
        }
        return null;
    }
}
