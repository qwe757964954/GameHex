import { Node, UITransform, Widget } from 'cc';

export function mountBigMapNavigation(navigation: Node, page: Node): { height: number; restore: () => void } {
    const parent = navigation.parent;
    const index = navigation.getSiblingIndex();
    const position = navigation.position.clone();
    const widget = navigation.getComponent(Widget);
    const widgetEnabled = widget?.enabled ?? false;
    const height = navigation.getComponent(UITransform)?.height ?? 0;
    //`BigMapEntry` 传入的是宿主节点，真正带 DesignDock/Backdrop 的是它下面的
    //`BigMapPage` 预制体根节点。直接拿宿主当页面根会让导航成为宿主最后一个子节点，
    //始终压在整张页面预制体之上；必须先找到页面渲染面，再把导航插到 DesignDock 前面。
    const surface = page.getChildByName('DesignDock') ? page
        : (page.getChildByName('BigMapPage') ?? page);
    const dock = surface.getChildByName('DesignDock');
    const pageHeight = surface.getComponent(UITransform)?.height ?? 0;
    if (widget) widget.enabled = false;
    navigation.setParent(surface);
    if (dock?.isValid) navigation.setSiblingIndex(dock.getSiblingIndex());
    navigation.setPosition(0, -pageHeight / 2 + height / 2, 0);
    let restored = false;
    return {
        height,
        restore: () => {
            if (restored) return;
            restored = true;
            if (!navigation.isValid) return;
            navigation.setParent(parent?.isValid ? parent : null);
            navigation.setSiblingIndex(index);
            navigation.setPosition(position);
            if (widget?.isValid) widget.enabled = widgetEnabled;
        },
    };
}
