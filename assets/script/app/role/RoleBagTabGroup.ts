import { _decorator, Component } from 'cc';
import { RoleBagTabItem } from './RoleBagTabItem';
import type { RoleBagTabId } from './RoleTypes';

const { ccclass, property } = _decorator;

/**
 * 背包页签组（挂 `ui/Role/Role.prefab` 的 `Role` 根）。
 *
 * 「谁亮」这条规则只属于页签自己：宿主 `RolePage` 只说「当前选中哪个 tab」，
 * 不再遍历页签、比较 `tabId`、逐个 `setSelected`。
 *
 * 这样加一个页签只需要在 prefab 里多拖一项进 {@link items}（并给它自己的 `tabId`），
 * page 一行都不用改 —— 也不会写出「按节点名找页签」那种一改名就静默失效的代码。
 */
@ccclass('RoleBagTabGroup')
export class RoleBagTabGroup extends Component {
    @property({ type: [RoleBagTabItem], tooltip: '三个背包页签：BagTabGem / BagTabEquip / BagTabItem' })
    items: RoleBagTabItem[] = [];

    /** 选中指定页签（`null` = 全部取消）。两态都写，切走时高亮不会留在原地。 */
    select(tab: RoleBagTabId | null): void {
        for (const item of this.items) item.setSelected(item.tabId === tab);
    }

    /** 按 tabId 取页签实例（红点等按页签维度的写入走这里）。缺配当场抛，别静默留下不亮的红点。 */
    item(tab: RoleBagTabId): RoleBagTabItem {
        const found = this.items.find(entry => entry.tabId === tab);
        if (!found) throw new Error(`[RoleBagTabGroup] 缺页签实例: tab=${tab}`);
        return found;
    }

    /** 红点统一归零（切走时用，防 `RedDot` 复用留残影）。 */
    clearRedDots(): void {
        for (const item of this.items) item.setRedDot(0);
    }
}
