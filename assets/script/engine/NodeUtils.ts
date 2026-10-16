import { Vec2 } from "./Vec2";

export class NodeUtils {
    static convertToNodeSpace(com: fgui.GComponent, worldPoint: Vec2): Vec2 {
        let wp = new cc.Vec2(worldPoint.x, worldPoint.y);
        let lp: cc.Vec2 = com._container.convertToNodeSpace(wp);
        return new Vec2(lp.x, lp.y);
    }
}