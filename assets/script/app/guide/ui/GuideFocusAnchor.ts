import { _decorator, Component } from 'cc';

const { ccclass, property } = _decorator;

/** 焦点标识绑定实际控件，不依赖页面节点路径。动态条目在 render 时更新 key。 */
@ccclass('GuideFocusAnchor')
export class GuideFocusAnchor extends Component {
    @property({ tooltip: 'guideStep.focusNode 中的焦点标识' })
    key = '';
    /** 同时展示多张抽卡结果时，优先跟随最近一次。 */
    shownAt = 0;
}
