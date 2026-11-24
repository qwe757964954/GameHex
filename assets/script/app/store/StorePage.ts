import { _decorator, Component } from 'cc';

import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';
import { EventMgr } from '../../framework/event/EventMgr';

const { ccclass } = _decorator;

/**
 * 商城页主控（Store.prefab）。商城是主界面底部第 0 格，整页实例化、切走即销毁，
 * 没有弹窗语义，所以直接继承 Component。
 *
 * 版面由 Bg、ShopPanel、Npc、ResBar 和 ScrollView 组成；ScrollView 的 content
 * 依次放 5 个分段 prefab。资源条复用公共 ResBar，显示哪两格由 prefab 的 resKeys 决定。
 */
@ccclass('StorePage')
export class StorePage extends Component {
    /** 目录名大小写必须和磁盘一致；真机热更包对路径大小写敏感。 */
    static prefabPath = 'ui/Store/Store';

    onLoad(): void {
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'ready' }, this);
    }

    onDestroy(): void {
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'destroyed' }, this);
    }
}
