import { Vec2 } from "./Vec2";

export class Rect {
    /**
     * !#en Creates a rectangle from two coordinate values.
     * !#zh 根据指定 2 个坐标创建出一个矩形区域。
     * @static
     * @method fromMinMax
     * @param {Vec2} v1
     * @param {Vec2} v2
     * @return {Rect}
     * @example
     * cc.Rect.fromMinMax(cc.v2(10, 10), cc.v2(20, 20)); // Rect {x: 10, y: 10, width: 10, height: 10};
     */
    static fromMinMax(v1: Vec2, v2: Vec2) {
        var min_x = Math.min(v1.x, v2.x);
        var min_y = Math.min(v1.y, v2.y);
        var max_x = Math.max(v1.x, v2.x);
        var max_y = Math.max(v1.y, v2.y);
        return new Rect(min_x, min_y, max_x - min_x, max_y - min_y);
    }
    /**
     * @property {Number} x
     */
    x: number;
    /**
     * @property {Number} y
     */
    y: number;
    /**
     * @property {Number} width
     */
    width: number;
    /**
     * @property {Number} height
     */
    height: number;
    constructor(x: Rect | number = 0, y: number = 0, w: number = 0, h: number = 0) {
        this.init(x, y, w, h);
    }

    init(x: Rect | number = 0, y: number = 0, w: number = 0, h: number = 0) {
        if (x && typeof x === 'object') {
            y = x.y;
            w = x.width;
            h = x.height;
            x = x.x;
        }
        this.x = x as number || 0;
        this.y = y || 0;
        this.width = w || 0;
        this.height = h || 0;
    }

    /**
     * !#en TODO
     * !#zh 是否等于指定的矩形。
     * @method equals
     * @param {Rect} other
     * @return {Boolean}
     * @example
     * var a = new cc.Rect(0, 0, 10, 10);
     * var b = new cc.Rect(0, 0, 10, 10);
     * a.equals(b);// true;
     */
    equals(other: Rect): boolean {
        return other &&
            this.x === other.x &&
            this.y === other.y &&
            this.width === other.width &&
            this.height === other.height;
    };

    set(source: Rect): Rect {
        this.x = source.x;
        this.y = source.y;
        this.width = source.width;
        this.height = source.height;
        return this;
    }

    /**
     * !#en Check whether the current rectangle intersects with the given one
     * !#zh 当前矩形与指定矩形是否相交。
     * @method intersects
     * @param {Rect} rect
     * @return {Boolean}
     * @example
     * var a = new cc.Rect(0, 0, 10, 10);
     * var b = new cc.Rect(0, 0, 20, 20);
     * a.intersects(b);// true
     */
    intersects(rect: Rect): boolean {
        var maxax = this.x + this.width,
            maxay = this.y + this.height,
            maxbx = rect.x + rect.width,
            maxby = rect.y + rect.height;
        return !(maxax < rect.x || maxbx < this.x || maxay < rect.y || maxby < this.y);
    }

    /**
     * !#en Returns the overlapping portion of 2 rectangles.
     * !#zh 返回 2 个矩形重叠的部分。
     * @method intersection
     * @param {Rect} out Stores the result
     * @param {Rect} rectB
     * @return {Rect} Returns the out parameter
     * @example
     * var a = new cc.Rect(0, 10, 20, 20);
     * var b = new cc.Rect(0, 10, 10, 10);
     * var intersection = new cc.Rect();
     * a.intersection(intersection, b); // intersection {x: 0, y: 10, width: 10, height: 10};
     */
    intersection(out: Rect, rectB: Rect): Rect {
        var axMin = this.x, ayMin = this.y, axMax = this.x + this.width, ayMax = this.y + this.height;
        var bxMin = rectB.x, byMin = rectB.y, bxMax = rectB.x + rectB.width, byMax = rectB.y + rectB.height;
        out.x = Math.max(axMin, bxMin);
        out.y = Math.max(ayMin, byMin);
        out.width = Math.min(axMax, bxMax) - out.x;
        out.height = Math.min(ayMax, byMax) - out.y;
        return out;
    }

    /**
     * !#en Check whether the current rect contains the given point
     * !#zh 当前矩形是否包含指定坐标点。
     * Returns true if the point inside this rectangle.
     * @method contains
     * @param {Vec2} point
     * @return {Boolean}
     * @example
     * var a = new cc.Rect(0, 0, 10, 10);
     * var b = new cc.Vec2(0, 5);
     * a.contains(b);// true
     */
    contains(point: Vec2): boolean {
        return (this.x <= point.x &&
            this.x + this.width >= point.x &&
            this.y <= point.y &&
            this.y + this.height >= point.y);
    }

    /**
     * !#en Returns true if the other rect totally inside this rectangle.
     * !#zh 当前矩形是否包含指定矩形。
     * @method containsRect
     * @param {Rect} rect
     * @return {Boolean}
     * @example
     * var a = new cc.Rect(0, 0, 20, 20);
     * var b = new cc.Rect(0, 0, 10, 10);
     * a.containsRect(b);// true
     */
    containsRect(rect: Rect): boolean {
        return (this.x <= rect.x &&
            this.x + this.width >= rect.x + rect.width &&
            this.y <= rect.y &&
            this.y + this.height >= rect.y + rect.height);
    }

    /**
     * !#en The minimum x value, equals to rect.x
     * !#zh 矩形 x 轴上的最小值，等价于 rect.x。
     * @property xMin
     * @type {Number}
     */
    get xMin() {
        return this.x;
    }
    set xMin(v) {
        this.width += this.x - v;
        this.x = v;
    }

    /**
    * !#en The minimum y value, equals to rect.y
    * !#zh 矩形 y 轴上的最小值。
    * @property yMin
    * @type {Number}
    */
    get yMin() {
        return this.y;
    }
    set yMin(v) {
        this.height += this.y - v;
        this.y = v;
    }

    /**
    * !#en The maximum x value.
    * !#zh 矩形 x 轴上的最大值。
    * @property xMax
    * @type {Number}
    */
    get xMax() {
        return this.x + this.width;
    }
    set xMax(value) {
        this.width = value - this.x;
    }

    /**
    * !#en The maximum y value.
    * !#zh 矩形 y 轴上的最大值。
    * @property yMax
    * @type {Number}
    */
    get yMax() {
        return this.y + this.height;
    }
    set yMax(value) {
        this.height = value - this.y;
    }

    /**
    * !#en The position of the center of the rectangle.
    * !#zh 矩形的中心点。
    * @property {Vec2} center
    */
    get center() {
        return new Vec2(this.x + this.width * 0.5,
            this.y + this.height * 0.5);
    }
    set center(value) {
        this.x = value.x - this.width * 0.5;
        this.y = value.y - this.height * 0.5;
    }

    /**
    * !#en The X and Y position of the rectangle.
    * !#zh 矩形的 x 和 y 坐标。
    * @property {Vec2} origin
    */
    get origin() {
        return new Vec2(this.x, this.y);
    }
    set origin(value) {
        this.x = value.x;
        this.y = value.y;
    }
}