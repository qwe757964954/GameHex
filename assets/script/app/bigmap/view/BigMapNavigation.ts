import { Node, UITransform, Widget } from 'cc';

export function mountBigMapNavigation(navigation: Node, page: Node): { height: number; restore: () => void } {
    const parent = navigation.parent;
    const index = navigation.getSiblingIndex();
    const position = navigation.position.clone();
    const widget = navigation.getComponent(Widget);
    const widgetEnabled = widget?.enabled ?? false;
    const height = navigation.getComponent(UITransform)?.height ?? 0;
    const pageHeight = page.getComponent(UITransform)?.height ?? 0;
    if (widget) widget.enabled = false;
    navigation.setParent(page);
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
