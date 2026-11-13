import { _decorator, Button, Color, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { EventMgr } from '../../../framework/event/EventMgr';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import { BigMapUiEvent, type BigMapIntent } from '../application/BigMapEvents';
import { HeadArt } from '../../HeadArt';

const { ccclass, property } = _decorator;

/ 一条「增益效果」：标题 + 描述（描述允许换行，最多两行）。 */
export interface IBigMapCityPopupBuff {
    readonly title: string;
    readonly desc: string;
}

/ 排行榜一行；头像按服务端 roleImg 经既有头像资源入口加载。 */
export interface IBigMapCityPopupRank {
    readonly rank: number;
    readonly name: string;
    readonly score: string;
    readonly avatar: SpriteFrame | null;
    readonly avatarId?: string;
}

/ 城池弹窗的全部展示数据（由 Presenter 算好，视图只写节点）。 */
export interface IBigMapCityPopupContent {
    readonly title: string;
    readonly openingText?: string;
    readonly buffs: readonly IBigMapCityPopupBuff[];
    readonly ranks: readonly IBigMapCityPopupRank[];
    readonly warScore: number;
    readonly minOccupyScore: number;
    readonly lordName: string;
    readonly lordScore: string;
    readonly lordAvatarId?: string;
    readonly staminaCost: number;
    readonly fightCaption: string;
    readonly fightEnabled: boolean;
    readonly hasPlayerActions?: boolean;
}

/ 弹窗内固定槽位数量 —— 与 prefab 里预先摆好的节点数一致，多出来的数据直接丢弃。 */
export const BIGMAP_CITY_POPUP_BUFF_SLOTS = 2;
export const BIGMAP_CITY_POPUP_RANK_SLOTS = 3;
/ 排行榜每行「积分」前缀 —— 设计稿里是独立文本节点（与数值分两段）。 */
export const BIGMAP_CITY_POPUP_SCORE_LABEL = '积分';

/ 设计稿积分统一用 K，避免切到 M 后丢掉千位信息。 */
function formatCityScore(score: string): string {
    const value = Number(score);
    return value >= 1000 ? `${Math.floor(value / 1000)}K` : score;
}

/
 *城池弹窗 —— 蓝湖「城池弹窗3」（山猫 2026-11-02 口径：*「弹窗按照设计稿，尺寸按照设计稿 1:1」*）。
 *
 *## 尺寸与适配
 *
 *面板 692×397、进攻按钮 277×108，全部按设计稿原尺寸摆放，一个像素都不缩放。
 *自适应交给 prefab 上的 `cc.Widget`（山猫 2026-11-02 明确要求的做法，不要写回代码）：
 *
 *| 节点 | Widget |
 *|---|---|
 *| 根 | 四边对齐（`_alignFlags=45`，inset 全 0）→ 跟弹窗层同尺寸 |
 *| `Panel` | 贴底 `bottom=160` + 水平居中 |
 *| `BtnFight` | 贴底 `bottom=20` + 水平居中 |
 *| 城主区 5 个节点 | 各自 `bottom` + `horizontalCenter`（面板顶上方，跟着面板一起贴底） |
 *
 *屏幕更高时整块自动贴到底部、间距不变 —— 代码里没有任何 `setContentSize` / `setScale`。
 *
 *## 为什么继承 `PopupBase`
 *
 *走项目统一的栈式弹窗（`PopupManager`）：`open()` / `close()` / 生命周期钩子都归基类管。
 *顺带白拿三件事：
 *- 点空白关闭由基类的 `__BlankClose` 空白接收层实现 —— 所以本 prefab 里不需要 `Dim` 节点；
 *- `onCover` / `onReveal`（被上层弹窗盖住 / 重新露出）；
 *- 层级由 `popupLayer` 决定，不用自己 `setSiblingIndex`。
 *
 *关闭时补发一个 `clear` 意图，让世界页把选中态一起清掉（点空白关闭 = 取消选中）。
 *
 *## 数据缺口（本版明确留空，不编）
 *
 *- 「增益效果」两条：`bigMapCamp` 表只有 `buffConNum` / `buffRate` 两个数值 + 一句 `campDesc`，
 *  没有逐条 buff 文案。有 `campDesc` 就填第一条，第二条隐藏。
 */
@ccclass('BigMapCityPopup')
export class BigMapCityPopup extends PopupBase {
    static prefabPath = 'ui/bigmap/BigMapCityPopup';

    @property({ type: [Node], group: '排行榜', tooltip: 'Right/Rank0..2' }) private rankRoots: Node[] = [];
    @property({ type: [Label], group: '排行榜' }) private rankNumbers: Label[] = [];
    @property({ type: [Label], group: '排行榜' }) private rankNames: Label[] = [];
    /
     *「积分」两个字（设计稿 x=553 起，左对齐）。
     *
     * 与数值分两个节点：设计稿是两段独立文本（553 / 607），合成一个 Label 左对齐的话
     *数值会紧贴「积分」，永远对不上蓝湖。
     *
     *槽位在 prefab 里绑死（山猫 2026-11-02：*「绑定组件就好」*）—— 不做按名字兜底查找，
     *绑错就在编辑器里露馅，比运行时静默凑合好。
     */
    @property({ type: [Label], group: '排行榜', tooltip: '「积分」标签，与数值分两段摆' })
    private rankScoreTags: Label[] = [];
    / 积分数值（设计稿 x=607 起，左对齐）。 */
    @property({ type: [Label], group: '排行榜' }) private rankScoreValues: Label[] = [];
    @property({ type: [Sprite], group: '排行榜' }) private rankAvatars: Sprite[] = [];
    @property({ type: Node, group: '排行榜' }) private fullRankRoot: Node = null!;

    @property({ type: [Node], group: '增益效果' }) private buffRoots: Node[] = [];
    @property({ type: [Label], group: '增益效果' }) private buffTitles: Label[] = [];
    @property({ type: [Label], group: '增益效果' }) private buffDescs: Label[] = [];
    @property({ type: Label, group: '开放时间' }) private openingLabel: Label = null!;

    @property({ type: Label, group: '战功', tooltip: 'Panel/Progress/Label：当前 / 最低占领战功' })
    private warScoreLabel: Label = null;
    / 战功填充条的 UITransform —— 直接拖组件，不走 `getComponent`（拖错在编辑器里就看得见）。 */
    @property({ type: UITransform, group: '战功', tooltip: 'Panel/Progress/Fill 的 UITransform：按比例改宽度' })
    private warScoreFillTransform: UITransform = null;

    @property({ type: Label, group: '城主' }) private lordNameLabel: Label = null;
    @property({ type: Label, group: '城主' }) private lordScoreLabel: Label = null;
    @property({ type: Sprite, group: '城主' }) private lordPerson: Sprite = null;
    @property({ type: Label, group: '城主' }) private emptyLordLabel: Label = null!;
    @property({ type: Node, group: '城主' }) private lordScoreRoot: Node = null!;

    @property({ type: Button, group: '操作' }) private fightButton: Button = null;
    @property({ type: Label, group: '操作' }) private fightLabel: Label = null;
    @property({ type: Label, group: '操作' }) private staminaLabel: Label = null;
    @property({ type: Sprite, group: '操作' }) private staminaIcon: Sprite = null;
    @property({ type: Button, group: '操作' }) private playerActionsButton: Button = null!;

    / 战功进度条槽的原始宽度（设计稿 `progress_02` = 250）—— 按比例改宽度时不能读被改过的值。 */
    private warScoreTrackWidth = 250;
    / 最近一次 render 的数据：`onOpen` 没带 userData 时用它兜底（先 open 后 render 的调用序）。 */
    private pending: IBigMapCityPopupContent | null = null;
    private readonly rankAvatarIds: string[] = [];
    private avatarRevision = 0;
    private lordAvatarId: string | null = null;

    protected onInit(): void {
        //prefab 已绑好 ⇒ 不判空：绑错应当场抛出来，判空只会把它变成静默死界面。
        this.fightButton.node.on(Button.EventType.CLICK, this.handleFight, this);
        this.playerActionsButton.node.on(Button.EventType.CLICK, this.handlePlayerActions, this);
    }

    protected onOpen(userData?: IBigMapCityPopupContent): void {
        this.render(userData ?? this.pending);
    }

    protected onClose(reason: PopupCloseReason): void {
        //点空白 / 手动关闭都要让世界页把选中态一起清掉，否则地图上会留着一座「选中但没弹窗」的城。
        this.pending = null;
        this.avatarRevision += 1;
        this.rankAvatarIds.length = 0;
        this.lordAvatarId = null;
        if (reason !== PopupCloseReason.Force) this.sendIntent({ kind: 'clear' });
    }

    / 全量覆盖：每次都把每个槽位的文本写一遍，不留上一座城的残值。 */
    render(content: IBigMapCityPopupContent | null): void {
        if (!content) return;
        this.pending = content;
        this.playerActionsButton.node.active = content.hasPlayerActions ?? false;
        this.renderBuffs(content.buffs);
        this.renderRanks(content.ranks);
        this.openingLabel.string = content.openingText ?? '';
        this.openingLabel.node.active = this.openingLabel.string !== '';
        this.renderWarScore(content.warScore, content.minOccupyScore);
        const hasLord = content.lordName !== '';
        this.lordNameLabel.string = content.lordName;
        this.lordNameLabel.node.active = hasLord;
        this.lordScoreLabel.string = hasLord && content.lordScore !== ''
            ? `${BIGMAP_CITY_POPUP_SCORE_LABEL} ${formatCityScore(content.lordScore)}` : '';
        this.lordScoreRoot.active = hasLord;
        this.renderLordAvatar(hasLord ? content.lordAvatarId ?? '' : '');
        this.emptyLordLabel.node.active = !hasLord;
        this.fightLabel.string = content.fightCaption;
        this.fightButton.node.active = hasLord;
        this.fightButton.interactable = content.fightEnabled;
        const hasCost = content.staminaCost > 0;
        this.staminaLabel.string = hasCost ? String(content.staminaCost) : '';
        this.staminaLabel.node.active = hasCost;
        this.staminaIcon.node.active = hasCost;
    }

    private renderBuffs(buffs: readonly IBigMapCityPopupBuff[]): void {
        for (let index = 0; index < BIGMAP_CITY_POPUP_BUFF_SLOTS; index += 1) {
            const buff = buffs[index];
            this.buffRoots[index].active = !!buff && (buff.title !== '' || buff.desc !== '');
            this.buffTitles[index].string = buff ? buff.title : '';
            this.buffDescs[index].string = buff ? buff.desc : '';
        }
    }

    private renderRanks(ranks: readonly IBigMapCityPopupRank[]): void {
        this.fullRankRoot.active = ranks.length > 0;
        for (let index = 0; index < BIGMAP_CITY_POPUP_RANK_SLOTS; index += 1) {
            const row = ranks[index];
            const root = this.rankRoots[index];
            if (root) root.active = !!row;
            //槽位空掉时必须把文本清掉：节点虽然隐藏，但复用同一实例时残值会留着，
            //一旦节点重新显示就会闪出上一座城的名字/积分（复用型弹窗的老坑）。
            if (!row) {
                this.rankAvatarIds[index] = '';
                this.rankAvatars[index].spriteFrame = null;
                this.rankNumbers[index].string = '';
                this.rankNames[index].string = '';
                this.rankScoreTags[index].string = '';
                this.rankScoreValues[index].string = '';
                continue;
            }
            this.rankNumbers[index].string = String(row.rank);
            this.rankNames[index].string = row.name;
            //「积分」和数值是两个节点（设计稿 x=553 / x=607 两段），拆开才能对上蓝湖的对齐。
            this.rankScoreTags[index].string = BIGMAP_CITY_POPUP_SCORE_LABEL;
            this.rankScoreValues[index].string = formatCityScore(row.score);
            const avatar = this.rankAvatars[index];
            if (avatar) {
                const avatarId = row.avatarId ?? '';
                if (!avatarId || this.rankAvatarIds[index] !== avatarId) {
                    this.rankAvatarIds[index] = avatarId;
                    avatar.spriteFrame = row.avatar;
                    if (avatarId) void this.loadRankAvatar(index, avatarId, this.avatarRevision);
                }
                //没有头像时把底图（设计稿 `组 3` 那张灰圆底）压暗当占位，不留空白洞。
                avatar.color = avatar.spriteFrame ? AVATAR_TINT : AVATAR_EMPTY_TINT;
            }
        }
    }

    private async loadRankAvatar(index: number, avatarId: string, revision: number): Promise<void> {
        let frame: SpriteFrame | null = null;
        const assets = this.assets;
        try {
            frame = await HeadArt.loadHeadFrame(avatarId, (name, root) =>
                assets.load(`${root}/${name}/spriteFrame`, SpriteFrame));
        } catch (error) {
            console.warn('[BigMapCityPopup] 排行头像加载失败', error);
        }
        if (!this.isValid || revision !== this.avatarRevision || this.rankAvatarIds[index] !== avatarId) return;
        const avatar = this.rankAvatars[index];
        avatar.spriteFrame = frame;
        avatar.color = frame ? AVATAR_TINT : AVATAR_EMPTY_TINT;
    }

    private renderLordAvatar(avatarId: string): void {
        if (this.lordAvatarId === avatarId) return;
        this.lordAvatarId = avatarId;
        this.lordPerson.spriteFrame = null;
        this.lordPerson.node.active = false;
        if (avatarId) void this.loadLordAvatar(avatarId, this.avatarRevision);
    }

    private async loadLordAvatar(avatarId: string, revision: number): Promise<void> {
        const assets = this.assets;
        let frame: SpriteFrame | null = null;
        try {
            frame = await HeadArt.loadHeadFrame(avatarId, (name, root) =>
                assets.load(`${root}/${name}/spriteFrame`, SpriteFrame));
        } catch (error) {
            console.warn('[BigMapCityPopup] 城主形象加载失败', error);
        }
        if (!this.isValid || revision !== this.avatarRevision || this.lordAvatarId !== avatarId) return;
        this.lordPerson.spriteFrame = frame;
        this.lordPerson.node.active = frame !== null;
    }

    private renderWarScore(warScore: number, minScore: number): void {
        this.warScoreLabel.string = `${warScore}/${minScore}`;
        const ratio = minScore > 0 ? Math.min(1, Math.max(0, warScore / minScore)) : 0;
        //按比例改宽度而不是改 scale：填充图两端是圆角，缩放会把圆角拉扁。
        this.warScoreFillTransform.setContentSize(this.warScoreTrackWidth * ratio, this.warScoreFillTransform.height);
    }

    private sendIntent(intent: BigMapIntent): void {
        EventMgr.instance.emit(BigMapUiEvent.Intent, { intent });
    }

    private handleFight(): void {
        this.sendIntent({ kind: 'primary' });
    }
    private handlePlayerActions(): void { this.sendIntent({ kind: 'campRoles' }); }
}

const AVATAR_TINT = Color.WHITE.clone();
const AVATAR_EMPTY_TINT = new Color(150, 150, 150, 255);
