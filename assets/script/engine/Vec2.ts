export class Vec2 {
    public static __cname: string = "Vec2";

    static temp1 = new Vec2()
    static temp2 = new Vec2()

    /**
     * @property {Number} x
     */
    x: number;

    /**
     * @property {Number} y
     */
    y: number;

    // compatible with vec3
    z: number = 0;
    magSqr = Vec2.prototype.lengthSqr;
    /**
     * !#zh 逐元素向量加法
     * @method add
     * @typescript
     * add <Out extends IVec2Like> (out: Out, a: Out, b: Out): Out
     * @static
     */
    static add(a: Vec2, b: Vec2, out?: Vec2,) {
        out = out || new Vec2()
        out.x = a.x + b.x;
        out.y = a.y + b.y;
        return out;
    }

    mulSelf = Vec2.prototype.multiplyScalar;
    /**
     * !#zh 向量标量乘法
     * @method multiplyScalar
     * @typescript
     * multiplyScalar <Out extends IVec2Like> (out: Out, a: Out, b: number): Out
     * @static
     */
    static multiplyScalar(out: Vec2, a: Vec2, b: number) {
        out.x = a.x * b;
        out.y = a.y * b;
        return out;
    }
    /**
     * !#en Multiplies by a number, and returns the new result.
     * !#zh 缩放向量，并返回新结果。
     * @method mul
     * @param {number} num
     * @param {Vec2} [out] - optional, the receiving vector, you can pass the same vec2 to save result to itself, if not provided, a new vec2 will be created
     * @return {Vec2} the result
     * @example
     * var v = cc.v2(10, 10);
     * v.mul(5);      // return Vec2 {x: 50, y: 50};
     * var v1 = new Vec2;
     * v.mul(5, v1);  // return Vec2 {x: 50, y: 50};
     */
    mul(num: number, out?: Vec2): Vec2 {
        return Vec2.multiplyScalar(out || new Vec2(), this, num);
    }
    /**
     * !#en
     * Constructor
     * see {{#crossLink "cc/vec2:method"}}cc.v2{{/crossLink}} or {{#crossLink "cc/p:method"}}cc.p{{/crossLink}}
     * !#zh
     * 构造函数，可查看 {{#crossLink "cc/vec2:method"}}cc.v2{{/crossLink}} 或者 {{#crossLink "cc/p:method"}}cc.p{{/crossLink}}
     * @method constructor
     * @param {Number} [x=0]
     * @param {Number} [y=0]
     */
    constructor(x: number | Vec2 = 0, y: number = 0) {
        if (x && typeof x === 'object') {
            this.x = x.x || 0;
            this.y = x.y || 0;
        } else {
            this.x = x as number || 0;
            this.y = y || 0;
        }
    }

    /**
     * !#en Sets vector with another's value
     * !#zh 设置向量值。
     * @method set
     * @return {Vec2} returns this
     * @chainable
     */
    set(x: number, y: number): Vec2 {
        this.x = x;
        this.y = y;
        return this;
    }

    /**
     * !#en Check whether two vector equal
     * !#zh 当前的向量是否与指定的向量相等。
     * @method equals
     * @param {Vec2} other
     * @return {Boolean}
     */
    equals(other: Vec2): boolean {
        return other && this.x === other.x && this.y === other.y;
    }

    /**
     * !#en Check whether two vector equal with some degree of variance.
     * !#zh
     * 近似判断两个点是否相等。<br/>
     * 判断 2 个向量是否在指定数值的范围之内，如果在则返回 true，反之则返回 false。
     * @method fuzzyEquals
     * @param {Vec2} other
     * @param {Number} variance
     * @return {Boolean}
     */
    fuzzyEquals(other: Vec2, variance): boolean {
        if (this.x - variance <= other.x && other.x <= this.x + variance) {
            if (this.y - variance <= other.y && other.y <= this.y + variance)
                return true;
        }
        return false;
    }

    /**
     * !#en Calculate linear interpolation result between this vector and another one with given ratio
     * !#zh 线性插值。
     * @method lerp
     * @param {Vec2} to
     * @param {Number} ratio - the interpolation coefficient
     * @param {Vec2} [out] - optional, the receiving vector, you can pass the same vec2 to save result to itself, if not provided, a new vec2 will be created
     * @return {Vec2}
     */
    lerp(to: Vec2, ratio: number, out?: Vec2): Vec2 {
        out = out || new Vec2();
        var x = this.x;
        var y = this.y;
        out.x = x + (to.x - x) * ratio;
        out.y = y + (to.y - y) * ratio;
        return out;
    }

    /**
     * !#en Clamp the vector between from float and to float.
     * !#zh
     * 返回指定限制区域后的向量。<br/>
     * 向量大于 max_inclusive 则返回 max_inclusive。<br/>
     * 向量小于 min_inclusive 则返回 min_inclusive。<br/>
     * 否则返回自身。
     * @method clampf
     * @param {Vec2} min_inclusive
     * @param {Vec2} max_inclusive
     * @return {Vec2}
     * @example
     * var min_inclusive = cc.v2(0, 0);
     * var max_inclusive = cc.v2(20, 20);
     * var v1 = cc.v2(20, 20).clampf(min_inclusive, max_inclusive); // Vec2 {x: 20, y: 20};
     * var v2 = cc.v2(0, 0).clampf(min_inclusive, max_inclusive);   // Vec2 {x: 0, y: 0};
     * var v3 = cc.v2(10, 10).clampf(min_inclusive, max_inclusive); // Vec2 {x: 10, y: 10};
     */
    clampf(min_inclusive: Vec2, max_inclusive: Vec2): Vec2 {
        this.x = cc.misc.clampf(this.x, min_inclusive.x, max_inclusive.x);
        this.y = cc.misc.clampf(this.y, min_inclusive.y, max_inclusive.y);
        return this;
    }




    /**
     * !#en Adds this vector.
     * !#zh 向量加法。
     * @method add
     * @param {Vec2} vector
     * @return {Vec2} returns this
     * @chainable
     * @example
     * var v = cc.v2(10, 10);
     * v.add(cc.v2(5, 5));// return Vec2 {x: 15, y: 15};
     */
    add(vector: Vec2, out?: Vec2): Vec2 {
        out = out || new Vec2();
        out.x = this.x + vector.x;
        out.y = this.y + vector.y;
        return out;
    }

    /**
     * !#en Subtracts one vector from this.
     * !#zh 向量减法。
     * @method subtract
     * @param {Vec2} vector
     * @return {Vec2} returns this
     * @chainable
     * @example
     * var v = cc.v2(10, 10);
     * v.subSelf(cc.v2(5, 5));// return Vec2 {x: 5, y: 5};
     */
    subtract(vector: Vec2): Vec2 {
        this.x -= vector.x;
        this.y -= vector.y;
        return this;
    }

    /**
     * !#en Multiplies this by a number.
     * !#zh 缩放当前向量。
     * @method multiplyScalar
     * @param {number} num
     * @return {Vec2} returns this
     * @chainable
     * @example
     * var v = cc.v2(10, 10);
     * v.multiply(5);// return Vec2 {x: 50, y: 50};
     */
    multiplyScalar(num: number): Vec2 {
        this.x *= num;
        this.y *= num;
        return this;
    }

    /**
     * !#en Multiplies two vectors.
     * !#zh 分量相乘。
     * @method multiply
     * @param {Vec2} vector
     * @return {Vec2} returns this
     * @chainable
     * @example
     * var v = cc.v2(10, 10);
     * v.multiply(cc.v2(5, 5));// return Vec2 {x: 50, y: 50};
     */
    multiply(vector: Vec2): Vec2 {
        this.x *= vector.x;
        this.y *= vector.y;
        return this;
    }

    /**
     * !#en Divides by a number.
     * !#zh 向量除法。
     * @method divide
     * @param {number} num
     * @return {Vec2} returns this
     * @chainable
     * @example
     * var v = cc.v2(10, 10);
     * v.divide(5); // return Vec2 {x: 2, y: 2};
     */
    divide(num: number): Vec2 {
        this.x /= num;
        this.y /= num;
        return this;
    }

    /**
     * !#en Negates the components.
     * !#zh 向量取反。
     * @method negate
     * @return {Vec2} returns this
     * @chainable
     * @example
     * var v = cc.v2(10, 10);
     * v.negate(); // return Vec2 {x: -10, y: -10};
     */
    negate(): Vec2 {
        this.x = -this.x;
        this.y = -this.y;
        return this;
    }

    /**
     * !#en Dot product
     * !#zh 当前向量与指定向量进行点乘。
     * @method dot
     * @param {Vec2} [vector]
     * @return {number} the result
     * @example
     * var v = cc.v2(10, 10);
     * v.dot(cc.v2(5, 5)); // return 100;
     */
    dot(vector: Vec2): number {
        return this.x * vector.x + this.y * vector.y;
    }

    /**
     * !#en Cross product
     * !#zh 当前向量与指定向量进行叉乘。
     * @method cross
     * @param {Vec2} [vector]
     * @return {number} the result
     * @example
     * var v = cc.v2(10, 10);
     * v.cross(cc.v2(5, 5)); // return 0;
     */
    cross(vector: Vec2): number {
        return this.x * vector.y - this.y * vector.x;
    }

    /**
     * !#en Returns the length of this vector.
     * !#zh 返回该向量的长度。
     * @method len
     * @return {number} the result
     * @example
     * var v = cc.v2(10, 10);
     * v.len(); // return 14.142135623730951;
     */
    len(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    distance(x, y) {
        return Math.sqrt((this.x - x) * (this.x - x) + (this.y - y) * (this.y - y));
    }

    /**
     * !#en Returns the squared length of this vector.
     * !#zh 返回该向量的长度平方。
     * @method lengthSqr
     * @return {number} the result
     * @example
     * var v = cc.v2(10, 10);
     * v.lengthSqr(); // return 200;
     */
    lengthSqr(): number {
        return this.x * this.x + this.y * this.y;
    }

    /**
     * !#en Make the length of this vector to 1.
     * !#zh 向量归一化，让这个向量的长度为 1。
     * @method normalizeSelf
     * @return {Vec2} returns this
     * @chainable
     * @example
     * var v = cc.v2(10, 10);
     * v.normalizeSelf(); // return Vec2 {x: 0.7071067811865475, y: 0.7071067811865475};
     */
    normalizeSelf(): Vec2 {
        var magSqr = this.x * this.x + this.y * this.y;
        if (magSqr === 1.0)
            return this;

        if (magSqr === 0.0) {
            return this;
        }
        let length = Math.sqrt(magSqr);
        if (0.0 === length) {
            this.x = 1
            this.y = 0
        } else {
            var invsqrt = 1.0 / length
            this.x *= invsqrt;
            this.y *= invsqrt;
        }
        return this;
    }

    /**
     * !#en
     * Returns this vector with a magnitude of 1.<br/>
     * <br/>
     * Note that the current vector is unchanged and a new normalized vector is returned. If you want to normalize the current vector, use normalizeSelf function.
     * !#zh
     * 返回归一化后的向量。<br/>
     * <br/>
     * 注意，当前向量不变，并返回一个新的归一化向量。如果你想来归一化当前向量，可使用 normalizeSelf 函数。
     * @method normalize
     * @param {Vec2} [out] - optional, the receiving vector, you can pass the same vec2 to save result to itself, if not provided, a new vec2 will be created
     * @return {Vec2} result
     * var v = cc.v2(10, 10);
     * v.normalize();   // return Vec2 {x: 0.7071067811865475, y: 0.7071067811865475};
     */
    normalize(out?: Vec2): Vec2 {
        out = out || new Vec2();
        out.x = this.x;
        out.y = this.y;
        out.normalizeSelf();
        return out;
    }

    /**
     * !#en Get angle in radian between this and vector.
     * !#zh 夹角的弧度。
     * @method angle
     * @param {Vec2} vector
     * @return {number} from 0 to Math.PI
     */
    angle(vector: Vec2): number {
        var magSqr1 = this.magSqr();
        var magSqr2 = vector.magSqr();

        if (magSqr1 === 0 || magSqr2 === 0) {
            console.warn("Can't get angle between zero vector");
            return 0.0;
        }

        var dot = this.dot(vector);
        var theta = dot / (Math.sqrt(magSqr1 * magSqr2));
        theta = cc.misc.clampf(theta, -1.0, 1.0);
        return Math.acos(theta);
    }

    /**
     * !#en Get angle in radian between this and vector with direction.
     * !#zh 带方向的夹角的弧度。
     * @method signAngle
     * @param {Vec2} vector
     * @return {number} from -MathPI to Math.PI
     */
    signAngle(vector: Vec2): number {
        let angle = this.angle(vector);
        return this.cross(vector) < 0 ? -angle : angle;
    }

    /**
     * !#en rotate
     * !#zh 返回旋转给定弧度后的新向量。
     * @method rotate
     * @param {number} radians
     * @param {Vec2} [out] - optional, the receiving vector, you can pass the same vec2 to save result to itself, if not provided, a new vec2 will be created
     * @return {Vec2} the result
     */
    rotate(radians: number, out?: Vec2): Vec2 {
        out = out || new Vec2();
        out.x = this.x;
        out.y = this.y;
        return out.rotateSelf(radians);
    }

    /**
     * !#en rotate self
     * !#zh 按指定弧度旋转向量。
     * @method rotateSelf
     * @param {number} radians
     * @return {Vec2} returns this
     * @chainable
     */
    rotateSelf(radians: number): Vec2 {
        var sin = Math.sin(radians);
        var cos = Math.cos(radians);
        var x = this.x;
        this.x = cos * x - sin * this.y;
        this.y = sin * x + cos * this.y;
        return this;
    }

    /**
     * !#en Calculates the projection of the current vector over the given vector.
     * !#zh 返回当前向量在指定 vector 向量上的投影向量。
     * @method project
     * @param {Vec2} vector
     * @return {Vec2}
     * @example
     * var v1 = cc.v2(20, 20);
     * var v2 = cc.v2(5, 5);
     * v1.project(v2); // Vec2 {x: 20, y: 20};
     */
    project(vector: Vec2): Vec2 {
        return vector.multiplyScalar(this.dot(vector) / vector.dot(vector));
    }

    /**
     * Returns the maximum value in x, y.
     * @method maxAxis
     * @returns {number}
     */
    maxAxis(): number {
        return Math.max(this.x, this.y);
    }

    /**
     * !#en Subtracts one vector from this, and returns the new result.
     * !#zh 向量减法，并返回新结果。
     * @method sub
     * @param {Vec2} vector
     * @param {Vec2} [out] - optional, the receiving vector, you can pass the same vec2 to save result to itself, if not provided, a new vec2 will be created
     * @return {Vec2} the result
     * @example
     * var v = cc.v2(10, 10);
     * v.sub(cc.v2(5, 5));      // return Vec2 {x: 5, y: 5};
     * var v1 = new Vec2;
     * v.sub(cc.v2(5, 5), v1);  // return Vec2 {x: 5, y: 5};
     */
    sub(vector: Vec2, out?: Vec2): Vec2 {
        out = out || new Vec2()
        out.x = this.x - vector.x;
        out.y = this.y - vector.y;
        return out;
    }
}