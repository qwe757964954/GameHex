import { _decorator, Component, Node } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('BigMapWorldTemplates')
export class BigMapWorldTemplates extends Component {
    @property({ type: Node, group: '地块' }) groundTemplate: Node = null;
    @property({ type: Node, group: '地块' }) decorTemplate: Node = null;
    @property({ type: Node, group: '据点' }) markerTemplate: Node = null;
}
