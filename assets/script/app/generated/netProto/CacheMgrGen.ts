
import { GameCacheMgr } from "../../../framework/cache/GameCacheMgr";

/**
 * 缓存读取的统一入口（**自动生成，勿手改**）。
 *
 * 表数与键都取自 `assets/resources/config/protoCache.json` 的 78 张表 —— 那是**运行时真相**：
 * `GameCache.tlKeyField = message.tlKey`，`Func.hashKey(keyOrval, tlKeyField)` 按它算 hash
 * （`framework/Func.ts:471`）。所以这里生成的取值方法只要键一致就必定命中。
 * 注意 `Cmd.d.ts` 的 `CmdXxx_Key` 类与它**在 12 张表上不一致**（两套独立产物），
 * 本文件以 protoCache 为准；重生成脚本 `tmp/gen_cachemgr.py`。**别从老客户端拷**（那份只有 44 张表）。
 *
 * 键语义：无键表 -> `getXxx()`；单键表 -> 传标量（也可传 `{字段:值}`）；多键表 -> 传对象字面量。
 * `Long` 键统一收敛成 `number | string`：hashKey 的单键分支只接受标量。
 *
 *  另有 2 张表的 tlKey 指向**非标量字段**，签名是「只含该字段的对象」：
 *   CmdDayWeekMonthGift -> getCmdDayWeekMonthGift(key: { tlDayGift: EveryDayGift[]|null })
 *   CmdFirstRechargeNew -> getCmdFirstRechargeNew(key: { infos: CmdFirstRechargeNewItem[]|null })
 * 原因见各自方法上的注释（protoCache 的 tlKey 推导规则不保证字段 1 真是键）。
 */
export class CacheMgrGen extends GameCacheMgr {
    static __cname: string = "CacheMgrGen";

    getCmdActivity(openResId: number) { return this.get("CmdActivity", openResId) }
    getTlCmdActivity() { return this.getValues("CmdActivity") }

    getCmdRole(id: number | string) { return this.get("CmdRole", id) }
    getTlCmdRole() { return this.getValues("CmdRole") }

    getCmdActivitySimple(id: string) { return this.get("CmdActivitySimple", id) }
    getTlCmdActivitySimple() { return this.getValues("CmdActivitySimple") }

    getCmdBattleChapter(chapterId: number) { return this.get("CmdBattleChapter", chapterId) }
    getTlCmdBattleChapter() { return this.getValues("CmdBattleChapter") }

    getCmdBattleLevel(level: number) { return this.get("CmdBattleLevel", level) }
    getTlCmdBattleLevel() { return this.getValues("CmdBattleLevel") }

    getCmdBattleToken(type: number) { return this.get("CmdBattleToken", type) }
    getTlCmdBattleToken() { return this.getValues("CmdBattleToken") }

    getCmdBreach() { return this.get("CmdBreach") }

    getCmdCardCache(resId: number) { return this.get("CmdCardCache", resId) }
    getTlCmdCardCache() { return this.getValues("CmdCardCache") }

    getCmdCastleApprentice(id: number) { return this.get("CmdCastleApprentice", id) }
    getTlCmdCastleApprentice() { return this.getValues("CmdCastleApprentice") }

    getCmdCastleSkill(skillId: number) { return this.get("CmdCastleSkill", skillId) }
    getTlCmdCastleSkill() { return this.getValues("CmdCastleSkill") }

    getCmdCastleWall(roleId: number | string) { return this.get("CmdCastleWall", roleId) }
    getTlCmdCastleWall() { return this.getValues("CmdCastleWall") }

    getCmdCastleWallSkill(id: number) { return this.get("CmdCastleWallSkill", id) }
    getTlCmdCastleWallSkill() { return this.getValues("CmdCastleWallSkill") }

    getCmdCastleWorkShop(id: number) { return this.get("CmdCastleWorkShop", id) }
    getTlCmdCastleWorkShop() { return this.getValues("CmdCastleWorkShop") }

    getCmdChapter(resId: number | string) { return this.get("CmdChapter", resId) }
    getTlCmdChapter() { return this.getValues("CmdChapter") }

    getCmdCode() { return this.get("CmdCode") }

