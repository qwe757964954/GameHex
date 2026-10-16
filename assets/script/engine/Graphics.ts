
export class Graphics {
    private _graphics: cc.Graphics
    private _com: fgui.GComponent
    public get com(): fgui.GComponent {
        return this._com
    }
    private _lastlinex: number
    private _lastliney: number
    constructor(parent: fgui.GComponent, compoentName?: string) {
        let newCom = new fgui.GComponent()
        newCom.setSize(parent.width, parent.height)
        if (compoentName) {
            newCom.name = compoentName
        }
        newCom.toParent(parent)
        this._com = newCom
        this._graphics = newCom.node.addComponent(cc.Graphics)
        this._lastlinex = null
        this._lastliney = null
    }

    destroy() {
        this._lastlinex = null
        this._lastliney = null
        if (this._com) {
            this._com.destroy()
        }
        this._com = null
    }

    /**设置线粗 */
    public set lineWidth(width: number) {
        this._graphics.lineWidth = width
    }

    /**设置线的颜色 */
    public set strokeColor(tlRgba: Array<number>) {
        if (tlRgba) {
            let graphics = this._graphics
            if (tlRgba.length == 3) {
                graphics.strokeColor = new cc.Color(tlRgba[0], tlRgba[1], tlRgba[2]);
            } else if (tlRgba.length == 4) {
                graphics.strokeColor = new cc.Color(tlRgba[0], tlRgba[1], tlRgba[2], tlRgba[3]);
            }
        }
    }

    public set fillColor(tlRgba: Array<number>) {
        if (tlRgba) {
            let graphics = this._graphics
            if (tlRgba.length == 3) {
                graphics.fillColor = new cc.Color(tlRgba[0], tlRgba[1], tlRgba[2]);
            } else if (tlRgba.length == 4) {
                graphics.fillColor = new cc.Color(tlRgba[0], tlRgba[1], tlRgba[2], tlRgba[3]);
            }
        }
    }

    public drawline(p: { x: number, y: number }) {
        if (this._lastlinex == null) {
            this._graphics.moveTo(p.x, p.y)
        } else {
            this._graphics.lineTo(p.x, p.y)
        }
        this._lastlinex = p.x
        this._lastliney = p.y
    }

    public setMoveTo(p: { x: number, y: number }) {
        this._graphics.moveTo(p.x, p.y)
    }

    public fill() {
        this._graphics.fill()
        this.resetlastlinexy()
    }

    public stroke() {
        this._graphics.stroke()
        this.resetlastlinexy()
    }

    public clear() {
        this._graphics.clear()
        this.resetlastlinexy()
    }

    public resetlastlinexy() {
        this._lastlinex = null
        this._lastliney = null
    }

    public setAlpha(alpha: number) {
        let graphics = this._graphics
        if (graphics) {
            let fillColor = graphics.fillColor
            if (fillColor) {
                fillColor.a = alpha
            }

            let strokeColor = graphics.strokeColor
            if (strokeColor) {
                strokeColor.a = alpha
            }
        }
    }

    public set sortingOrder(order: number) {
        if (this._com) {
            this._com.sortingOrder = order
        }
    }
}