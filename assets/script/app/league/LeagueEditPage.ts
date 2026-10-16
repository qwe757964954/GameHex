/**
 * 「编辑信息」弹窗（老端 `play/LayerLeagueEdit`，`ui/League/LeagueEdit`）。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/大厅/组件_联盟_大厅_编辑信息.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `popBg`（公用 `组件_公共弹窗_新`，标题「编辑信息」） | (40,421) **640×437** | `PopupBg` + `TitleBg` + `TitleDeco` + `Title` + `CloseBtn` |
 * | `n28` 输入框底板 `frame_Zhikuang01`（九宫格） | (80,487) 560×158 | `InputBg` |
 * | `lab_input`（`input="true" maxLength="128"`，20px） | (101,500) 517×119 | `Input`（`cc.EditBox`） |
 * | `btn_ok`（`按钮_公共_通用`，`TY_btn10`） | (386,675) 218×106 | `BtnSure` |
 * | `btn_no`（`按钮_公共_通用`，`TY_btn09`） | (113,675) 218×106 | `BtnCancel` |
 *
 * `popBg` 那组的 relation 是 `center-center,middle-middle`，老端又调了 `toFullCenterParent`
 * ⇒ 弹窗**恒居中**（FGUI 里那对 xy 只是设计态坐标，不用照抄）；底板图见
 * `LeagueArt.LEAGUE_ART_POPUP_BOARD` 的说明。
 *
 * ## 一份面板改四处 —— 由 `type` 区分（老端 `OpenLayerLeagueEdit(content, type)`）
 *
 * | `type`（`LeagueEditType`） | 改什么 | 调用方（老端的入口） |
 * |---|---|---|
 * | `NAME = 1` | 联盟名字 | 管理面板点 `btnName` 热区 |
 * | `WX = 2` | 联系微信号 | 点 `btnWx` 热区 |
 * | `NOTICE = 3` | 联盟公告 | 点 `comp_notice` |
 * | `DECLARATION = 4` | 联盟宣言 | 点 `comp_dec` |
 *
 * 面板**自身不区分 type**（标题恒「编辑信息」），只做「把初值填进输入框 + 把新值发出去」，
 * 所以本端用 `LeagueEditPage.open({ userData: { type, content } })` 传参，
 * **不**为四种用途各建一个 prefab。
 *
 * ## 老端 `onBtnOk()` 逐句对照
 *
 * ```ts
 * if (this._editing) return;                       // ① 防连点
 * let content = input.text;
 * if (!content || content == "***") return;        // ② 空 / 被判违禁 ⇒ 不发包
 * this._editing = true;
 * try {
 *     let passed = await this.SDKMgr.checkMessage(content, false);
 *     if (!this.isValid || !this.com || input.text != content) return;   // ③ 结果回来时输入框被改了 ⇒ 放弃
 *     if (!passed) { this.showSensitiveTip(input, content); return; }    // ④ 违禁 ⇒ 置 "***" + 提示
 *     await this.ModelMgr.ModelLeague.RequestLeagueEdit(this.proxy.type, content);
 *     this.unload();
 * } finally { this._editing = false; }
 * ```
 *
 * ①②③ 全部照搬；**④ 有意跳过**：老端的违禁词校验走 `SDKMgr.checkMessage`，
 * 而 Demo3.8 **没有 SDK 层**（同 `app/chat/ChatTexts.sensitiveWord` 处的说明）。
 * 占位串 `'***'` 的语义仍然保留（它在 ② 里当「没填」处理），
 * 提示文案也留在 `LeagueTexts.LEAGUE_EDIT_SENSITIVE_TIP`，将来接上校验时直接用。
 */