    /**
     *  CmdDayWeekMonthGift 的 protoCache.tlKey 指向非标量字段 `tlDayGift`（EveryDayGift[]|null）。
     * tlKey 的推导规则是「字段号 == 1 的字段名」（client_proto/protoCache_build.py:106），
     * 并不保证字段 1 真是键。而 Func.hashKey 的单键分支是 `key = keyOrval[tlKeyField[0]]`，
     * 传字段**值**（数组）会被 `typeof === object` 当成「取字段的对象」-> `arr["tlDayGift"]` -> undefined -> 永远取不到。
     * 所以这里按运行时语义只收「含该字段的对象」（= addOrUpdate 里被 hash 的 message 形状）。
     * 日常读取更推荐 `getTlCmdDayWeekMonthGift()`：该表是按内容分桶的，通常只有 1 条。
     */
    getCmdDayWeekMonthGift(key: { tlDayGift: EveryDayGift[]|null }) { return this.get2("CmdDayWeekMonthGift", key) }
    getTlCmdDayWeekMonthGift() { return this.getValues("CmdDayWeekMonthGift") }

    getCmdEquipPage(page: number) { return this.get("CmdEquipPage", page) }
    getTlCmdEquipPage() { return this.getValues("CmdEquipPage") }

    getCmdEveryDaySign() { return this.get("CmdEveryDaySign") }

    getCmdFirstRecharge() { return this.get("CmdFirstRecharge") }

    getCmdFuBen(resId: number | string) { return this.get("CmdFuBen", resId) }
    getTlCmdFuBen() { return this.getValues("CmdFuBen") }

    getCmdFund() { return this.get("CmdFund") }

    getCmdGameCircle(likeRewardState: CmdCommonState) { return this.get("CmdGameCircle", likeRewardState) }
    getTlCmdGameCircle() { return this.getValues("CmdGameCircle") }

    getCmdGem(id: number | string) { return this.get("CmdGem", id) }
    getTlCmdGem() { return this.getValues("CmdGem") }

    getCmdGuanKaGift(resId: number) { return this.get("CmdGuanKaGift", resId) }
    getTlCmdGuanKaGift() { return this.getValues("CmdGuanKaGift") }

    getCmdGuide() { return this.get("CmdGuide") }

    getCmdHang() { return this.get("CmdHang") }

    getCmdHero(resId: number | string) { return this.get("CmdHero", resId) }
    getTlCmdHero() { return this.getValues("CmdHero") }

    getCmdItem(resId: number | string) { return this.get("CmdItem", resId) }
    getTlCmdItem() { return this.getValues("CmdItem") }

    getCmdLockMonster(roleId: number | string) { return this.get("CmdLockMonster", roleId) }
    getTlCmdLockMonster() { return this.getValues("CmdLockMonster") }

    getCmdMall(id: number | string) { return this.get("CmdMall", id) }
    getTlCmdMall() { return this.getValues("CmdMall") }

    getCmdOpenCache(refId: number) { return this.get("CmdOpenCache", refId) }
    getTlCmdOpenCache() { return this.getValues("CmdOpenCache") }

    getCmdRankItem(type: number) { return this.get("CmdRankItem", type) }
    getTlCmdRankItem() { return this.getValues("CmdRankItem") }

    getCmdRedDotCache(redDotType: CmdRedDotType) { return this.get("CmdRedDotCache", redDotType) }
    getTlCmdRedDotCache() { return this.getValues("CmdRedDotCache") }

    getCmdRune(id: number | string) { return this.get("CmdRune", id) }
    getTlCmdRune() { return this.getValues("CmdRune") }

    getCmdSecretRealm(roleId: number | string) { return this.get("CmdSecretRealm", roleId) }
    getTlCmdSecretRealm() { return this.getValues("CmdSecretRealm") }

    getCmdShare() { return this.get("CmdShare") }

    getCmdShop(cmdShopType: CmdShopType) { return this.get("CmdShop", cmdShopType) }
    getTlCmdShop() { return this.getValues("CmdShop") }

    getCmdSkin(resId: number | string) { return this.get("CmdSkin", resId) }
    getTlCmdSkin() { return this.getValues("CmdSkin") }

