import { _decorator, Component, Node } from 'cc';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';

const { ccclass, property } = _decorator;

/** 主界面组件：交互入口。 */
@ccclass('MainPage')
export class MainPage extends Component {
    @property({ type: Node, tooltip: 'BeginGame：开始游戏按钮' })
    startButton: Node = null!;

    onLoad(): void {
        this.startButton.on(Node.EventType.TOUCH_END, this.onStartGame, this);
    }

    private onStartGame(): void {
        ProcedureManager.navigate(GameRoute.Matching);
    }
}