import { _decorator, Button, EditBox, Node } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { leagueRepository, type ILeagueRepository, type LeagueRequestResult } from './LeagueRepository';
import {
    LEAGUE_EDIT_REJECTED_PLACEHOLDER,
    LEAGUE_EDIT_TITLE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_OFFLINE,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

/** 打开本弹窗的参数（`PopupBase.open({ userData: ... })`）。 */
export interface ILeagueEditParams {
    /** 改哪一项 —— 取 `LeagueEditType`（1 名字 / 2 微信号 / 3 公告 / 4 宣言）。 */
    readonly type: number;
    /** 输入框的初值（老端 `updateView()` 里 `lab_input.setText(this.proxy.ctx)`）。 */
    readonly content: string;
}

@ccclass('LeagueEditPage')
export class LeagueEditPage extends PopupBase {
    /**
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上才会 `resources.load` 失败、开出一个空弹窗。
     */
    static prefabPath = 'ui/League/LeagueEdit';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: EditBox, tooltip: 'Input：lab_input 的 cc.EditBox（maxLength=128）' })
    inputField: EditBox = null!;

    @property({ type: Node, tooltip: 'BtnSure：确定' })
    sureButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnCancel：取消' })
    cancelButton: Node = null!;

    /** 老端 `LayerLagueEdit.type`。 */
    private editType = 0;

    /** 老端 `_editing`（防连点）。 */
    private editing = false;

    private buttonsBound = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        if (this.buttonsBound) return;
        this.buttonsBound = true;

        const close = this.closeButton?.getComponent(Button);
        if (close) close.node.on(Button.EventType.CLICK, this.onCancelClick, this);
        else console.warn('[LeagueEdit] CloseBtn 上没有 cc.Button，点击不会生效');

        this.bindClick(this.cancelButton, this.onCancelClick);
        this.bindClick(this.sureButton, this.onSureClick);
    }

    protected onOpen(userData?: ILeagueEditParams): void {
        this.editType = Number(userData?.type ?? 0);
        this.editing = false;
        if (!Number.isFinite(this.editType) || this.editType <= 0) {
            console.warn('[LeagueEdit] 打开参数缺 `type`（取 LeagueEditType），确定按钮不会发包');
        }
        // 老端 `updateView()`：把初值直接塞进输入框
        if (this.inputField) this.inputField.string = userData?.content ?? '';
    }

    /** 弹窗标题（供单测 / 复用方取，避免到处写中文字面量）。 */
    static get titleText(): string {
        return LEAGUE_EDIT_TITLE;
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    // ============================================================
    // 交互
    // ============================================================

    /** 「确定」：老端 `onBtnOk()`。 */
    async onSureClick(): Promise<void> {
        // ① 防连点
        if (this.editing) return;

        const input = this.inputField;
        const content = input ? input.string : '';
        // ② 空 / 「被判违禁」的占位串 ⇒ 当作没填，不发包（老端 `content == "***"`）
        if (!content || content === LEAGUE_EDIT_REJECTED_PLACEHOLDER) return;
        if (this.editType <= 0) return;

        this.editing = true;
        try {
            const result = await this.repository.edit(this.editType, content, this);
            // ③ 结果回来时弹窗已经被关掉 / 输入框已被改动 ⇒ 放弃（同老端的 input.text != content）
            if (!this.alive || !input || input.string !== content) return;

            if (result === 'ok') {
                this.closeByButton();
                return;
            }
            FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
        } finally {
            this.editing = false;
        }
    }

    /** 「取消」/ 右上闭钮：什么都不发，直接关。 */
    onCancelClick(): void {
        this.closeByButton();
    }

    /** 供单测断言「写操作在飞时不会重复发包」。 */
    get isEditing(): boolean {
        return this.editing;
    }

    /** 当前绑定到发包里的 `type`（供单测断言传参没被吞）。 */
    get currentEditType(): number {
        return this.editType;
    }

    // ============================================================
    // 杂项
    // ============================================================

    private bindClick(node: Node | null, handler: () => void): void {
        if (!node) {
            console.warn('[LeagueEdit] 按钮节点缺失，点击不会生效');
            return;
        }
        const button = node.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, handler, this);
        else node.on(Node.EventType.TOUCH_END, handler, this);
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}

/** 让调用方只 import 本文件就能拿到 `type` 取值（口径同 `LeagueRepository` 的转出）。 */
export type { LeagueRequestResult };