    getCmdSpecialGiftCache(resId: number | string) { return this.get("CmdSpecialGiftCache", resId) }
    getTlCmdSpecialGiftCache() { return this.getValues("CmdSpecialGiftCache") }

    getCmdSpiritAnimal(uniqueId: number | string) { return this.get("CmdSpiritAnimal", uniqueId) }
    getTlCmdSpiritAnimal() { return this.getValues("CmdSpiritAnimal") }

    getCmdTask(resId: number) { return this.get("CmdTask", resId) }
    getTlCmdTask() { return this.getValues("CmdTask") }

    getCmdArmyLevel(armyId: number) { return this.get("CmdArmyLevel", armyId) }
    getTlCmdArmyLevel() { return this.getValues("CmdArmyLevel") }

    getCmdGeneral(generalId: number) { return this.get("CmdGeneral", generalId) }
    getTlCmdGeneral() { return this.getValues("CmdGeneral") }

    getCmdAdvisor(advisorId: number) { return this.get("CmdAdvisor", advisorId) }
    getTlCmdAdvisor() { return this.getValues("CmdAdvisor") }

    getCmdAdvisorPage(PageId: number) { return this.get("CmdAdvisorPage", PageId) }
    getTlCmdAdvisorPage() { return this.getValues("CmdAdvisorPage") }

    getCmdArmySkinStar(skinId: number) { return this.get("CmdArmySkinStar", skinId) }
    getTlCmdArmySkinStar() { return this.getValues("CmdArmySkinStar") }

    getCmdArmySkinSelect(armyId: number) { return this.get("CmdArmySkinSelect", armyId) }
    getTlCmdArmySkinSelect() { return this.getValues("CmdArmySkinSelect") }

    getCmdGeneralPage(PageId: number) { return this.get("CmdGeneralPage", PageId) }
    getTlCmdGeneralPage() { return this.getValues("CmdGeneralPage") }

    getCmdFriend(friendId: number | string) { return this.get("CmdFriend", friendId) }
    getTlCmdFriend() { return this.getValues("CmdFriend") }

    getCmdFriendApply(friendId: number | string) { return this.get("CmdFriendApply", friendId) }
    getTlCmdFriendApply() { return this.getValues("CmdFriendApply") }

    getCmdFriendBlack(friendId: number | string) { return this.get("CmdFriendBlack", friendId) }
    getTlCmdFriendBlack() { return this.getValues("CmdFriendBlack") }

    getCmdChatRole(roleId: number | string) { return this.get("CmdChatRole", roleId) }
    getTlCmdChatRole() { return this.getValues("CmdChatRole") }

    getCmdGranary(id: number | string) { return this.get("CmdGranary", id) }
    getTlCmdGranary() { return this.getValues("CmdGranary") }

    getCmdMonsterManualItem(monsterId: number) { return this.get("CmdMonsterManualItem", monsterId) }
    getTlCmdMonsterManualItem() { return this.getValues("CmdMonsterManualItem") }

    getCmdEquipItem(uniqueId: number | string) { return this.get("CmdEquipItem", uniqueId) }
    getTlCmdEquipItem() { return this.getValues("CmdEquipItem") }

    getCmdEquipPart(equipId: number) { return this.get("CmdEquipPart", equipId) }
    getTlCmdEquipPart() { return this.getValues("CmdEquipPart") }

    getCmdUnion(id: number | string) { return this.get("CmdUnion", id) }
    getTlCmdUnion() { return this.getValues("CmdUnion") }

    getCmdUnionMember(roleId: number | string) { return this.get("CmdUnionMember", roleId) }
    getTlCmdUnionMember() { return this.getValues("CmdUnionMember") }

    getCmdUnionApplys(applyId: number | string) { return this.get("CmdUnionApplys", applyId) }
    getTlCmdUnionApplys() { return this.getValues("CmdUnionApplys") }

    getCmdUnionLogs(id: number | string) { return this.get("CmdUnionLogs", id) }
    getTlCmdUnionLogs() { return this.getValues("CmdUnionLogs") }

    getCmdRoleUnion(roleId: number | string) { return this.get("CmdRoleUnion", roleId) }
    getTlCmdRoleUnion() { return this.getValues("CmdRoleUnion") }

    getCmdUnionActivity(unionId: number | string) { return this.get("CmdUnionActivity", unionId) }
    getTlCmdUnionActivity() { return this.getValues("CmdUnionActivity") }

