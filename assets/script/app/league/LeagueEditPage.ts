import { _decorator, Button, EditBox, Node } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { PopupBase } from '../../framework/ui/PopupBase';
import { LeagueEditEvent, type ILeagueEditViewState } from './LeagueEditEvents';
import { LEAGUE_EDIT_TITLE } from './LeagueTexts';

export type { ILeagueEditParams } from './LeagueEditModel';
export type { LeagueRequestResult } from './LeagueRepository';

const { ccclass, property } = _decorator;

/** 四种联盟信息编辑共用一份视图；无 SDK 层，沿用原有的违禁词占位串规则。 */
@ccclass('LeagueEditPage')
export class LeagueEditPage extends PopupBase {
    static prefabPath = 'ui/League/LeagueEdit';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: EditBox, tooltip: 'Input：lab_input 的 cc.EditBox（maxLength=128）' })
    inputField: EditBox = null!;

    @property({ type: Node, tooltip: 'BtnSure：确定' })
    sureButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnCancel：取消' })
    cancelButton: Node = null!;

    protected onInit(): void {
        this.closeButton.on(Button.EventType.CLICK, this.onCancelClick, this);
        this.cancelButton.on(Button.EventType.CLICK, this.onCancelClick, this);
        this.sureButton.on(Button.EventType.CLICK, this.onSureClick, this);
        this.inputField.node.on('text-changed', this.onContentChanged, this);
    }

    static get titleText(): string { return LEAGUE_EDIT_TITLE; }

    render(state: ILeagueEditViewState): void {
        if (this.inputField.string !== state.content) this.inputField.string = state.content;
        this.sureButton.getComponent(Button).interactable = !state.submitting;
    }

    onSureClick(): void {
        EventMgr.instance.emit(LeagueEditEvent.Intent, { owner: this, kind: 'submit', content: this.inputField.string });
    }

    private onContentChanged(): void {
        EventMgr.instance.emit(LeagueEditEvent.Intent, { owner: this, kind: 'change', content: this.inputField.string });
    }

    onCancelClick(): void { this.closeByButton(); }
}
