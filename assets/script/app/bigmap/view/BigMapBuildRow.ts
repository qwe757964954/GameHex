import { _decorator, Component, Graphics, Label } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('BigMapBuildRow')
export class BigMapBuildRow extends Component {
    @property(Graphics) background: Graphics = null;
    @property(Label) nameLabel: Label = null;
    @property(Label) detail: Label = null;
}