    getCmdRoleActBossDamage(roleId: number | string) { return this.get("CmdRoleActBossDamage", roleId) }
    getTlCmdRoleActBossDamage() { return this.getValues("CmdRoleActBossDamage") }

    getCmdOathAlliance(roleId: number | string) { return this.get("CmdOathAlliance", roleId) }
    getTlCmdOathAlliance() { return this.getValues("CmdOathAlliance") }

    getCmdUnionActBossDamage(unionId: number | string) { return this.get("CmdUnionActBossDamage", unionId) }
    getTlCmdUnionActBossDamage() { return this.getValues("CmdUnionActBossDamage") }

    getCmdCastleWallSkinStar(type: number) { return this.get("CmdCastleWallSkinStar", type) }
    getTlCmdCastleWallSkinStar() { return this.getValues("CmdCastleWallSkinStar") }

    getCmdCastleWallSkillPage(pageId: number) { return this.get("CmdCastleWallSkillPage", pageId) }
    getTlCmdCastleWallSkillPage() { return this.getValues("CmdCastleWallSkillPage") }

    getCmdCastleGuards(id: number) { return this.get("CmdCastleGuards", id) }
    getTlCmdCastleGuards() { return this.getValues("CmdCastleGuards") }

    /**
     *  CmdFirstRechargeNew 的 protoCache.tlKey 指向非标量字段 `infos`（CmdFirstRechargeNewItem[]|null）。
     * tlKey 的推导规则是「字段号 == 1 的字段名」（client_proto/protoCache_build.py:106），
     * 并不保证字段 1 真是键。而 Func.hashKey 的单键分支是 `key = keyOrval[tlKeyField[0]]`，
     * 传字段**值**（数组）会被 `typeof === object` 当成「取字段的对象」-> `arr["infos"]` -> undefined -> 永远取不到。
     * 所以这里按运行时语义只收「含该字段的对象」（= addOrUpdate 里被 hash 的 message 形状）。
     * 日常读取更推荐 `getTlCmdFirstRechargeNew()`：该表是按内容分桶的，通常只有 1 条。
     */
    getCmdFirstRechargeNew(key: { infos: CmdFirstRechargeNewItem[]|null }) { return this.get2("CmdFirstRechargeNew", key) }
    getTlCmdFirstRechargeNew() { return this.getValues("CmdFirstRechargeNew") }

    getCmdRoleActDamage(roleId: number | string) { return this.get("CmdRoleActDamage", roleId) }
    getTlCmdRoleActDamage() { return this.getValues("CmdRoleActDamage") }

    getCmdRechargeDaily(roleId: number | string) { return this.get("CmdRechargeDaily", roleId) }
    getTlCmdRechargeDaily() { return this.getValues("CmdRechargeDaily") }

    getCmdLeaderSkill(roleId: number | string) { return this.get("CmdLeaderSkill", roleId) }
    getTlCmdLeaderSkill() { return this.getValues("CmdLeaderSkill") }

    getCmdLimitedTimeBundle(resId: number) { return this.get("CmdLimitedTimeBundle", resId) }
    getTlCmdLimitedTimeBundle() { return this.getValues("CmdLimitedTimeBundle") }

    getCmdCelebrationInfo(id: number) { return this.get("CmdCelebrationInfo", id) }
    getTlCmdCelebrationInfo() { return this.getValues("CmdCelebrationInfo") }

    getCmdRoleQuestion(id: number) { return this.get("CmdRoleQuestion", id) }
    getTlCmdRoleQuestion() { return this.getValues("CmdRoleQuestion") }

    getCmdRoleInteractInfo(resId: number) { return this.get("CmdRoleInteractInfo", resId) }
    getTlCmdRoleInteractInfo() { return this.getValues("CmdRoleInteractInfo") }

    getCmdArtifact(artifactId: number) { return this.get("CmdArtifact", artifactId) }
    getTlCmdArtifact() { return this.getValues("CmdArtifact") }

    getCmdArtifactPage(PageId: number) { return this.get("CmdArtifactPage", PageId) }
    getTlCmdArtifactPage() { return this.getValues("CmdArtifactPage") }

}
