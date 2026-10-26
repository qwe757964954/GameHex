// DO NOT EDIT! This is a generated file. Edit the JSDoc in src/*.js instead and run 'npm run build:types'.



    declare class CmdActivity {
        activityRefId?: (number|null);
        detail?: (CmdActivityDetail|null);
        endTime?: (Long|null);
        openResId?: (number|null);
        startTime?: (Long|null);
    }

    

    declare enum CmdTurntableLotteryType {
        Type1 = 1,
        Type2 = 2,
        Type3 = 3,
        Type4 = 4
    }

    declare class CmdLotteryActDetail {
        actType: number;
        lotteryType: number;
        drawCount: number;
        luckValue: number;
        claimedMask: number;
    }

    

    declare class CmdActivityDetail {
        dayChallengeActDetail?: (CmdDayChallengeActDetail|null);
        monthCardActDetail?: (CmdMonthCardActDetail|null);
        rechargeGiftActDetail?: (CmdRechargeGiftActDetail|null);
        cmdRechargeGiftAct2Detail?: (CmdRechargeGiftAct2Detail|null);
        cmdRechargeGiftAct3Detail?: (CmdRechargeGiftAct3Detail|null);
        monthCardActDetail2?: (CmdMonthCardActDetail|null);
        skinActDetail?: (CmdSkinActDetail|null);
        tlLotteryActDetail?: (CmdLotteryActDetail[]|null);
    }

    

    declare class CmdActivityGoods {
        resId: number;
        times: number;
    }

    

    declare class CmdActivityJsonReqMsg {
        activityId: string;
        tlJsonName?: (string[]|null);
    }

    

    declare class CmdActivityJsonRspMsg {
        content: string;
    }

    

    declare class CmdActivityLimitSkinBuyReqMsg {
        id: number;
    }

    

    declare class CmdActivityLimitSkinBuyRspMsg {
        cmdSkinPlayer: CmdSkinPlayer;
        tlReward?: (CmdGoods[]|null);
    }

    

    declare class CmdActivityLimitSkinInfoReqMsg {
    }

    

    declare class CmdActivityLimitSkinInfoRspMsg {
        cmdSkinPlayer: CmdSkinPlayer;
    }

    

    declare class CmdActivityLimitTimeInfoReqMsg {
    }

    

    declare class CmdActivityLimitTimeInfoRspMsg {
        tlCmdTask?: (CmdTask[]|null);
        tlLimitTimeActivity?: (CmdActivityGoods[]|null);
        tlLimitTimeDay?: (CmdActivityGoods[]|null);
    }

    

    declare class CmdActivityLimitTimeTakeReqMsg {
        resId: number;
        type: number;
    }

    

    declare class CmdActivityLimitTimeTakeRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
        tlCmdTask?: (CmdTask[]|null);
        tlLimitTimeActivity?: (CmdActivityGoods[]|null);
        tlLimitTimeDay?: (CmdActivityGoods[]|null);
    }

    

    declare class CmdActivitySimple {
        changeTime?: (Long|null);
        cmdActivityTime: CmdActivityTime;
        exist: boolean;
        id: string;
        jsonNames?: (string[]|null);
        name: string;
        tlCmdActivityTime?: (CmdActivityTime[]|null);
        type: number;
    }

    

    declare class CmdActivitySimple_Key {
        id: string;
    }

    

    declare class CmdActivityTime {
        endTime?: (Long|null);
        startTime?: (Long|null);
    }

    

    declare enum CmdActivityTypeEnum {
        limit_skin = 102,
        limit_time = 101
    }

    declare class CmdActivity_Key {
        openResId: number;
    }

    

    declare class CmdAdvert {
        nextTime?: (Long|null);
        num: number;
        type: number;
    }

    

    declare class CmdAppletInfo {
        extra?: (string|null);
        num: number;
        type: number;
    }

    

    declare class CmdBattleAttr {
        refId: number;
        value: string;
    }

    

    declare class CmdBattleBroMsg {
    }

    

    declare class CmdBattleBuff {
        id: number;
        refId: number;
    }

    

    declare class CmdBattleCard {
        id: number;
        useNum: number;
    }

    

    declare class CmdBattleChapter {
        chapterId: number;
        tlCmdBattleLevel?: (CmdBattleLevel[]|null);
    }

    

    declare class CmdBattleChapter_Key {
        chapterId: number;
    }

    

    declare class CmdBattleCompleteInfoReqMsg {
        level: number;
    }

    

    declare class CmdBattleCompleteInfoRspMsg {
        star3: number;
    }

    

    declare class CmdBattleData {
        advertNum: number;
        battleId: string;
        battleType?: (CmdBattleType|null);
        clientData?: (Uint8Array|null);
        cmdBattleSkill?: (CmdBattleSkill|null);
        gemRefreshSkillNum?: (number|null);
        randomTimes: number;
        spiritAnimalData?: (CmdSpiritAnimalData|null);
        times: number;
        tlCmdBattleAttr?: (CmdBattleAttr[]|null);
        tlCmdBattleBuff?: (CmdBattleBuff[]|null);
        tlCmdBattleCard?: (CmdBattleCard[]|null);
        tlId?: (number[]|null);
        tlSkillId?: (number[]|null);
        tlWallSkillId?: (number[]|null);
    }

    

    declare class CmdBattleDataUploadReqMsg {
        battleId: string;
        clientData: Uint8Array;
    }

    

    declare class CmdBattleDataUploadRspMsg {
    }

    

    declare class CmdBattleLevel {
        level: number;
        star: number;
        takeStar: number;
        battleTime: number;
        buyTimes: number;
    }

    

    declare class CmdBattleLevel_Key {
        level: number;
    }

    

    declare class CmdBattlePreviewReqMsg {
        level: number;
        wave?: (number|null);
    }

    

    declare class CmdBattlePreviewRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdBattleRandomSkillReqMsg {
        battleTime?: (number|null);
        cardId?: (number|null);
        clientData?: (Uint8Array|null);
        hp?: (number|null);
        level?: (number|null);
        type?: (number|null);
    }

    

    declare class CmdBattleRandomSkillRspMsg {
        cmdBattleData?: (CmdBattleData|null);
        selectId?: (number[]|null);
        tlId?: (number[]|null);
    }

    

    declare class CmdBattleArmyData {
        armyId: number;
        skillLv: number;
        damage: Long;
    }

    

    declare class CmdBattleResultReqMsg {
        battleTime?: (number|null);
        cmdBattleType?: (CmdBattleType|null);
        killNumber?: (number|null);
        level?: (number|null);
        report?: (Uint8Array|null);
        star?: (number|null);
        version?: (number|null);
        wave?: (number|null);
        killBossNumber?: (number|null);
        totalDamage?: (Long|null);
        armyInfos?: (CmdBattleArmyData[]|null);
    }

    

    declare class CmdBattleResultRspMsg {
        tipType?: (number|null);
        tlCmdGoods?: (CmdGoods[]|null);
        star?: (number|null);
    }

    

    declare class CmdBattleSelectSkillReqMsg {
        id?: (number[]|null);
        level?: (number|null);
        type?: (number|null);
    }

    

    declare class CmdBattleSelectSkillRspMsg {
        cmdBattleData: CmdBattleData;
    }

    

    declare class CmdBattleSkill {
        curRandomSkill?: (number[]|null);
        curRandomSkillType?: (number|null);
        tlBaseSkillId?: (number[]|null);
        tlBossSkillId?: (number[]|null);
        tlSkillId?: (number[]|null);
    }

    

    declare class CmdBattleStatisticsReqMsg {
        battleId: string;
        battleTime?: (number|null);
        cmdBattleType?: (CmdBattleType|null);
        level?: (number|null);
        report?: (Uint8Array|null);
        roundIndex?: (number|null);
        version?: (number|null);
    }

    

    declare class CmdBattleStatisticsRspMsg {
    }

    

    declare class CmdBattleSweepReqMsg {
        level: number;
        type: number;
    }

    

    declare class CmdBattleSweepRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare enum CmdBattleType {
        CHAPTER = 1,
        LOCK_MONSTER = 2,
        SECRET_REALM = 3
    }

    declare class CmdBreach {
    }

    

    declare class CmdBreachReqMsg {
        resId: Long;
        type: number;
    }

    

    declare class CmdBreachRspMsg {
    }

    

    declare class CmdBreach_Key {
        resId: Long;
    }

    

    declare class CmdBuySkinReqMsg {
        resId: number;
    }

    

    declare class CmdBuySkinRspMsg {
        tlReward?: (CmdGoods[]|null);
    }

    

    declare class CmdBuyStaBuyReqMsg {
        resId: number;
    }

    

    declare class CmdBuyStaBuyRspMsg {
    }

    

    declare class CmdBuyStaInfoReqMsg {
    }

    

    declare class CmdBuyStaInfoRspMsg {
        cmdBuyStaState?: (CmdBuyStaState[]|null);
    }

    

    declare class CmdBuyStaState {
        resId: number;
        state: number;
    }

    

    declare class CmdCacheBroMsg {
    }

    

    declare class CmdCastleSkill {
        level: number;
        skillId: number;
    }

    

    declare class CmdCastleSkill_Key {
        skillId: number;
    }

    

    declare class CmdCastleWorkShop {
        history: string;
        id: number;
        level: number;
        levelEndTime: Long;
        rewardEndTime: Long;
        rewardNum: number;
    }

    

    declare class CmdCastleWorkShop_Key {
        id: number;
    }

    

    declare class CmdCastleApprentice {
        id: number;
        level: number;
        state: boolean;
    }

    

    declare class CmdCastleApprentice_Key {
        id: number;
    }

    

    declare class CmdCastleWall {
        roleId: Long;
        selectType: number;
        level: number;
        selectSkillPageId: number;
    }

    

    declare class CmdCastleWall_Key {
        roleId: Long;
    }

    

    declare class CmdCastleWallSkill {
        id: number;
        level: number;
    }

    

    declare class CmdCastleWallSkill_Key {
        id: number;
    }

    

    declare class CmdCastleWallSkinStar {
        type: number;
        star: number;
    }

    

    declare class CmdCastleWallSkinStar_Key {
        type: number;
    }

    

    declare class CmdCastleWallSkillPage {
        pageId: number;
        skillList?: (number[]|null);
    }

    

    declare class CmdCastleWallSkillPage_Key {
        pageId: number;
    }

    

    declare class CmdCastleSkillUpLevelReqMsg {
        skillId: number;
    }

    

    declare class CmdCastleSkillUpLevelRspMsg {
    }

    

    declare class CmdCastleSkillResearchReqMsg {
    }

    

    declare class CmdCastleSkillResearchRspMsg {
    }

    

    declare class CmdCastleWorkShopOpenReqMsg {
        id: number;
    }

    

    declare class CmdCastleWorkShopOpenRspMsg {
    }

    

    declare class CmdCastleWorkShopUpLevelReqMsg {
        id: number;
    }

    

    declare class CmdCastleWorkShopUpLevelRspMsg {
    }

    

    declare class CmdCastleWorkShopSpeedReqMsg {
        id: number;
    }

    

    declare class CmdCastleWorkShopSpeedRspMsg {
    }

    

    declare class CmdCastleWorkShopTakeReqMsg {
        id: number;
    }

    

    declare class CmdCastleWorkShopTakeRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdCastleApprenticeUpReqMsg {
        id: number;
        type: number;
    }

    

    declare class CmdCastleApprenticeUpRspMsg {
    }

    

    declare class CmdCastleApprenticeUpLevelReqMsg {
        id: number;
    }

    

    declare class CmdCastleApprenticeUpLevelRspMsg {
    }

    

    declare class CmdCastleWallUpLevelReqMsg {
    }

    

    declare class CmdCastleWallUpLevelRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdCastleWallQualityUpReqMsg {
        wallType: number;
    }

    

    declare class CmdCastleWallQualityUpRspMsg {
    }

    

    declare class CmdCastleWallSelectReqMsg {
        type: number;
    }

    

    declare class CmdCastleWallSelectRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdCastleWallUpSkillLevelReqMsg {
        id: number;
    }

    

    declare class CmdCastleWallUpSkillLevelRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdCastleWallSkinUpStarReqMsg {
        wallType: number;
    }

    

    declare class CmdCastleWallSkinUpStarRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdCastleWallSelectSkillPageReqMsg {
        pageId: number;
    }

    

    declare class CmdCastleWallSelectSkillPageRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdCastleWallSelectSkillReqMsg {
        pageId: number;
        index: number;
        wallType: number;
    }

    

    declare class CmdCastleWallSelectSkillRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdChangeUsedSkinReqMsg {
        resId: Long;
    }

    

    declare class CmdChangeUsedSkinRspMsg {
    }

    

    declare class CmdChapter {
        finishState: number;
        giftState: number;
        liveTime: Long;
        resId: Long;
        tlChapterBoxState?: (CmdChapterBoxState[]|null);
    }

    

    declare class CmdChapterBoxState {
        boxResId: Long;
        rewardState: CmdCommonState;
    }

    

    declare class CmdChapter_Key {
        resId: Long;
    }

    

    declare class CmdClientAppendData {
        tlCmdClientAppendDataModel?: (CmdClientAppendDataModel[]|null);
    }

    

    declare class CmdClientAppendDataModel {
        appendData: Uint8Array;
        cmdClientAppendDataModelEnum: CmdClientAppendDataModelEnum;
    }

    

    declare enum CmdClientAppendDataModelEnum {
        CmdGuideList = 1
    }

    declare class CmdClientInfo {
        appId?: (string|null);
        appType?: (string|null);
        bigChannel: string;
        idfa: string;
        imei: string;
        mac: string;
        mobileBrand: string;
        mobileModel: string;
        networkType: string;
        smallChannel: string;
        smallChannelPack: string;
        systemName: string;
        systemVersion: string;
        versionCode: string;
        versionName: string;
    }

    

    declare class CmdCode {
    }

    

    declare class CmdCodeExchangeReqMsg {
        code: string;
    }

    

    declare class CmdCodeExchangeRspMsg {
        tlReward?: (CmdGoods[]|null);
    }

    

    declare class CmdCode_Key {
        id: Long;
    }

    

    declare enum CmdCommonState {
        FINISH = 1,
        REWARDED = 2,
        UNDONE = 0
    }

    declare class CmdCommonTips {
        content: CmdI18N;
    }

    

    declare class CmdContinueNextBattleReqMsg {
        battleType: CmdBattleType;
        "continue"?: (boolean|null);
    }

    

    declare class CmdContinueNextBattleRspMsg {
        cmdBattleData?: (CmdBattleData|null);
    }

    

    declare class CmdContinuityGiftFinishRewardReqMsg {
        days: number;
    }

    

    declare class CmdContinuityGiftFinishRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdContinuityGiftInfo {
        days: number;
        status: number;
    }

    

    declare class CmdContinuityGiftInfoReqMsg {
    }

    

    declare class CmdContinuityGiftInfoRspMsg {
        accumulativeAward?: (number[]|null);
        endTime: Long;
        tlCmdContinuityGiftInfo?: (CmdContinuityGiftInfo[]|null);
    }

    

    declare class CmdContinuityGiftRewardReqMsg {
        days: number;
    }

    

    declare class CmdContinuityGiftRewardRspMsg {
        tlCmdContinuityGiftInfo?: (CmdContinuityGiftInfo[]|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdDayChallengeActDetail {
        tlDayChallengeTask?: (CmdDayChallengeTask[]|null);
        tlProgressInfo?: (number[]|null);
    }

    

    declare class CmdDayChallengeTask {
        process: number;
        resId: number;
        state: CmdCommonState;
    }

    

    declare class RechargeCount {
        buyState: number;
        resId: number;
        rewards?: (CmdGoods[]|null);
    }

    

    declare class CmdDayWeekMonthGift {
        rechargeDay: number;
        tlDayGift?: (EveryDayGift[]|null);
        tlMonthGift?: (EveryDayGift[]|null);
        tlRechargeCount?: (RechargeCount[]|null);
        tlWeekGift?: (EveryDayGift[]|null);
    }

    

    declare class CmdDayWeekMonthGiftFreeBuyReqMsg {
        id: Long;
    }

    

    declare class CmdDayWeekMonthGiftFreeBuyRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdDayWeekMonthGiftGetRewardReqMsg {
        id: number;
    }

    

    declare class CmdDayWeekMonthGiftGetRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdDayWeekMonthGiftInfoReqMsg {
    }

    

    declare class CmdDayWeekMonthGiftInfoRspMsg {
        cmdDayWeekMonthGift: CmdDayWeekMonthGift;
    }

    

    declare class CmdDayWeekMonthGift_Key {
        id: Long;
    }

    

    declare class CmdEndBroMsg {
        end: number;
        nextTime: Long;
    }

    

    declare class CmdEndBuyInfoReqMsg {
    }

    

    declare class CmdEndBuyInfoRspMsg {
        tlEndBuyInfo?: (CmdRoleEndBuyInfo[]|null);
    }

    

    declare class CmdEndBuyReqMsg {
        buyId: number;
    }

    

    declare class CmdEndBuyRspMsg {
        tlReward?: (CmdGoods[]|null);
    }

    

    declare class CmdEnterBattleReqMsg {
        battleType: CmdBattleType;
        level?: (number|null);
    }

    

    declare class CmdEnterBattleRspMsg {
        cmdBattleData?: (CmdBattleData|null);
    }

    

    declare class CmdEquip {
        equipId: number;
        level: number;
        tlCmdGemInfo?: (CmdGemInfo[]|null);
    }

    

    declare class CmdEquipChangePageNameReqMsg {
        name: string;
        page: number;
    }

    

    declare class CmdEquipChangePageNameRspMsg {
    }

    

    declare class CmdEquipItem {
        uniqueId: Long;
        resId: number;
        baseId: number;
        rank: number;
        baseQuality: number;
        curQuality: number;
        costNum: number;
        washNum: number;
        tlAttributes?: (number[]|null);
        tlEffects?: (number[]|null);
    }

    

    declare class CmdEquipItem_Key {
        uniqueId: Long;
    }

    

    declare class CmdEquipPart {
        equipId: number;
        equip: CmdEquipItem;
    }

    

    declare class CmdEquipPart_Key {
        equipId: number;
    }

    

    declare class CmdEquipPage {
        name: string;
        page: number;
        tlCmdEquip?: (CmdEquip[]|null);
    }

    

    declare class CmdEquipPage_Key {
        page: number;
    }

    

    declare class CmdEquipSelectPageReqMsg {
        page: number;
    }

    

    declare class CmdEquipSelectPageRspMsg {
    }

    

    declare class CmdEquipUpLevelAllReqMsg {
    }

    

    declare class CmdEquipUpLevelAllRspMsg {
    }

    

    declare class CmdEquipUpLevelReqMsg {
        id: number;
        type?: (number|null);
    }

    

    declare class CmdEquipUpLevelRspMsg {
    }

    

    declare class CmdEquipUpQualityReqMsg {
        equipId: number;
    }

    

    declare class CmdEquipUpQualityRspMsg {
        ret?: (boolean|null);
        equipPart?: (CmdEquipPart|null);
    }

    

    declare class CmdEquipWashReqMsg {
        equipId: number;
    }

    

    declare class CmdEquipWashRspMsg {
        ret?: (boolean|null);
        equipId?: (number|null);
        tlLibs?: (number[]|null);
    }

    

    declare class CmdEquipWashConformReqMsg {
        equipId: number;
        change: boolean;
    }

    

    declare class CmdEquipWashConformRspMsg {
        equipPart?: (CmdEquipPart|null);
    }

    

    declare class CmdEquipDecomposeReqMsg {
        tlUniqueIds?: (Long[]|null);
    }

    

    declare class CmdEquipDecomposeRspMsg {
        tlUniqueIds?: (Long[]|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdEquipReplaceReqMsg {
        uniqueId: Long;
    }

    

    declare class CmdEquipReplaceRspMsg {
        ret?: (boolean|null);
        uniqueId?: (Long|null);
        equipPart?: (CmdEquipPart|null);
        equip?: (CmdEquipItem|null);
    }

    

    declare class CmdEveryDayGetRewardsReqMsg {
        day: number;
    }

    

    declare class CmdEveryDayGetRewardsRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdEveryDaySign {
    }

    

    declare class CmdEveryDaySignInInfoReqMsg {
    }

    

    declare class CmdEveryDaySignInInfoRspMsg {
        days: number;
        tlEveryDaySignInReward?: (EveryDaySignInReward[]|null);
    }

    

    declare class CmdEveryDaySignInReqMsg {
    }

    

    declare class CmdEveryDaySignInRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdEveryDaySign_Key {
        id: Long;
    }

    

    declare class CmdFirstRechargeInfo {
        id: number;
        lastTakeTime?: (Long|null);
        rewardIds?: (Long[]|null);
    }

    

    declare class CmdFuBen {
        detail: CmdFuBenDetail;
        resId: Long;
    }

    

    declare class CmdFuBenDailyDetail {
        buyTime: number;
        cmdFuBenRewardState?: (CmdFuBenRewardState[]|null);
        enterCount: number;
        freeTime: number;
        level: number;
        resId: Long;
        type: number;
    }

    

    declare class CmdFuBenDailyGetRewardReqMsg {
        resId: number;
    }

    

    declare class CmdFuBenDailyGetRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdFuBenDetail {
        cmdFuBenDailyDetail?: (CmdFuBenDailyDetail|null);
        cmdFuBenGoldDetail?: (CmdFuBenGoldDetail|null);
    }

    

    declare class CmdFuBenEnterReqMsg {
        resId: Long;
        type: CmdFuBenType;
    }

    

    declare class CmdFuBenEnterRspMsg {
    }

    

    declare class CmdFuBenGoldDetail {
        buyTime: number;
        enterCount: number;
        freeTime: number;
        level: number;
        resId: Long;
        type: number;
    }

    

    declare class CmdFuBenRewardState {
        resId: number;
        state: number;
    }

    

    declare enum CmdFuBenType {
        CHAPTER = 1,
        DAILY = 3,
        MONEY = 2
    }

    declare class CmdFuBen_Key {
        resId: Long;
    }

    

    declare class CmdFund {
    }

    

    declare class CmdFundDetail {
        buyState: number;
        cmdFundRewardState?: (CmdFundRewardState[]|null);
        resId: Long;
    }

    

    declare class CmdFundGetInfoReqMsg {
    }

    

    declare class CmdFundGetInfoRspMsg {
        cmdFundDetail?: (CmdFundDetail[]|null);
    }

    

    declare class CmdFundGetRewardReqMsg {
        resId: Long;
    }

    

    declare class CmdFundGetRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdFundRewardState {
        resId: Long;
        state: number;
    }

    

    declare class CmdFund_Key {
        id: Long;
    }

    

    declare class CmdGameCircle {
        likeRewardState: CmdCommonState;
    }

    

    declare class CmdGameCircle_Key {
    }

    

    declare class CmdGameExtend {
        clazzName: string;
        message: Uint8Array;
    }

    

    declare class CmdGem {
        attribute: number;
        id: Long;
        lock: number;
        newAttribute?: (number|null);
        num: number;
        quality: number;
        resId: Long;
    }

    

    declare class CmdGemComposePreviewReqMsg {
    }

    

    declare class CmdGemComposePreviewRspMsg {
        tlCmdGemPreview?: (CmdGemPreview[]|null);
    }

    

    declare class CmdGemComposeReqMsg {
    }

    

    declare class CmdGemComposeRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdGemDownReqMsg {
        equipId: number;
        order: number;
        page: number;
    }

    

    declare class CmdGemDownRspMsg {
    }

    

    declare class CmdGemInfo {
        gemId: Long;
        order: number;
    }

    

    declare class CmdGemLockReqMsg {
        id: Long;
        lock?: (number|null);
    }

    

    declare class CmdGemLockRspMsg {
    }

    

    declare class CmdGemOnReqMsg {
        equipId: number;
        id: Long;
        page: number;
    }

    

    declare class CmdGemOnRspMsg {
    }

    

    declare class CmdGemPreview {
        id: Long;
        num: number;
    }

    

    declare class CmdGemRefineReqMsg {
        id: Long;
        type?: (Long|null);
    }

    

    declare class CmdGemRefineRspMsg {
    }

    

    declare class CmdGemRefineSaveReqMsg {
        id: Long;
        type: Long;
    }

    

    declare class CmdGemRefineSaveRspMsg {
        id?: (Long|null);
    }

    

    declare class CmdGemRefreshSkillReqMsg {
    }

    

    declare class CmdGemRefreshSkillRspMsg {
        tlId?: (number[]|null);
    }

    

    declare class CmdGemReplaceReqMsg {
        equipId: number;
        id: Long;
        order: number;
        page: number;
    }

    

    declare class CmdGemReplaceRspMsg {
    }

    

    declare class CmdGem_Key {
        id: Long;
    }

    

    declare class CmdGetAllPlayClientAniReqMsg {
    }

    

    declare class CmdGetAllPlayClientAniRspMsg {
        clientAniRefId?: (number[]|null);
    }

    

    declare class CmdGetHallRoleListReqMsg {
    }

    

    declare class CmdGetHallRoleListRspMsg {
        tlHallRole?: (CmdHallRole[]|null);
    }

    

    declare class CmdGetRankReqMsg {
        rankType: CmdRankType;
        showNum?: (number|null);
        type?: (number|null);
        unionId?: (Long|null);
    }

    

    declare class CmdGetRankRspMsg {
        rankInfo?: (CmdRankData|null);
    }

    

    declare class CmdGmInfo {
        cmd: string;
        desc?: (string|null);
    }

    

    declare class CmdGmListReqMsg {
    }

    

    declare class CmdGmListRspMsg {
        cmd?: (CmdGmInfo[]|null);
    }

    

    declare class CmdGoodReplace {
        newResId: Long;
        number: number;
        oldResId: Long;
    }

    

    declare class CmdGoods {
        number: string;
        quality?: (number|null);
        resId: Long;
    }

    

    declare class CmdGoodsList {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdGoodsRedDot {
        id?: (Long|null);
        resId: Long;
    }

    

    declare class CmdGoodsRedDotDispelReqMsg {
        dispelParam?: (CmdGoodsRedDot[]|null);
    }

    

    declare class CmdGoodsRedDotDispelRspMsg {
    }

    

    declare class CmdGuanKaGift {
        resId: number;
        buyCount?: (Long|null);
    }

    

    declare class CmdGuanKaGiftBroMsg {
        cmdGuanKaGift: CmdGuanKaGift;
    }

    

    declare class CmdGuanKaGift_Key {
        resId: number;
    }

    

    declare class CmdGuide {
    }

    

    declare class CmdGuideDetail {
        extend?: (string|null);
        resId: number;
        type: number;
    }

    

    declare class CmdGuideReadReqMsg {
    }

    

    declare class CmdGuideReadRspMsg {
        cmdGuideDetail?: (CmdGuideDetail[]|null);
    }

    

    declare class CmdGuideRecordReqMsg {
        extend?: (string|null);
        resId: number;
        type: number;
    }

    

    declare class CmdGuideRecordRspMsg {
    }

    

    declare class CmdGuide_Key {
        id: Long;
    }

    

    declare class CmdHallRole {
        point?: (CmdPoint|null);
        roleId: Long;
        roleName?: (string|null);
    }

    

    declare class CmdHang {
    }

    

    declare class CmdHangGetRewardReqMsg {
    }

    

    declare class CmdHangGetRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdHangQuickReqMsg {
    }

    

    declare class CmdHangQuickRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdHangTimeReqMsg {
    }

    

    declare class CmdHangTimeRspMsg {
        time: Long;
    }

    

    declare class CmdHang_Key {
        resId: Long;
    }

    

    declare class CmdHero {
        equipId?: (Long|null);
        level: Long;
        resId: Long;
        state: number;
    }

    

    declare class CmdHeroChangeReqMsg {
        resId: Long;
    }

    

    declare class CmdHeroChangeRspMsg {
    }

    

    declare class CmdHeroLevelUpOneKeyReqMsg {
        resId: Long;
    }

    

    declare class CmdHeroLevelUpOneKeyRspMsg {
    }

    

    declare class CmdHeroLevelUpReqMsg {
        resId: Long;
    }

    

    declare class CmdHeroLevelUpRspMsg {
    }

    

    declare class CmdHeroOpenReqMsg {
    }

    

    declare class CmdHeroOpenRspMsg {
    }

    

    declare class CmdHeroUnlockGetInfoReqMsg {
    }

    

    declare class CmdHeroUnlockGetInfoRspMsg {
        cmdHeroUnlockInfo?: (CmdHeroUnlockInfo[]|null);
    }

    

    declare class CmdHeroUnlockInfo {
        count: number;
        resId: Long;
        rewardState: number;
    }

    

    declare class CmdHeroUnlockRewardReqMsg {
        resId: Long;
    }

    

    declare class CmdHeroUnlockRewardRspMsg {
    }

    

    declare class CmdHero_Key {
        resId: Long;
    }

    

    declare class CmdI18N {
        cmdI18NRef?: (string|null);
        template?: (string|null);
        tlParam?: (CmdI18N[]|null);
    }

    

    declare class CmdItem {
        isNew: boolean;
        number: number;
        resId: Long;
    }

    

    declare class CmdItemBoxUseReqMsg {
        cmdGoodsList?: (CmdGoodsList|null);
        number: number;
        resId: Long;
    }

    

    declare class CmdItemBoxUseRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdItemUseReqMsg {
        number: number;
        resId: Long;
    }

    

    declare class CmdItemUseRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdItem_Key {
        resId: Long;
    }

    

    declare class CmdLockMonster {
        roleId: Long;
        level: number;
        levelPassTime: Long;
        takeBoxlevel: number;
        buyEnterCount: number;
    }

    

    declare class CmdLockMonster_Key {
        roleId: Long;
    }

    

    declare class CmdOathAlliance {
        roleId: Long;
        todayTakeCount: number;
        lastTakeTime: Long;
        renown: number;
    }

    

    declare class CmdOathAlliance_Key {
        roleId: Long;
    }

    

    declare class CmdMail {
        cmdGoodsList?: (CmdGoodsList|null);
        content: string;
        id: Long;
        read: boolean;
        readTime: Long;
        sendTime: Long;
        take: boolean;
        title: string;
    }

    

    declare class CmdMailDeleteReqMsg {
        id?: (Long[]|null);
    }

    

    declare class CmdMailDeleteRspMsg {
    }

    

    declare class CmdMailListReqMsg {
    }

    

    declare class CmdMailListRspMsg {
        tlCmdMailSimple?: (CmdMailSimple[]|null);
    }

    

    declare class CmdMailReadReqMsg {
        id: Long;
    }

    

    declare class CmdMailReadRspMsg {
        cmdMail: CmdMail;
    }

    

    declare class CmdMailSimple {
        id: Long;
        read: boolean;
        sendTime: Long;
        take: boolean;
        title: string;
    }

    

    declare class CmdMailTakeRewardReqMsg {
        id?: (Long[]|null);
    }

    

    declare class CmdMailTakeRewardRspMsg {
        tlReward?: (CmdGoods[]|null);
    }

    

    declare class CmdMall {
        detail?: (CmdMallDetail|null);
        id?: (Long|null);
    }

    

    declare class CmdMallBroMsg {
        cmdMall: CmdMall;
        mallId: Long;
    }

    

    declare class CmdMallChapterGiftDetail {
        resId?: (Long|null);
        state?: (number|null);
    }

    

    declare class CmdMallChargeDetail {
        resId?: (Long|null);
        state?: (number|null);
    }

    

    declare class CmdMallCoinBuyReqMsg {
        mallId: Long;
        resId: Long;
        type: number;
    }

    

    declare class CmdMallCoinBuyRspMsg {
    }

    

    declare class CmdMallCoinDetail {
        buyCount?: (number|null);
        freeTime?: (Long|null);
        resId?: (Long|null);
    }

    

    declare class CmdMallDailyShopBuyReqMsg {
        isAd: number;
        mallId: Long;
        planId: Long;
    }

    

    declare class CmdMallDailyShopBuyRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdMallDailyShopDetail {
        adTime?: (Long|null);
        buyCount?: (number|null);
        discount?: (string|null);
        finalNumber?: (string|null);
        original?: (string|null);
        resId?: (Long|null);
        rewardId?: (Long|null);
    }

    

    declare class CmdMallDetail {
        cmdMallChapterGiftDetail?: (CmdMallChapterGiftDetail[]|null);
        cmdMallChargeDetail?: (CmdMallChargeDetail[]|null);
        cmdMallCoinDetail?: (CmdMallCoinDetail[]|null);
        cmdMallDailyShopDetail?: (CmdMallDailyShopDetail[]|null);
        cmdMallLuckDrawDetail?: (CmdMallLuckDrawDetail[]|null);
        cmdMallSEquipDetail?: (CmdMallSEquipDetail[]|null);
    }

    

    declare class CmdMallGetDataReqMsg {
    }

    

    declare class CmdMallGetDataRspMsg {
        cmdMall?: (CmdMall[]|null);
    }

    

    declare class CmdMallLuckDrawDetail {
        bigPrizeCount?: (number|null);
        buyCount?: (number|null);
        freeTime?: (Long|null);
        resId?: (Long|null);
    }

    

    declare class CmdMallLuckDrawReqMsg {
        mallId: Long;
        resId: Long;
        type: number;
    }

    

    declare class CmdMallLuckDrawRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdMallSEquipDetail {
        bigPrizeCount?: (number|null);
        buyCount?: (number|null);
        resId?: (Long|null);
        ultimatePrizeCount?: (number|null);
    }

    

    declare class CmdMallSEquipDrawReqMsg {
        count: boolean;
        mallId: Long;
        resId: Long;
        type: number;
    }

    

    declare class CmdMallSEquipDrawRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdMall_Key {
        id: Long;
    }

    

    declare class CmdMiningBuyReqMsg {
    }

    

    declare class CmdMiningBuyRspMsg {
        tlReward?: (CmdGoods[]|null);
    }

    

    declare class CmdModifyItemBroMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdMonthCardActDetail {
        cardEndTime: Long;
        todayTake?: (boolean|null);
    }

    

    declare class CmdOpenCache {
        refId: number;
        show: boolean;
    }

    

    declare class CmdOpenCache_Key {
        refId: number;
    }

    

    declare class CmdPoint {
        x: number;
        y: number;
    }

    

    declare class CmdRankData {
        myRank: CmdRankRole;
        rankList?: (CmdRankRole[]|null);
        region?: (string|null);
    }

    

    declare class CmdRankItem {
        endTime?: (number|null);
        showEndTime?: (number|null);
        startTime?: (number|null);
        type: number;
    }

    

    declare class CmdRankItem_Key {
        type: number;
    }

    

    declare class CmdRankRole {
        headFrame?: (Long|null);
        platFormImg?: (string|null);
        rank: number;
        roleId: Long;
        roleImg?: (Long|null);
        roleName?: (string|null);
        selectServerId?: (Long|null);
        serverId?: (Long|null);
        value?: (Long|null);
        power?: (number|null);
        titleId?: (number|null);
        usedSkinResId?: (Long|null);
        count?: (number|null);
        maxCount?: (number|null);
    }

    

    declare class CmdChapterFirstPassInfo {
        passLevel: number;
        roleId: Long;
        name: string;
        img: Long;
        headFrame: Long;
        platformImg: string;
        level: number;
        selectServerId: number;
        power: number;
        serverId: number;
        titleId: number;
    }

    

    declare class CmdChapterFirstPassInfo_Key {
        passLevel: number;
    }

    

    declare enum CmdRankType {
        CHAPTER_FULL_RANK = 1,
        CHAPTER_SERVER_RANK = 2,
        LOCK_MONSTER_FULL_RANK = 3,
        LOCK_MONSTER_SERVER_RANK = 4,
        SECRET_REALM_FULL_RANK = 5,
        SECRET_REALM_SERVER_RANK = 6,
        OATH_ALLIANCE_FULL_RANK = 7,
        OATH_ALLIANCE_SERVER_RANK = 8,
        GUARDS_JIANGE_FULL_RANK = 9,
        GUARDS_JIANGE_SERVER_RANK = 10,
        NORTH_EXPEDITION_FULL_RANK = 21,
        NORTH_EXPEDITION_SERVER_RANK = 22,
        NORTH_EXPEDITION_UNION_FULL_RANK = 23,
        NORTH_EXPEDITION_UNION_SERVER_RANK = 24,
        CELEBRATION_POWER_FULL_RANK = 31,
        CELEBRATION_POWER_SERVER_RANK = 32,
        CELEBRATION_END_FULL_RANK = 33,
        CELEBRATION_END_SERVER_RANK = 34,
        CELEBRATION_EQUIP_FULL_RANK = 35,
        CELEBRATION_EQUIP_SERVER_RANK = 36,
        CELEBRATION_GEM_FULL_RANK = 37,
        CELEBRATION_GEM_SERVER_RANK = 38,
        CELEBRATION_TELENT_FULL_RANK = 39,
        CELEBRATION_TELENT_SERVER_RANK = 40,
        CELEBRATION_ARMY_FULL_RANK = 41,
        CELEBRATION_ARMY_SERVER_RANK = 42,
        CELEBRATION_CHAPTER_STAR_FULL_RANK = 43,
        CELEBRATION_CHAPTER_STAR_SERVER_RANK = 44,
        CELEBRATION_GUARDS_LEVEL_FULL_RANK = 45,
        CELEBRATION_GUARDS_LEVEL_SERVER_RANK = 46,
        CELEBRATION_WALL_LEVEL_FULL_RANK = 47,
        CELEBRATION_WALL_LEVEL_SERVER_RANK = 48,
        CELEBRATION_LOCK_MONSTER_FULL_RANK = 49,
        CELEBRATION_LOCK_MONSTER_SERVER_RANK = 50,
        CELEBRATION_OATH_ALLIANCE_FULL_RANK = 51,
        CELEBRATION_OATH_ALLIANCE_SERVER_RANK = 52,
        SLG_CAMP_ROLE_HARM_RANK = 53
    }

    declare class CmdRecharge {
        id: Long;
        rewards?: (CmdGoods[]|null);
    }

    

    declare class CmdRechargeBroMsg {
        cmdRecharge: CmdRecharge;
    }

    

    declare class CmdRechargeGiftAct2Detail {
        curProcess: number;
        tlTakeProcess?: (number[]|null);
    }

    

    declare class CmdRechargeGiftAct3Detail {
        curProcess: number;
        tlTakeProcess?: (number[]|null);
    }

    

    declare class CmdRechargeGiftActDetail {
        curRechargeProcess: number;
        tlTakeRechargeProcess?: (number[]|null);
    }

    

    declare class CmdRecordClientAniReqMsg {
        clientAniRefId: number;
    }

    

    declare class CmdRecordClientAniRspMsg {
    }

    

    declare class CmdRedDotCache {
        nextRefreshTime?: (Long|null);
        number: number;
        redDotType: CmdRedDotType;
    }

    

    declare class CmdRedDotCache_Key {
        redDotType: CmdRedDotType;
    }

    

    declare enum CmdRedDotType {
        TEST = 1,
        MAil = 2,
        continuity_days = 3,
        GEM_COMPOSE = 4,
        SEVEN_DAY = 5,
        limit_time_activity = 6,
        signin = 7,
        SPIRIT_ANIMAL_BOX = 8,
        FIRST_RECHARGE = 9
    }

    declare class CmdRole {
        battleSpiritAnimalUniqueId?: (Long|null);
        cmdFirstRechargeInfo: CmdFirstRechargeInfo;
        coin: string;
        createTime: Long;
        end: number;
        endMax: number;
        exp: number;
        freeRenameCount: number;
        gem: string;
        gold: string;
        headFrame: Long;
        id: Long;
        img: Long;
        internal: number;
        lv: number;
        maxBattleLevelPassTime?: (Long|null);
        miningProcess: number;
        miningShow: boolean;
        name: string;
        nextEndRecoverTime: Long;
        platformImg: string;
        recharge: number;
        region?: (string|null);
        selectEquipPage: number;
        selectServerId?: (number|null);
        spiritAnimalAtkAdd?: (number|null);
        sweepTimes: number;
        tlCmdAdvert?: (CmdAdvert[]|null);
        tlCmdAppletInfo?: (CmdAppletInfo[]|null);
        tlExtraId?: (number[]|null);
        washStone: number;
        showAdvisorId?: (number|null);
        selectAdvisorPage?: (number|null);
        selectGeneralPage?: (number|null);
        takeFriendEndCount?: (number|null);
        sendFriendEndCount?: (number|null);
        lastGranaryGenTime?: (Long|null);
        firstPassRewardMaxLevel?: (number|null);
        lastIdleRewardTime?: (Long|null);
        unionCoin: number;
        unionGold: number;
        unionContribute: number;
        enterLockMonsterCount: number;
        enterGuardsJianGeCount: number;
        usedSkinResId?: (Long|null);
        jianGeCoin?: (number|null);
        activityCoin?: (number|null);
        lastLoginTime?: (Long|null);
        sgeyCoin?: (number|null);
        chhjCoin?: (number|null);
        dcjxCoin?: (number|null);
        hyxtCoin?: (number|null);
    }

    

    declare class CmdRoleAppletShareReqMsg {
    }

    

    declare class CmdRoleAppletShareRewardReqMsg {
    }

    

    declare class CmdRoleAppletShareRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdRoleAppletShareRspMsg {
    }

    

    declare class CmdRoleChangeHeadFrameReqMsg {
        resId: Long;
    }

    

    declare class CmdRoleChangeHeadFrameRspMsg {
    }

    

    declare class CmdRoleChangeImgReqMsg {
        resId: Long;
    }

    

    declare class CmdRoleChangeImgRspMsg {
    }

    

    declare class CmdRoleChangeNameReqMsg {
        name: string;
    }

    

    declare class CmdRoleChangeNameRspMsg {
    }

    

    declare class CmdRoleDouYinRewardReqMsg {
    }

    

    declare class CmdRoleDouYinRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdRoleEndBuyInfo {
        buyId: number;
        number: number;
    }

    

    declare class CmdRoleEndUpdateReqMsg {
    }

    

    declare class CmdRoleEndUpdateRspMsg {
    }

    

    declare class CmdRoleGuanKaGiftBuyReqMsg {
        resId: number;
    }

    

    declare class CmdRoleGuanKaGiftBuyRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdRoleGuanKaGiftSelectReqMsg {
        gemId: number;
        resId: number;
    }

    

    declare class CmdRoleGuanKaGiftSelectRspMsg {
    }

    

    declare class CmdRoleInfoViewReqMsg {
        roleId: Long;
        serverId: number;
    }

    

    declare class CmdArmyShow {
        id: number;
        star: number;
    }

    

    declare class CmdArmyShowList {
        tlShow?: (CmdArmyShow[]|null);
    }

    

    declare class CmdEquipLook {
        equipId: number;
        level: number;
        tlCmdGem?: (CmdGem[]|null);
        tlCmdGemInfo?: (CmdGemInfo[]|null);
    }

    

    declare class CmdRoleInfoViewRspMsg {
        roleId?: (Long|null);
        roleName?: (string|null);
        img?: (Long|null);
        platformImg?: (string|null);
        headFrame?: (Long|null);
        level?: (number|null);
        tlCmdEquip?: (CmdEquipLook[]|null);
        skinId?: (number|null);
        power?: (number|null);
        battleLevel?: (number|null);
        tlArmySkin?: (CmdArmyShowList|null);
        tlGeneral?: (CmdArmyShowList|null);
        tlAdvisor?: (CmdArmyShowList|null);
        selectServerId?: (number|null);
        tlEquipPart?: (CmdEquipPart[]|null);
        unionInfo?: (CmdUnionShow|null);
    }

    

    declare class CmdRoleLoginReqMsg {
        cmdClientInfo: CmdClientInfo;
        code: string;
        img?: (string|null);
        openid?: (string|null);
        platform: number;
        reconnect?: (boolean|null);
        roleId: Long;
        selectServerId?: (number|null);
        time: Long;
        token: string;
    }

    

    declare class CmdRoleLoginRspMsg {
        cmdBattleData?: (CmdBattleData|null);
        loginStatus: LoginStatus;
        newRole?: (boolean|null);
    }

    

    declare class CmdRoleOfflineBroMsg {
        type: number;
    }

    

    declare class CmdRoleTakeFirstChargeReqMsg {
    }

    

    declare class CmdRoleTakeFirstChargeRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdRoleUploadPlatformImgReqMsg {
        platformImg: string;
    }

    

    declare class CmdRoleUploadPlatformImgRspMsg {
    }

    

    declare class CmdRoleWatchAdvertReqMsg {
        type: number;
        id?: (number|null);
    }

    

    declare class CmdRoleWatchAdvertRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
        tlId?: (number[]|null);
    }

    

    declare class CmdRole_Key {
    }

    

    declare class CmdRoll {
        content: string;
        time: Long;
    }

    

    declare class CmdRollBroMsg {
        cmdRoll: CmdRoll;
    }

    

    declare class CmdRune {
        id: Long;
        isNew: boolean;
        isPutOn: boolean;
        phase: number;
        quality: number;
        resId: Long;
    }

    

    declare class CmdRunePutOnReqMsg {
        area: number;
        id: Long;
    }

    

    declare class CmdRunePutOnRspMsg {
    }

    

    declare class CmdRuneReplaceReqMsg {
        id: Long;
        replaceId: Long;
    }

    

    declare class CmdRuneReplaceRspMsg {
    }

    

    declare class CmdRuneSynthesisOneKeyReqMsg {
    }

    

    declare class CmdRuneSynthesisOneKeyRspMsg {
        id?: (Long[]|null);
    }

    

    declare class CmdRuneSynthesisReqMsg {
        nid?: (Long[]|null);
        phase: number;
        quality: number;
        resId: Long;
    }

    

    declare class CmdRuneSynthesisRspMsg {
    }

    

    declare class CmdRuneTakeOffReqMsg {
        area: number;
        id: Long;
    }

    

    declare class CmdRuneTakeOffRspMsg {
    }

    

    declare class CmdRune_Key {
        id: Long;
    }

    

    declare class CmdSecretRealm {
        endTime: Long;
        level: number;
        roleId: Long;
        secretRealmScore?: (CmdSecretRealmScore[]|null);
        type: number;
    }

    

    declare class CmdSecretRealmScore {
        level: number;
        type: number;
    }

    

    declare class CmdSecretRealm_Key {
        roleId: Long;
    }

    

    declare class CmdSevenDayInfo {
        cmdSevenDayPoint: CmdSevenDayPoint;
        tlCmdSevenDayShop?: (CmdSevenDayShop[]|null);
        tlCmdTask?: (CmdTask[]|null);
    }

    

    declare class CmdSevenDayInfoReqMsg {
    }

    

    declare class CmdSevenDayInfoRspMsg {
        cmdSevenDayInfo: CmdSevenDayInfo;
    }

    

    declare class CmdSevenDayPoint {
        point: number;
        tlIds?: (number[]|null);
    }

    

    declare class CmdSevenDayShop {
        buyTimes: number;
        id: number;
    }

    

    declare class CmdSevenDayShopBuyReqMsg {
        id: number;
    }

    

    declare class CmdSevenDayShopBuyRspMsg {
        cmdSevenDayInfo?: (CmdSevenDayInfo|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdSevenDayTakePointRewardReqMsg {
        resId: number;
    }

    

    declare class CmdSevenDayTakePointRewardRspMsg {
        cmdSevenDayInfo?: (CmdSevenDayInfo|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdSevenDayTakeTaskRewardReqMsg {
        day: number;
    }

    

    declare class CmdSevenDayTakeTaskRewardRspMsg {
        cmdSevenDayInfo?: (CmdSevenDayInfo|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdShare {
    }

    

    declare class CmdShareGetRewardReqMsg {
    }

    

    declare class CmdShareGetRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdShareStateReqMsg {
    }

    

    declare class CmdShareStateRspMsg {
        rewardState: number;
        shareState: number;
    }

    

    declare class CmdShare_Key {
        id: Long;
    }

    

    declare class CmdShop {
        cmdShopType: CmdShopType;
        tlCmdShopGoods?: (CmdShopGoods[]|null);
    }

    

    declare class CmdShopBuyReqMsg {
        id: number;
        cmdShopType: CmdShopType;
        buyTimes?: (number|null);
        tlGoodReplace?: (CmdGoodReplace[]|null);
        openResId?: (number|null);
    }

    

    declare class CmdShopBuyRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdShopGoods {
        alreadyTakeBox?: (number[]|null);
        boxProcess?: (number|null);
        buyTimes: number;
        id: number;
        nextBuyTime?: (Long|null);
        nextTime?: (number|null);
        nextTime50?: (number|null);
    }

    

    declare enum CmdShopType {
        box = 1,
        resource = 2,
        diamond = 3,
        gold = 4,
        gift = 5,
        spiritAnimal = 6,
        chapter = 7,
        union = 8,
        god = 9,
        jianGe = 10,
        lottery = 11,
        lotteryChange1 = 12,
        lotteryChange2 = 13,
        lotteryChange3 = 14,
        lotteryChange4 = 15
    }

    declare class CmdShop_Key {
        cmdShopType: CmdShopType;
    }

    

    declare class CmdSigninInfo {
        boxTlCmdTask?: (CmdTask[]|null);
        day: number;
        round: number;
        tlCmdTask?: (CmdTask[]|null);
        type: number;
    }

    

    declare class CmdSigninInfoReqMsg {
    }

    

    declare class CmdSigninInfoRspMsg {
        cmdSigninInfo: CmdSigninInfo;
    }

    

    declare class CmdSigninTakeTaskRewardReqMsg {
        resId: number;
    }

    

    declare class CmdSigninTakeTaskRewardRspMsg {
        cmdSigninInfo?: (CmdSigninInfo|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdSkin {
        resId: Long;
        used?: (boolean|null);
    }

    

    declare class CmdSkinActDetail {
        alreadyBuy: boolean;
        price: number;
        skinResId: Long;
    }

    

    declare class CmdSkinPlayer {
        tlCmdSkinShop?: (CmdSkinShop[]|null);
    }

    

    declare class CmdSkinShop {
        buy: boolean;
        id: number;
    }

    

    declare class CmdSkin_Key {
        resId: Long;
    }

    

    declare class CmdSpecialGiftCache {
        endTime: Long;
        resId: Long;
        state: CmdCommonState;
    }

    

    declare class CmdSpecialGiftCache_Key {
        resId: Long;
    }

    

    declare class CmdSpiritAnimal {
        level: number;
        resId: Long;
        uniqueId: Long;
    }

    

    declare class CmdSpiritAnimalBattleReqMsg {
        uniqueId: Long;
    }

    

    declare class CmdSpiritAnimalBattleRspMsg {
    }

    

    declare class CmdSpiritAnimalData {
        tlCmdBattleAttr?: (CmdBattleAttr[]|null);
        tlCmdBattleBuff?: (CmdBattleBuff[]|null);
        tlSkillId?: (number[]|null);
    }

    

    declare class CmdSpiritAnimalLevelUpReqMsg {
        uniqueId: Long;
    }

    

    declare class CmdSpiritAnimalLevelUpRspMsg {
    }

    

    declare class CmdSpiritAnimalResetPreviewReqMsg {
        uniqueId: Long;
    }

    

    declare class CmdSpiritAnimalResetPreviewRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdSpiritAnimalResetReqMsg {
        uniqueId: Long;
    }

    

    declare class CmdSpiritAnimalResetRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdSpiritAnimalStepUpReqMsg {
        tlCampUniqueId?: (Long[]|null);
        tlSameUniqueId?: (Long[]|null);
        uniqueId: Long;
    }

    

    declare class CmdSpiritAnimalStepUpRspMsg {
    }

    

    declare class CmdSpiritAnimal_Key {
        uniqueId: Long;
    }

    

    declare class CmdSystemGmReqMsg {
        cmd: string;
    }

    

    declare class CmdSystemGmRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdSystemSyncTimeReqMsg {
    }

    

    declare class CmdSystemSyncTimeRspMsg {
        serverTime: Long;
    }

    

    declare class CmdTakeChapterRewardReqMsg {
        chapter: number;
    }

    

    declare class CmdTakeChapterRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdTakeDayChallengeActRewardReqMsg {
        resId: number;
        taskResId: number;
    }

    

    declare class CmdTakeDayChallengeActRewardRspMsg {
        tlReward?: (CmdGoods[]|null);
    }

    

    declare class CmdTakeGameCircleRewardReqMsg {
    }

    

    declare class CmdTakeGameCircleRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdTakeLockMonsterBoxReqMsg {
    }

    

    declare class CmdTakeLockMonsterBoxRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdLockMonsterSweepReqMsg {
    }

    

    declare class CmdLockMonsterSweepRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdTakeMonthCardActRewardReqMsg {
        resId: number;
    }

    

    declare class CmdTakeMonthCardActRewardRspMsg {
        tlReward?: (CmdGoods[]|null);
    }

    

    declare class CmdTakeRechargeGiftActRewardReqMsg {
        rechargeProcess: number;
        resId: number;
    }

    

    declare class CmdTakeRechargeGiftActRewardRspMsg {
        tlReward?: (CmdGoods[]|null);
    }

    

    declare class CmdTakeSpiritAnimalBoxReqMsg {
        id: number;
        resId: Long;
        takeProcess: number;
    }

    

    declare class CmdTakeSpiritAnimalBoxRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdTask {
        count: Long;
        resId: number;
        rewardState: CmdCommonState;
    }

    

    declare enum CmdTaskType {
        ACT_DAY_CHALLENGE_TASK = 1,
        SEVEN_DAY_TASK = 2,
        LIMIT_TIME_TASK = 3,
        SIGN_IN_TASK = 4,
        MAIN_TASK = 5,
        UNION_TASK = 6,
        TURNTABLE_LOTTERY_TASK = 7
    }

    declare class CmdTask_Key {
        resId: number;
    }

    

    declare class CmdTips {
        content: string;
    }

    

    declare class CmdUpdateRedDotReqMsg {
        redDotType: CmdRedDotType;
    }

    

    declare class CmdUpdateRedDotRspMsg {
    }

    

    declare class EveryDayGift {
        buyCount: number;
        fromId: number;
        giftId: Long;
        rewards?: (CmdGoods[]|null);
    }

    

    declare class EveryDaySignInReward {
        day: number;
        state: number;
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare enum LoginStatus {
        BAN = 3,
        SUCCESS = 1,
        WEI_HU = 2
    }

    declare class CmdCommonRole {
        roleId: Long;
        name: string;
        img: Long;
        headFrame: Long;
        platformImg: string;
        level: number;
        power: Long;
        serverId: number;
        selectServerId: number;
        titleId: number;
        usedSkinResId: Long;
    }

    

    declare class CmdCommonRole_Key {
        id: Long;
    }

    

    declare class CmdBattleRoleAttr {
        roleId: Long;
        attrKeys?: (string[]|null);
        attrValues?: (number[]|null);
        cards?: (number[]|null);
        modifyList?: (number[]|null);
    }

    

    declare class CmdBattleRoleAttrList {
        attrList?: (CmdBattleRoleAttr[]|null);
    }

    

    declare class CmdTeamDetail {
        teamId: Long;
        leaderId: Long;
        battleType: number;
        battleId: number;
        memberList?: (CmdCommonRole[]|null);
        attrList?: (CmdBattleRoleAttr[]|null);
    }

    

    declare class CmdInviteInfo {
        invite: CmdCommonRole;
        battleType: number;
        battleId: number;
    }

    

    declare class CmdRecruitInfo {
        roleId: Long;
        battleType: number;
        battleId: number;
        name: string;
        img: Long;
        headFrame: Long;
        platformImg: string;
        level: number;
        power: number;
        serverId: number;
        selectServerId: number;
        titleId: number;
        textId: number;
        sendTime: Long;
    }

    

    declare class CmdRecruitInfoList {
        recruitList?: (CmdRecruitInfo[]|null);
    }

    

    declare class CmdTeamInitReqMsg {
    }

    

    declare class CmdTeamInitRspMsg {
        info?: (CmdTeamDetail|null);
    }

    

    declare class CmdTeamCreateReqMsg {
        battleType: number;
        battleId: number;
        attr: CmdBattleRoleAttr;
    }

    

    declare class CmdTeamCreateRspMsg {
        ret?: (number|null);
    }

    

    declare class CmdTeamDetailBroMsg {
        info?: (CmdTeamDetail|null);
        randomNum?: (number|null);
    }

    

    declare class CmdTeamDisbandBroMsg {
    }

    

    declare class CmdTeamInviteReqMsg {
        targetId: Long;
        battleType: number;
        battleId: number;
        attr: CmdBattleRoleAttr;
    }

    

    declare class CmdTeamInviteRspMsg {
        ret?: (number|null);
    }

    

    declare class CmdTeamInviteBroMsg {
        info?: (CmdInviteInfo|null);
    }

    

    declare class CmdTeamReplyInviteReqMsg {
        inviteId: Long;
        agree?: (boolean|null);
        attr?: (CmdBattleRoleAttr|null);
    }

    

    declare class CmdTeamReplyInviteRspMsg {
        ret?: (number|null);
    }

    

    declare class CmdTeamReplyInviteBroMsg {
        roleId: Long;
        name?: (string|null);
        agree?: (boolean|null);
    }

    

    declare class CmdTeamQuitReqMsg {
    }

    

    declare class CmdTeamQuitRspMsg {
        ret?: (number|null);
    }

    

    declare class CmdTeamKickReqMsg {
        targetId: Long;
    }

    

    declare class CmdTeamKickRspMsg {
        ret?: (number|null);
    }

    

    declare class CmdTeamRecruitInitReqMsg {
    }

    

    declare class CmdTeamRecruitInitRspMsg {
        infoList?: (CmdRecruitInfoList|null);
    }

    

    declare class CmdTeamRecruitSendReqMsg {
        battleType: number;
        battleId: number;
        attr?: (CmdBattleRoleAttr|null);
    }

    

    declare class CmdTeamRecruitSendRspMsg {
        ret?: (number|null);
    }

    

    declare class CmdTeamRecruitSendBroMsg {
        info: CmdRecruitInfo;
    }

    

    declare class CmdTeamRecruitJoinReqMsg {
        roleId: Long;
        attr: CmdBattleRoleAttr;
    }

    

    declare class CmdTeamRecruitJoinRspMsg {
        ret?: (number|null);
    }

    

    declare class CmdTeamKickBroMsg {
    }

    

    declare class CmdBattleTeamEnterReqMsg {
    }

    

    declare class CmdBattleTeamEnterRspMsg {
        ret?: (number|null);
    }

    

    declare class CmdBattleTeamEnterBroMsg {
    }

    

    declare class CmdBattleTeamUpdateReqMsg {
        type: number;
        value?: (number[]|null);
        frame: number;
        number: number;
    }

    

    declare class CmdBattleTeamUpdateRspMsg {
        ret?: (number|null);
    }

    

    declare class CmdBattleTeamUpdateBroMsg {
        type: number;
        value?: (number[]|null);
        frame: number;
        number: number;
        sendId: Long;
    }

    

    declare class CmdArmyLevel {
        armyId: number;
        level: number;
    }

    

    declare class CmdArmyLevel_Key {
        armyId: number;
    }

    

    declare class CmdArmySkinSelect {
        armyId: number;
        skinId: number;
    }

    

    declare class CmdArmySkinSelect_Key {
        armyId: number;
    }

    

    declare class CmdArmySkinStar {
        skinId: number;
        star: number;
    }

    

    declare class CmdArmySkinStar_Key {
        skinId: number;
    }

    

    declare class CmdAdvisor {
        advisorId: number;
        star: number;
    }

    

    declare class CmdAdvisor_Key {
        advisorId: number;
    }

    

    declare class CmdAdvisorPage {
        PageId: number;
        advisorList?: (number[]|null);
    }

    

    declare class CmdAdvisorPage_Key {
        PageId: number;
    }

    

    declare class CmdGeneral {
        generalId: number;
        star: number;
    }

    

    declare class CmdGeneral_Key {
        generalId: number;
    }

    

    declare class CmdGeneralPage {
        PageId: number;
        generalList?: (number[]|null);
    }

    

    declare class CmdGeneralPage_Key {
        PageId: number;
    }

    

    declare class CmdArmyLevelUpReqMsg {
        armyId: number;
    }

    

    declare class CmdArmyLevelUpRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdArmySkinAddStarReqMsg {
        skinId: number;
    }

    

    declare class CmdArmySkinAddStarRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdArmySelectSkinReqMsg {
        armyId: number;
        skinId: number;
    }

    

    declare class CmdArmySelectSkinRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdAdvisorAddStarReqMsg {
        advisorId: number;
    }

    

    declare class CmdAdvisorAddStarRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdAdvisorSelectPageReqMsg {
        pageId: number;
    }

    

    declare class CmdAdvisorSelectPageRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdAdvisorBattleReqMsg {
        pageId: number;
        index: number;
        advisorId: number;
    }

    

    declare class CmdAdvisorBattleRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdAdvisorShowReqMsg {
        advisorId: number;
    }

    

    declare class CmdAdvisorShowRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdGeneralAddStarReqMsg {
        generalId: number;
    }

    

    declare class CmdGeneralAddStarRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdGeneralSelectPageReqMsg {
        pageId: number;
    }

    

    declare class CmdGeneralSelectPageRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdGeneralBattleReqMsg {
        pageId: number;
        index: number;
        generalId: number;
    }

    

    declare class CmdGeneralBattleRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdFriend {
        friendId: Long;
        name: string;
        level: number;
        title: number;
        img: Long;
        headFrame: Long;
        power: Long;
        serverId: number;
        selectServerId: number;
        online?: (boolean|null);
        lastOfflineTime?: (Long|null);
        todaySend?: (boolean|null);
        todayReceive?: (boolean|null);
        todayTake?: (boolean|null);
    }

    

    declare class CmdFriend_Key {
        friendId: Long;
    }

    

    declare class CmdFriendApply {
        friendId: Long;
        name: string;
        level: number;
        title: number;
        img: Long;
        headFrame: Long;
        power: Long;
        selectServerId: number;
        serverId: number;
    }

    

    declare class CmdFriendApply_Key {
        friendId: Long;
    }

    

    declare class CmdFriendBlack {
        friendId: Long;
        name: string;
        level: number;
        title: number;
        img: Long;
        headFrame: Long;
        power: Long;
        selectServerId: number;
        serverId: number;
    }

    

    declare class CmdFriendBlack_Key {
        friendId: Long;
    }

    

    declare class CmdFriendsApplyReqMsg {
        targetId: Long;
    }

    

    declare class CmdFriendsApplyRspMsg {
        targetId?: (Long|null);
    }

    

    declare class CmdFriendsApplyBroMsg {
        apply: CmdFriendApply;
    }

    

    declare class CmdFriendsAddReqMsg {
        targetId?: (Long|null);
    }

    

    declare class CmdFriendsAddRspMsg {
    }

    

    declare class CmdFriendsAddBroMsg {
        friend: CmdFriend;
    }

    

    declare class CmdFriendsRefuseReqMsg {
        targetId: Long;
    }

    

    declare class CmdFriendsRefuseRspMsg {
    }

    

    declare class CmdFriendsRefuseBroMsg {
        targetId: Long;
        name: string;
    }

    

    declare class CmdFriendsRemoveReqMsg {
        targetId?: (Long[]|null);
    }

    

    declare class CmdFriendsRemoveRspMsg {
        targetId?: (Long[]|null);
    }

    

    declare class CmdFriendsRemoveBroMsg {
        targetId: Long;
    }

    

    declare class CmdFriendsBlackReqMsg {
        targetId: Long;
    }

    

    declare class CmdFriendsBlackRspMsg {
    }

    

    declare class CmdFriendBlackRemoveReqMsg {
        targetId: Long;
    }

    

    declare class CmdFriendBlackRemoveRspMsg {
        targetId?: (Long|null);
    }

    

    declare class CmdFriendsSearchReqMsg {
        targetId?: (Long|null);
        targetName?: (string|null);
    }

    

    declare class CmdFriendsSearchRspMsg {
        friend?: (CmdFriend|null);
    }

    

    declare class CmdFriendGetEndReqMsg {
        targetId: Long;
    }

    

    declare class CmdFriendGetEndRspMsg {
        friend?: (CmdFriend|null);
    }

    

    declare class CmdFriendGetEndOneKeyReqMsg {
    }

    

    declare class CmdFriendGetEndOneKeyRspMsg {
        friendList?: (CmdFriend[]|null);
    }

    

    declare class CmdFriendSendEndReqMsg {
        targetId: Long;
    }

    

    declare class CmdFriendSendEndRspMsg {
        friend?: (CmdFriend|null);
    }

    

    declare class CmdFriendSendEndBroMsg {
        friend: CmdFriend;
    }

    

    declare class CmdFriendSendEndOneKeyReqMsg {
    }

    

    declare class CmdFriendSendEndOneKeyRspMsg {
        friendList?: (CmdFriend[]|null);
    }

    

    declare class CmdFriendSendEndOneKeyBroMsg {
    }

    

    declare class CmdFriendAgreeOneKeyReqMsg {
    }

    

    declare class CmdFriendAgreeOneKeyRspMsg {
    }

    

    declare class CmdFriendAgreeOneKeyBroMsg {
    }

    

    declare class CmdFriendRefuseOneKeyReqMsg {
    }

    

    declare class CmdFriendRefuseOneKeyRspMsg {
    }

    

    declare class CmdFriendRefuseOneKeyBroMsg {
    }

    

    declare class CmdFriendRefreshSuggestReqMsg {
    }

    

    declare class CmdFriendRefreshSuggestRspMsg {
        suggestList?: (CmdFriend[]|null);
    }

    

    declare enum ChatChannelType {
        CHAT_CHANNEL_RECRUIT = 0,
        CHAT_CHANNEL_THEATER = 1,
        CHAT_CHANNEL_WORLD = 2,
        CHAT_CHANNEL_PRIVATE = 3,
        CHAT_CHANNEL_UNION = 4
    }

    declare class CmdChatRole {
        roleId: Long;
        name: string;
        img: Long;
        headFrame: Long;
        platformImg: string;
        level: number;
        power: Long;
        serverId: number;
        selectServerId: number;
        titleId: number;
        lastOfflineTime: Long;
    }

    

    declare class CmdChatRole_Key {
        roleId: Long;
    }

    

    declare class CmdChatMsgClient {
        chatId: Long;
        speaker: CmdChatRole;
        sendTime: Long;
        content: string;
    }

    

    declare class CmdChatMsg {
        chatId: Long;
        sendId: Long;
        recvId: Long;
        sendTime: Long;
        content: string;
    }

    

    declare class CmdChatMsg_Key {
        chatId: Long;
    }

    

    declare class CmdChatInitReqMsg {
        channel: number;
        id?: (Long|null);
        page: number;
    }

    

    declare class CmdChatInitRspMsg {
        ret?: (number|null);
        channel?: (number|null);
        id?: (Long|null);
        page?: (number|null);
        list?: (CmdChatMsgClient[]|null);
    }

    

    declare class CmdChatSendReqMsg {
        channel: number;
        id?: (Long|null);
        content: string;
    }

    

    declare class CmdChatSendRspMsg {
        ret?: (number|null);
    }

    

    declare class CmdChatBroMsg {
        channel: number;
        id: Long;
        content: CmdChatMsgClient;
    }

    

    declare class CmdChatDelTargetReqMsg {
        id: Long;
    }

    

    declare class CmdChatDelTargetRspMsg {
        id: Long;
    }

    

    declare class CmdGranary {
        id: Long;
        genTime: Long;
        outTime: Long;
    }

    

    declare class CmdGranary_Key {
        id: Long;
    }

    

    declare class CmdGranaryGetReqMsg {
        id: Long;
    }

    

    declare class CmdGranaryGetRspMsg {
        ret: boolean;
        id: Long;
    }

    

    declare class CmdGranaryGetOneKeyReqMsg {
    }

    

    declare class CmdGranaryGetOneKeyRspMsg {
        id?: (Long[]|null);
    }

    

    declare class CmdGranaryUpdateBroMsg {
        granarys: CmdGranary;
    }

    

    declare class CmdGetChapterFirstPassListReqMsg {
    }

    

    declare class CmdGetChapterFirstPassListRspMsg {
        tlCmdInfos?: (CmdChapterFirstPassInfo[]|null);
    }

    

    declare class CmdGetChapterFirstPassRewardReqMsg {
    }

    

    declare class CmdGetChapterFirstPassRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdMonsterManualItem {
        monsterId: number;
        activeState: boolean;
        rewardState: boolean;
    }

    

    declare class CmdMonsterManualItem_Key {
        monsterId: number;
    }

    

    declare class CmdMonsterManualActiveBroMsg {
        tlCmdItems?: (CmdMonsterManualItem[]|null);
    }

    

    declare class CmdMonsterManualGetRewardReqMsg {
        monsterId?: (number|null);
    }

    

    declare class CmdMonsterManualGetRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdTakeMainTaskRewardReqMsg {
        resId: number;
    }

    

    declare class CmdTakeMainTaskRewardRspMsg {
        ret?: (boolean|null);
        resId?: (number|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdTaskUnionGetRewardReqMsg {
        resId: number;
    }

    

    declare class CmdTaskUnionGetRewardRspMsg {
        ret?: (boolean|null);
        resId?: (number|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdTaskUnionGetProgressRewardReqMsg {
        subType: number;
    }

    

    declare class CmdTaskUnionGetProgressRewardRspMsg {
        ret?: (boolean|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare enum CmdUnionState {
        FORMAL = 1,
        DISBAND = 2
    }

    declare enum CmdUnionEditType {
        NAME = 1,
        VXCHAT = 2,
        NOTICE = 3,
        DECLARATION = 4
    }

    declare enum CmdUnionJoinState {
        QUIT = 0,
        JOIN = 1
    }

    declare enum CmdUnionPosition {
        LEADER = 1,
        DEPUTY = 2,
        MEMBER = 3
    }

    declare class CmdUnion {
        id: Long;
        exp: number;
        level: number;
        icon: number;
        count: number;
        maxCount: number;
        autoJoin: boolean;
        name: string;
        leaderId: Long;
        leaderName: string;
        notice: string;
        declaration: string;
        wxChat: string;
        serverId: number;
        selectServerId: number;
        state: Long;
    }

    

    declare class CmdUnion_Key {
        id: Long;
    }

    

    declare class CmdUnionSimple {
        id: Long;
        icon: number;
        level: number;
        count: number;
        maxCount: number;
        leaderId: Long;
        name: string;
        leaderName: string;
        serverId: number;
        selectServerId: number;
        state: Long;
    }

    

    declare class CmdUnionSimple_Key {
        id: Long;
    }

    

    declare class CmdUnionMember {
        roleId: Long;
        name: string;
        img: Long;
        headFrame: Long;
        level: number;
        power: Long;
        serverId: number;
        selectServerId: number;
        titleId: number;
        position: number;
        online: boolean;
        lastOfflineTime: Long;
        todayContribute: number;
        allContribute: number;
    }

    

    declare class CmdUnionMember_Key {
        roleId: Long;
    }

    

    declare class CmdUnionApplys {
        applyId: Long;
        name: string;
        level: number;
        title: number;
        img: Long;
        headFrame: Long;
        power: Long;
        serverId: number;
        selectServerId: number;
    }

    

    declare class CmdUnionApplys_Key {
        applyId: Long;
    }

    

    declare class CmdUnionLogs {
        id: Long;
        name: string;
        join: number;
        time: Long;
        opPosition: number;
        opName: string;
    }

    

    declare class CmdUnionLogs_Key {
        id: Long;
    }

    

    declare class CmdRoleUnion {
        roleId: Long;
        unionId: Long;
        lastQuitTime: Long;
        serverId: number;
        selectServerId: number;
        todayDonateTimes: number;
        todayDonateAdvTimes: number;
        todayTaskAdvTimes: number;
        todayTaskGetProgressCount: number;
        todayExchangeTimes: number;
        todayBargainTimes: number;
        todayBuyBargainTimes: number;
        todayDrumTimes: number;
    }

    

    declare class CmdRoleUnion_Key {
        roleId: Long;
    }

    

    declare class CmdUnionShow {
        id: Long;
        icon: number;
        level: number;
        name: string;
    }

    

    declare class CmdUnionCreateReqMsg {
        icon: number;
        name: string;
        quick: boolean;
    }

    

    declare class CmdUnionCreateRspMsg {
        ret?: (boolean|null);
        union?: (CmdUnion|null);
    }

    

    declare class CmdUnionJoinReqMsg {
        unionIds?: (Long[]|null);
    }

    

    declare class CmdUnionJoinRspMsg {
        ret?: (boolean|null);
        unionIds?: (Long[]|null);
    }

    

    declare class CmdUnionApproveJoinReqMsg {
        reqId: Long;
        agree: boolean;
    }

    

    declare class CmdUnionApproveJoinRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdUnionApproveJoinOneKeyReqMsg {
        agree: boolean;
    }

    

    declare class CmdUnionApproveJoinOneKeyRspMsg {
    }

    

    declare class CmdUnionQuitReqMsg {
    }

    

    declare class CmdUnionQuitRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdUnionKickReqMsg {
        memberId: Long;
    }

    

    declare class CmdUnionKickRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdUnionAppointReqMsg {
        memberId: Long;
        officialId: number;
        type: boolean;
    }

    

    declare class CmdUnionAppointRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdUnionSetQuickJoinReqMsg {
        quick: boolean;
    }

    

    declare class CmdUnionSetQuickJoinRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdUnionEditReqMsg {
        type: number;
        content: string;
    }

    

    declare class CmdUnionEditRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdUnionDetailReqMsg {
    }

    

    declare class CmdUnionDetailRspMsg {
    }

    

    declare class CmdUnionApplyListReqMsg {
    }

    

    declare class CmdUnionApplyListRspMsg {
    }

    

    declare class CmdUnionLogReqMsg {
    }

    

    declare class CmdUnionLogRspMsg {
    }

    

    declare class CmdUnionListReqMsg {
    }

    

    declare class CmdUnionListRspMsg {
    }

    

    declare class CmdUnionSearchReqMsg {
        id: Long;
    }

    

    declare class CmdUnionSearchRspMsg {
        ret?: (boolean|null);
        union?: (CmdUnion|null);
    }

    

    declare class CmdUnionDonateReqMsg {
        adv: boolean;
    }

    

    declare class CmdUnionDonateRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdUnionApproveJoinBroMsg {
        agree?: (boolean|null);
    }

    

    declare class CmdUnionInfoUpdateBroMsg {
    }

    

    declare class CmdUnionMemberListUpdateBroMsg {
    }

    

    declare class CmdUnionApplyListUpdateBroMsg {
    }

    

    declare class CmdUnionLogListUpdateBroMsg {
    }

    

    declare class CmdUnionListUpdateBroMsg {
    }

    

    declare class CmdUnionTaskListUpdateBroMsg {
    }

    

    declare enum CmdUnionActType {
        BARGAIN = 1,
        NORTH_EXPEDITION = 2
    }

    declare class CmdUnionActInfo {
        roleId: Long;
        times: number;
        value: Long;
    }

    

    declare class CmdUnionActivity {
        unionId: Long;
        type: number;
        tlCmdUnionActInfo?: (CmdUnionActInfo[]|null);
        resetTime: Long;
        id: number;
        addBuffTimes: number;
        addBuffTime: Long;
        allValue: Long;
    }

    

    declare class CmdUnionActivity_Key {
        unionId: Long;
    }

    

    declare class CmdRoleActBossDamage {
        roleId: Long;
        bossId: number;
        damage: Long;
    }

    

    declare class CmdRoleActBossDamage_Key {
        roleId: Long;
    }

    

    declare class CmdUnionActBossDamage {
        unionId: Long;
        bossId: number;
        damage: Long;
    }

    

    declare class CmdUnionActBossDamage_Key {
        unionId: Long;
    }

    

    declare class CmdUnionBargainReqMsg {
        buy: boolean;
    }

    

    declare class CmdUnionBargainRspMsg {
        ret?: (boolean|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdUnionActListReqMsg {
        type: number;
    }

    

    declare class CmdUnionActListRspMsg {
    }

    

    declare class CmdUnionActDrumReqMsg {
        type: number;
    }

    

    declare class CmdUnionActDrumRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdUnionActSweepReqMsg {
        type: number;
    }

    

    declare class CmdUnionActSweepRspMsg {
        ret?: (boolean|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdTakeOathAllianceRewardReqMsg {
    }

    

    declare class CmdTakeOathAllianceRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdBattleBuyBlessReqMsg {
        level: number;
    }

    

    declare class CmdBattleBuyBlessRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdBattleBuyBlessBroMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdCastleGuards {
        id: number;
        level: number;
        battle: number;
        curQuality: number;
    }

    

    declare class CmdCastleGuards_Key {
        id: number;
    }

    

    declare class CmdCastleGuardsActiveReqMsg {
        id: number;
    }

    

    declare class CmdCastleGuardsActiveRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdCastleGuardsActiveBroMsg {
        id: number;
    }

    

    declare class CmdCastleGuardsLevelUpReqMsg {
        id: number;
    }

    

    declare class CmdCastleGuardsLevelUpRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdCastleGuardsRankUpReqMsg {
        id: number;
    }

    

    declare class CmdCastleGuardsRankUpRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdCastleGuardsUpReqMsg {
        id: number;
        index: number;
    }

    

    declare class CmdCastleGuardsUpRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdFirstRecharge {
    }

    

    declare class CmdFirstRecharge_Key {
        id: Long;
    }

    

    declare class CmdFirstRechargeNewItem {
        id: number;
        active: boolean;
        activeTime: Long;
        takenIds?: (number[]|null);
    }

    

    declare class CmdFirstRechargeNew {
        infos?: (CmdFirstRechargeNewItem[]|null);
    }

    

    declare class CmdFirstRechargeNew_Key {
    }

    

    declare class CmdFirstRechargeOpenReqMsg {
    }

    

    declare class CmdFirstRechargeOpenRspMsg {
    }

    

    declare class CmdFirstRechargesBuyReqMsg {
        id: number;
    }

    

    declare class CmdFirstRechargesBuyRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdFirstRechargesBuyBroMsg {
    }

    

    declare class CmdFirstRechargeRewardReqMsg {
        id: number;
        day: number;
    }

    

    declare class CmdFirstRechargeRewardRspMsg {
        ret?: (boolean|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdRoleActDamage {
        roleId: Long;
        actType: number;
        id: number;
        resetTime: Long;
        times: number;
        damage: Long;
        maxDamage: Long;
    }

    

    declare class CmdRoleActDamage_Key {
        roleId: Long;
    }

    

    declare class CmdFuBenBuyTimesReqMsg {
        type: number;
    }

    

    declare class CmdFuBenBuyTimesRspMsg {
    }

    

    declare class CmdFuBenSweepReqMsg {
        type: number;
    }

    

    declare class CmdFuBenSweepRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare enum CmdBattleTokenType {
        battleToken_end = 1,
        battleToken_signIn = 2,
        battleToken_levelFund = 3,
        battleToken_pass = 4,
        battleToken_lottery1 = 5,
        battleToken_lottery2 = 6,
        battleToken_max = 7
    }

    declare class CmdBattleTokenMessage {
        open: boolean;
        resId: number;
        tlTakeLevel?: (number[]|null);
    }

    

    declare class CmdBattleToken {
        type: number;
        level: number;
        exp: number;
        tlBattleTokenMessage?: (CmdBattleTokenMessage[]|null);
        endTime: Long;
    }

    

    declare class CmdBattleToken_Key {
        type: number;
    }

    

    declare class CmdBattleTokenOpenReqMsg {
        resId: number;
    }

    

    declare class CmdBattleTokenOpenRspMsg {
        ret: boolean;
    }

    

    declare class CmdBattleTokenOpenBroMsg {
    }

    

    declare class CmdBattleTokenResetReqMsg {
    }

    

    declare class CmdBattleTokenResetRspMsg {
    }

    

    declare class CmdBattleTokenTakeRewardReqMsg {
        takeAll?: (boolean|null);
        resId?: (number|null);
        level?: (number|null);
        type?: (number|null);
    }

    

    declare class CmdBattleTokenTakeRewardRspMsg {
        tlReward?: (CmdGoods[]|null);
    }

    

    declare class CmdCardCache {
        resId: number;
        endTime: Long;
    }

    

    declare class CmdCardCache_Key {
        resId: number;
    }

    

    declare class CmdCardBuyReqMsg {
        res_Id: number;
    }

    

    declare class CmdCardBuyRspMsg {
        ret: boolean;
    }

    

    declare class CmdCardBuyBroMsg {
        tlRewards?: (CmdGoods[]|null);
    }

    

    declare class CmdRechargeDailyItem {
        id: number;
        day: number;
        accDay: number;
        takenIds?: (number[]|null);
        accTakenIds?: (number[]|null);
    }

    

    declare class CmdRechargeDaily {
        roleId: Long;
        rechargeCount: number;
        endTime: Long;
        infos?: (CmdRechargeDailyItem[]|null);
    }

    

    declare class CmdRechargeDaily_Key {
        roleId: Long;
    }

    

    declare class CmdRechargeDailyUpdateBroMsg {
    }

    

    declare class CmdRechargeDailyGetRewardReqMsg {
        id: number;
        day: number;
    }

    

    declare class CmdRechargeDailyGetRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdRechargeDailyGetAccRewardReqMsg {
        id: number;
        day: number;
    }

    

    declare class CmdRechargeDailyGetAccRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdTakeDayActProgressRewardReqMsg {
        resId: number;
        id: number;
    }

    

    declare class CmdTakeDayActProgressRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdLeaderSkillLevel {
        id: number;
        level: number;
    }

    

    declare class CmdLeaderSkill {
        roleId: Long;
        showId: number;
        tlBattles?: (number[]|null);
        tlLevels?: (CmdLeaderSkillLevel[]|null);
    }

    

    declare class CmdLeaderSkill_Key {
        roleId: Long;
    }

    

    declare class CmdLeaderSkillBattleReqMsg {
        idx: number;
        id: number;
    }

    

    declare class CmdLeaderSkillBattleRspMsg {
    }

    

    declare class CmdLeaderSkillShowReqMsg {
        id: number;
        up: boolean;
    }

    

    declare class CmdLeaderSkillShowRspMsg {
    }

    

    declare class CmdLeaderSkillUpgradeReqMsg {
        id: number;
    }

    

    declare class CmdLeaderSkillUpgradeRspMsg {
    }

    

    declare class CmdLimitedTimeBundle {
        resId: number;
        refreshTime: Long;
        sendTime: Long;
        buyCount: number;
    }

    

    declare class CmdLimitedTimeBundle_Key {
        resId: number;
    }

    

    declare class CmdRefreshLimitedTimeBundleBroMsg {
    }

    

    declare class CmdBuyLimitedTimeBundleBroMsg {
        tlRewards?: (CmdGoods[]|null);
    }

    

    declare class CmdCelebrationInfo {
        id: number;
        curValue: Long;
        targetInfos?: (number[]|null);
        shopInfos?: (number[]|null);
    }

    

    declare class CmdCelebrationInfo_Key {
        id: number;
    }

    

    declare class CmdCelebrationUpdateDataBroMsg {
    }

    

    declare class CmdCelebrationGetTargetRewardReqMsg {
        id: number;
        subId: number;
    }

    

    declare class CmdCelebrationGetTargetRewardRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdCelebrationBuyShopGoodsReqMsg {
        id: number;
        subId: number;
    }

    

    declare class CmdCelebrationBuyShopGoodsRspMsg {
        canRmb?: (boolean|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdCelebrationBuyShopGoodsBroMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdRoleQuestion {
        id: number;
        state: number;
    }

    

    declare class CmdRoleQuestion_Key {
        id: number;
    }

    

    declare class CmdRoleQuestionClickReqMsg {
        id: number;
    }

    

    declare class CmdRoleQuestionClickRspMsg {
    }

    

    declare class CmdTaskTurntableLotteryGetRewardReqMsg {
        resId: number;
    }

    

    declare class CmdTaskTurntableLotteryGetRewardRspMsg {
        ret?: (boolean|null);
        resId?: (number|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdActivityLotteryGetRewardReqMsg {
        resId: number;
    }

    

    declare class CmdActivityLotteryGetRewardRspMsg {
        tlReward?: (CmdGoods[]|null);
    }

    

    declare class CmdLotteryLuckLog {
        itemId: number;
        roleName: string;
    }

    

    declare class CmdActivityLotteryGetLuckLogReqMsg {
        resId: number;
    }

    

    declare class CmdActivityLotteryGetLuckLogRspMsg {
        resId: number;
        tlLog?: (CmdLotteryLuckLog[]|null);
    }

    

    declare class CmdRoleInteractInfo {
        resId: number;
        state: number;
    }

    

    declare class CmdRoleInteractInfo_Key {
        resId: number;
    }

    

    declare class CmdRoleInteractReqMsg {
        resId: number;
    }

    

    declare class CmdRoleInteractRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdArtifact {
        artifactId: number;
        level: number;
        star: number;
    }

    

    declare class CmdArtifact_Key {
        artifactId: number;
    }

    

    declare class CmdArtifactPage {
        PageId: number;
        artifactList?: (number[]|null);
    }

    

    declare class CmdArtifactPage_Key {
        PageId: number;
    }

    

    declare class CmdArtifactAddLevelReqMsg {
        artifactId: number;
    }

    

    declare class CmdArtifactAddLevelRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdArtifactAddStarReqMsg {
        artifactId: number;
    }

    

    declare class CmdArtifactAddStarRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdArtifactBattleReqMsg {
        pageId: number;
        artifactIds?: (number[]|null);
    }

    

    declare class CmdArtifactBattleRspMsg {
        ret?: (boolean|null);
    }

    

    declare class CmdItemComposReqMsg {
        resId: number;
        number: number;
    }

    

    declare class CmdItemComposRspMsg {
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdFormationInfo {
        formationId: number;
        heroId?: (number[]|null);
        select?: (number|null);
    }

    

    declare class CmdFormationInfo_Key {
        formationId?: (number|null);
    }

    

    declare class CmdFormationInfoReqMsg {
    }

    

    declare class CmdFormationInfoRspMsg {
        infos?: (CmdFormationInfo[]|null);
    }

    

    declare class CmdFormationOpReqMsg {
        info: CmdFormationInfo;
    }

    

    declare class CmdFormationOpRspMsg {
        info: CmdFormationInfo;
    }

    

    declare class CmdFormationSelectReqMsg {
        formationId: number;
    }

    

    declare class CmdFormationSelectRspMsg {
        formationId: number;
    }

    

    declare class CmdNewTreasureInfo {
        cardBoxID: number;
        openTime: number;
        index: number;
    }

    

    declare class CmdNewTreasureInfoListReqMsg {
    }

    

    declare class CmdNewTreasureInfoListRspMsg {
        infos?: (CmdNewTreasureInfo[]|null);
    }

    

    declare class CmdNewTreasureActivateReqMsg {
        index: number;
    }

    

    declare class CmdNewTreasureActivateRspMsg {
        info: CmdNewTreasureInfo;
    }

    

    declare class CmdNewTreasureFastOpenReqMsg {
        index: number;
    }

    

    declare class CmdNewTreasureFastOpenRspMsg {
        index: number;
        succ: number;
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdNewTreasureOpenReqMsg {
        index: number;
    }

    

    declare class CmdNewTreasureOpenRspMsg {
        index: number;
        succ: number;
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdNewTreasureInfoBroMsg {
        info: CmdNewTreasureInfo;
    }

    

    declare class CmdPvpHeroSkillInfo {
        id: number;
        level: number;
    }

    

    declare class CmdPvpHeroInfo {
        heroId: number;
        level: number;
        skills?: (CmdPvpHeroSkillInfo[]|null);
    }

    

    declare class CmdPvpArtifactInfo {
        artifactId: number;
        level: number;
        select: number;
    }

    

    declare class CmdPvpHeroInfoListReqMsg {
    }

    

    declare class CmdPvpHeroInfoListRspMsg {
        infos?: (CmdPvpHeroInfo[]|null);
    }

    

    declare class CmdPvpHeroUpLevelReqMsg {
        heroId: number;
    }

    

    declare class CmdPvpHeroUpLevelRspMsg {
        info: CmdPvpHeroInfo;
    }

    

    declare class CmdPvpHeroUpSkillReqMsg {
        heroId: number;
        skillId: number;
    }

    

    declare class CmdPvpHeroUpSkillRspMsg {
        info: CmdPvpHeroInfo;
    }

    

    declare class CmdPvpArtifactInfoListReqMsg {
    }

    

    declare class CmdPvpArtifactInfoListRspMsg {
        infos?: (CmdPvpArtifactInfo[]|null);
    }

    

    declare class CmdPvpArtifactUpLevelReqMsg {
        artifactId: number;
    }

    

    declare class CmdPvpArtifactUpLevelRspMsg {
        info: CmdPvpArtifactInfo;
    }

    

    declare class CmdPvpArtifactSelectReqMsg {
        artifactId: number;
    }

    

    declare class CmdPvpArtifactSelectRspMsg {
        info: CmdPvpArtifactInfo;
    }

    

    declare class CmdPvpInfo {
        grade: number;
        score: number;
        winCount: number;
        gradeRewardTag: number;
    }

    

    declare class CmdBattleStatisticsInfo {
        unitId: number;
        eventType: number;
        frameId: number;
        kv?: (string[]|null);
    }

    

    declare class CmdPvpInfoReqMsg {
    }

    

    declare class CmdPvpInfoRspMsg {
        info: CmdPvpInfo;
    }

    

    declare class CmdPvpGradeRewardReqMsg {
    }

    

    declare class CmdPvpGradeRewardRspMsg {
        gradeRewardTag: number;
    }

    

    declare class CmdBattleUnitShowInfo {
        roleId: Long;
        serverId: number;
        power: number;
        name: string;
        img: Long;
        headFrame: Long;
        gradeId: number;
        gradeScore: number;
    }

    

    declare class CmdBattleUnitInfo {
        showInfo: CmdBattleUnitShowInfo;
        campId: number;
        heroInfos?: (CmdPvpHeroInfo[]|null);
        artifactId: number;
        artifactLevel: number;
        unitId: number;
    }

    

    declare class CmdStartBattleInfo {
        battleType: number;
        battleParams?: (string[]|null);
    }

    

    declare class CmdPveBattleResultInfo {
        addScore: number;
        newGrade: number;
        newScore: number;
        cmdGoods?: (CmdGoods[]|null);
        treasureId?: (number|null);
    }

    

    declare class CmdChapterBattleResultInfo {
        cmdGoods?: (CmdGoods[]|null);
        treasureId?: (number|null);
    }

    

    declare class CmdSlgMonsterBattleResultInfo {
        cmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdSlgCampBattleResultInfo {
        warScore?: (number|null);
        cmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdBattleFrameInfo {
        frameId: number;
        unitId: number;
        op: number;
        params?: (number[]|null);
    }

    

    declare class CmdStartBattleReqMsg {
        startBattleInfo: CmdStartBattleInfo;
        version?: (string|null);
    }

    

    declare class CmdStartBattleRspMsg {
        code: number;
        seed: Long;
        version: string;
        battleId: string;
        startBattleInfo: CmdStartBattleInfo;
        unitInfos?: (CmdBattleUnitInfo[]|null);
    }

    

    declare class CmdFinishBattleReqMsg {
        clientTickCount: number;
        result: number;
        commands?: (CmdBattleFrameInfo[]|null);
        statisticsInfos?: (CmdBattleStatisticsInfo[]|null);
    }

    

    declare class CmdFinishBattleRspMsg {
        code: number;
    }

    

    declare class CmdBattleResultBroMsg {
        battleType: number;
        code: number;
        dataBytes: Uint8Array;
    }

    

    declare class ChapterInfo {
        idleTime: number;
        chapters?: (number[]|null);
    }

    

    declare class CmdCityChapterInfoReqMsg {
    }

    

    declare class CmdCityChapterInfoRspMsg {
        info: ChapterInfo;
    }

    

    declare class CmdCityChapterIdleRewardReqMsg {
    }

    

    declare class CmdCityChapterIdleRewardRspMsg {
        idleTime: number;
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdCityChapterSweepReqMsg {
        levelChapter: number;
        cellId: number;
    }

    

    declare class CmdCityChapterSweepRspMsg {
        succ: number;
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdCityChapterUnlockCellReqMsg {
        levelChapter: number;
        cellId: number;
    }

    

    declare class CmdCityChapterUnlockCellRspMsg {
        levelChapter: number;
        cellId?: (number[]|null);
        succ: number;
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdCityChapterPassCellReqMsg {
        levelChapter: number;
        cellId: number;
    }

    

    declare class CmdCityChapterPassCellRspMsg {
        levelChapter: number;
        cellId: number;
        succ: number;
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdCityChapterPassCellBroMsg {
        levelChapter: number;
        cellId?: (number[]|null);
    }

    

    declare class CmdCityChapterInfoBroMsg {
        info: ChapterInfo;
    }

    

    declare class CmdCityChapterCellInfoReqMsg {
        levelChapter: number;
    }

    

    declare class CmdCityChapterCellInfoRspMsg {
        levelChapter: number;
        rewardState: number;
        unlockCells?: (Long[]|null);
        passCells?: (Long[]|null);
    }

    

    declare class SlgGameInfo {
        maxMonsterLevel: number;
        toCampId: number;
    }

    

    declare class SlgGameActionInfo {
        nextRevertTime: number;
    }

    

    declare class SlgCampSimpleInfo {
        campId: number;
        opType: number;
        state: number;
    }

    

    declare class SlgCampInfo {
        campId: number;
        opType: number;
        state: number;
    }

    

    declare class SlgBuildInfo {
        buildInstId: number;
        buildingId: number;
        position: number;
        level: number;
        state: number;
        finishTime?: (number|null);
    }

    

    declare class SlgBuildQueueInfo {
        queueId: number;
        type: number;
        buildInstId: number;
    }

    

    declare class SlgBuildGameInfo {
        builds?: (SlgBuildInfo[]|null);
        queues?: (SlgBuildQueueInfo[]|null);
        unlockQueue: number;
    }

    

    declare class CmdSlgCampSimpleInfoReqMsg {
        campIds?: (number[]|null);
    }

    

    declare class CmdSlgCampSimpleInfoRspMsg {
        infos?: (SlgCampSimpleInfo[]|null);
    }

    

    declare class CmdSlgCampInfoReqMsg {
        campIds?: (number[]|null);
    }

    

    declare class CmdSlgCampInfoRspMsg {
        infos?: (SlgCampInfo[]|null);
    }

    

    declare class CmdSlgActionUpdateReqMsg {
    }

    

    declare class CmdSlgActionUpdateRspMsg {
        info: SlgGameActionInfo;
    }

    

    declare class CmdSlgGameInfoReqMsg {
    }

    

    declare class CmdSlgGameInfoRspMsg {
        info: SlgGameInfo;
    }

    

    declare class CmdSlgGameInfoBroMsg {
        info: SlgGameInfo;
    }

    

    declare class CmdSlgBuildInfoReqMsg {
    }

    

    declare class CmdSlgBuildInfoRspMsg {
        info: SlgBuildGameInfo;
    }

    

    declare class CmdSlgBuildReqMsg {
        buildingId: number;
        position: number;
        instant?: (number|null);
    }

    

    declare class CmdSlgBuildRspMsg {
        build: SlgBuildInfo;
        queue: SlgBuildQueueInfo;
    }

    

    declare class CmdSlgBuildUpgradeReqMsg {
        buildInstId: number;
        instant?: (number|null);
    }

    

    declare class CmdSlgBuildUpgradeRspMsg {
        build: SlgBuildInfo;
        queue: SlgBuildQueueInfo;
    }

    

    declare class CmdSlgBuildCancelReqMsg {
        buildInstId: number;
    }

    

    declare class CmdSlgBuildCancelRspMsg {
        buildInstId: number;
        build?: (SlgBuildInfo|null);
        queue?: (SlgBuildQueueInfo|null);
    }

    

    declare class CmdSlgBuildMoveReqMsg {
        buildInstId: number;
        position: number;
    }

    

    declare class CmdSlgBuildMoveRspMsg {
        build: SlgBuildInfo;
    }

    

    declare class CmdSlgBuildCollectReqMsg {
        buildInstIds?: (number[]|null);
    }

    

    declare class CmdSlgBuildCollectRspMsg {
        builds?: (SlgBuildInfo[]|null);
        tlCmdGoods?: (CmdGoods[]|null);
    }

    

    declare class CmdSlgBuildUnlockQueueReqMsg {
        queueId: number;
    }

    

    declare class CmdSlgBuildUnlockQueueRspMsg {
        unlockQueue: number;
    }

    

    declare class CmdSlgBuildInfoBroMsg {
    }

    

    declare enum MessageId {
        CmdTakeDayChallengeActRewardRspMsg = 1731012380,
        CmdTakeDayActProgressRewardRspMsg = 381806326,
        CmdTakeMonthCardActRewardRspMsg = 650624469,
        CmdTakeRechargeGiftActRewardRspMsg = 364759860,
        CmdActivityJsonRspMsg = 904212428,
        CmdActivityLimitTimeInfoRspMsg = 1769777808,
        CmdActivityLimitTimeTakeRspMsg = 1469215657,
        CmdBuySkinRspMsg = 55511540,
        CmdActivityLimitSkinInfoRspMsg = 2115460800,
        CmdActivityLimitSkinBuyRspMsg = 730391206,
        CmdActivityLotteryGetRewardRspMsg = 1615692712,
        CmdActivityLotteryGetLuckLogRspMsg = 550340320,
        CmdArmyLevelUpRspMsg = 2019044469,
        CmdArmySkinAddStarRspMsg = 606377246,
        CmdArmySelectSkinRspMsg = 1423980531,
        CmdAdvisorAddStarRspMsg = 301757744,
        CmdAdvisorSelectPageRspMsg = 497519860,
        CmdAdvisorBattleRspMsg = 821095103,
        CmdAdvisorShowRspMsg = 214563142,
        CmdGeneralAddStarRspMsg = 1417805144,
        CmdGeneralSelectPageRspMsg = 328735204,
        CmdGeneralBattleRspMsg = 251282025,
        CmdArtifactAddLevelRspMsg = 457117554,
        CmdArtifactAddStarRspMsg = 1889730358,
        CmdArtifactBattleRspMsg = 236058631,
        CmdEnterBattleRspMsg = 954352089,
        CmdContinueNextBattleRspMsg = 986683025,
        CmdGemRefreshSkillRspMsg = 2140529010,
        CmdBattleDataUploadRspMsg = 1914585408,
        CmdBattleResultRspMsg = 475498478,
        CmdBattleStatisticsRspMsg = 881202280,
        CmdTakeChapterRewardRspMsg = 1792000898,
        CmdBattleSweepRspMsg = 70842819,
        CmdBattleRandomSkillRspMsg = 140321439,
        CmdBattleSelectSkillRspMsg = 355247302,
        CmdBattlePreviewRspMsg = 1720724839,
        CmdBattleCompleteInfoRspMsg = 1330132868,
        CmdBattleTeamEnterRspMsg = 135638924,
        CmdBattleTeamUpdateRspMsg = 1515286085,
        CmdBattleBuyBlessRspMsg = 1331629962,
        CmdBattleTokenOpenRspMsg = 224520948,
        CmdBattleTokenTakeRewardRspMsg = 2063652608,
        CmdBattleTokenResetRspMsg = 952348427,
        CmdBreachRspMsg = 287063570,
        CmdBuyStaBuyRspMsg = 730345707,
        CmdBuyStaInfoRspMsg = 2114050331,
        CmdCardBuyRspMsg = 579891201,
        CmdCastleSkillUpLevelRspMsg = 21015693,
        CmdCastleSkillResearchRspMsg = 1359547363,
        CmdCastleWorkShopOpenRspMsg = 1776254022,
        CmdCastleWorkShopUpLevelRspMsg = 581980397,
        CmdCastleWorkShopSpeedRspMsg = 367202545,
        CmdCastleWorkShopTakeRspMsg = 310061251,
        CmdCastleApprenticeUpRspMsg = 1220313759,
        CmdCastleApprenticeUpLevelRspMsg = 492743159,
        CmdCastleWallUpLevelRspMsg = 157500720,
        CmdCastleWallQualityUpRspMsg = 486054753,
        CmdCastleWallSelectRspMsg = 108080165,
        CmdCastleWallUpSkillLevelRspMsg = 2070127885,
        CmdCastleWallSkinUpStarRspMsg = 668984887,
        CmdCastleWallSelectSkillPageRspMsg = 303108149,
        CmdCastleWallSelectSkillRspMsg = 64167132,
        CmdCastleGuardsActiveRspMsg = 393859209,
        CmdCastleGuardsLevelUpRspMsg = 1218372674,
        CmdCastleGuardsRankUpRspMsg = 1054187350,
        CmdCastleGuardsUpRspMsg = 1134916514,
        CmdChatInitRspMsg = 691376229,
        CmdChatSendRspMsg = 917389533,
        CmdChatDelTargetRspMsg = 63079597,
        CmdCityChapterInfoRspMsg = 904257191,
        CmdCityChapterIdleRewardRspMsg = 1309083890,
        CmdCityChapterSweepRspMsg = 1335059463,
        CmdCityChapterUnlockCellRspMsg = 45711217,
        CmdCityChapterPassCellRspMsg = 1560327682,
        CmdCityChapterCellInfoRspMsg = 1137184677,
        CmdDayWeekMonthGiftGetRewardRspMsg = 1356079122,
        CmdDayWeekMonthGiftInfoRspMsg = 1005269291,
        CmdDayWeekMonthGiftFreeBuyRspMsg = 355499005,
        CmdEquipUpLevelAllRspMsg = 1246543183,
        CmdEquipUpLevelRspMsg = 154590858,
        CmdEquipSelectPageRspMsg = 806986012,
        CmdEquipChangePageNameRspMsg = 918039683,
        CmdEquipUpQualityRspMsg = 24217329,
        CmdEquipWashRspMsg = 211219800,
        CmdEquipWashConformRspMsg = 1592294924,
        CmdEquipDecomposeRspMsg = 1476438722,
        CmdEquipReplaceRspMsg = 152967745,
        CmdEveryDaySignInInfoRspMsg = 1133773426,
        CmdEveryDaySignInRspMsg = 1704555072,
        CmdEveryDayGetRewardsRspMsg = 1935261292,
        CmdFirstRechargeOpenRspMsg = 938272586,
        CmdFirstRechargesBuyRspMsg = 1309919437,
        CmdFirstRechargeRewardRspMsg = 622072529,
        CmdFormationInfoRspMsg = 1211220072,
        CmdFormationOpRspMsg = 1506971931,
        CmdFriendsApplyRspMsg = 2057674506,
        CmdFriendsAddRspMsg = 552573225,
        CmdFriendsRefuseRspMsg = 1262322162,
        CmdFriendsRemoveRspMsg = 1219983774,
        CmdFriendsBlackRspMsg = 227867847,
        CmdFriendBlackRemoveRspMsg = 78131250,
        CmdFriendsSearchRspMsg = 246249338,
        CmdFriendGetEndRspMsg = 2055097216,
        CmdFriendGetEndOneKeyRspMsg = 437546553,
        CmdFriendSendEndRspMsg = 1466069662,
        CmdFriendSendEndOneKeyRspMsg = 384409047,
        CmdFriendAgreeOneKeyRspMsg = 1277358288,
        CmdFriendRefuseOneKeyRspMsg = 1734010408,
        CmdFriendRefreshSuggestRspMsg = 429905916,
        CmdFuBenEnterRspMsg = 827208359,
        CmdFuBenDailyGetRewardRspMsg = 1528771729,
        CmdFuBenBuyTimesRspMsg = 427584667,
        CmdFuBenSweepRspMsg = 1878627949,
        CmdFundGetInfoRspMsg = 510764152,
        CmdFundGetRewardRspMsg = 1902555017,
        CmdTakeGameCircleRewardRspMsg = 1855584437,
        CmdGemOnRspMsg = 723509321,
        CmdGemReplaceRspMsg = 1557847038,
        CmdGemDownRspMsg = 561910022,
        CmdGemRefineRspMsg = 346087611,
        CmdGemRefineSaveRspMsg = 1149209122,
        CmdGemComposeRspMsg = 1565473696,
        CmdGemLockRspMsg = 998030141,
        CmdGemComposePreviewRspMsg = 1938966802,
        CmdGranaryGetRspMsg = 4384515,
        CmdGranaryGetOneKeyRspMsg = 914853252,
        CmdGuideRecordRspMsg = 353871062,
        CmdGuideReadRspMsg = 142005541,
        CmdGetHallRoleListRspMsg = 1624091372,
        CmdHangQuickRspMsg = 1023337980,
        CmdHangTimeRspMsg = 20353276,
        CmdHangGetRewardRspMsg = 1443586620,
        CmdHeroChangeRspMsg = 302212057,
        CmdHeroLevelUpRspMsg = 914609230,
        CmdHeroLevelUpOneKeyRspMsg = 200868985,
        CmdHeroOpenRspMsg = 1722636353,
        CmdHeroUnlockGetInfoRspMsg = 647497073,
        CmdHeroUnlockRewardRspMsg = 2024711478,
        CmdItemUseRspMsg = 486417821,
        CmdItemBoxUseRspMsg = 522720460,
        CmdItemComposRspMsg = 1879302909,
        CmdLeaderSkillBattleRspMsg = 100005559,
        CmdLeaderSkillShowRspMsg = 1149390670,
        CmdLeaderSkillUpgradeRspMsg = 77042543,
        CmdTakeLockMonsterBoxRspMsg = 1090703712,
        CmdLockMonsterSweepRspMsg = 421431834,
        CmdMailListRspMsg = 319013138,
        CmdMailReadRspMsg = 546189302,
        CmdMailDeleteRspMsg = 172353567,
        CmdMailTakeRewardRspMsg = 555367350,
        CmdMallSEquipDrawRspMsg = 163390926,
        CmdMallLuckDrawRspMsg = 1193344794,
        CmdMallDailyShopBuyRspMsg = 1185112280,
        CmdMallCoinBuyRspMsg = 115313430,
        CmdMallGetDataRspMsg = 1322643093,
        CmdMonsterManualGetRewardRspMsg = 1031509406,
        CmdNewTreasureInfoListRspMsg = 2011197980,
        CmdNewTreasureActivateRspMsg = 399007957,
        CmdNewTreasureFastOpenRspMsg = 291587262,
        CmdNewTreasureOpenRspMsg = 1903704638,
        CmdTakeOathAllianceRewardRspMsg = 271053488,
        CmdPvpHeroInfoListRspMsg = 1516169721,
        CmdPvpHeroUpLevelRspMsg = 937856670,
        CmdPvpHeroUpSkillRspMsg = 473853329,
        CmdPvpArtifactInfoListRspMsg = 214080977,
        CmdPvpArtifactUpLevelRspMsg = 1929634442,
        CmdPvpArtifactSelectRspMsg = 1344720097,
        CmdPvpInfoRspMsg = 45368353,
        CmdPvpGradeRewardRspMsg = 1849483705,
        CmdStartBattleRspMsg = 1785200541,
        CmdFinishBattleRspMsg = 975557688,
        CmdGetRankRspMsg = 345265589,
        CmdGetChapterFirstPassListRspMsg = 518424945,
        CmdGetChapterFirstPassRewardRspMsg = 1035774786,
        CmdCelebrationGetTargetRewardRspMsg = 1808065367,
        CmdCelebrationBuyShopGoodsRspMsg = 1473298867,
        CmdRechargeDailyGetRewardRspMsg = 203020112,
        CmdRechargeDailyGetAccRewardRspMsg = 599406123,
        CmdUpdateRedDotRspMsg = 87323966,
        CmdGoodsRedDotDispelRspMsg = 805392448,
        CmdRoleLoginRspMsg = 158618628,
        CmdRoleChangeNameRspMsg = 1996633358,
        CmdRoleChangeImgRspMsg = 912768250,
        CmdRoleUploadPlatformImgRspMsg = 225100382,
        CmdRoleChangeHeadFrameRspMsg = 2075087664,
        CmdEndBuyInfoRspMsg = 1357989782,
        CmdEndBuyRspMsg = 1695409208,
        CmdRoleEndUpdateRspMsg = 1865990615,
        CmdMiningBuyRspMsg = 1065397953,
        CmdCodeExchangeRspMsg = 452401139,
        CmdRoleTakeFirstChargeRspMsg = 17475600,
        CmdRoleWatchAdvertRspMsg = 1151490410,
        CmdRoleInfoViewRspMsg = 1505925414,
        CmdRoleDouYinRewardRspMsg = 1594668726,
        CmdRoleAppletShareRspMsg = 1597596872,
        CmdRoleAppletShareRewardRspMsg = 1186069383,
        CmdRoleGuanKaGiftSelectRspMsg = 1810611536,
        CmdRoleGuanKaGiftBuyRspMsg = 549296840,
        CmdRoleQuestionClickRspMsg = 690020587,
        CmdRoleInteractRspMsg = 1678080855,
        CmdRunePutOnRspMsg = 648739037,
        CmdRuneTakeOffRspMsg = 887086199,
        CmdRuneReplaceRspMsg = 224396995,
        CmdRuneSynthesisRspMsg = 1308719965,
        CmdRuneSynthesisOneKeyRspMsg = 1160730652,
        CmdShareGetRewardRspMsg = 883372771,
        CmdShareStateRspMsg = 669018575,
        CmdShopBuyRspMsg = 1338068263,
        CmdContinuityGiftInfoRspMsg = 1330212203,
        CmdContinuityGiftRewardRspMsg = 1554306220,
        CmdContinuityGiftFinishRewardRspMsg = 402025121,
        CmdTakeSpiritAnimalBoxRspMsg = 923167072,
        CmdChangeUsedSkinRspMsg = 1911316089,
        CmdSlgCampSimpleInfoRspMsg = 1631409176,
        CmdSlgCampInfoRspMsg = 1665140602,
        CmdSlgActionUpdateRspMsg = 196069974,
        CmdSlgGameInfoRspMsg = 1100779337,
        CmdSlgBuildInfoRspMsg = 1414628085,
        CmdSlgBuildRspMsg = 455496637,
        CmdSlgBuildUpgradeRspMsg = 1255226437,
        CmdSlgBuildCancelRspMsg = 1606383447,
        CmdSlgBuildMoveRspMsg = 2116890094,
        CmdSlgBuildCollectRspMsg = 1353318189,
        CmdSlgBuildUnlockQueueRspMsg = 1478251158,
        CmdSpiritAnimalLevelUpRspMsg = 2051518427,
        CmdSpiritAnimalStepUpRspMsg = 1991681903,
        CmdSpiritAnimalBattleRspMsg = 1439043070,
        CmdSpiritAnimalResetRspMsg = 454379051,
        CmdSpiritAnimalResetPreviewRspMsg = 1924442819,
        CmdSystemSyncTimeRspMsg = 2058086284,
        CmdSystemGmRspMsg = 1915513454,
        CmdGmListRspMsg = 323387391,
        CmdRecordClientAniRspMsg = 855569897,
        CmdGetAllPlayClientAniRspMsg = 1343478075,
        CmdSevenDayInfoRspMsg = 867503290,
        CmdSevenDayShopBuyRspMsg = 1979875530,
        CmdSevenDayTakeTaskRewardRspMsg = 328767495,
        CmdSevenDayTakePointRewardRspMsg = 1539905038,
        CmdSigninInfoRspMsg = 946249011,
        CmdSigninTakeTaskRewardRspMsg = 75320742,
        CmdTakeMainTaskRewardRspMsg = 189258127,
        CmdTaskUnionGetRewardRspMsg = 1155347992,
        CmdTaskUnionGetProgressRewardRspMsg = 779946725,
        CmdTaskTurntableLotteryGetRewardRspMsg = 1308198127,
        CmdTeamInitRspMsg = 1260780842,
        CmdTeamCreateRspMsg = 85784150,
        CmdTeamInviteRspMsg = 1162344797,
        CmdTeamReplyInviteRspMsg = 2136264863,
        CmdTeamQuitRspMsg = 78606551,
        CmdTeamKickRspMsg = 50565600,
        CmdTeamRecruitInitRspMsg = 1960461510,
        CmdTeamRecruitSendRspMsg = 1734448206,
        CmdTeamRecruitJoinRspMsg = 699516972,
        CmdUnionBargainRspMsg = 845972768,
        CmdUnionActListRspMsg = 1121112734,
        CmdUnionActDrumRspMsg = 879094694,
        CmdUnionActSweepRspMsg = 1708291410,
        CmdUnionCreateRspMsg = 1480156308,
        CmdUnionJoinRspMsg = 1114808446,
        CmdUnionApproveJoinRspMsg = 759231909,
        CmdUnionApproveJoinOneKeyRspMsg = 790265954,
        CmdUnionQuitRspMsg = 579826919,
        CmdUnionKickRspMsg = 708999070,
        CmdUnionAppointRspMsg = 1310063537,
        CmdUnionSetQuickJoinRspMsg = 483032179,
        CmdUnionEditRspMsg = 695023518,
        CmdUnionDetailRspMsg = 473581609,
        CmdUnionApplyListRspMsg = 1880253510,
        CmdUnionLogRspMsg = 1410480146,
        CmdUnionListRspMsg = 2025245686,
        CmdUnionSearchRspMsg = 64682048,
        CmdUnionDonateRspMsg = 936504263,
        CmdBattleTeamEnterBroMsg = 310481301,
        CmdBattleTeamUpdateBroMsg = 1961406310,
        CmdBattleBuyBlessBroMsg = 885509737,
        CmdBattleTokenOpenBroMsg = 221599277,
        CmdCardBuyBroMsg = 1026011426,
        CmdCastleGuardsActiveBroMsg = 52261016,
        CmdChatBroMsg = 754420972,
        CmdCityChapterPassCellBroMsg = 2006447907,
        CmdCityChapterInfoBroMsg = 1350377416,
        CmdCacheBroMsg = 331957642,
        CmdRoleOfflineBroMsg = 2041625045,
        CmdRechargeBroMsg = 495748573,
        CmdModifyItemBroMsg = 658416489,
        CmdBattleBroMsg = 1253466612,
        CmdMallBroMsg = 528672976,
        CmdEndBroMsg = 1882529373,
        CmdFirstRechargesBuyBroMsg = 1756039662,
        CmdFriendsApplyBroMsg = 1791172565,
        CmdFriendsAddBroMsg = 106453000,
        CmdFriendsRefuseBroMsg = 816201937,
        CmdFriendsRemoveBroMsg = 1666103999,
        CmdFriendSendEndBroMsg = 1019949437,
        CmdFriendSendEndOneKeyBroMsg = 61711178,
        CmdFriendAgreeOneKeyBroMsg = 831238063,
        CmdFriendRefuseOneKeyBroMsg = 1287890183,
        CmdGranaryUpdateBroMsg = 789546177,
        CmdRefreshLimitedTimeBundleBroMsg = 1678727286,
        CmdBuyLimitedTimeBundleBroMsg = 937248641,
        CmdRollBroMsg = 11546745,
        CmdMonsterManualActiveBroMsg = 1339999214,
        CmdNewTreasureInfoBroMsg = 779511813,
        CmdBattleResultBroMsg = 921618703,
        CmdCelebrationUpdateDataBroMsg = 1157544859,
        CmdCelebrationBuyShopGoodsBroMsg = 1919419092,
        CmdRechargeDailyUpdateBroMsg = 161909789,
        CmdGuanKaGiftBroMsg = 915823971,
        CmdSlgGameInfoBroMsg = 1546899562,
        CmdSlgBuildInfoBroMsg = 1860748310,
        CmdTeamDetailBroMsg = 1366910774,
        CmdTeamDisbandBroMsg = 2097470162,
        CmdTeamInviteBroMsg = 1608465022,
        CmdTeamReplyInviteBroMsg = 1690144638,
        CmdTeamRecruitSendBroMsg = 2114398865,
        CmdTeamKickBroMsg = 395554625,
        CmdUnionApproveJoinBroMsg = 313111684,
        CmdUnionInfoUpdateBroMsg = 434491086,
        CmdUnionMemberListUpdateBroMsg = 1523089848,
        CmdUnionApplyListUpdateBroMsg = 520724354,
        CmdUnionLogListUpdateBroMsg = 196894184,
        CmdUnionListUpdateBroMsg = 505721534,
        CmdUnionTaskListUpdateBroMsg = 2080473117
    }

    declare class ClientCmdData {
        appendData?: (Uint8Array|null);
        clientIndex: number;
        data?: (Uint8Array|null);
        messageId: number;
    }

    

    declare class CmdCache {
        cacheName: string;
        data?: (Uint8Array[]|null);
        type: number;
    }

    

    declare class CmdCacheField {
        data: Uint8Array;
        fieldNumber: number;
    }

    

    declare class CmdCacheUpdateByField {
        fields?: (CmdCacheField[]|null);
        key: Uint8Array;
    }

    

    declare class CmdDouble {
        value: number;
    }

    

    declare class CmdFloat {
        value: number;
    }

    

    declare class CmdInt32 {
        value: number;
    }

    

    declare class CmdInt64 {
        value: Long;
    }

    

    declare class ServerCmdData {
        clientIndex: number;
        cmdCaches?: (CmdCache[]|null);
        compress: boolean;
        data: Uint8Array;
        messageIds?: (number[]|null);
        result: boolean;
        splits?: (number[]|null);
    }

    



declare type EnumProtoName =
| "CmdTurntableLotteryType"
| "CmdActivityTypeEnum"
| "CmdBattleType"
| "CmdClientAppendDataModelEnum"
| "CmdCommonState"
| "CmdFuBenType"
| "CmdRankType"
| "CmdRedDotType"
| "CmdShopType"
| "CmdTaskType"
| "LoginStatus"
| "ChatChannelType"
| "CmdUnionState"
| "CmdUnionEditType"
| "CmdUnionJoinState"
| "CmdUnionPosition"
| "CmdUnionActType"
| "CmdBattleTokenType"
| "MessageId"

declare type MessageProtoName =
| "CmdActivity"
| "CmdLotteryActDetail"
| "CmdActivityDetail"
| "CmdActivityGoods"
| "CmdActivityJsonReqMsg"
| "CmdActivityJsonRspMsg"
| "CmdActivityLimitSkinBuyReqMsg"
| "CmdActivityLimitSkinBuyRspMsg"
| "CmdActivityLimitSkinInfoReqMsg"
| "CmdActivityLimitSkinInfoRspMsg"
| "CmdActivityLimitTimeInfoReqMsg"
| "CmdActivityLimitTimeInfoRspMsg"
| "CmdActivityLimitTimeTakeReqMsg"
| "CmdActivityLimitTimeTakeRspMsg"
| "CmdActivitySimple"
| "CmdActivitySimple_Key"
| "CmdActivityTime"
| "CmdActivity_Key"
| "CmdAdvert"
| "CmdAppletInfo"
| "CmdBattleAttr"
| "CmdBattleBroMsg"
| "CmdBattleBuff"
| "CmdBattleCard"
| "CmdBattleChapter"
| "CmdBattleChapter_Key"
| "CmdBattleCompleteInfoReqMsg"
| "CmdBattleCompleteInfoRspMsg"
| "CmdBattleData"
| "CmdBattleDataUploadReqMsg"
| "CmdBattleDataUploadRspMsg"
| "CmdBattleLevel"
| "CmdBattleLevel_Key"
| "CmdBattlePreviewReqMsg"
| "CmdBattlePreviewRspMsg"
| "CmdBattleRandomSkillReqMsg"
| "CmdBattleRandomSkillRspMsg"
| "CmdBattleArmyData"
| "CmdBattleResultReqMsg"
| "CmdBattleResultRspMsg"
| "CmdBattleSelectSkillReqMsg"
| "CmdBattleSelectSkillRspMsg"
| "CmdBattleSkill"
| "CmdBattleStatisticsReqMsg"
| "CmdBattleStatisticsRspMsg"
| "CmdBattleSweepReqMsg"
| "CmdBattleSweepRspMsg"
| "CmdBreach"
| "CmdBreachReqMsg"
| "CmdBreachRspMsg"
| "CmdBreach_Key"
| "CmdBuySkinReqMsg"
| "CmdBuySkinRspMsg"
| "CmdBuyStaBuyReqMsg"
| "CmdBuyStaBuyRspMsg"
| "CmdBuyStaInfoReqMsg"
| "CmdBuyStaInfoRspMsg"
| "CmdBuyStaState"
| "CmdCacheBroMsg"
| "CmdCastleSkill"
| "CmdCastleSkill_Key"
| "CmdCastleWorkShop"
| "CmdCastleWorkShop_Key"
| "CmdCastleApprentice"
| "CmdCastleApprentice_Key"
| "CmdCastleWall"
| "CmdCastleWall_Key"
| "CmdCastleWallSkill"
| "CmdCastleWallSkill_Key"
| "CmdCastleWallSkinStar"
| "CmdCastleWallSkinStar_Key"
| "CmdCastleWallSkillPage"
| "CmdCastleWallSkillPage_Key"
| "CmdCastleSkillUpLevelReqMsg"
| "CmdCastleSkillUpLevelRspMsg"
| "CmdCastleSkillResearchReqMsg"
| "CmdCastleSkillResearchRspMsg"
| "CmdCastleWorkShopOpenReqMsg"
| "CmdCastleWorkShopOpenRspMsg"
| "CmdCastleWorkShopUpLevelReqMsg"
| "CmdCastleWorkShopUpLevelRspMsg"
| "CmdCastleWorkShopSpeedReqMsg"
| "CmdCastleWorkShopSpeedRspMsg"
| "CmdCastleWorkShopTakeReqMsg"
| "CmdCastleWorkShopTakeRspMsg"
| "CmdCastleApprenticeUpReqMsg"
| "CmdCastleApprenticeUpRspMsg"
| "CmdCastleApprenticeUpLevelReqMsg"
| "CmdCastleApprenticeUpLevelRspMsg"
| "CmdCastleWallUpLevelReqMsg"
| "CmdCastleWallUpLevelRspMsg"
| "CmdCastleWallQualityUpReqMsg"
| "CmdCastleWallQualityUpRspMsg"
| "CmdCastleWallSelectReqMsg"
| "CmdCastleWallSelectRspMsg"
| "CmdCastleWallUpSkillLevelReqMsg"
| "CmdCastleWallUpSkillLevelRspMsg"
| "CmdCastleWallSkinUpStarReqMsg"
| "CmdCastleWallSkinUpStarRspMsg"
| "CmdCastleWallSelectSkillPageReqMsg"
| "CmdCastleWallSelectSkillPageRspMsg"
| "CmdCastleWallSelectSkillReqMsg"
| "CmdCastleWallSelectSkillRspMsg"
| "CmdChangeUsedSkinReqMsg"
| "CmdChangeUsedSkinRspMsg"
| "CmdChapter"
| "CmdChapterBoxState"
| "CmdChapter_Key"
| "CmdClientAppendData"
| "CmdClientAppendDataModel"
| "CmdClientInfo"
| "CmdCode"
| "CmdCodeExchangeReqMsg"
| "CmdCodeExchangeRspMsg"
| "CmdCode_Key"
| "CmdCommonTips"
| "CmdContinueNextBattleReqMsg"
| "CmdContinueNextBattleRspMsg"
| "CmdContinuityGiftFinishRewardReqMsg"
| "CmdContinuityGiftFinishRewardRspMsg"
| "CmdContinuityGiftInfo"
| "CmdContinuityGiftInfoReqMsg"
| "CmdContinuityGiftInfoRspMsg"
| "CmdContinuityGiftRewardReqMsg"
| "CmdContinuityGiftRewardRspMsg"
| "CmdDayChallengeActDetail"
| "CmdDayChallengeTask"
| "RechargeCount"
| "CmdDayWeekMonthGift"
| "CmdDayWeekMonthGiftFreeBuyReqMsg"
| "CmdDayWeekMonthGiftFreeBuyRspMsg"
| "CmdDayWeekMonthGiftGetRewardReqMsg"
| "CmdDayWeekMonthGiftGetRewardRspMsg"
| "CmdDayWeekMonthGiftInfoReqMsg"
| "CmdDayWeekMonthGiftInfoRspMsg"
| "CmdDayWeekMonthGift_Key"
| "CmdEndBroMsg"
| "CmdEndBuyInfoReqMsg"
| "CmdEndBuyInfoRspMsg"
| "CmdEndBuyReqMsg"
| "CmdEndBuyRspMsg"
| "CmdEnterBattleReqMsg"
| "CmdEnterBattleRspMsg"
| "CmdEquip"
| "CmdEquipChangePageNameReqMsg"
| "CmdEquipChangePageNameRspMsg"
| "CmdEquipItem"
| "CmdEquipItem_Key"
| "CmdEquipPart"
| "CmdEquipPart_Key"
| "CmdEquipPage"
| "CmdEquipPage_Key"
| "CmdEquipSelectPageReqMsg"
| "CmdEquipSelectPageRspMsg"
| "CmdEquipUpLevelAllReqMsg"
| "CmdEquipUpLevelAllRspMsg"
| "CmdEquipUpLevelReqMsg"
| "CmdEquipUpLevelRspMsg"
| "CmdEquipUpQualityReqMsg"
| "CmdEquipUpQualityRspMsg"
| "CmdEquipWashReqMsg"
| "CmdEquipWashRspMsg"
| "CmdEquipWashConformReqMsg"
| "CmdEquipWashConformRspMsg"
| "CmdEquipDecomposeReqMsg"
| "CmdEquipDecomposeRspMsg"
| "CmdEquipReplaceReqMsg"
| "CmdEquipReplaceRspMsg"
| "CmdEveryDayGetRewardsReqMsg"
| "CmdEveryDayGetRewardsRspMsg"
| "CmdEveryDaySign"
| "CmdEveryDaySignInInfoReqMsg"
| "CmdEveryDaySignInInfoRspMsg"
| "CmdEveryDaySignInReqMsg"
| "CmdEveryDaySignInRspMsg"
| "CmdEveryDaySign_Key"
| "CmdFirstRechargeInfo"
| "CmdFuBen"
| "CmdFuBenDailyDetail"
| "CmdFuBenDailyGetRewardReqMsg"
| "CmdFuBenDailyGetRewardRspMsg"
| "CmdFuBenDetail"
| "CmdFuBenEnterReqMsg"
| "CmdFuBenEnterRspMsg"
| "CmdFuBenGoldDetail"
| "CmdFuBenRewardState"
| "CmdFuBen_Key"
| "CmdFund"
| "CmdFundDetail"
| "CmdFundGetInfoReqMsg"
| "CmdFundGetInfoRspMsg"
| "CmdFundGetRewardReqMsg"
| "CmdFundGetRewardRspMsg"
| "CmdFundRewardState"
| "CmdFund_Key"
| "CmdGameCircle"
| "CmdGameCircle_Key"
| "CmdGameExtend"
| "CmdGem"
| "CmdGemComposePreviewReqMsg"
| "CmdGemComposePreviewRspMsg"
| "CmdGemComposeReqMsg"
| "CmdGemComposeRspMsg"
| "CmdGemDownReqMsg"
| "CmdGemDownRspMsg"
| "CmdGemInfo"
| "CmdGemLockReqMsg"
| "CmdGemLockRspMsg"
| "CmdGemOnReqMsg"
| "CmdGemOnRspMsg"
| "CmdGemPreview"
| "CmdGemRefineReqMsg"
| "CmdGemRefineRspMsg"
| "CmdGemRefineSaveReqMsg"
| "CmdGemRefineSaveRspMsg"
| "CmdGemRefreshSkillReqMsg"
| "CmdGemRefreshSkillRspMsg"
| "CmdGemReplaceReqMsg"
| "CmdGemReplaceRspMsg"
| "CmdGem_Key"
| "CmdGetAllPlayClientAniReqMsg"
| "CmdGetAllPlayClientAniRspMsg"
| "CmdGetHallRoleListReqMsg"
| "CmdGetHallRoleListRspMsg"
| "CmdGetRankReqMsg"
| "CmdGetRankRspMsg"
| "CmdGmInfo"
| "CmdGmListReqMsg"
| "CmdGmListRspMsg"
| "CmdGoodReplace"
| "CmdGoods"
| "CmdGoodsList"
| "CmdGoodsRedDot"
| "CmdGoodsRedDotDispelReqMsg"
| "CmdGoodsRedDotDispelRspMsg"
| "CmdGuanKaGift"
| "CmdGuanKaGiftBroMsg"
| "CmdGuanKaGift_Key"
| "CmdGuide"
| "CmdGuideDetail"
| "CmdGuideReadReqMsg"
| "CmdGuideReadRspMsg"
| "CmdGuideRecordReqMsg"
| "CmdGuideRecordRspMsg"
| "CmdGuide_Key"
| "CmdHallRole"
| "CmdHang"
| "CmdHangGetRewardReqMsg"
| "CmdHangGetRewardRspMsg"
| "CmdHangQuickReqMsg"
| "CmdHangQuickRspMsg"
| "CmdHangTimeReqMsg"
| "CmdHangTimeRspMsg"
| "CmdHang_Key"
| "CmdHero"
| "CmdHeroChangeReqMsg"
| "CmdHeroChangeRspMsg"
| "CmdHeroLevelUpOneKeyReqMsg"
| "CmdHeroLevelUpOneKeyRspMsg"
| "CmdHeroLevelUpReqMsg"
| "CmdHeroLevelUpRspMsg"
| "CmdHeroOpenReqMsg"
| "CmdHeroOpenRspMsg"
| "CmdHeroUnlockGetInfoReqMsg"
| "CmdHeroUnlockGetInfoRspMsg"
| "CmdHeroUnlockInfo"
| "CmdHeroUnlockRewardReqMsg"
| "CmdHeroUnlockRewardRspMsg"
| "CmdHero_Key"
| "CmdI18N"
| "CmdItem"
| "CmdItemBoxUseReqMsg"
| "CmdItemBoxUseRspMsg"
| "CmdItemUseReqMsg"
| "CmdItemUseRspMsg"
| "CmdItem_Key"
| "CmdLockMonster"
| "CmdLockMonster_Key"
| "CmdOathAlliance"
| "CmdOathAlliance_Key"
| "CmdMail"
| "CmdMailDeleteReqMsg"
| "CmdMailDeleteRspMsg"
| "CmdMailListReqMsg"
| "CmdMailListRspMsg"
| "CmdMailReadReqMsg"
| "CmdMailReadRspMsg"
| "CmdMailSimple"
| "CmdMailTakeRewardReqMsg"
| "CmdMailTakeRewardRspMsg"
| "CmdMall"
| "CmdMallBroMsg"
| "CmdMallChapterGiftDetail"
| "CmdMallChargeDetail"
| "CmdMallCoinBuyReqMsg"
| "CmdMallCoinBuyRspMsg"
| "CmdMallCoinDetail"
| "CmdMallDailyShopBuyReqMsg"
| "CmdMallDailyShopBuyRspMsg"
| "CmdMallDailyShopDetail"
| "CmdMallDetail"
| "CmdMallGetDataReqMsg"
| "CmdMallGetDataRspMsg"
| "CmdMallLuckDrawDetail"
| "CmdMallLuckDrawReqMsg"
| "CmdMallLuckDrawRspMsg"
| "CmdMallSEquipDetail"
| "CmdMallSEquipDrawReqMsg"
| "CmdMallSEquipDrawRspMsg"
| "CmdMall_Key"
| "CmdMiningBuyReqMsg"
| "CmdMiningBuyRspMsg"
| "CmdModifyItemBroMsg"
| "CmdMonthCardActDetail"
| "CmdOpenCache"
| "CmdOpenCache_Key"
| "CmdPoint"
| "CmdRankData"
| "CmdRankItem"
| "CmdRankItem_Key"
| "CmdRankRole"
| "CmdChapterFirstPassInfo"
| "CmdChapterFirstPassInfo_Key"
| "CmdRecharge"
| "CmdRechargeBroMsg"
| "CmdRechargeGiftAct2Detail"
| "CmdRechargeGiftAct3Detail"
| "CmdRechargeGiftActDetail"
| "CmdRecordClientAniReqMsg"
| "CmdRecordClientAniRspMsg"
| "CmdRedDotCache"
| "CmdRedDotCache_Key"
| "CmdRole"
| "CmdRoleAppletShareReqMsg"
| "CmdRoleAppletShareRewardReqMsg"
| "CmdRoleAppletShareRewardRspMsg"
| "CmdRoleAppletShareRspMsg"
| "CmdRoleChangeHeadFrameReqMsg"
| "CmdRoleChangeHeadFrameRspMsg"
| "CmdRoleChangeImgReqMsg"
| "CmdRoleChangeImgRspMsg"
| "CmdRoleChangeNameReqMsg"
| "CmdRoleChangeNameRspMsg"
| "CmdRoleDouYinRewardReqMsg"
| "CmdRoleDouYinRewardRspMsg"
| "CmdRoleEndBuyInfo"
| "CmdRoleEndUpdateReqMsg"
| "CmdRoleEndUpdateRspMsg"
| "CmdRoleGuanKaGiftBuyReqMsg"
| "CmdRoleGuanKaGiftBuyRspMsg"
| "CmdRoleGuanKaGiftSelectReqMsg"
| "CmdRoleGuanKaGiftSelectRspMsg"
| "CmdRoleInfoViewReqMsg"
| "CmdArmyShow"
| "CmdArmyShowList"
| "CmdEquipLook"
| "CmdRoleInfoViewRspMsg"
| "CmdRoleLoginReqMsg"
| "CmdRoleLoginRspMsg"
| "CmdRoleOfflineBroMsg"
| "CmdRoleTakeFirstChargeReqMsg"
| "CmdRoleTakeFirstChargeRspMsg"
| "CmdRoleUploadPlatformImgReqMsg"
| "CmdRoleUploadPlatformImgRspMsg"
| "CmdRoleWatchAdvertReqMsg"
| "CmdRoleWatchAdvertRspMsg"
| "CmdRole_Key"
| "CmdRoll"
| "CmdRollBroMsg"
| "CmdRune"
| "CmdRunePutOnReqMsg"
| "CmdRunePutOnRspMsg"
| "CmdRuneReplaceReqMsg"
| "CmdRuneReplaceRspMsg"
| "CmdRuneSynthesisOneKeyReqMsg"
| "CmdRuneSynthesisOneKeyRspMsg"
| "CmdRuneSynthesisReqMsg"
| "CmdRuneSynthesisRspMsg"
| "CmdRuneTakeOffReqMsg"
| "CmdRuneTakeOffRspMsg"
| "CmdRune_Key"
| "CmdSecretRealm"
| "CmdSecretRealmScore"
| "CmdSecretRealm_Key"
| "CmdSevenDayInfo"
| "CmdSevenDayInfoReqMsg"
| "CmdSevenDayInfoRspMsg"
| "CmdSevenDayPoint"
| "CmdSevenDayShop"
| "CmdSevenDayShopBuyReqMsg"
| "CmdSevenDayShopBuyRspMsg"
| "CmdSevenDayTakePointRewardReqMsg"
| "CmdSevenDayTakePointRewardRspMsg"
| "CmdSevenDayTakeTaskRewardReqMsg"
| "CmdSevenDayTakeTaskRewardRspMsg"
| "CmdShare"
| "CmdShareGetRewardReqMsg"
| "CmdShareGetRewardRspMsg"
| "CmdShareStateReqMsg"
| "CmdShareStateRspMsg"
| "CmdShare_Key"
| "CmdShop"
| "CmdShopBuyReqMsg"
| "CmdShopBuyRspMsg"
| "CmdShopGoods"
| "CmdShop_Key"
| "CmdSigninInfo"
| "CmdSigninInfoReqMsg"
| "CmdSigninInfoRspMsg"
| "CmdSigninTakeTaskRewardReqMsg"
| "CmdSigninTakeTaskRewardRspMsg"
| "CmdSkin"
| "CmdSkinActDetail"
| "CmdSkinPlayer"
| "CmdSkinShop"
| "CmdSkin_Key"
| "CmdSpecialGiftCache"
| "CmdSpecialGiftCache_Key"
| "CmdSpiritAnimal"
| "CmdSpiritAnimalBattleReqMsg"
| "CmdSpiritAnimalBattleRspMsg"
| "CmdSpiritAnimalData"
| "CmdSpiritAnimalLevelUpReqMsg"
| "CmdSpiritAnimalLevelUpRspMsg"
| "CmdSpiritAnimalResetPreviewReqMsg"
| "CmdSpiritAnimalResetPreviewRspMsg"
| "CmdSpiritAnimalResetReqMsg"
| "CmdSpiritAnimalResetRspMsg"
| "CmdSpiritAnimalStepUpReqMsg"
| "CmdSpiritAnimalStepUpRspMsg"
| "CmdSpiritAnimal_Key"
| "CmdSystemGmReqMsg"
| "CmdSystemGmRspMsg"
| "CmdSystemSyncTimeReqMsg"
| "CmdSystemSyncTimeRspMsg"
| "CmdTakeChapterRewardReqMsg"
| "CmdTakeChapterRewardRspMsg"
| "CmdTakeDayChallengeActRewardReqMsg"
| "CmdTakeDayChallengeActRewardRspMsg"
| "CmdTakeGameCircleRewardReqMsg"
| "CmdTakeGameCircleRewardRspMsg"
| "CmdTakeLockMonsterBoxReqMsg"
| "CmdTakeLockMonsterBoxRspMsg"
| "CmdLockMonsterSweepReqMsg"
| "CmdLockMonsterSweepRspMsg"
| "CmdTakeMonthCardActRewardReqMsg"
| "CmdTakeMonthCardActRewardRspMsg"
| "CmdTakeRechargeGiftActRewardReqMsg"
| "CmdTakeRechargeGiftActRewardRspMsg"
| "CmdTakeSpiritAnimalBoxReqMsg"
| "CmdTakeSpiritAnimalBoxRspMsg"
| "CmdTask"
| "CmdTask_Key"
| "CmdTips"
| "CmdUpdateRedDotReqMsg"
| "CmdUpdateRedDotRspMsg"
| "EveryDayGift"
| "EveryDaySignInReward"
| "CmdCommonRole"
| "CmdCommonRole_Key"
| "CmdBattleRoleAttr"
| "CmdBattleRoleAttrList"
| "CmdTeamDetail"
| "CmdInviteInfo"
| "CmdRecruitInfo"
| "CmdRecruitInfoList"
| "CmdTeamInitReqMsg"
| "CmdTeamInitRspMsg"
| "CmdTeamCreateReqMsg"
| "CmdTeamCreateRspMsg"
| "CmdTeamDetailBroMsg"
| "CmdTeamDisbandBroMsg"
| "CmdTeamInviteReqMsg"
| "CmdTeamInviteRspMsg"
| "CmdTeamInviteBroMsg"
| "CmdTeamReplyInviteReqMsg"
| "CmdTeamReplyInviteRspMsg"
| "CmdTeamReplyInviteBroMsg"
| "CmdTeamQuitReqMsg"
| "CmdTeamQuitRspMsg"
| "CmdTeamKickReqMsg"
| "CmdTeamKickRspMsg"
| "CmdTeamRecruitInitReqMsg"
| "CmdTeamRecruitInitRspMsg"
| "CmdTeamRecruitSendReqMsg"
| "CmdTeamRecruitSendRspMsg"
| "CmdTeamRecruitSendBroMsg"
| "CmdTeamRecruitJoinReqMsg"
| "CmdTeamRecruitJoinRspMsg"
| "CmdTeamKickBroMsg"
| "CmdBattleTeamEnterReqMsg"
| "CmdBattleTeamEnterRspMsg"
| "CmdBattleTeamEnterBroMsg"
| "CmdBattleTeamUpdateReqMsg"
| "CmdBattleTeamUpdateRspMsg"
| "CmdBattleTeamUpdateBroMsg"
| "CmdArmyLevel"
| "CmdArmyLevel_Key"
| "CmdArmySkinSelect"
| "CmdArmySkinSelect_Key"
| "CmdArmySkinStar"
| "CmdArmySkinStar_Key"
| "CmdAdvisor"
| "CmdAdvisor_Key"
| "CmdAdvisorPage"
| "CmdAdvisorPage_Key"
| "CmdGeneral"
| "CmdGeneral_Key"
| "CmdGeneralPage"
| "CmdGeneralPage_Key"
| "CmdArmyLevelUpReqMsg"
| "CmdArmyLevelUpRspMsg"
| "CmdArmySkinAddStarReqMsg"
| "CmdArmySkinAddStarRspMsg"
| "CmdArmySelectSkinReqMsg"
| "CmdArmySelectSkinRspMsg"
| "CmdAdvisorAddStarReqMsg"
| "CmdAdvisorAddStarRspMsg"
| "CmdAdvisorSelectPageReqMsg"
| "CmdAdvisorSelectPageRspMsg"
| "CmdAdvisorBattleReqMsg"
| "CmdAdvisorBattleRspMsg"
| "CmdAdvisorShowReqMsg"
| "CmdAdvisorShowRspMsg"
| "CmdGeneralAddStarReqMsg"
| "CmdGeneralAddStarRspMsg"
| "CmdGeneralSelectPageReqMsg"
| "CmdGeneralSelectPageRspMsg"
| "CmdGeneralBattleReqMsg"
| "CmdGeneralBattleRspMsg"
| "CmdFriend"
| "CmdFriend_Key"
| "CmdFriendApply"
| "CmdFriendApply_Key"
| "CmdFriendBlack"
| "CmdFriendBlack_Key"
| "CmdFriendsApplyReqMsg"
| "CmdFriendsApplyRspMsg"
| "CmdFriendsApplyBroMsg"
| "CmdFriendsAddReqMsg"
| "CmdFriendsAddRspMsg"
| "CmdFriendsAddBroMsg"
| "CmdFriendsRefuseReqMsg"
| "CmdFriendsRefuseRspMsg"
| "CmdFriendsRefuseBroMsg"
| "CmdFriendsRemoveReqMsg"
| "CmdFriendsRemoveRspMsg"
| "CmdFriendsRemoveBroMsg"
| "CmdFriendsBlackReqMsg"
| "CmdFriendsBlackRspMsg"
| "CmdFriendBlackRemoveReqMsg"
| "CmdFriendBlackRemoveRspMsg"
| "CmdFriendsSearchReqMsg"
| "CmdFriendsSearchRspMsg"
| "CmdFriendGetEndReqMsg"
| "CmdFriendGetEndRspMsg"
| "CmdFriendGetEndOneKeyReqMsg"
| "CmdFriendGetEndOneKeyRspMsg"
| "CmdFriendSendEndReqMsg"
| "CmdFriendSendEndRspMsg"
| "CmdFriendSendEndBroMsg"
| "CmdFriendSendEndOneKeyReqMsg"
| "CmdFriendSendEndOneKeyRspMsg"
| "CmdFriendSendEndOneKeyBroMsg"
| "CmdFriendAgreeOneKeyReqMsg"
| "CmdFriendAgreeOneKeyRspMsg"
| "CmdFriendAgreeOneKeyBroMsg"
| "CmdFriendRefuseOneKeyReqMsg"
| "CmdFriendRefuseOneKeyRspMsg"
| "CmdFriendRefuseOneKeyBroMsg"
| "CmdFriendRefreshSuggestReqMsg"
| "CmdFriendRefreshSuggestRspMsg"
| "CmdChatRole"
| "CmdChatRole_Key"
| "CmdChatMsgClient"
| "CmdChatMsg"
| "CmdChatMsg_Key"
| "CmdChatInitReqMsg"
| "CmdChatInitRspMsg"
| "CmdChatSendReqMsg"
| "CmdChatSendRspMsg"
| "CmdChatBroMsg"
| "CmdChatDelTargetReqMsg"
| "CmdChatDelTargetRspMsg"
| "CmdGranary"
| "CmdGranary_Key"
| "CmdGranaryGetReqMsg"
| "CmdGranaryGetRspMsg"
| "CmdGranaryGetOneKeyReqMsg"
| "CmdGranaryGetOneKeyRspMsg"
| "CmdGranaryUpdateBroMsg"
| "CmdGetChapterFirstPassListReqMsg"
| "CmdGetChapterFirstPassListRspMsg"
| "CmdGetChapterFirstPassRewardReqMsg"
| "CmdGetChapterFirstPassRewardRspMsg"
| "CmdMonsterManualItem"
| "CmdMonsterManualItem_Key"
| "CmdMonsterManualActiveBroMsg"
| "CmdMonsterManualGetRewardReqMsg"
| "CmdMonsterManualGetRewardRspMsg"
| "CmdTakeMainTaskRewardReqMsg"
| "CmdTakeMainTaskRewardRspMsg"
| "CmdTaskUnionGetRewardReqMsg"
| "CmdTaskUnionGetRewardRspMsg"
| "CmdTaskUnionGetProgressRewardReqMsg"
| "CmdTaskUnionGetProgressRewardRspMsg"
| "CmdUnion"
| "CmdUnion_Key"
| "CmdUnionSimple"
| "CmdUnionSimple_Key"
| "CmdUnionMember"
| "CmdUnionMember_Key"
| "CmdUnionApplys"
| "CmdUnionApplys_Key"
| "CmdUnionLogs"
| "CmdUnionLogs_Key"
| "CmdRoleUnion"
| "CmdRoleUnion_Key"
| "CmdUnionShow"
| "CmdUnionCreateReqMsg"
| "CmdUnionCreateRspMsg"
| "CmdUnionJoinReqMsg"
| "CmdUnionJoinRspMsg"
| "CmdUnionApproveJoinReqMsg"
| "CmdUnionApproveJoinRspMsg"
| "CmdUnionApproveJoinOneKeyReqMsg"
| "CmdUnionApproveJoinOneKeyRspMsg"
| "CmdUnionQuitReqMsg"
| "CmdUnionQuitRspMsg"
| "CmdUnionKickReqMsg"
| "CmdUnionKickRspMsg"
| "CmdUnionAppointReqMsg"
| "CmdUnionAppointRspMsg"
| "CmdUnionSetQuickJoinReqMsg"
| "CmdUnionSetQuickJoinRspMsg"
| "CmdUnionEditReqMsg"
| "CmdUnionEditRspMsg"
| "CmdUnionDetailReqMsg"
| "CmdUnionDetailRspMsg"
| "CmdUnionApplyListReqMsg"
| "CmdUnionApplyListRspMsg"
| "CmdUnionLogReqMsg"
| "CmdUnionLogRspMsg"
| "CmdUnionListReqMsg"
| "CmdUnionListRspMsg"
| "CmdUnionSearchReqMsg"
| "CmdUnionSearchRspMsg"
| "CmdUnionDonateReqMsg"
| "CmdUnionDonateRspMsg"
| "CmdUnionApproveJoinBroMsg"
| "CmdUnionInfoUpdateBroMsg"
| "CmdUnionMemberListUpdateBroMsg"
| "CmdUnionApplyListUpdateBroMsg"
| "CmdUnionLogListUpdateBroMsg"
| "CmdUnionListUpdateBroMsg"
| "CmdUnionTaskListUpdateBroMsg"
| "CmdUnionActInfo"
| "CmdUnionActivity"
| "CmdUnionActivity_Key"
| "CmdRoleActBossDamage"
| "CmdRoleActBossDamage_Key"
| "CmdUnionActBossDamage"
| "CmdUnionActBossDamage_Key"
| "CmdUnionBargainReqMsg"
| "CmdUnionBargainRspMsg"
| "CmdUnionActListReqMsg"
| "CmdUnionActListRspMsg"
| "CmdUnionActDrumReqMsg"
| "CmdUnionActDrumRspMsg"
| "CmdUnionActSweepReqMsg"
| "CmdUnionActSweepRspMsg"
| "CmdTakeOathAllianceRewardReqMsg"
| "CmdTakeOathAllianceRewardRspMsg"
| "CmdBattleBuyBlessReqMsg"
| "CmdBattleBuyBlessRspMsg"
| "CmdBattleBuyBlessBroMsg"
| "CmdCastleGuards"
| "CmdCastleGuards_Key"
| "CmdCastleGuardsActiveReqMsg"
| "CmdCastleGuardsActiveRspMsg"
| "CmdCastleGuardsActiveBroMsg"
| "CmdCastleGuardsLevelUpReqMsg"
| "CmdCastleGuardsLevelUpRspMsg"
| "CmdCastleGuardsRankUpReqMsg"
| "CmdCastleGuardsRankUpRspMsg"
| "CmdCastleGuardsUpReqMsg"
| "CmdCastleGuardsUpRspMsg"
| "CmdFirstRecharge"
| "CmdFirstRecharge_Key"
| "CmdFirstRechargeNewItem"
| "CmdFirstRechargeNew"
| "CmdFirstRechargeNew_Key"
| "CmdFirstRechargeOpenReqMsg"
| "CmdFirstRechargeOpenRspMsg"
| "CmdFirstRechargesBuyReqMsg"
| "CmdFirstRechargesBuyRspMsg"
| "CmdFirstRechargesBuyBroMsg"
| "CmdFirstRechargeRewardReqMsg"
| "CmdFirstRechargeRewardRspMsg"
| "CmdRoleActDamage"
| "CmdRoleActDamage_Key"
| "CmdFuBenBuyTimesReqMsg"
| "CmdFuBenBuyTimesRspMsg"
| "CmdFuBenSweepReqMsg"
| "CmdFuBenSweepRspMsg"
| "CmdBattleTokenMessage"
| "CmdBattleToken"
| "CmdBattleToken_Key"
| "CmdBattleTokenOpenReqMsg"
| "CmdBattleTokenOpenRspMsg"
| "CmdBattleTokenOpenBroMsg"
| "CmdBattleTokenResetReqMsg"
| "CmdBattleTokenResetRspMsg"
| "CmdBattleTokenTakeRewardReqMsg"
| "CmdBattleTokenTakeRewardRspMsg"
| "CmdCardCache"
| "CmdCardCache_Key"
| "CmdCardBuyReqMsg"
| "CmdCardBuyRspMsg"
| "CmdCardBuyBroMsg"
| "CmdRechargeDailyItem"
| "CmdRechargeDaily"
| "CmdRechargeDaily_Key"
| "CmdRechargeDailyUpdateBroMsg"
| "CmdRechargeDailyGetRewardReqMsg"
| "CmdRechargeDailyGetRewardRspMsg"
| "CmdRechargeDailyGetAccRewardReqMsg"
| "CmdRechargeDailyGetAccRewardRspMsg"
| "CmdTakeDayActProgressRewardReqMsg"
| "CmdTakeDayActProgressRewardRspMsg"
| "CmdLeaderSkillLevel"
| "CmdLeaderSkill"
| "CmdLeaderSkill_Key"
| "CmdLeaderSkillBattleReqMsg"
| "CmdLeaderSkillBattleRspMsg"
| "CmdLeaderSkillShowReqMsg"
| "CmdLeaderSkillShowRspMsg"
| "CmdLeaderSkillUpgradeReqMsg"
| "CmdLeaderSkillUpgradeRspMsg"
| "CmdLimitedTimeBundle"
| "CmdLimitedTimeBundle_Key"
| "CmdRefreshLimitedTimeBundleBroMsg"
| "CmdBuyLimitedTimeBundleBroMsg"
| "CmdCelebrationInfo"
| "CmdCelebrationInfo_Key"
| "CmdCelebrationUpdateDataBroMsg"
| "CmdCelebrationGetTargetRewardReqMsg"
| "CmdCelebrationGetTargetRewardRspMsg"
| "CmdCelebrationBuyShopGoodsReqMsg"
| "CmdCelebrationBuyShopGoodsRspMsg"
| "CmdCelebrationBuyShopGoodsBroMsg"
| "CmdRoleQuestion"
| "CmdRoleQuestion_Key"
| "CmdRoleQuestionClickReqMsg"
| "CmdRoleQuestionClickRspMsg"
| "CmdTaskTurntableLotteryGetRewardReqMsg"
| "CmdTaskTurntableLotteryGetRewardRspMsg"
| "CmdActivityLotteryGetRewardReqMsg"
| "CmdActivityLotteryGetRewardRspMsg"
| "CmdLotteryLuckLog"
| "CmdActivityLotteryGetLuckLogReqMsg"
| "CmdActivityLotteryGetLuckLogRspMsg"
| "CmdRoleInteractInfo"
| "CmdRoleInteractInfo_Key"
| "CmdRoleInteractReqMsg"
| "CmdRoleInteractRspMsg"
| "CmdArtifact"
| "CmdArtifact_Key"
| "CmdArtifactPage"
| "CmdArtifactPage_Key"
| "CmdArtifactAddLevelReqMsg"
| "CmdArtifactAddLevelRspMsg"
| "CmdArtifactAddStarReqMsg"
| "CmdArtifactAddStarRspMsg"
| "CmdArtifactBattleReqMsg"
| "CmdArtifactBattleRspMsg"
| "CmdItemComposReqMsg"
| "CmdItemComposRspMsg"
| "CmdFormationInfo"
| "CmdFormationInfo_Key"
| "CmdFormationInfoReqMsg"
| "CmdFormationInfoRspMsg"
| "CmdFormationOpReqMsg"
| "CmdFormationOpRspMsg"
| "CmdFormationSelectReqMsg"
| "CmdFormationSelectRspMsg"
| "CmdNewTreasureInfo"
| "CmdNewTreasureInfoListReqMsg"
| "CmdNewTreasureInfoListRspMsg"
| "CmdNewTreasureActivateReqMsg"
| "CmdNewTreasureActivateRspMsg"
| "CmdNewTreasureFastOpenReqMsg"
| "CmdNewTreasureFastOpenRspMsg"
| "CmdNewTreasureOpenReqMsg"
| "CmdNewTreasureOpenRspMsg"
| "CmdNewTreasureInfoBroMsg"
| "CmdPvpHeroSkillInfo"
| "CmdPvpHeroInfo"
| "CmdPvpArtifactInfo"
| "CmdPvpHeroInfoListReqMsg"
| "CmdPvpHeroInfoListRspMsg"
| "CmdPvpHeroUpLevelReqMsg"
| "CmdPvpHeroUpLevelRspMsg"
| "CmdPvpHeroUpSkillReqMsg"
| "CmdPvpHeroUpSkillRspMsg"
| "CmdPvpArtifactInfoListReqMsg"
| "CmdPvpArtifactInfoListRspMsg"
| "CmdPvpArtifactUpLevelReqMsg"
| "CmdPvpArtifactUpLevelRspMsg"
| "CmdPvpArtifactSelectReqMsg"
| "CmdPvpArtifactSelectRspMsg"
| "CmdPvpInfo"
| "CmdBattleStatisticsInfo"
| "CmdPvpInfoReqMsg"
| "CmdPvpInfoRspMsg"
| "CmdPvpGradeRewardReqMsg"
| "CmdPvpGradeRewardRspMsg"
| "CmdBattleUnitShowInfo"
| "CmdBattleUnitInfo"
| "CmdStartBattleInfo"
| "CmdPveBattleResultInfo"
| "CmdChapterBattleResultInfo"
| "CmdSlgMonsterBattleResultInfo"
| "CmdSlgCampBattleResultInfo"
| "CmdBattleFrameInfo"
| "CmdStartBattleReqMsg"
| "CmdStartBattleRspMsg"
| "CmdFinishBattleReqMsg"
| "CmdFinishBattleRspMsg"
| "CmdBattleResultBroMsg"
| "ChapterInfo"
| "CmdCityChapterInfoReqMsg"
| "CmdCityChapterInfoRspMsg"
| "CmdCityChapterIdleRewardReqMsg"
| "CmdCityChapterIdleRewardRspMsg"
| "CmdCityChapterSweepReqMsg"
| "CmdCityChapterSweepRspMsg"
| "CmdCityChapterUnlockCellReqMsg"
| "CmdCityChapterUnlockCellRspMsg"
| "CmdCityChapterPassCellReqMsg"
| "CmdCityChapterPassCellRspMsg"
| "CmdCityChapterPassCellBroMsg"
| "CmdCityChapterInfoBroMsg"
| "CmdCityChapterCellInfoReqMsg"
| "CmdCityChapterCellInfoRspMsg"
| "SlgGameInfo"
| "SlgGameActionInfo"
| "SlgCampSimpleInfo"
| "SlgCampInfo"
| "SlgBuildInfo"
| "SlgBuildQueueInfo"
| "SlgBuildGameInfo"
| "CmdSlgCampSimpleInfoReqMsg"
| "CmdSlgCampSimpleInfoRspMsg"
| "CmdSlgCampInfoReqMsg"
| "CmdSlgCampInfoRspMsg"
| "CmdSlgActionUpdateReqMsg"
| "CmdSlgActionUpdateRspMsg"
| "CmdSlgGameInfoReqMsg"
| "CmdSlgGameInfoRspMsg"
| "CmdSlgGameInfoBroMsg"
| "CmdSlgBuildInfoReqMsg"
| "CmdSlgBuildInfoRspMsg"
| "CmdSlgBuildReqMsg"
| "CmdSlgBuildRspMsg"
| "CmdSlgBuildUpgradeReqMsg"
| "CmdSlgBuildUpgradeRspMsg"
| "CmdSlgBuildCancelReqMsg"
| "CmdSlgBuildCancelRspMsg"
| "CmdSlgBuildMoveReqMsg"
| "CmdSlgBuildMoveRspMsg"
| "CmdSlgBuildCollectReqMsg"
| "CmdSlgBuildCollectRspMsg"
| "CmdSlgBuildUnlockQueueReqMsg"
| "CmdSlgBuildUnlockQueueRspMsg"
| "CmdSlgBuildInfoBroMsg"
| "ClientCmdData"
| "CmdCache"
| "CmdCacheField"
| "CmdCacheUpdateByField"
| "CmdDouble"
| "CmdFloat"
| "CmdInt32"
| "CmdInt64"
| "ServerCmdData"

declare type ReqMsgProtoName =
| "CmdActivityJsonReqMsg"
| "CmdActivityLimitSkinBuyReqMsg"
| "CmdActivityLimitSkinInfoReqMsg"
| "CmdActivityLimitTimeInfoReqMsg"
| "CmdActivityLimitTimeTakeReqMsg"
| "CmdBattleCompleteInfoReqMsg"
| "CmdBattleDataUploadReqMsg"
| "CmdBattlePreviewReqMsg"
| "CmdBattleRandomSkillReqMsg"
| "CmdBattleResultReqMsg"
| "CmdBattleSelectSkillReqMsg"
| "CmdBattleStatisticsReqMsg"
| "CmdBattleSweepReqMsg"
| "CmdBreachReqMsg"
| "CmdBuySkinReqMsg"
| "CmdBuyStaBuyReqMsg"
| "CmdBuyStaInfoReqMsg"
| "CmdCastleSkillUpLevelReqMsg"
| "CmdCastleSkillResearchReqMsg"
| "CmdCastleWorkShopOpenReqMsg"
| "CmdCastleWorkShopUpLevelReqMsg"
| "CmdCastleWorkShopSpeedReqMsg"
| "CmdCastleWorkShopTakeReqMsg"
| "CmdCastleApprenticeUpReqMsg"
| "CmdCastleApprenticeUpLevelReqMsg"
| "CmdCastleWallUpLevelReqMsg"
| "CmdCastleWallQualityUpReqMsg"
| "CmdCastleWallSelectReqMsg"
| "CmdCastleWallUpSkillLevelReqMsg"
| "CmdCastleWallSkinUpStarReqMsg"
| "CmdCastleWallSelectSkillPageReqMsg"
| "CmdCastleWallSelectSkillReqMsg"
| "CmdChangeUsedSkinReqMsg"
| "CmdCodeExchangeReqMsg"
| "CmdContinueNextBattleReqMsg"
| "CmdContinuityGiftFinishRewardReqMsg"
| "CmdContinuityGiftInfoReqMsg"
| "CmdContinuityGiftRewardReqMsg"
| "CmdDayWeekMonthGiftFreeBuyReqMsg"
| "CmdDayWeekMonthGiftGetRewardReqMsg"
| "CmdDayWeekMonthGiftInfoReqMsg"
| "CmdEndBuyInfoReqMsg"
| "CmdEndBuyReqMsg"
| "CmdEnterBattleReqMsg"
| "CmdEquipChangePageNameReqMsg"
| "CmdEquipSelectPageReqMsg"
| "CmdEquipUpLevelAllReqMsg"
| "CmdEquipUpLevelReqMsg"
| "CmdEquipUpQualityReqMsg"
| "CmdEquipWashReqMsg"
| "CmdEquipWashConformReqMsg"
| "CmdEquipDecomposeReqMsg"
| "CmdEquipReplaceReqMsg"
| "CmdEveryDayGetRewardsReqMsg"
| "CmdEveryDaySignInInfoReqMsg"
| "CmdEveryDaySignInReqMsg"
| "CmdFuBenDailyGetRewardReqMsg"
| "CmdFuBenEnterReqMsg"
| "CmdFundGetInfoReqMsg"
| "CmdFundGetRewardReqMsg"
| "CmdGemComposePreviewReqMsg"
| "CmdGemComposeReqMsg"
| "CmdGemDownReqMsg"
| "CmdGemLockReqMsg"
| "CmdGemOnReqMsg"
| "CmdGemRefineReqMsg"
| "CmdGemRefineSaveReqMsg"
| "CmdGemRefreshSkillReqMsg"
| "CmdGemReplaceReqMsg"
| "CmdGetAllPlayClientAniReqMsg"
| "CmdGetHallRoleListReqMsg"
| "CmdGetRankReqMsg"
| "CmdGmListReqMsg"
| "CmdGoodsRedDotDispelReqMsg"
| "CmdGuideReadReqMsg"
| "CmdGuideRecordReqMsg"
| "CmdHangGetRewardReqMsg"
| "CmdHangQuickReqMsg"
| "CmdHangTimeReqMsg"
| "CmdHeroChangeReqMsg"
| "CmdHeroLevelUpOneKeyReqMsg"
| "CmdHeroLevelUpReqMsg"
| "CmdHeroOpenReqMsg"
| "CmdHeroUnlockGetInfoReqMsg"
| "CmdHeroUnlockRewardReqMsg"
| "CmdItemBoxUseReqMsg"
| "CmdItemUseReqMsg"
| "CmdMailDeleteReqMsg"
| "CmdMailListReqMsg"
| "CmdMailReadReqMsg"
| "CmdMailTakeRewardReqMsg"
| "CmdMallCoinBuyReqMsg"
| "CmdMallDailyShopBuyReqMsg"
| "CmdMallGetDataReqMsg"
| "CmdMallLuckDrawReqMsg"
| "CmdMallSEquipDrawReqMsg"
| "CmdMiningBuyReqMsg"
| "CmdRecordClientAniReqMsg"
| "CmdRoleAppletShareReqMsg"
| "CmdRoleAppletShareRewardReqMsg"
| "CmdRoleChangeHeadFrameReqMsg"
| "CmdRoleChangeImgReqMsg"
| "CmdRoleChangeNameReqMsg"
| "CmdRoleDouYinRewardReqMsg"
| "CmdRoleEndUpdateReqMsg"
| "CmdRoleGuanKaGiftBuyReqMsg"
| "CmdRoleGuanKaGiftSelectReqMsg"
| "CmdRoleInfoViewReqMsg"
| "CmdRoleLoginReqMsg"
| "CmdRoleTakeFirstChargeReqMsg"
| "CmdRoleUploadPlatformImgReqMsg"
| "CmdRoleWatchAdvertReqMsg"
| "CmdRunePutOnReqMsg"
| "CmdRuneReplaceReqMsg"
| "CmdRuneSynthesisOneKeyReqMsg"
| "CmdRuneSynthesisReqMsg"
| "CmdRuneTakeOffReqMsg"
| "CmdSevenDayInfoReqMsg"
| "CmdSevenDayShopBuyReqMsg"
| "CmdSevenDayTakePointRewardReqMsg"
| "CmdSevenDayTakeTaskRewardReqMsg"
| "CmdShareGetRewardReqMsg"
| "CmdShareStateReqMsg"
| "CmdShopBuyReqMsg"
| "CmdSigninInfoReqMsg"
| "CmdSigninTakeTaskRewardReqMsg"
| "CmdSpiritAnimalBattleReqMsg"
| "CmdSpiritAnimalLevelUpReqMsg"
| "CmdSpiritAnimalResetPreviewReqMsg"
| "CmdSpiritAnimalResetReqMsg"
| "CmdSpiritAnimalStepUpReqMsg"
| "CmdSystemGmReqMsg"
| "CmdSystemSyncTimeReqMsg"
| "CmdTakeChapterRewardReqMsg"
| "CmdTakeDayChallengeActRewardReqMsg"
| "CmdTakeGameCircleRewardReqMsg"
| "CmdTakeLockMonsterBoxReqMsg"
| "CmdLockMonsterSweepReqMsg"
| "CmdTakeMonthCardActRewardReqMsg"
| "CmdTakeRechargeGiftActRewardReqMsg"
| "CmdTakeSpiritAnimalBoxReqMsg"
| "CmdUpdateRedDotReqMsg"
| "CmdTeamInitReqMsg"
| "CmdTeamCreateReqMsg"
| "CmdTeamInviteReqMsg"
| "CmdTeamReplyInviteReqMsg"
| "CmdTeamQuitReqMsg"
| "CmdTeamKickReqMsg"
| "CmdTeamRecruitInitReqMsg"
| "CmdTeamRecruitSendReqMsg"
| "CmdTeamRecruitJoinReqMsg"
| "CmdBattleTeamEnterReqMsg"
| "CmdBattleTeamUpdateReqMsg"
| "CmdArmyLevelUpReqMsg"
| "CmdArmySkinAddStarReqMsg"
| "CmdArmySelectSkinReqMsg"
| "CmdAdvisorAddStarReqMsg"
| "CmdAdvisorSelectPageReqMsg"
| "CmdAdvisorBattleReqMsg"
| "CmdAdvisorShowReqMsg"
| "CmdGeneralAddStarReqMsg"
| "CmdGeneralSelectPageReqMsg"
| "CmdGeneralBattleReqMsg"
| "CmdFriendsApplyReqMsg"
| "CmdFriendsAddReqMsg"
| "CmdFriendsRefuseReqMsg"
| "CmdFriendsRemoveReqMsg"
| "CmdFriendsBlackReqMsg"
| "CmdFriendBlackRemoveReqMsg"
| "CmdFriendsSearchReqMsg"
| "CmdFriendGetEndReqMsg"
| "CmdFriendGetEndOneKeyReqMsg"
| "CmdFriendSendEndReqMsg"
| "CmdFriendSendEndOneKeyReqMsg"
| "CmdFriendAgreeOneKeyReqMsg"
| "CmdFriendRefuseOneKeyReqMsg"
| "CmdFriendRefreshSuggestReqMsg"
| "CmdChatInitReqMsg"
| "CmdChatSendReqMsg"
| "CmdChatDelTargetReqMsg"
| "CmdGranaryGetReqMsg"
| "CmdGranaryGetOneKeyReqMsg"
| "CmdGetChapterFirstPassListReqMsg"
| "CmdGetChapterFirstPassRewardReqMsg"
| "CmdMonsterManualGetRewardReqMsg"
| "CmdTakeMainTaskRewardReqMsg"
| "CmdTaskUnionGetRewardReqMsg"
| "CmdTaskUnionGetProgressRewardReqMsg"
| "CmdUnionCreateReqMsg"
| "CmdUnionJoinReqMsg"
| "CmdUnionApproveJoinReqMsg"
| "CmdUnionApproveJoinOneKeyReqMsg"
| "CmdUnionQuitReqMsg"
| "CmdUnionKickReqMsg"
| "CmdUnionAppointReqMsg"
| "CmdUnionSetQuickJoinReqMsg"
| "CmdUnionEditReqMsg"
| "CmdUnionDetailReqMsg"
| "CmdUnionApplyListReqMsg"
| "CmdUnionLogReqMsg"
| "CmdUnionListReqMsg"
| "CmdUnionSearchReqMsg"
| "CmdUnionDonateReqMsg"
| "CmdUnionBargainReqMsg"
| "CmdUnionActListReqMsg"
| "CmdUnionActDrumReqMsg"
| "CmdUnionActSweepReqMsg"
| "CmdTakeOathAllianceRewardReqMsg"
| "CmdBattleBuyBlessReqMsg"
| "CmdCastleGuardsActiveReqMsg"
| "CmdCastleGuardsLevelUpReqMsg"
| "CmdCastleGuardsRankUpReqMsg"
| "CmdCastleGuardsUpReqMsg"
| "CmdFirstRechargeOpenReqMsg"
| "CmdFirstRechargesBuyReqMsg"
| "CmdFirstRechargeRewardReqMsg"
| "CmdFuBenBuyTimesReqMsg"
| "CmdFuBenSweepReqMsg"
| "CmdBattleTokenOpenReqMsg"
| "CmdBattleTokenResetReqMsg"
| "CmdBattleTokenTakeRewardReqMsg"
| "CmdCardBuyReqMsg"
| "CmdRechargeDailyGetRewardReqMsg"
| "CmdRechargeDailyGetAccRewardReqMsg"
| "CmdTakeDayActProgressRewardReqMsg"
| "CmdLeaderSkillBattleReqMsg"
| "CmdLeaderSkillShowReqMsg"
| "CmdLeaderSkillUpgradeReqMsg"
| "CmdCelebrationGetTargetRewardReqMsg"
| "CmdCelebrationBuyShopGoodsReqMsg"
| "CmdRoleQuestionClickReqMsg"
| "CmdTaskTurntableLotteryGetRewardReqMsg"
| "CmdActivityLotteryGetRewardReqMsg"
| "CmdActivityLotteryGetLuckLogReqMsg"
| "CmdRoleInteractReqMsg"
| "CmdArtifactAddLevelReqMsg"
| "CmdArtifactAddStarReqMsg"
| "CmdArtifactBattleReqMsg"
| "CmdItemComposReqMsg"
| "CmdFormationInfoReqMsg"
| "CmdFormationOpReqMsg"
| "CmdFormationSelectReqMsg"
| "CmdNewTreasureInfoListReqMsg"
| "CmdNewTreasureActivateReqMsg"
| "CmdNewTreasureFastOpenReqMsg"
| "CmdNewTreasureOpenReqMsg"
| "CmdPvpHeroInfoListReqMsg"
| "CmdPvpHeroUpLevelReqMsg"
| "CmdPvpHeroUpSkillReqMsg"
| "CmdPvpArtifactInfoListReqMsg"
| "CmdPvpArtifactUpLevelReqMsg"
| "CmdPvpArtifactSelectReqMsg"
| "CmdPvpInfoReqMsg"
| "CmdPvpGradeRewardReqMsg"
| "CmdStartBattleReqMsg"
| "CmdFinishBattleReqMsg"
| "CmdCityChapterInfoReqMsg"
| "CmdCityChapterIdleRewardReqMsg"
| "CmdCityChapterSweepReqMsg"
| "CmdCityChapterUnlockCellReqMsg"
| "CmdCityChapterPassCellReqMsg"
| "CmdCityChapterCellInfoReqMsg"
| "CmdSlgCampSimpleInfoReqMsg"
| "CmdSlgCampInfoReqMsg"
| "CmdSlgActionUpdateReqMsg"
| "CmdSlgGameInfoReqMsg"
| "CmdSlgBuildInfoReqMsg"
| "CmdSlgBuildReqMsg"
| "CmdSlgBuildUpgradeReqMsg"
| "CmdSlgBuildCancelReqMsg"
| "CmdSlgBuildMoveReqMsg"
| "CmdSlgBuildCollectReqMsg"
| "CmdSlgBuildUnlockQueueReqMsg"

declare interface protoCacheGen{CmdActivity:{c:CmdActivity, c_k:CmdActivity_Key}
CmdRole:{c:CmdRole, c_k:CmdRole_Key}
CmdActivitySimple:{c:CmdActivitySimple, c_k:CmdActivitySimple_Key}
CmdBattleChapter:{c:CmdBattleChapter, c_k:CmdBattleChapter_Key}
CmdBattleLevel:{c:CmdBattleLevel, c_k:CmdBattleLevel_Key}
CmdBattleToken:{c:CmdBattleToken, c_k:CmdBattleToken_Key}
CmdBreach:{c:CmdBreach, c_k:CmdBreach_Key}
CmdCardCache:{c:CmdCardCache, c_k:CmdCardCache_Key}
CmdCastleApprentice:{c:CmdCastleApprentice, c_k:CmdCastleApprentice_Key}
CmdCastleSkill:{c:CmdCastleSkill, c_k:CmdCastleSkill_Key}
CmdCastleWall:{c:CmdCastleWall, c_k:CmdCastleWall_Key}
CmdCastleWallSkill:{c:CmdCastleWallSkill, c_k:CmdCastleWallSkill_Key}
CmdCastleWorkShop:{c:CmdCastleWorkShop, c_k:CmdCastleWorkShop_Key}
CmdChapter:{c:CmdChapter, c_k:CmdChapter_Key}
CmdCode:{c:CmdCode, c_k:CmdCode_Key}
CmdDayWeekMonthGift:{c:CmdDayWeekMonthGift, c_k:CmdDayWeekMonthGift_Key}
CmdEquipPage:{c:CmdEquipPage, c_k:CmdEquipPage_Key}
CmdEveryDaySign:{c:CmdEveryDaySign, c_k:CmdEveryDaySign_Key}
CmdFirstRecharge:{c:CmdFirstRecharge, c_k:CmdFirstRecharge_Key}
CmdFuBen:{c:CmdFuBen, c_k:CmdFuBen_Key}
CmdFund:{c:CmdFund, c_k:CmdFund_Key}
CmdGameCircle:{c:CmdGameCircle, c_k:CmdGameCircle_Key}
CmdGem:{c:CmdGem, c_k:CmdGem_Key}
CmdGuanKaGift:{c:CmdGuanKaGift, c_k:CmdGuanKaGift_Key}
CmdGuide:{c:CmdGuide, c_k:CmdGuide_Key}
CmdHang:{c:CmdHang, c_k:CmdHang_Key}
CmdHero:{c:CmdHero, c_k:CmdHero_Key}
CmdItem:{c:CmdItem, c_k:CmdItem_Key}
CmdLockMonster:{c:CmdLockMonster, c_k:CmdLockMonster_Key}
CmdMall:{c:CmdMall, c_k:CmdMall_Key}
CmdOpenCache:{c:CmdOpenCache, c_k:CmdOpenCache_Key}
CmdRankItem:{c:CmdRankItem, c_k:CmdRankItem_Key}
CmdRedDotCache:{c:CmdRedDotCache, c_k:CmdRedDotCache_Key}
CmdRune:{c:CmdRune, c_k:CmdRune_Key}
CmdSecretRealm:{c:CmdSecretRealm, c_k:CmdSecretRealm_Key}
CmdShare:{c:CmdShare, c_k:CmdShare_Key}
CmdShop:{c:CmdShop, c_k:CmdShop_Key}
CmdSkin:{c:CmdSkin, c_k:CmdSkin_Key}
CmdSpecialGiftCache:{c:CmdSpecialGiftCache, c_k:CmdSpecialGiftCache_Key}
CmdSpiritAnimal:{c:CmdSpiritAnimal, c_k:CmdSpiritAnimal_Key}
CmdTask:{c:CmdTask, c_k:CmdTask_Key}
CmdArmyLevel:{c:CmdArmyLevel, c_k:CmdArmyLevel_Key}
CmdGeneral:{c:CmdGeneral, c_k:CmdGeneral_Key}
CmdAdvisor:{c:CmdAdvisor, c_k:CmdAdvisor_Key}
CmdAdvisorPage:{c:CmdAdvisorPage, c_k:CmdAdvisorPage_Key}
CmdArmySkinStar:{c:CmdArmySkinStar, c_k:CmdArmySkinStar_Key}
CmdArmySkinSelect:{c:CmdArmySkinSelect, c_k:CmdArmySkinSelect_Key}
CmdGeneralPage:{c:CmdGeneralPage, c_k:CmdGeneralPage_Key}
CmdFriend:{c:CmdFriend, c_k:CmdFriend_Key}
CmdFriendApply:{c:CmdFriendApply, c_k:CmdFriendApply_Key}
CmdFriendBlack:{c:CmdFriendBlack, c_k:CmdFriendBlack_Key}
CmdChatRole:{c:CmdChatRole, c_k:CmdChatRole_Key}
CmdGranary:{c:CmdGranary, c_k:CmdGranary_Key}
CmdMonsterManualItem:{c:CmdMonsterManualItem, c_k:CmdMonsterManualItem_Key}
CmdEquipItem:{c:CmdEquipItem, c_k:CmdEquipItem_Key}
CmdEquipPart:{c:CmdEquipPart, c_k:CmdEquipPart_Key}
CmdUnion:{c:CmdUnion, c_k:CmdUnion_Key}
CmdUnionMember:{c:CmdUnionMember, c_k:CmdUnionMember_Key}
CmdUnionApplys:{c:CmdUnionApplys, c_k:CmdUnionApplys_Key}
CmdUnionLogs:{c:CmdUnionLogs, c_k:CmdUnionLogs_Key}
CmdRoleUnion:{c:CmdRoleUnion, c_k:CmdRoleUnion_Key}
CmdUnionActivity:{c:CmdUnionActivity, c_k:CmdUnionActivity_Key}
CmdRoleActBossDamage:{c:CmdRoleActBossDamage, c_k:CmdRoleActBossDamage_Key}
CmdOathAlliance:{c:CmdOathAlliance, c_k:CmdOathAlliance_Key}
CmdUnionActBossDamage:{c:CmdUnionActBossDamage, c_k:CmdUnionActBossDamage_Key}
CmdCastleWallSkinStar:{c:CmdCastleWallSkinStar, c_k:CmdCastleWallSkinStar_Key}
CmdCastleWallSkillPage:{c:CmdCastleWallSkillPage, c_k:CmdCastleWallSkillPage_Key}
CmdCastleGuards:{c:CmdCastleGuards, c_k:CmdCastleGuards_Key}
CmdFirstRechargeNew:{c:CmdFirstRechargeNew, c_k:CmdFirstRechargeNew_Key}
CmdRoleActDamage:{c:CmdRoleActDamage, c_k:CmdRoleActDamage_Key}
CmdRechargeDaily:{c:CmdRechargeDaily, c_k:CmdRechargeDaily_Key}
CmdLeaderSkill:{c:CmdLeaderSkill, c_k:CmdLeaderSkill_Key}
CmdLimitedTimeBundle:{c:CmdLimitedTimeBundle, c_k:CmdLimitedTimeBundle_Key}
CmdCelebrationInfo:{c:CmdCelebrationInfo, c_k:CmdCelebrationInfo_Key}
CmdRoleQuestion:{c:CmdRoleQuestion, c_k:CmdRoleQuestion_Key}
CmdRoleInteractInfo:{c:CmdRoleInteractInfo, c_k:CmdRoleInteractInfo_Key}
CmdArtifact:{c:CmdArtifact, c_k:CmdArtifact_Key}
CmdArtifactPage:{c:CmdArtifactPage, c_k:CmdArtifactPage_Key}}