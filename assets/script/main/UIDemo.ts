/**
 * Test.scene 已经序列化了 UIDemo 组件。
 * 保留这个兼容入口，让旧场景不必重做 UUID 绑定；实际启动新的占城大师模块。
 */
import { Component, _decorator } from 'cc';
import { LoginPage } from '../app/login/LoginPage';

const { ccclass } = _decorator;

@ccclass('UIDemo')
export class UIDemo extends Component {
    onLoad(): void {
        if (!this.getComponent(LoginPage)) {
            this.node.addComponent(LoginPage);
        }
    }
}
