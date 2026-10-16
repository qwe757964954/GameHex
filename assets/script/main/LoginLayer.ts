import { _decorator, Component, Label, Color, UITransform, Vec3 } from 'cc';
import { EventCallback } from '../framework/event/EventCallback';
import { EventProxy } from '../framework/event/EventProxy';
import { Func } from '../framework/Func';
import { StringUtil } from '../framework/utils/StringUtil';
import { Timer } from '../framework/utils/Timer';

const { ccclass, property } = _decorator;

/**
 * LoginLayer
 * ------------------------------------------------------------------
 * 占位登录界面。挂在场景里的 LoginLayer 节点上。
 * 用于验证:
 *   - framework event/EventCallback
 *   - framework StringUtil / Func
 *   - framework Timer
 *
 * 不接业务，仅做最小 UI 演示。
 * ------------------------------------------------------------------
 */
@ccclass('LoginLayer')
export class LoginLayer extends Component {

    @property({ type: Label, tooltip: '标题' })
    titleLabel: Label | null = null;

    @property({ type: Label, tooltip: '实时显示信息' })
    infoLabel: Label | null = null;

    private _events: EventCallback<string> = new EventCallback<string>();
    private _timer: Timer | null = null;
    private _tickCount: number = 0;

    onLoad() {
        console.log('[LoginLayer] onLoad');

        // EventCallback 演示
        this._events.addCallback((event: string) => {
            console.log('[LoginLayer] event fired:', event);
            if (this.infoLabel) {
                this.infoLabel.string = `Last event: ${event} @ tick ${this._tickCount}`;
            }
        });
        this._events.execute('onLoginOpen');

        // StringUtil.format 演示
        if (this.titleLabel) {
            this.titleLabel.string = StringUtil.format('欢迎来到 Demo3.8  ({0})', 'P0 验证');
        }

        // Func.uuid 演示
        const id = Func.uuid(8, null);
        console.log('[LoginLayer] generated uuid:', id);

        // Timer 演示：每 1 秒 tick 一次
        this._timer = Timer.getTimer(
            () => {
                this._tickCount++;
                this._events.execute(`tick_${this._tickCount}`);
            },
            this,
            1000,
            -1,
        );
        this._timer.start();
    }

    onDestroy() {
        if (this._timer) {
            this._timer.stop();
            this._timer = null;
        }
        this._events.destroy();
    }
}