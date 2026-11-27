import { _decorator, Component, Label, Node, UITransform } from 'cc';

const { ccclass, property } = _decorator;

/** 属性名与当前值的最小横向间距（设计分辨率像素）。 */
const VALUE_GAP = 10;

/** 当前值与提升箭头的最小横向间距（设计分辨率像素）。 */
const NEXT_ARROW_GAP = 12;

/**
 * 装备锻造属性行组件（对齐 FGUI `组件_装备锻造_属性item.xml`）。
 * 遵循组件属性绑定规范，消除外部 getChildByName/getComponent 动态查询。
 *
 * `nextLabel` / `arrowNode` 允许不绑（无下一级预览的行可复用同一组件；
 * 当前 `EquipEvolve.prefab` 四个实例均已绑定四列）。
 */
@ccclass('EquipEvolveAttrItem')
export class EquipEvolveAttrItem extends Component {
    @property({ type: Label, tooltip: '属性名标签' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: '当前属性值标签' })
    curLabel: Label = null!;

    @property({ type: Label, tooltip: '下一级属性值标签（无下一级列时可空）' })
    nextLabel: Label | null = null;

    @property({ type: Node, tooltip: '提升箭头节点（无下一级列时可空）' })
    arrowNode: Node | null = null;

    /** Prefab 里当前值列的默认右缘（局部坐标），首次排版时采集，之后不随文本扩宽漂移。 */
    private baseValueRight: number | null = null;

    /** Prefab 里箭头 / 下一级列的默认 X 坐标，首次排版时采集，供长词条顺推后回弹归位。 */
    private baseArrowX: number | null = null;
    private baseNextX: number | null = null;

    /** 传入 `next` 才显示「→ 下一级」，不传即只显示当前值（满级 / 满品阶由调用方不传）。 */
    setData(name: string, cur: string | number, next?: string | number): void {
        this.node.active = true;
        this.nameLabel.string = name;
        this.curLabel.string = String(cur);

        let showNext = false;
        if (this.nextLabel) {
            if (next != null) {
                this.nextLabel.string = String(next);
                showNext = true;
            }
            this.nextLabel.node.active = showNext;
        }
        if (this.arrowNode) {
            this.arrowNode.active = showNext;
        }

        this.layoutRow(showNext);
    }

    /**
     * 按实测宽度整行顺排：当前值保持不小于 Prefab 默认列右缘，支持 `anchorX = 0 / 1`，
     * 并在显示下一级时同步顺推箭头与下一级文案避免重叠；切回短词条后自动归位。
     *
     * 必须先 `updateRenderData(true)`：`Overflow.NONE` 的实测宽度是延迟写回
     * `UITransform` 的，不逼一次读到的是上一句的宽度（与 `TerritoryResourceGainView` 同一个坑）。
     */
    private layoutRow(showNext: boolean): void {
        const nameNode = this.nameLabel.node;
        const curLabel = this.curLabel;
        const curNode = curLabel.node;
        const nameUI = nameNode.getComponent(UITransform);
        const curUI = curNode.getComponent(UITransform);

        if (this.baseValueRight === null) {
            this.baseValueRight = curNode.position.x + (1 - curUI.anchorX) * curUI.width;
        }
        if (this.arrowNode && this.baseArrowX === null) {
            this.baseArrowX = this.arrowNode.position.x;
        }
        if (this.nextLabel && this.baseNextX === null) {
            this.baseNextX = this.nextLabel.node.position.x;
        }

        // Prefab 若仍为 CLAMP 定宽框，先切回 Overflow.NONE 再刷实测宽，避免长数值被裁掉。
        if (curLabel.overflow !== Label.Overflow.NONE) {
            curLabel.overflow = Label.Overflow.NONE;
        }
        this.nameLabel.updateRenderData(true);
        curLabel.updateRenderData(true);

        const nameRight = nameUI.width > 0
            ? nameNode.position.x + (1 - nameUI.anchorX) * nameUI.width
            : 0;
        const valueWidth = curUI.width;
        const right = Math.max(this.baseValueRight, nameRight + VALUE_GAP + valueWidth);
        curNode.setPosition(right - (1 - curUI.anchorX) * valueWidth, curNode.position.y, curNode.position.z);

        if (!showNext || !this.arrowNode || this.baseArrowX === null) {
            return;
        }
        const arrowUI = this.arrowNode.getComponent(UITransform);
        const arrowLeft = this.baseArrowX - (arrowUI ? arrowUI.anchorX * arrowUI.width : 0);
        const shift = Math.max(0, right + NEXT_ARROW_GAP - arrowLeft);
        this.arrowNode.setPosition(this.baseArrowX + shift, this.arrowNode.position.y, this.arrowNode.position.z);
        if (this.nextLabel && this.baseNextX !== null) {
            const nextNode = this.nextLabel.node;
            nextNode.setPosition(this.baseNextX + shift, nextNode.position.y, nextNode.position.z);
        }
    }
}
