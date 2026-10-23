import RefMgrBase from "../../../framework/ref/RefMgrBase";
//import { RefMgrGuideBase } from "../../ref/refEx/RefMgrGuideBase";
export default class RefBase{
protected _RefMgractivity:RefMgractivityBase<IRefactivity>;
protected _RefMgractivityOpen:RefMgractivityOpenBase<IRefactivityOpen>;
protected _RefMgractivityTab:RefMgractivityTabBase<IRefactivityTab>;
protected _RefMgrad:RefMgradBase<IRefad>;
protected _RefMgradvisor:RefMgradvisorBase<IRefadvisor>;
protected _RefMgradvisorStar:RefMgradvisorStarBase<IRefadvisorStar>;
protected _RefMgrapprentice:RefMgrapprenticeBase<IRefapprentice>;
protected _RefMgrapprenticeLevel:RefMgrapprenticeLevelBase<IRefapprenticeLevel>;
protected _RefMgrarmy:RefMgrarmyBase<IRefarmy>;
protected _RefMgrarmyLevel:RefMgrarmyLevelBase<IRefarmyLevel>;
protected _RefMgrarmySkillLevelUp:RefMgrarmySkillLevelUpBase<IRefarmySkillLevelUp>;
protected _RefMgrarmySkin:RefMgrarmySkinBase<IRefarmySkin>;
protected _RefMgrarmySkinStar:RefMgrarmySkinStarBase<IRefarmySkinStar>;
protected _RefMgrartifact:RefMgrartifactBase<IRefartifact>;
protected _RefMgrartifactLevel:RefMgrartifactLevelBase<IRefartifactLevel>;
protected _RefMgrartifactStar:RefMgrartifactStarBase<IRefartifactStar>;
protected _RefMgraudioConfig:RefMgraudioConfigBase<IRefaudioConfig>;
protected _RefMgrbaseBuilding:RefMgrbaseBuildingBase<IRefbaseBuilding>;
protected _RefMgrbaseBuildingLevel:RefMgrbaseBuildingLevelBase<IRefbaseBuildingLevel>;
protected _RefMgrbattleModel:RefMgrbattleModelBase<IRefbattleModel>;
protected _RefMgrbattleTokenConfig:RefMgrbattleTokenConfigBase<IRefbattleTokenConfig>;
protected _RefMgrbattleTokenPlan:RefMgrbattleTokenPlanBase<IRefbattleTokenPlan>;
protected _RefMgrbattleTokenReward:RefMgrbattleTokenRewardBase<IRefbattleTokenReward>;
protected _RefMgrbfPersonRankAward:RefMgrbfPersonRankAwardBase<IRefbfPersonRankAward>;
protected _RefMgrbfUnionRankAward:RefMgrbfUnionRankAwardBase<IRefbfUnionRankAward>;
protected _RefMgrbigmapBuilding:RefMgrbigmapBuildingBase<IRefbigmapBuilding>;
protected _RefMgrbigmapBuildingLevel:RefMgrbigmapBuildingLevelBase<IRefbigmapBuildingLevel>;
protected _RefMgrbigmapBuildingProduce:RefMgrbigmapBuildingProduceBase<IRefbigmapBuildingProduce>;
protected _RefMgrbigMapCamp:RefMgrbigMapCampBase<IRefbigMapCamp>;
protected _RefMgrbigmapCity:RefMgrbigmapCityBase<IRefbigmapCity>;
protected _RefMgrbigmapCityLevel:RefMgrbigmapCityLevelBase<IRefbigmapCityLevel>;
protected _RefMgrbigmapMonster:RefMgrbigmapMonsterBase<IRefbigmapMonster>;
protected _RefMgrbigmapQueue:RefMgrbigmapQueueBase<IRefbigmapQueue>;
protected _RefMgrbigmapRank:RefMgrbigmapRankBase<IRefbigmapRank>;
protected _RefMgrbigmapResource:RefMgrbigmapResourceBase<IRefbigmapResource>;
protected _RefMgrbigmapSchedule:RefMgrbigmapScheduleBase<IRefbigmapSchedule>;
protected _RefMgrbigmapScoreRule:RefMgrbigmapScoreRuleBase<IRefbigmapScoreRule>;
protected _RefMgrbigmapStamina:RefMgrbigmapStaminaBase<IRefbigmapStamina>;
protected _RefMgrbigmapWorld:RefMgrbigmapWorldBase<IRefbigmapWorld>;
protected _RefMgrbigNum:RefMgrbigNumBase<IRefbigNum>;
protected _RefMgrbuild:RefMgrbuildBase<IRefbuild>;
protected _RefMgrbuySta:RefMgrbuyStaBase<IRefbuySta>;
protected _RefMgrcardLevelUp:RefMgrcardLevelUpBase<IRefcardLevelUp>;
protected _RefMgrcelebrationConfig:RefMgrcelebrationConfigBase<IRefcelebrationConfig>;
protected _RefMgrcelebrationRank:RefMgrcelebrationRankBase<IRefcelebrationRank>;
protected _RefMgrcelebrationShop:RefMgrcelebrationShopBase<IRefcelebrationShop>;
protected _RefMgrcelebrationTarget:RefMgrcelebrationTargetBase<IRefcelebrationTarget>;
protected _RefMgrchapterAttrAddition:RefMgrchapterAttrAdditionBase<IRefchapterAttrAddition>;
protected _RefMgrchapterRankAward:RefMgrchapterRankAwardBase<IRefchapterRankAward>;
protected _RefMgrciFu:RefMgrciFuBase<IRefciFu>;
protected _RefMgrdayChallengeActTask:RefMgrdayChallengeActTaskBase<IRefdayChallengeActTask>;
protected _RefMgrdayChallengeActTaskProgress:RefMgrdayChallengeActTaskProgressBase<IRefdayChallengeActTaskProgress>;
protected _RefMgrdefenceModWave:RefMgrdefenceModWaveBase<IRefdefenceModWave>;
protected _RefMgrdefenceWaveReward:RefMgrdefenceWaveRewardBase<IRefdefenceWaveReward>;
protected _RefMgrequip:RefMgrequipBase<IRefequip>;
protected _RefMgrequipLevel:RefMgrequipLevelBase<IRefequipLevel>;
protected _RefMgrequipLib:RefMgrequipLibBase<IRefequipLib>;
protected _RefMgrequipRank:RefMgrequipRankBase<IRefequipRank>;
protected _RefMgrequipResonance:RefMgrequipResonanceBase<IRefequipResonance>;
protected _RefMgrequipType:RefMgrequipTypeBase<IRefequipType>;
protected _RefMgrfirstRechargeNew:RefMgrfirstRechargeNewBase<IReffirstRechargeNew>;
protected _RefMgrfirstRechargeShop:RefMgrfirstRechargeShopBase<IReffirstRechargeShop>;
protected _RefMgrfundPlan:RefMgrfundPlanBase<IReffundPlan>;
protected _RefMgrfundReward:RefMgrfundRewardBase<IReffundReward>;
protected _RefMgrgameCircleConfig:RefMgrgameCircleConfigBase<IRefgameCircleConfig>;
protected _RefMgrgameConfig:RefMgrgameConfigBase<IRefgameConfig>;
protected _RefMgrgem:RefMgrgemBase<IRefgem>;
protected _RefMgrgemAttribute:RefMgrgemAttributeBase<IRefgemAttribute>;
protected _RefMgrgemBox:RefMgrgemBoxBase<IRefgemBox>;
protected _RefMgrgemQuality:RefMgrgemQualityBase<IRefgemQuality>;
protected _RefMgrgemShop:RefMgrgemShopBase<IRefgemShop>;
protected _RefMgrgeneral:RefMgrgeneralBase<IRefgeneral>;
protected _RefMgrgeneralStar:RefMgrgeneralStarBase<IRefgeneralStar>;
protected _RefMgrgiftShop:RefMgrgiftShopBase<IRefgiftShop>;
protected _RefMgrgoldShop:RefMgrgoldShopBase<IRefgoldShop>;
protected _RefMgrgrade:RefMgrgradeBase<IRefgrade>;
protected _RefMgrguanka:RefMgrguankaBase<IRefguanka>;
protected _RefMgrguanka1:RefMgrguanka1Base<IRefguanka1>;
protected _RefMgrguankaChapter:RefMgrguankaChapterBase<IRefguankaChapter>;
protected _RefMgrguankaFBconfig:RefMgrguankaFBconfigBase<IRefguankaFBconfig>;
protected _RefMgrguankaFbType:RefMgrguankaFbTypeBase<IRefguankaFbType>;
protected _RefMgrguankaGift:RefMgrguankaGiftBase<IRefguankaGift>;
protected _RefMgrguankaHitLv:RefMgrguankaHitLvBase<IRefguankaHitLv>;
protected _RefMgrguankaLV:RefMgrguankaLVBase<IRefguankaLV>;
protected _RefMgrguankaMarch:RefMgrguankaMarchBase<IRefguankaMarch>;
protected _RefMgrguankaReward:RefMgrguankaRewardBase<IRefguankaReward>;
protected _RefMgrguankaReward1:RefMgrguankaReward1Base<IRefguankaReward1>;
protected _RefMgrguankaReward2:RefMgrguankaReward2Base<IRefguankaReward2>;
protected _RefMgrguankaSkillLevelUp:RefMgrguankaSkillLevelUpBase<IRefguankaSkillLevelUp>;
protected _RefMgrguankaStar:RefMgrguankaStarBase<IRefguankaStar>;
protected _RefMgrguards:RefMgrguardsBase<IRefguards>;
protected _RefMgrguardsLevel:RefMgrguardsLevelBase<IRefguardsLevel>;
protected _RefMgrguardsRank:RefMgrguardsRankBase<IRefguardsRank>;
protected _RefMgrguoGuanZJConfig:RefMgrguoGuanZJConfigBase<IRefguoGuanZJConfig>;
protected _RefMgrhead:RefMgrheadBase<IRefhead>;
protected _RefMgrheroSkill:RefMgrheroSkillBase<IRefheroSkill>;
protected _RefMgrheroSkillLevel:RefMgrheroSkillLevelBase<IRefheroSkillLevel>;
protected _RefMgricon:RefMgriconBase<IReficon>;
protected _RefMgridConfig:RefMgridConfigBase<IRefidConfig>;
protected _RefMgrinteractReward:RefMgrinteractRewardBase<IRefinteractReward>;
protected _RefMgritem:RefMgritemBase<IRefitem>;
protected _RefMgritemBox:RefMgritemBoxBase<IRefitemBox>;
protected _RefMgritemBoxPro:RefMgritemBoxProBase<IRefitemBoxPro>;
protected _RefMgritemCraft:RefMgritemCraftBase<IRefitemCraft>;
protected _RefMgritemType:RefMgritemTypeBase<IRefitemType>;
protected _RefMgrlevel:RefMgrlevelBase<IReflevel>;
protected _RefMgrlevelInfo:RefMgrlevelInfoBase<IReflevelInfo>;
protected _RefMgrlevelMapGrideReward:RefMgrlevelMapGrideRewardBase<IReflevelMapGrideReward>;
protected _RefMgrlimitedTimeBundle:RefMgrlimitedTimeBundleBase<IReflimitedTimeBundle>;
protected _RefMgrlimitTimeCard:RefMgrlimitTimeCardBase<IReflimitTimeCard>;
protected _RefMgrlockMonsterLevel:RefMgrlockMonsterLevelBase<IReflockMonsterLevel>;
protected _RefMgrlockMonsterRefreshCost:RefMgrlockMonsterRefreshCostBase<IReflockMonsterRefreshCost>;
protected _RefMgrlottery:RefMgrlotteryBase<IReflottery>;
protected _RefMgrlotteryshop1:RefMgrlotteryshop1Base<IReflotteryshop1>;
protected _RefMgrlotteryshop2:RefMgrlotteryshop2Base<IReflotteryshop2>;
protected _RefMgrlotteryshop3:RefMgrlotteryshop3Base<IReflotteryshop3>;
protected _RefMgrlotteryshop4:RefMgrlotteryshop4Base<IReflotteryshop4>;
protected _RefMgrlotterytask:RefMgrlotterytaskBase<IReflotterytask>;
protected _RefMgrmapconfig:RefMgrmapconfigBase<IRefmapconfig>;
protected _RefMgrmapTerrian:RefMgrmapTerrianBase<IRefmapTerrian>;
protected _RefMgrmatchTips:RefMgrmatchTipsBase<IRefmatchTips>;
protected _RefMgrmL:RefMgrmLBase<IRefmL>;
protected _RefMgrmodelRef:RefMgrmodelRefBase<IRefmodelRef>;
protected _RefMgrmonster:RefMgrmonsterBase<IRefmonster>;
protected _RefMgrmonsterCard:RefMgrmonsterCardBase<IRefmonsterCard>;
protected _RefMgrmonsterSkillType:RefMgrmonsterSkillTypeBase<IRefmonsterSkillType>;
protected _RefMgrmonthCardActPlan:RefMgrmonthCardActPlanBase<IRefmonthCardActPlan>;
protected _RefMgrneutralResource:RefMgrneutralResourceBase<IRefneutralResource>;
protected _RefMgrnewTreasureBoxCardPool:RefMgrnewTreasureBoxCardPoolBase<IRefnewTreasureBoxCardPool>;
protected _RefMgrnewTreasureBoxConfig:RefMgrnewTreasureBoxConfigBase<IRefnewTreasureBoxConfig>;
protected _RefMgrnewTreasureBoxQueueConfig:RefMgrnewTreasureBoxQueueConfigBase<IRefnewTreasureBoxQueueConfig>;
protected _RefMgrnpcTeam:RefMgrnpcTeamBase<IRefnpcTeam>;
protected _RefMgropen:RefMgropenBase<IRefopen>;
protected _RefMgropenGridReward:RefMgropenGridRewardBase<IRefopenGridReward>;
protected _RefMgrpayChannel:RefMgrpayChannelBase<IRefpayChannel>;
protected _RefMgrplotCard:RefMgrplotCardBase<IRefplotCard>;
protected _RefMgrplotDialogue:RefMgrplotDialogueBase<IRefplotDialogue>;
protected _RefMgrplotGuanka:RefMgrplotGuankaBase<IRefplotGuanka>;
protected _RefMgrprivilegeMonthCardInfo:RefMgrprivilegeMonthCardInfoBase<IRefprivilegeMonthCardInfo>;
protected _RefMgrproDesc:RefMgrproDescBase<IRefproDesc>;
protected _RefMgrpvpArtifact:RefMgrpvpArtifactBase<IRefpvpArtifact>;
protected _RefMgrpvpArtifactAscend:RefMgrpvpArtifactAscendBase<IRefpvpArtifactAscend>;
protected _RefMgrpvpAttrMap:RefMgrpvpAttrMapBase<IRefpvpAttrMap>;
protected _RefMgrpvpBaseTeamWeight:RefMgrpvpBaseTeamWeightBase<IRefpvpBaseTeamWeight>;
protected _RefMgrpvpBond:RefMgrpvpBondBase<IRefpvpBond>;
protected _RefMgrpvpCard:RefMgrpvpCardBase<IRefpvpCard>;
protected _RefMgrpvpCounter:RefMgrpvpCounterBase<IRefpvpCounter>;
protected _RefMgrpvpGlobal:RefMgrpvpGlobalBase<IRefpvpGlobal>;
protected _RefMgrpvpModifierOverride:RefMgrpvpModifierOverrideBase<IRefpvpModifierOverride>;
protected _RefMgrpvpPity:RefMgrpvpPityBase<IRefpvpPity>;
protected _RefMgrpvpSkill:RefMgrpvpSkillBase<IRefpvpSkill>;
protected _RefMgrpvpSkillBinding:RefMgrpvpSkillBindingBase<IRefpvpSkillBinding>;
protected _RefMgrpvpSkillPlan:RefMgrpvpSkillPlanBase<IRefpvpSkillPlan>;
protected _RefMgrpvpStatus:RefMgrpvpStatusBase<IRefpvpStatus>;
protected _RefMgrpvpTile:RefMgrpvpTileBase<IRefpvpTile>;
protected _RefMgrpvpTileGen:RefMgrpvpTileGenBase<IRefpvpTileGen>;
protected _RefMgrpvpTileGenParams:RefMgrpvpTileGenParamsBase<IRefpvpTileGenParams>;
protected _RefMgrpvpUnitGrowth:RefMgrpvpUnitGrowthBase<IRefpvpUnitGrowth>;
protected _RefMgrqingShen:RefMgrqingShenBase<IRefqingShen>;
protected _RefMgrrechargeContinuityGift:RefMgrrechargeContinuityGiftBase<IRefrechargeContinuityGift>;
protected _RefMgrrechargeDaily:RefMgrrechargeDailyBase<IRefrechargeDaily>;
protected _RefMgrrechargeGiftActPlan:RefMgrrechargeGiftActPlanBase<IRefrechargeGiftActPlan>;
protected _RefMgrrefToCodeEnum:RefMgrrefToCodeEnumBase<IRefrefToCodeEnum>;
protected _RefMgrresourceShop:RefMgrresourceShopBase<IRefresourceShop>;
protected _RefMgrrewardClientPool:RefMgrrewardClientPoolBase<IRefrewardClientPool>;
protected _RefMgrroleProperty:RefMgrrolePropertyBase<IRefroleProperty>;
protected _RefMgrsecretRealmAttr:RefMgrsecretRealmAttrBase<IRefsecretRealmAttr>;
protected _RefMgrsecretRealmLevel:RefMgrsecretRealmLevelBase<IRefsecretRealmLevel>;
protected _RefMgrsecretRealmRefreshCost:RefMgrsecretRealmRefreshCostBase<IRefsecretRealmRefreshCost>;
protected _RefMgrserverRank:RefMgrserverRankBase<IRefserverRank>;
protected _RefMgrsevenDayPoint:RefMgrsevenDayPointBase<IRefsevenDayPoint>;
protected _RefMgrsevenDayShop:RefMgrsevenDayShopBase<IRefsevenDayShop>;
protected _RefMgrsevenDayTask:RefMgrsevenDayTaskBase<IRefsevenDayTask>;
protected _RefMgrshare:RefMgrshareBase<IRefshare>;
protected _RefMgrshiMengBattleConfig:RefMgrshiMengBattleConfigBase<IRefshiMengBattleConfig>;
protected _RefMgrsigninTask:RefMgrsigninTaskBase<IRefsigninTask>;
protected _RefMgrskillAdditionBuff:RefMgrskillAdditionBuffBase<IRefskillAdditionBuff>;
protected _RefMgrskillAttr:RefMgrskillAttrBase<IRefskillAttr>;
protected _RefMgrskillAttrModifier:RefMgrskillAttrModifierBase<IRefskillAttrModifier>;
protected _RefMgrskillBook:RefMgrskillBookBase<IRefskillBook>;
protected _RefMgrskillBookLevel:RefMgrskillBookLevelBase<IRefskillBookLevel>;
protected _RefMgrskillBuff:RefMgrskillBuffBase<IRefskillBuff>;
protected _RefMgrskillEffect:RefMgrskillEffectBase<IRefskillEffect>;
protected _RefMgrskillEffectDamageType:RefMgrskillEffectDamageTypeBase<IRefskillEffectDamageType>;
protected _RefMgrskillEffectShow:RefMgrskillEffectShowBase<IRefskillEffectShow>;
protected _RefMgrskillLevelUP:RefMgrskillLevelUPBase<IRefskillLevelUP>;
protected _RefMgrskillType:RefMgrskillTypeBase<IRefskillType>;
protected _RefMgrskillView:RefMgrskillViewBase<IRefskillView>;
protected _RefMgrskin:RefMgrskinBase<IRefskin>;
protected _RefMgrspiritAnimal:RefMgrspiritAnimalBase<IRefspiritAnimal>;
protected _RefMgrspiritAnimalBox:RefMgrspiritAnimalBoxBase<IRefspiritAnimalBox>;
protected _RefMgrspiritAnimalLevel:RefMgrspiritAnimalLevelBase<IRefspiritAnimalLevel>;
protected _RefMgrspiritAnimalStep:RefMgrspiritAnimalStepBase<IRefspiritAnimalStep>;
protected _RefMgrspiritAnimalType:RefMgrspiritAnimalTypeBase<IRefspiritAnimalType>;
protected _RefMgrssjjRankAward:RefMgrssjjRankAwardBase<IRefssjjRankAward>;
protected _RefMgrswjjShop:RefMgrswjjShopBase<IRefswjjShop>;
protected _RefMgrsystemDesc:RefMgrsystemDescBase<IRefsystemDesc>;
protected _RefMgrtaskMain:RefMgrtaskMainBase<IReftaskMain>;
protected _RefMgrtaskType:RefMgrtaskTypeBase<IReftaskType>;
protected _RefMgrtaskUnion:RefMgrtaskUnionBase<IReftaskUnion>;
protected _RefMgrtaskUnionProgress:RefMgrtaskUnionProgressBase<IReftaskUnionProgress>;
protected _RefMgrunionDiscount:RefMgrunionDiscountBase<IRefunionDiscount>;
protected _RefMgrunionLevel:RefMgrunionLevelBase<IRefunionLevel>;
protected _RefMgrunionOfficial:RefMgrunionOfficialBase<IRefunionOfficial>;
protected _RefMgrunionShop:RefMgrunionShopBase<IRefunionShop>;
protected _RefMgrvaluableMonthCardInfo:RefMgrvaluableMonthCardInfoBase<IRefvaluableMonthCardInfo>;
protected _RefMgrviewtype:RefMgrviewtypeBase<IRefviewtype>;
protected _RefMgrwall:RefMgrwallBase<IRefwall>;
protected _RefMgrwallSkillLevel:RefMgrwallSkillLevelBase<IRefwallSkillLevel>;
protected _RefMgrwallType:RefMgrwallTypeBase<IRefwallType>;
protected _RefMgrwaveReward:RefMgrwaveRewardBase<IRefwaveReward>;
protected _RefMgrworkShop:RefMgrworkShopBase<IRefworkShop>;
protected _RefMgrworkShopLevel:RefMgrworkShopLevelBase<IRefworkShopLevel>;
protected _RefMgrzcGuide:RefMgrzcGuideBase<IRefzcGuide>;
protected _RefMgrzcGuideParams:RefMgrzcGuideParamsBase<IRefzcGuideParams>;
get RefMgractivity(){if(!this._RefMgractivity){this._RefMgractivity=new RefMgractivityBase<IRefactivity>()}return this._RefMgractivity}
get RefMgractivityOpen(){if(!this._RefMgractivityOpen){this._RefMgractivityOpen=new RefMgractivityOpenBase<IRefactivityOpen>()}return this._RefMgractivityOpen}
get RefMgractivityTab(){if(!this._RefMgractivityTab){this._RefMgractivityTab=new RefMgractivityTabBase<IRefactivityTab>()}return this._RefMgractivityTab}
get RefMgrad(){if(!this._RefMgrad){this._RefMgrad=new RefMgradBase<IRefad>()}return this._RefMgrad}
get RefMgradvisor(){if(!this._RefMgradvisor){this._RefMgradvisor=new RefMgradvisorBase<IRefadvisor>()}return this._RefMgradvisor}
get RefMgradvisorStar(){if(!this._RefMgradvisorStar){this._RefMgradvisorStar=new RefMgradvisorStarBase<IRefadvisorStar>()}return this._RefMgradvisorStar}
get RefMgrapprentice(){if(!this._RefMgrapprentice){this._RefMgrapprentice=new RefMgrapprenticeBase<IRefapprentice>()}return this._RefMgrapprentice}
get RefMgrapprenticeLevel(){if(!this._RefMgrapprenticeLevel){this._RefMgrapprenticeLevel=new RefMgrapprenticeLevelBase<IRefapprenticeLevel>()}return this._RefMgrapprenticeLevel}
get RefMgrarmy(){if(!this._RefMgrarmy){this._RefMgrarmy=new RefMgrarmyBase<IRefarmy>()}return this._RefMgrarmy}
get RefMgrarmyLevel(){if(!this._RefMgrarmyLevel){this._RefMgrarmyLevel=new RefMgrarmyLevelBase<IRefarmyLevel>()}return this._RefMgrarmyLevel}
get RefMgrarmySkillLevelUp(){if(!this._RefMgrarmySkillLevelUp){this._RefMgrarmySkillLevelUp=new RefMgrarmySkillLevelUpBase<IRefarmySkillLevelUp>()}return this._RefMgrarmySkillLevelUp}
get RefMgrarmySkin(){if(!this._RefMgrarmySkin){this._RefMgrarmySkin=new RefMgrarmySkinBase<IRefarmySkin>()}return this._RefMgrarmySkin}
get RefMgrarmySkinStar(){if(!this._RefMgrarmySkinStar){this._RefMgrarmySkinStar=new RefMgrarmySkinStarBase<IRefarmySkinStar>()}return this._RefMgrarmySkinStar}
get RefMgrartifact(){if(!this._RefMgrartifact){this._RefMgrartifact=new RefMgrartifactBase<IRefartifact>()}return this._RefMgrartifact}
get RefMgrartifactLevel(){if(!this._RefMgrartifactLevel){this._RefMgrartifactLevel=new RefMgrartifactLevelBase<IRefartifactLevel>()}return this._RefMgrartifactLevel}
get RefMgrartifactStar(){if(!this._RefMgrartifactStar){this._RefMgrartifactStar=new RefMgrartifactStarBase<IRefartifactStar>()}return this._RefMgrartifactStar}
get RefMgraudioConfig(){if(!this._RefMgraudioConfig){this._RefMgraudioConfig=new RefMgraudioConfigBase<IRefaudioConfig>()}return this._RefMgraudioConfig}
get RefMgrbaseBuilding(){if(!this._RefMgrbaseBuilding){this._RefMgrbaseBuilding=new RefMgrbaseBuildingBase<IRefbaseBuilding>()}return this._RefMgrbaseBuilding}
get RefMgrbaseBuildingLevel(){if(!this._RefMgrbaseBuildingLevel){this._RefMgrbaseBuildingLevel=new RefMgrbaseBuildingLevelBase<IRefbaseBuildingLevel>()}return this._RefMgrbaseBuildingLevel}
get RefMgrbattleModel(){if(!this._RefMgrbattleModel){this._RefMgrbattleModel=new RefMgrbattleModelBase<IRefbattleModel>()}return this._RefMgrbattleModel}
get RefMgrbattleTokenConfig(){if(!this._RefMgrbattleTokenConfig){this._RefMgrbattleTokenConfig=new RefMgrbattleTokenConfigBase<IRefbattleTokenConfig>()}return this._RefMgrbattleTokenConfig}
get RefMgrbattleTokenPlan(){if(!this._RefMgrbattleTokenPlan){this._RefMgrbattleTokenPlan=new RefMgrbattleTokenPlanBase<IRefbattleTokenPlan>()}return this._RefMgrbattleTokenPlan}
get RefMgrbattleTokenReward(){if(!this._RefMgrbattleTokenReward){this._RefMgrbattleTokenReward=new RefMgrbattleTokenRewardBase<IRefbattleTokenReward>()}return this._RefMgrbattleTokenReward}
get RefMgrbfPersonRankAward(){if(!this._RefMgrbfPersonRankAward){this._RefMgrbfPersonRankAward=new RefMgrbfPersonRankAwardBase<IRefbfPersonRankAward>()}return this._RefMgrbfPersonRankAward}
get RefMgrbfUnionRankAward(){if(!this._RefMgrbfUnionRankAward){this._RefMgrbfUnionRankAward=new RefMgrbfUnionRankAwardBase<IRefbfUnionRankAward>()}return this._RefMgrbfUnionRankAward}
get RefMgrbigmapBuilding(){if(!this._RefMgrbigmapBuilding){this._RefMgrbigmapBuilding=new RefMgrbigmapBuildingBase<IRefbigmapBuilding>()}return this._RefMgrbigmapBuilding}
get RefMgrbigmapBuildingLevel(){if(!this._RefMgrbigmapBuildingLevel){this._RefMgrbigmapBuildingLevel=new RefMgrbigmapBuildingLevelBase<IRefbigmapBuildingLevel>()}return this._RefMgrbigmapBuildingLevel}
get RefMgrbigmapBuildingProduce(){if(!this._RefMgrbigmapBuildingProduce){this._RefMgrbigmapBuildingProduce=new RefMgrbigmapBuildingProduceBase<IRefbigmapBuildingProduce>()}return this._RefMgrbigmapBuildingProduce}
get RefMgrbigMapCamp(){if(!this._RefMgrbigMapCamp){this._RefMgrbigMapCamp=new RefMgrbigMapCampBase<IRefbigMapCamp>()}return this._RefMgrbigMapCamp}
get RefMgrbigmapCity(){if(!this._RefMgrbigmapCity){this._RefMgrbigmapCity=new RefMgrbigmapCityBase<IRefbigmapCity>()}return this._RefMgrbigmapCity}
get RefMgrbigmapCityLevel(){if(!this._RefMgrbigmapCityLevel){this._RefMgrbigmapCityLevel=new RefMgrbigmapCityLevelBase<IRefbigmapCityLevel>()}return this._RefMgrbigmapCityLevel}
get RefMgrbigmapMonster(){if(!this._RefMgrbigmapMonster){this._RefMgrbigmapMonster=new RefMgrbigmapMonsterBase<IRefbigmapMonster>()}return this._RefMgrbigmapMonster}
get RefMgrbigmapQueue(){if(!this._RefMgrbigmapQueue){this._RefMgrbigmapQueue=new RefMgrbigmapQueueBase<IRefbigmapQueue>()}return this._RefMgrbigmapQueue}
get RefMgrbigmapRank(){if(!this._RefMgrbigmapRank){this._RefMgrbigmapRank=new RefMgrbigmapRankBase<IRefbigmapRank>()}return this._RefMgrbigmapRank}
get RefMgrbigmapResource(){if(!this._RefMgrbigmapResource){this._RefMgrbigmapResource=new RefMgrbigmapResourceBase<IRefbigmapResource>()}return this._RefMgrbigmapResource}
get RefMgrbigmapSchedule(){if(!this._RefMgrbigmapSchedule){this._RefMgrbigmapSchedule=new RefMgrbigmapScheduleBase<IRefbigmapSchedule>()}return this._RefMgrbigmapSchedule}
get RefMgrbigmapScoreRule(){if(!this._RefMgrbigmapScoreRule){this._RefMgrbigmapScoreRule=new RefMgrbigmapScoreRuleBase<IRefbigmapScoreRule>()}return this._RefMgrbigmapScoreRule}
get RefMgrbigmapStamina(){if(!this._RefMgrbigmapStamina){this._RefMgrbigmapStamina=new RefMgrbigmapStaminaBase<IRefbigmapStamina>()}return this._RefMgrbigmapStamina}
get RefMgrbigmapWorld(){if(!this._RefMgrbigmapWorld){this._RefMgrbigmapWorld=new RefMgrbigmapWorldBase<IRefbigmapWorld>()}return this._RefMgrbigmapWorld}
get RefMgrbigNum(){if(!this._RefMgrbigNum){this._RefMgrbigNum=new RefMgrbigNumBase<IRefbigNum>()}return this._RefMgrbigNum}
get RefMgrbuild(){if(!this._RefMgrbuild){this._RefMgrbuild=new RefMgrbuildBase<IRefbuild>()}return this._RefMgrbuild}
get RefMgrbuySta(){if(!this._RefMgrbuySta){this._RefMgrbuySta=new RefMgrbuyStaBase<IRefbuySta>()}return this._RefMgrbuySta}
get RefMgrcardLevelUp(){if(!this._RefMgrcardLevelUp){this._RefMgrcardLevelUp=new RefMgrcardLevelUpBase<IRefcardLevelUp>()}return this._RefMgrcardLevelUp}
get RefMgrcelebrationConfig(){if(!this._RefMgrcelebrationConfig){this._RefMgrcelebrationConfig=new RefMgrcelebrationConfigBase<IRefcelebrationConfig>()}return this._RefMgrcelebrationConfig}
get RefMgrcelebrationRank(){if(!this._RefMgrcelebrationRank){this._RefMgrcelebrationRank=new RefMgrcelebrationRankBase<IRefcelebrationRank>()}return this._RefMgrcelebrationRank}
get RefMgrcelebrationShop(){if(!this._RefMgrcelebrationShop){this._RefMgrcelebrationShop=new RefMgrcelebrationShopBase<IRefcelebrationShop>()}return this._RefMgrcelebrationShop}
get RefMgrcelebrationTarget(){if(!this._RefMgrcelebrationTarget){this._RefMgrcelebrationTarget=new RefMgrcelebrationTargetBase<IRefcelebrationTarget>()}return this._RefMgrcelebrationTarget}
get RefMgrchapterAttrAddition(){if(!this._RefMgrchapterAttrAddition){this._RefMgrchapterAttrAddition=new RefMgrchapterAttrAdditionBase<IRefchapterAttrAddition>()}return this._RefMgrchapterAttrAddition}
get RefMgrchapterRankAward(){if(!this._RefMgrchapterRankAward){this._RefMgrchapterRankAward=new RefMgrchapterRankAwardBase<IRefchapterRankAward>()}return this._RefMgrchapterRankAward}
get RefMgrciFu(){if(!this._RefMgrciFu){this._RefMgrciFu=new RefMgrciFuBase<IRefciFu>()}return this._RefMgrciFu}
get RefMgrdayChallengeActTask(){if(!this._RefMgrdayChallengeActTask){this._RefMgrdayChallengeActTask=new RefMgrdayChallengeActTaskBase<IRefdayChallengeActTask>()}return this._RefMgrdayChallengeActTask}
get RefMgrdayChallengeActTaskProgress(){if(!this._RefMgrdayChallengeActTaskProgress){this._RefMgrdayChallengeActTaskProgress=new RefMgrdayChallengeActTaskProgressBase<IRefdayChallengeActTaskProgress>()}return this._RefMgrdayChallengeActTaskProgress}
get RefMgrdefenceModWave(){if(!this._RefMgrdefenceModWave){this._RefMgrdefenceModWave=new RefMgrdefenceModWaveBase<IRefdefenceModWave>()}return this._RefMgrdefenceModWave}
get RefMgrdefenceWaveReward(){if(!this._RefMgrdefenceWaveReward){this._RefMgrdefenceWaveReward=new RefMgrdefenceWaveRewardBase<IRefdefenceWaveReward>()}return this._RefMgrdefenceWaveReward}
get RefMgrequip(){if(!this._RefMgrequip){this._RefMgrequip=new RefMgrequipBase<IRefequip>()}return this._RefMgrequip}
get RefMgrequipLevel(){if(!this._RefMgrequipLevel){this._RefMgrequipLevel=new RefMgrequipLevelBase<IRefequipLevel>()}return this._RefMgrequipLevel}
get RefMgrequipLib(){if(!this._RefMgrequipLib){this._RefMgrequipLib=new RefMgrequipLibBase<IRefequipLib>()}return this._RefMgrequipLib}
get RefMgrequipRank(){if(!this._RefMgrequipRank){this._RefMgrequipRank=new RefMgrequipRankBase<IRefequipRank>()}return this._RefMgrequipRank}
get RefMgrequipResonance(){if(!this._RefMgrequipResonance){this._RefMgrequipResonance=new RefMgrequipResonanceBase<IRefequipResonance>()}return this._RefMgrequipResonance}
get RefMgrequipType(){if(!this._RefMgrequipType){this._RefMgrequipType=new RefMgrequipTypeBase<IRefequipType>()}return this._RefMgrequipType}
get RefMgrfirstRechargeNew(){if(!this._RefMgrfirstRechargeNew){this._RefMgrfirstRechargeNew=new RefMgrfirstRechargeNewBase<IReffirstRechargeNew>()}return this._RefMgrfirstRechargeNew}
get RefMgrfirstRechargeShop(){if(!this._RefMgrfirstRechargeShop){this._RefMgrfirstRechargeShop=new RefMgrfirstRechargeShopBase<IReffirstRechargeShop>()}return this._RefMgrfirstRechargeShop}
get RefMgrfundPlan(){if(!this._RefMgrfundPlan){this._RefMgrfundPlan=new RefMgrfundPlanBase<IReffundPlan>()}return this._RefMgrfundPlan}
get RefMgrfundReward(){if(!this._RefMgrfundReward){this._RefMgrfundReward=new RefMgrfundRewardBase<IReffundReward>()}return this._RefMgrfundReward}
get RefMgrgameCircleConfig(){if(!this._RefMgrgameCircleConfig){this._RefMgrgameCircleConfig=new RefMgrgameCircleConfigBase<IRefgameCircleConfig>()}return this._RefMgrgameCircleConfig}
get RefMgrgameConfig(){if(!this._RefMgrgameConfig){this._RefMgrgameConfig=new RefMgrgameConfigBase<IRefgameConfig>()}return this._RefMgrgameConfig}
get RefMgrgem(){if(!this._RefMgrgem){this._RefMgrgem=new RefMgrgemBase<IRefgem>()}return this._RefMgrgem}
get RefMgrgemAttribute(){if(!this._RefMgrgemAttribute){this._RefMgrgemAttribute=new RefMgrgemAttributeBase<IRefgemAttribute>()}return this._RefMgrgemAttribute}
get RefMgrgemBox(){if(!this._RefMgrgemBox){this._RefMgrgemBox=new RefMgrgemBoxBase<IRefgemBox>()}return this._RefMgrgemBox}
get RefMgrgemQuality(){if(!this._RefMgrgemQuality){this._RefMgrgemQuality=new RefMgrgemQualityBase<IRefgemQuality>()}return this._RefMgrgemQuality}
get RefMgrgemShop(){if(!this._RefMgrgemShop){this._RefMgrgemShop=new RefMgrgemShopBase<IRefgemShop>()}return this._RefMgrgemShop}
get RefMgrgeneral(){if(!this._RefMgrgeneral){this._RefMgrgeneral=new RefMgrgeneralBase<IRefgeneral>()}return this._RefMgrgeneral}
get RefMgrgeneralStar(){if(!this._RefMgrgeneralStar){this._RefMgrgeneralStar=new RefMgrgeneralStarBase<IRefgeneralStar>()}return this._RefMgrgeneralStar}
get RefMgrgiftShop(){if(!this._RefMgrgiftShop){this._RefMgrgiftShop=new RefMgrgiftShopBase<IRefgiftShop>()}return this._RefMgrgiftShop}
get RefMgrgoldShop(){if(!this._RefMgrgoldShop){this._RefMgrgoldShop=new RefMgrgoldShopBase<IRefgoldShop>()}return this._RefMgrgoldShop}
get RefMgrgrade(){if(!this._RefMgrgrade){this._RefMgrgrade=new RefMgrgradeBase<IRefgrade>()}return this._RefMgrgrade}
get RefMgrguanka(){if(!this._RefMgrguanka){this._RefMgrguanka=new RefMgrguankaBase<IRefguanka>()}return this._RefMgrguanka}
get RefMgrguanka1(){if(!this._RefMgrguanka1){this._RefMgrguanka1=new RefMgrguanka1Base<IRefguanka1>()}return this._RefMgrguanka1}
get RefMgrguankaChapter(){if(!this._RefMgrguankaChapter){this._RefMgrguankaChapter=new RefMgrguankaChapterBase<IRefguankaChapter>()}return this._RefMgrguankaChapter}
get RefMgrguankaFBconfig(){if(!this._RefMgrguankaFBconfig){this._RefMgrguankaFBconfig=new RefMgrguankaFBconfigBase<IRefguankaFBconfig>()}return this._RefMgrguankaFBconfig}
get RefMgrguankaFbType(){if(!this._RefMgrguankaFbType){this._RefMgrguankaFbType=new RefMgrguankaFbTypeBase<IRefguankaFbType>()}return this._RefMgrguankaFbType}
get RefMgrguankaGift(){if(!this._RefMgrguankaGift){this._RefMgrguankaGift=new RefMgrguankaGiftBase<IRefguankaGift>()}return this._RefMgrguankaGift}
get RefMgrguankaHitLv(){if(!this._RefMgrguankaHitLv){this._RefMgrguankaHitLv=new RefMgrguankaHitLvBase<IRefguankaHitLv>()}return this._RefMgrguankaHitLv}
get RefMgrguankaLV(){if(!this._RefMgrguankaLV){this._RefMgrguankaLV=new RefMgrguankaLVBase<IRefguankaLV>()}return this._RefMgrguankaLV}
get RefMgrguankaMarch(){if(!this._RefMgrguankaMarch){this._RefMgrguankaMarch=new RefMgrguankaMarchBase<IRefguankaMarch>()}return this._RefMgrguankaMarch}
get RefMgrguankaReward(){if(!this._RefMgrguankaReward){this._RefMgrguankaReward=new RefMgrguankaRewardBase<IRefguankaReward>()}return this._RefMgrguankaReward}
get RefMgrguankaReward1(){if(!this._RefMgrguankaReward1){this._RefMgrguankaReward1=new RefMgrguankaReward1Base<IRefguankaReward1>()}return this._RefMgrguankaReward1}
get RefMgrguankaReward2(){if(!this._RefMgrguankaReward2){this._RefMgrguankaReward2=new RefMgrguankaReward2Base<IRefguankaReward2>()}return this._RefMgrguankaReward2}
get RefMgrguankaSkillLevelUp(){if(!this._RefMgrguankaSkillLevelUp){this._RefMgrguankaSkillLevelUp=new RefMgrguankaSkillLevelUpBase<IRefguankaSkillLevelUp>()}return this._RefMgrguankaSkillLevelUp}
get RefMgrguankaStar(){if(!this._RefMgrguankaStar){this._RefMgrguankaStar=new RefMgrguankaStarBase<IRefguankaStar>()}return this._RefMgrguankaStar}
get RefMgrguards(){if(!this._RefMgrguards){this._RefMgrguards=new RefMgrguardsBase<IRefguards>()}return this._RefMgrguards}
get RefMgrguardsLevel(){if(!this._RefMgrguardsLevel){this._RefMgrguardsLevel=new RefMgrguardsLevelBase<IRefguardsLevel>()}return this._RefMgrguardsLevel}
get RefMgrguardsRank(){if(!this._RefMgrguardsRank){this._RefMgrguardsRank=new RefMgrguardsRankBase<IRefguardsRank>()}return this._RefMgrguardsRank}
get RefMgrguoGuanZJConfig(){if(!this._RefMgrguoGuanZJConfig){this._RefMgrguoGuanZJConfig=new RefMgrguoGuanZJConfigBase<IRefguoGuanZJConfig>()}return this._RefMgrguoGuanZJConfig}
get RefMgrhead(){if(!this._RefMgrhead){this._RefMgrhead=new RefMgrheadBase<IRefhead>()}return this._RefMgrhead}
get RefMgrheroSkill(){if(!this._RefMgrheroSkill){this._RefMgrheroSkill=new RefMgrheroSkillBase<IRefheroSkill>()}return this._RefMgrheroSkill}
get RefMgrheroSkillLevel(){if(!this._RefMgrheroSkillLevel){this._RefMgrheroSkillLevel=new RefMgrheroSkillLevelBase<IRefheroSkillLevel>()}return this._RefMgrheroSkillLevel}
get RefMgricon(){if(!this._RefMgricon){this._RefMgricon=new RefMgriconBase<IReficon>()}return this._RefMgricon}
get RefMgridConfig(){if(!this._RefMgridConfig){this._RefMgridConfig=new RefMgridConfigBase<IRefidConfig>()}return this._RefMgridConfig}
get RefMgrinteractReward(){if(!this._RefMgrinteractReward){this._RefMgrinteractReward=new RefMgrinteractRewardBase<IRefinteractReward>()}return this._RefMgrinteractReward}
get RefMgritem(){if(!this._RefMgritem){this._RefMgritem=new RefMgritemBase<IRefitem>()}return this._RefMgritem}
get RefMgritemBox(){if(!this._RefMgritemBox){this._RefMgritemBox=new RefMgritemBoxBase<IRefitemBox>()}return this._RefMgritemBox}
get RefMgritemBoxPro(){if(!this._RefMgritemBoxPro){this._RefMgritemBoxPro=new RefMgritemBoxProBase<IRefitemBoxPro>()}return this._RefMgritemBoxPro}
get RefMgritemCraft(){if(!this._RefMgritemCraft){this._RefMgritemCraft=new RefMgritemCraftBase<IRefitemCraft>()}return this._RefMgritemCraft}
get RefMgritemType(){if(!this._RefMgritemType){this._RefMgritemType=new RefMgritemTypeBase<IRefitemType>()}return this._RefMgritemType}
get RefMgrlevel(){if(!this._RefMgrlevel){this._RefMgrlevel=new RefMgrlevelBase<IReflevel>()}return this._RefMgrlevel}
get RefMgrlevelInfo(){if(!this._RefMgrlevelInfo){this._RefMgrlevelInfo=new RefMgrlevelInfoBase<IReflevelInfo>()}return this._RefMgrlevelInfo}
get RefMgrlevelMapGrideReward(){if(!this._RefMgrlevelMapGrideReward){this._RefMgrlevelMapGrideReward=new RefMgrlevelMapGrideRewardBase<IReflevelMapGrideReward>()}return this._RefMgrlevelMapGrideReward}
get RefMgrlimitedTimeBundle(){if(!this._RefMgrlimitedTimeBundle){this._RefMgrlimitedTimeBundle=new RefMgrlimitedTimeBundleBase<IReflimitedTimeBundle>()}return this._RefMgrlimitedTimeBundle}
get RefMgrlimitTimeCard(){if(!this._RefMgrlimitTimeCard){this._RefMgrlimitTimeCard=new RefMgrlimitTimeCardBase<IReflimitTimeCard>()}return this._RefMgrlimitTimeCard}
get RefMgrlockMonsterLevel(){if(!this._RefMgrlockMonsterLevel){this._RefMgrlockMonsterLevel=new RefMgrlockMonsterLevelBase<IReflockMonsterLevel>()}return this._RefMgrlockMonsterLevel}
get RefMgrlockMonsterRefreshCost(){if(!this._RefMgrlockMonsterRefreshCost){this._RefMgrlockMonsterRefreshCost=new RefMgrlockMonsterRefreshCostBase<IReflockMonsterRefreshCost>()}return this._RefMgrlockMonsterRefreshCost}
get RefMgrlottery(){if(!this._RefMgrlottery){this._RefMgrlottery=new RefMgrlotteryBase<IReflottery>()}return this._RefMgrlottery}
get RefMgrlotteryshop1(){if(!this._RefMgrlotteryshop1){this._RefMgrlotteryshop1=new RefMgrlotteryshop1Base<IReflotteryshop1>()}return this._RefMgrlotteryshop1}
get RefMgrlotteryshop2(){if(!this._RefMgrlotteryshop2){this._RefMgrlotteryshop2=new RefMgrlotteryshop2Base<IReflotteryshop2>()}return this._RefMgrlotteryshop2}
get RefMgrlotteryshop3(){if(!this._RefMgrlotteryshop3){this._RefMgrlotteryshop3=new RefMgrlotteryshop3Base<IReflotteryshop3>()}return this._RefMgrlotteryshop3}
get RefMgrlotteryshop4(){if(!this._RefMgrlotteryshop4){this._RefMgrlotteryshop4=new RefMgrlotteryshop4Base<IReflotteryshop4>()}return this._RefMgrlotteryshop4}
get RefMgrlotterytask(){if(!this._RefMgrlotterytask){this._RefMgrlotterytask=new RefMgrlotterytaskBase<IReflotterytask>()}return this._RefMgrlotterytask}
get RefMgrmapconfig(){if(!this._RefMgrmapconfig){this._RefMgrmapconfig=new RefMgrmapconfigBase<IRefmapconfig>()}return this._RefMgrmapconfig}
get RefMgrmapTerrian(){if(!this._RefMgrmapTerrian){this._RefMgrmapTerrian=new RefMgrmapTerrianBase<IRefmapTerrian>()}return this._RefMgrmapTerrian}
get RefMgrmatchTips(){if(!this._RefMgrmatchTips){this._RefMgrmatchTips=new RefMgrmatchTipsBase<IRefmatchTips>()}return this._RefMgrmatchTips}
get RefMgrmL(){if(!this._RefMgrmL){this._RefMgrmL=new RefMgrmLBase<IRefmL>()}return this._RefMgrmL}
get RefMgrmodelRef(){if(!this._RefMgrmodelRef){this._RefMgrmodelRef=new RefMgrmodelRefBase<IRefmodelRef>()}return this._RefMgrmodelRef}
get RefMgrmonster(){if(!this._RefMgrmonster){this._RefMgrmonster=new RefMgrmonsterBase<IRefmonster>()}return this._RefMgrmonster}
get RefMgrmonsterCard(){if(!this._RefMgrmonsterCard){this._RefMgrmonsterCard=new RefMgrmonsterCardBase<IRefmonsterCard>()}return this._RefMgrmonsterCard}
get RefMgrmonsterSkillType(){if(!this._RefMgrmonsterSkillType){this._RefMgrmonsterSkillType=new RefMgrmonsterSkillTypeBase<IRefmonsterSkillType>()}return this._RefMgrmonsterSkillType}
get RefMgrmonthCardActPlan(){if(!this._RefMgrmonthCardActPlan){this._RefMgrmonthCardActPlan=new RefMgrmonthCardActPlanBase<IRefmonthCardActPlan>()}return this._RefMgrmonthCardActPlan}
get RefMgrneutralResource(){if(!this._RefMgrneutralResource){this._RefMgrneutralResource=new RefMgrneutralResourceBase<IRefneutralResource>()}return this._RefMgrneutralResource}
get RefMgrnewTreasureBoxCardPool(){if(!this._RefMgrnewTreasureBoxCardPool){this._RefMgrnewTreasureBoxCardPool=new RefMgrnewTreasureBoxCardPoolBase<IRefnewTreasureBoxCardPool>()}return this._RefMgrnewTreasureBoxCardPool}
get RefMgrnewTreasureBoxConfig(){if(!this._RefMgrnewTreasureBoxConfig){this._RefMgrnewTreasureBoxConfig=new RefMgrnewTreasureBoxConfigBase<IRefnewTreasureBoxConfig>()}return this._RefMgrnewTreasureBoxConfig}
get RefMgrnewTreasureBoxQueueConfig(){if(!this._RefMgrnewTreasureBoxQueueConfig){this._RefMgrnewTreasureBoxQueueConfig=new RefMgrnewTreasureBoxQueueConfigBase<IRefnewTreasureBoxQueueConfig>()}return this._RefMgrnewTreasureBoxQueueConfig}
get RefMgrnpcTeam(){if(!this._RefMgrnpcTeam){this._RefMgrnpcTeam=new RefMgrnpcTeamBase<IRefnpcTeam>()}return this._RefMgrnpcTeam}
get RefMgropen(){if(!this._RefMgropen){this._RefMgropen=new RefMgropenBase<IRefopen>()}return this._RefMgropen}
get RefMgropenGridReward(){if(!this._RefMgropenGridReward){this._RefMgropenGridReward=new RefMgropenGridRewardBase<IRefopenGridReward>()}return this._RefMgropenGridReward}
get RefMgrpayChannel(){if(!this._RefMgrpayChannel){this._RefMgrpayChannel=new RefMgrpayChannelBase<IRefpayChannel>()}return this._RefMgrpayChannel}
get RefMgrplotCard(){if(!this._RefMgrplotCard){this._RefMgrplotCard=new RefMgrplotCardBase<IRefplotCard>()}return this._RefMgrplotCard}
get RefMgrplotDialogue(){if(!this._RefMgrplotDialogue){this._RefMgrplotDialogue=new RefMgrplotDialogueBase<IRefplotDialogue>()}return this._RefMgrplotDialogue}
get RefMgrplotGuanka(){if(!this._RefMgrplotGuanka){this._RefMgrplotGuanka=new RefMgrplotGuankaBase<IRefplotGuanka>()}return this._RefMgrplotGuanka}
get RefMgrprivilegeMonthCardInfo(){if(!this._RefMgrprivilegeMonthCardInfo){this._RefMgrprivilegeMonthCardInfo=new RefMgrprivilegeMonthCardInfoBase<IRefprivilegeMonthCardInfo>()}return this._RefMgrprivilegeMonthCardInfo}
get RefMgrproDesc(){if(!this._RefMgrproDesc){this._RefMgrproDesc=new RefMgrproDescBase<IRefproDesc>()}return this._RefMgrproDesc}
get RefMgrpvpArtifact(){if(!this._RefMgrpvpArtifact){this._RefMgrpvpArtifact=new RefMgrpvpArtifactBase<IRefpvpArtifact>()}return this._RefMgrpvpArtifact}
get RefMgrpvpArtifactAscend(){if(!this._RefMgrpvpArtifactAscend){this._RefMgrpvpArtifactAscend=new RefMgrpvpArtifactAscendBase<IRefpvpArtifactAscend>()}return this._RefMgrpvpArtifactAscend}
get RefMgrpvpAttrMap(){if(!this._RefMgrpvpAttrMap){this._RefMgrpvpAttrMap=new RefMgrpvpAttrMapBase<IRefpvpAttrMap>()}return this._RefMgrpvpAttrMap}
get RefMgrpvpBaseTeamWeight(){if(!this._RefMgrpvpBaseTeamWeight){this._RefMgrpvpBaseTeamWeight=new RefMgrpvpBaseTeamWeightBase<IRefpvpBaseTeamWeight>()}return this._RefMgrpvpBaseTeamWeight}
get RefMgrpvpBond(){if(!this._RefMgrpvpBond){this._RefMgrpvpBond=new RefMgrpvpBondBase<IRefpvpBond>()}return this._RefMgrpvpBond}
get RefMgrpvpCard(){if(!this._RefMgrpvpCard){this._RefMgrpvpCard=new RefMgrpvpCardBase<IRefpvpCard>()}return this._RefMgrpvpCard}
get RefMgrpvpCounter(){if(!this._RefMgrpvpCounter){this._RefMgrpvpCounter=new RefMgrpvpCounterBase<IRefpvpCounter>()}return this._RefMgrpvpCounter}
get RefMgrpvpGlobal(){if(!this._RefMgrpvpGlobal){this._RefMgrpvpGlobal=new RefMgrpvpGlobalBase<IRefpvpGlobal>()}return this._RefMgrpvpGlobal}
get RefMgrpvpModifierOverride(){if(!this._RefMgrpvpModifierOverride){this._RefMgrpvpModifierOverride=new RefMgrpvpModifierOverrideBase<IRefpvpModifierOverride>()}return this._RefMgrpvpModifierOverride}
get RefMgrpvpPity(){if(!this._RefMgrpvpPity){this._RefMgrpvpPity=new RefMgrpvpPityBase<IRefpvpPity>()}return this._RefMgrpvpPity}
get RefMgrpvpSkill(){if(!this._RefMgrpvpSkill){this._RefMgrpvpSkill=new RefMgrpvpSkillBase<IRefpvpSkill>()}return this._RefMgrpvpSkill}
get RefMgrpvpSkillBinding(){if(!this._RefMgrpvpSkillBinding){this._RefMgrpvpSkillBinding=new RefMgrpvpSkillBindingBase<IRefpvpSkillBinding>()}return this._RefMgrpvpSkillBinding}
get RefMgrpvpSkillPlan(){if(!this._RefMgrpvpSkillPlan){this._RefMgrpvpSkillPlan=new RefMgrpvpSkillPlanBase<IRefpvpSkillPlan>()}return this._RefMgrpvpSkillPlan}
get RefMgrpvpStatus(){if(!this._RefMgrpvpStatus){this._RefMgrpvpStatus=new RefMgrpvpStatusBase<IRefpvpStatus>()}return this._RefMgrpvpStatus}
get RefMgrpvpTile(){if(!this._RefMgrpvpTile){this._RefMgrpvpTile=new RefMgrpvpTileBase<IRefpvpTile>()}return this._RefMgrpvpTile}
get RefMgrpvpTileGen(){if(!this._RefMgrpvpTileGen){this._RefMgrpvpTileGen=new RefMgrpvpTileGenBase<IRefpvpTileGen>()}return this._RefMgrpvpTileGen}
get RefMgrpvpTileGenParams(){if(!this._RefMgrpvpTileGenParams){this._RefMgrpvpTileGenParams=new RefMgrpvpTileGenParamsBase<IRefpvpTileGenParams>()}return this._RefMgrpvpTileGenParams}
get RefMgrpvpUnitGrowth(){if(!this._RefMgrpvpUnitGrowth){this._RefMgrpvpUnitGrowth=new RefMgrpvpUnitGrowthBase<IRefpvpUnitGrowth>()}return this._RefMgrpvpUnitGrowth}
get RefMgrqingShen(){if(!this._RefMgrqingShen){this._RefMgrqingShen=new RefMgrqingShenBase<IRefqingShen>()}return this._RefMgrqingShen}
get RefMgrrechargeContinuityGift(){if(!this._RefMgrrechargeContinuityGift){this._RefMgrrechargeContinuityGift=new RefMgrrechargeContinuityGiftBase<IRefrechargeContinuityGift>()}return this._RefMgrrechargeContinuityGift}
get RefMgrrechargeDaily(){if(!this._RefMgrrechargeDaily){this._RefMgrrechargeDaily=new RefMgrrechargeDailyBase<IRefrechargeDaily>()}return this._RefMgrrechargeDaily}
get RefMgrrechargeGiftActPlan(){if(!this._RefMgrrechargeGiftActPlan){this._RefMgrrechargeGiftActPlan=new RefMgrrechargeGiftActPlanBase<IRefrechargeGiftActPlan>()}return this._RefMgrrechargeGiftActPlan}
get RefMgrrefToCodeEnum(){if(!this._RefMgrrefToCodeEnum){this._RefMgrrefToCodeEnum=new RefMgrrefToCodeEnumBase<IRefrefToCodeEnum>()}return this._RefMgrrefToCodeEnum}
get RefMgrresourceShop(){if(!this._RefMgrresourceShop){this._RefMgrresourceShop=new RefMgrresourceShopBase<IRefresourceShop>()}return this._RefMgrresourceShop}
get RefMgrrewardClientPool(){if(!this._RefMgrrewardClientPool){this._RefMgrrewardClientPool=new RefMgrrewardClientPoolBase<IRefrewardClientPool>()}return this._RefMgrrewardClientPool}
get RefMgrroleProperty(){if(!this._RefMgrroleProperty){this._RefMgrroleProperty=new RefMgrrolePropertyBase<IRefroleProperty>()}return this._RefMgrroleProperty}
get RefMgrsecretRealmAttr(){if(!this._RefMgrsecretRealmAttr){this._RefMgrsecretRealmAttr=new RefMgrsecretRealmAttrBase<IRefsecretRealmAttr>()}return this._RefMgrsecretRealmAttr}
get RefMgrsecretRealmLevel(){if(!this._RefMgrsecretRealmLevel){this._RefMgrsecretRealmLevel=new RefMgrsecretRealmLevelBase<IRefsecretRealmLevel>()}return this._RefMgrsecretRealmLevel}
get RefMgrsecretRealmRefreshCost(){if(!this._RefMgrsecretRealmRefreshCost){this._RefMgrsecretRealmRefreshCost=new RefMgrsecretRealmRefreshCostBase<IRefsecretRealmRefreshCost>()}return this._RefMgrsecretRealmRefreshCost}
get RefMgrserverRank(){if(!this._RefMgrserverRank){this._RefMgrserverRank=new RefMgrserverRankBase<IRefserverRank>()}return this._RefMgrserverRank}
get RefMgrsevenDayPoint(){if(!this._RefMgrsevenDayPoint){this._RefMgrsevenDayPoint=new RefMgrsevenDayPointBase<IRefsevenDayPoint>()}return this._RefMgrsevenDayPoint}
get RefMgrsevenDayShop(){if(!this._RefMgrsevenDayShop){this._RefMgrsevenDayShop=new RefMgrsevenDayShopBase<IRefsevenDayShop>()}return this._RefMgrsevenDayShop}
get RefMgrsevenDayTask(){if(!this._RefMgrsevenDayTask){this._RefMgrsevenDayTask=new RefMgrsevenDayTaskBase<IRefsevenDayTask>()}return this._RefMgrsevenDayTask}
get RefMgrshare(){if(!this._RefMgrshare){this._RefMgrshare=new RefMgrshareBase<IRefshare>()}return this._RefMgrshare}
get RefMgrshiMengBattleConfig(){if(!this._RefMgrshiMengBattleConfig){this._RefMgrshiMengBattleConfig=new RefMgrshiMengBattleConfigBase<IRefshiMengBattleConfig>()}return this._RefMgrshiMengBattleConfig}
get RefMgrsigninTask(){if(!this._RefMgrsigninTask){this._RefMgrsigninTask=new RefMgrsigninTaskBase<IRefsigninTask>()}return this._RefMgrsigninTask}
get RefMgrskillAdditionBuff(){if(!this._RefMgrskillAdditionBuff){this._RefMgrskillAdditionBuff=new RefMgrskillAdditionBuffBase<IRefskillAdditionBuff>()}return this._RefMgrskillAdditionBuff}
get RefMgrskillAttr(){if(!this._RefMgrskillAttr){this._RefMgrskillAttr=new RefMgrskillAttrBase<IRefskillAttr>()}return this._RefMgrskillAttr}
get RefMgrskillAttrModifier(){if(!this._RefMgrskillAttrModifier){this._RefMgrskillAttrModifier=new RefMgrskillAttrModifierBase<IRefskillAttrModifier>()}return this._RefMgrskillAttrModifier}
get RefMgrskillBook(){if(!this._RefMgrskillBook){this._RefMgrskillBook=new RefMgrskillBookBase<IRefskillBook>()}return this._RefMgrskillBook}
get RefMgrskillBookLevel(){if(!this._RefMgrskillBookLevel){this._RefMgrskillBookLevel=new RefMgrskillBookLevelBase<IRefskillBookLevel>()}return this._RefMgrskillBookLevel}
get RefMgrskillBuff(){if(!this._RefMgrskillBuff){this._RefMgrskillBuff=new RefMgrskillBuffBase<IRefskillBuff>()}return this._RefMgrskillBuff}
get RefMgrskillEffect(){if(!this._RefMgrskillEffect){this._RefMgrskillEffect=new RefMgrskillEffectBase<IRefskillEffect>()}return this._RefMgrskillEffect}
get RefMgrskillEffectDamageType(){if(!this._RefMgrskillEffectDamageType){this._RefMgrskillEffectDamageType=new RefMgrskillEffectDamageTypeBase<IRefskillEffectDamageType>()}return this._RefMgrskillEffectDamageType}
get RefMgrskillEffectShow(){if(!this._RefMgrskillEffectShow){this._RefMgrskillEffectShow=new RefMgrskillEffectShowBase<IRefskillEffectShow>()}return this._RefMgrskillEffectShow}
get RefMgrskillLevelUP(){if(!this._RefMgrskillLevelUP){this._RefMgrskillLevelUP=new RefMgrskillLevelUPBase<IRefskillLevelUP>()}return this._RefMgrskillLevelUP}
get RefMgrskillType(){if(!this._RefMgrskillType){this._RefMgrskillType=new RefMgrskillTypeBase<IRefskillType>()}return this._RefMgrskillType}
get RefMgrskillView(){if(!this._RefMgrskillView){this._RefMgrskillView=new RefMgrskillViewBase<IRefskillView>()}return this._RefMgrskillView}
get RefMgrskin(){if(!this._RefMgrskin){this._RefMgrskin=new RefMgrskinBase<IRefskin>()}return this._RefMgrskin}
get RefMgrspiritAnimal(){if(!this._RefMgrspiritAnimal){this._RefMgrspiritAnimal=new RefMgrspiritAnimalBase<IRefspiritAnimal>()}return this._RefMgrspiritAnimal}
get RefMgrspiritAnimalBox(){if(!this._RefMgrspiritAnimalBox){this._RefMgrspiritAnimalBox=new RefMgrspiritAnimalBoxBase<IRefspiritAnimalBox>()}return this._RefMgrspiritAnimalBox}
get RefMgrspiritAnimalLevel(){if(!this._RefMgrspiritAnimalLevel){this._RefMgrspiritAnimalLevel=new RefMgrspiritAnimalLevelBase<IRefspiritAnimalLevel>()}return this._RefMgrspiritAnimalLevel}
get RefMgrspiritAnimalStep(){if(!this._RefMgrspiritAnimalStep){this._RefMgrspiritAnimalStep=new RefMgrspiritAnimalStepBase<IRefspiritAnimalStep>()}return this._RefMgrspiritAnimalStep}
get RefMgrspiritAnimalType(){if(!this._RefMgrspiritAnimalType){this._RefMgrspiritAnimalType=new RefMgrspiritAnimalTypeBase<IRefspiritAnimalType>()}return this._RefMgrspiritAnimalType}
get RefMgrssjjRankAward(){if(!this._RefMgrssjjRankAward){this._RefMgrssjjRankAward=new RefMgrssjjRankAwardBase<IRefssjjRankAward>()}return this._RefMgrssjjRankAward}
get RefMgrswjjShop(){if(!this._RefMgrswjjShop){this._RefMgrswjjShop=new RefMgrswjjShopBase<IRefswjjShop>()}return this._RefMgrswjjShop}
get RefMgrsystemDesc(){if(!this._RefMgrsystemDesc){this._RefMgrsystemDesc=new RefMgrsystemDescBase<IRefsystemDesc>()}return this._RefMgrsystemDesc}
get RefMgrtaskMain(){if(!this._RefMgrtaskMain){this._RefMgrtaskMain=new RefMgrtaskMainBase<IReftaskMain>()}return this._RefMgrtaskMain}
get RefMgrtaskType(){if(!this._RefMgrtaskType){this._RefMgrtaskType=new RefMgrtaskTypeBase<IReftaskType>()}return this._RefMgrtaskType}
get RefMgrtaskUnion(){if(!this._RefMgrtaskUnion){this._RefMgrtaskUnion=new RefMgrtaskUnionBase<IReftaskUnion>()}return this._RefMgrtaskUnion}
get RefMgrtaskUnionProgress(){if(!this._RefMgrtaskUnionProgress){this._RefMgrtaskUnionProgress=new RefMgrtaskUnionProgressBase<IReftaskUnionProgress>()}return this._RefMgrtaskUnionProgress}
get RefMgrunionDiscount(){if(!this._RefMgrunionDiscount){this._RefMgrunionDiscount=new RefMgrunionDiscountBase<IRefunionDiscount>()}return this._RefMgrunionDiscount}
get RefMgrunionLevel(){if(!this._RefMgrunionLevel){this._RefMgrunionLevel=new RefMgrunionLevelBase<IRefunionLevel>()}return this._RefMgrunionLevel}
get RefMgrunionOfficial(){if(!this._RefMgrunionOfficial){this._RefMgrunionOfficial=new RefMgrunionOfficialBase<IRefunionOfficial>()}return this._RefMgrunionOfficial}
get RefMgrunionShop(){if(!this._RefMgrunionShop){this._RefMgrunionShop=new RefMgrunionShopBase<IRefunionShop>()}return this._RefMgrunionShop}
get RefMgrvaluableMonthCardInfo(){if(!this._RefMgrvaluableMonthCardInfo){this._RefMgrvaluableMonthCardInfo=new RefMgrvaluableMonthCardInfoBase<IRefvaluableMonthCardInfo>()}return this._RefMgrvaluableMonthCardInfo}
get RefMgrviewtype(){if(!this._RefMgrviewtype){this._RefMgrviewtype=new RefMgrviewtypeBase<IRefviewtype>()}return this._RefMgrviewtype}
get RefMgrwall(){if(!this._RefMgrwall){this._RefMgrwall=new RefMgrwallBase<IRefwall>()}return this._RefMgrwall}
get RefMgrwallSkillLevel(){if(!this._RefMgrwallSkillLevel){this._RefMgrwallSkillLevel=new RefMgrwallSkillLevelBase<IRefwallSkillLevel>()}return this._RefMgrwallSkillLevel}
get RefMgrwallType(){if(!this._RefMgrwallType){this._RefMgrwallType=new RefMgrwallTypeBase<IRefwallType>()}return this._RefMgrwallType}
get RefMgrwaveReward(){if(!this._RefMgrwaveReward){this._RefMgrwaveReward=new RefMgrwaveRewardBase<IRefwaveReward>()}return this._RefMgrwaveReward}
get RefMgrworkShop(){if(!this._RefMgrworkShop){this._RefMgrworkShop=new RefMgrworkShopBase<IRefworkShop>()}return this._RefMgrworkShop}
get RefMgrworkShopLevel(){if(!this._RefMgrworkShopLevel){this._RefMgrworkShopLevel=new RefMgrworkShopLevelBase<IRefworkShopLevel>()}return this._RefMgrworkShopLevel}
get RefMgrzcGuide(){if(!this._RefMgrzcGuide){this._RefMgrzcGuide=new RefMgrzcGuideBase<IRefzcGuide>()}return this._RefMgrzcGuide}
get RefMgrzcGuideParams(){if(!this._RefMgrzcGuideParams){this._RefMgrzcGuideParams=new RefMgrzcGuideParamsBase<IRefzcGuideParams>()}return this._RefMgrzcGuideParams}

}
export class RefMgractivityBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("activity")}}
export class RefMgractivityOpenBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("activityOpen")}}
export class RefMgractivityTabBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("activityTab")}}
export class RefMgradBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("ad")}}
export class RefMgradvisorBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("advisor")}}
export class RefMgradvisorStarBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("advisorStar")}}
export class RefMgrapprenticeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("apprentice")}}
export class RefMgrapprenticeLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("apprenticeLevel")}}
export class RefMgrarmyBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("army")}}
export class RefMgrarmyLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("armyLevel")}}
export class RefMgrarmySkillLevelUpBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("armySkillLevelUp")}}
export class RefMgrarmySkinBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("armySkin")}}
export class RefMgrarmySkinStarBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("armySkinStar")}}
export class RefMgrartifactBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("artifact")}}
export class RefMgrartifactLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("artifactLevel")}}
export class RefMgrartifactStarBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("artifactStar")}}
export class RefMgraudioConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("audioConfig")}}
export class RefMgrbaseBuildingBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("baseBuilding")}}
export class RefMgrbaseBuildingLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("baseBuildingLevel")}}
export class RefMgrbattleModelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("battleModel")}}
export class RefMgrbattleTokenConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("battleTokenConfig")}}
export class RefMgrbattleTokenPlanBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("battleTokenPlan")}}
export class RefMgrbattleTokenRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("battleTokenReward")}}
export class RefMgrbfPersonRankAwardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bfPersonRankAward")}}
export class RefMgrbfUnionRankAwardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bfUnionRankAward")}}
export class RefMgrbigmapBuildingBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapBuilding")}}
export class RefMgrbigmapBuildingLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapBuildingLevel")}}
export class RefMgrbigmapBuildingProduceBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapBuildingProduce")}}
export class RefMgrbigMapCampBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigMapCamp")}}
export class RefMgrbigmapCityBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapCity")}}
export class RefMgrbigmapCityLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapCityLevel")}}
export class RefMgrbigmapMonsterBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapMonster")}}
export class RefMgrbigmapQueueBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapQueue")}}
export class RefMgrbigmapRankBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapRank")}}
export class RefMgrbigmapResourceBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapResource")}}
export class RefMgrbigmapScheduleBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapSchedule")}}
export class RefMgrbigmapScoreRuleBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapScoreRule")}}
export class RefMgrbigmapStaminaBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapStamina")}}
export class RefMgrbigmapWorldBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapWorld")}}
export class RefMgrbigNumBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigNum")}}
export class RefMgrbuildBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("build")}}
export class RefMgrbuyStaBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("buySta")}}
export class RefMgrcardLevelUpBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("cardLevelUp")}}
export class RefMgrcelebrationConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("celebrationConfig")}}
export class RefMgrcelebrationRankBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("celebrationRank")}}
export class RefMgrcelebrationShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("celebrationShop")}}
export class RefMgrcelebrationTargetBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("celebrationTarget")}}
export class RefMgrchapterAttrAdditionBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("chapterAttrAddition")}}
export class RefMgrchapterRankAwardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("chapterRankAward")}}
export class RefMgrciFuBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("ciFu")}}
export class RefMgrdayChallengeActTaskBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("dayChallengeActTask")}}
export class RefMgrdayChallengeActTaskProgressBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("dayChallengeActTaskProgress")}}
export class RefMgrdefenceModWaveBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("defenceModWave")}}
export class RefMgrdefenceWaveRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("defenceWaveReward")}}
export class RefMgrequipBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("equip")}}
export class RefMgrequipLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("equipLevel")}}
export class RefMgrequipLibBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("equipLib")}}
export class RefMgrequipRankBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("equipRank")}}
export class RefMgrequipResonanceBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("equipResonance")}}
export class RefMgrequipTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("equipType")}}
export class RefMgrfirstRechargeNewBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("firstRechargeNew")}}
export class RefMgrfirstRechargeShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("firstRechargeShop")}}
export class RefMgrfundPlanBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("fundPlan")}}
export class RefMgrfundRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("fundReward")}}
export class RefMgrgameCircleConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("gameCircleConfig")}}
export class RefMgrgameConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("gameConfig")}}
export class RefMgrgemBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("gem")}}
export class RefMgrgemAttributeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("gemAttribute")}}
export class RefMgrgemBoxBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("gemBox")}}
export class RefMgrgemQualityBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("gemQuality")}}
export class RefMgrgemShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("gemShop")}}
export class RefMgrgeneralBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("general")}}
export class RefMgrgeneralStarBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("generalStar")}}
export class RefMgrgiftShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("giftShop")}}
export class RefMgrgoldShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("goldShop")}}
export class RefMgrgradeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("grade")}}
export class RefMgrguankaBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guanka")}}
export class RefMgrguanka1Base<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guanka1")}}
export class RefMgrguankaChapterBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaChapter")}}
export class RefMgrguankaFBconfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaFBconfig")}}
export class RefMgrguankaFbTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaFbType")}}
export class RefMgrguankaGiftBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaGift")}}
export class RefMgrguankaHitLvBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaHitLv")}}
export class RefMgrguankaLVBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaLV")}}
export class RefMgrguankaMarchBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaMarch")}}
export class RefMgrguankaRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaReward")}}
export class RefMgrguankaReward1Base<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaReward1")}}
export class RefMgrguankaReward2Base<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaReward2")}}
export class RefMgrguankaSkillLevelUpBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaSkillLevelUp")}}
export class RefMgrguankaStarBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaStar")}}
export class RefMgrguardsBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guards")}}
export class RefMgrguardsLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guardsLevel")}}
export class RefMgrguardsRankBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guardsRank")}}
export class RefMgrguoGuanZJConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guoGuanZJConfig")}}
export class RefMgrheadBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("head")}}
export class RefMgrheroSkillBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("heroSkill")}}
export class RefMgrheroSkillLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("heroSkillLevel")}}
export class RefMgriconBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("icon")}}
export class RefMgridConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("idConfig")}}
export class RefMgrinteractRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("interactReward")}}
export class RefMgritemBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("item")}}
export class RefMgritemBoxBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("itemBox")}}
export class RefMgritemBoxProBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("itemBoxPro")}}
export class RefMgritemCraftBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("itemCraft")}}
export class RefMgritemTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("itemType")}}
export class RefMgrlevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("level")}}
export class RefMgrlevelInfoBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("levelInfo")}}
export class RefMgrlevelMapGrideRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("levelMapGrideReward")}}
export class RefMgrlimitedTimeBundleBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("limitedTimeBundle")}}
export class RefMgrlimitTimeCardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("limitTimeCard")}}
export class RefMgrlockMonsterLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("lockMonsterLevel")}}
export class RefMgrlockMonsterRefreshCostBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("lockMonsterRefreshCost")}}
export class RefMgrlotteryBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("lottery")}}
export class RefMgrlotteryshop1Base<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("lotteryshop1")}}
export class RefMgrlotteryshop2Base<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("lotteryshop2")}}
export class RefMgrlotteryshop3Base<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("lotteryshop3")}}
export class RefMgrlotteryshop4Base<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("lotteryshop4")}}
export class RefMgrlotterytaskBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("lotterytask")}}
export class RefMgrmapconfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("mapconfig")}}
export class RefMgrmapTerrianBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("mapTerrian")}}
export class RefMgrmatchTipsBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("matchTips")}}
export class RefMgrmLBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("mL")}}
export class RefMgrmodelRefBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("modelRef")}}
export class RefMgrmonsterBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("monster")}}
export class RefMgrmonsterCardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("monsterCard")}}
export class RefMgrmonsterSkillTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("monsterSkillType")}}
export class RefMgrmonthCardActPlanBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("monthCardActPlan")}}
export class RefMgrneutralResourceBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("neutralResource")}}
export class RefMgrnewTreasureBoxCardPoolBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("newTreasureBoxCardPool")}}
export class RefMgrnewTreasureBoxConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("newTreasureBoxConfig")}}
export class RefMgrnewTreasureBoxQueueConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("newTreasureBoxQueueConfig")}}
export class RefMgrnpcTeamBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("npcTeam")}}
export class RefMgropenBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("open")}}
export class RefMgropenGridRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("openGridReward")}}
export class RefMgrpayChannelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("payChannel")}}
export class RefMgrplotCardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("plotCard")}}
export class RefMgrplotDialogueBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("plotDialogue")}}
export class RefMgrplotGuankaBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("plotGuanka")}}
export class RefMgrprivilegeMonthCardInfoBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("privilegeMonthCardInfo")}}
export class RefMgrproDescBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("proDesc")}}
export class RefMgrpvpArtifactBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpArtifact")}}
export class RefMgrpvpArtifactAscendBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpArtifactAscend")}}
export class RefMgrpvpAttrMapBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpAttrMap")}}
export class RefMgrpvpBaseTeamWeightBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpBaseTeamWeight")}}
export class RefMgrpvpBondBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpBond")}}
export class RefMgrpvpCardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpCard")}}
export class RefMgrpvpCounterBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpCounter")}}
export class RefMgrpvpGlobalBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpGlobal")}}
export class RefMgrpvpModifierOverrideBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpModifierOverride")}}
export class RefMgrpvpPityBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpPity")}}
export class RefMgrpvpSkillBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpSkill")}}
export class RefMgrpvpSkillBindingBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpSkillBinding")}}
export class RefMgrpvpSkillPlanBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpSkillPlan")}}
export class RefMgrpvpStatusBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpStatus")}}
export class RefMgrpvpTileBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpTile")}}
export class RefMgrpvpTileGenBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpTileGen")}}
export class RefMgrpvpTileGenParamsBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpTileGenParams")}}
export class RefMgrpvpUnitGrowthBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpUnitGrowth")}}
export class RefMgrqingShenBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("qingShen")}}
export class RefMgrrechargeContinuityGiftBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("rechargeContinuityGift")}}
export class RefMgrrechargeDailyBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("rechargeDaily")}}
export class RefMgrrechargeGiftActPlanBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("rechargeGiftActPlan")}}
export class RefMgrrefToCodeEnumBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("refToCodeEnum")}}
export class RefMgrresourceShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("resourceShop")}}
export class RefMgrrewardClientPoolBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("rewardClientPool")}}
export class RefMgrrolePropertyBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("roleProperty")}}
export class RefMgrsecretRealmAttrBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("secretRealmAttr")}}
export class RefMgrsecretRealmLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("secretRealmLevel")}}
export class RefMgrsecretRealmRefreshCostBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("secretRealmRefreshCost")}}
export class RefMgrserverRankBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("serverRank")}}
export class RefMgrsevenDayPointBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("sevenDayPoint")}}
export class RefMgrsevenDayShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("sevenDayShop")}}
export class RefMgrsevenDayTaskBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("sevenDayTask")}}
export class RefMgrshareBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("share")}}
export class RefMgrshiMengBattleConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("shiMengBattleConfig")}}
export class RefMgrsigninTaskBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("signinTask")}}
export class RefMgrskillAdditionBuffBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillAdditionBuff")}}
export class RefMgrskillAttrBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillAttr")}}
export class RefMgrskillAttrModifierBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillAttrModifier")}}
export class RefMgrskillBookBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillBook")}}
export class RefMgrskillBookLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillBookLevel")}}
export class RefMgrskillBuffBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillBuff")}}
export class RefMgrskillEffectBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillEffect")}}
export class RefMgrskillEffectDamageTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillEffectDamageType")}}
export class RefMgrskillEffectShowBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillEffectShow")}}
export class RefMgrskillLevelUPBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillLevelUP")}}
export class RefMgrskillTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillType")}}
export class RefMgrskillViewBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillView")}}
export class RefMgrskinBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skin")}}
export class RefMgrspiritAnimalBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("spiritAnimal")}}
export class RefMgrspiritAnimalBoxBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("spiritAnimalBox")}}
export class RefMgrspiritAnimalLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("spiritAnimalLevel")}}
export class RefMgrspiritAnimalStepBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("spiritAnimalStep")}}
export class RefMgrspiritAnimalTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("spiritAnimalType")}}
export class RefMgrssjjRankAwardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("ssjjRankAward")}}
export class RefMgrswjjShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("swjjShop")}}
export class RefMgrsystemDescBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("systemDesc")}}
export class RefMgrtaskMainBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("taskMain")}}
export class RefMgrtaskTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("taskType")}}
export class RefMgrtaskUnionBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("taskUnion")}}
export class RefMgrtaskUnionProgressBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("taskUnionProgress")}}
export class RefMgrunionDiscountBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("unionDiscount")}}
export class RefMgrunionLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("unionLevel")}}
export class RefMgrunionOfficialBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("unionOfficial")}}
export class RefMgrunionShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("unionShop")}}
export class RefMgrvaluableMonthCardInfoBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("valuableMonthCardInfo")}}
export class RefMgrviewtypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("viewtype")}}
export class RefMgrwallBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("wall")}}
export class RefMgrwallSkillLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("wallSkillLevel")}}
export class RefMgrwallTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("wallType")}}
export class RefMgrwaveRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("waveReward")}}
export class RefMgrworkShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("workShop")}}
export class RefMgrworkShopLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("workShopLevel")}}
export class RefMgrzcGuideBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("zcGuide")}}
export class RefMgrzcGuideParamsBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("zcGuideParams")}}
