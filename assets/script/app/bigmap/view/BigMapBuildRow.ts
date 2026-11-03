import { _decorator, Component, Label, Sprite } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('BigMapBuildRow')
export class BigMapBuildRow extends Component {
    @property(Sprite) background: Sprite = null!;
    @property(Label) nameLabel: Label = null;
    @property(Label) detail: Label = null;
}
