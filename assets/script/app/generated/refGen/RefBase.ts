import RefMgrBase from "../../../framework/ref/RefMgrBase";
//import { RefMgrGuideBase } from "../../ref/refEx/RefMgrGuideBase";
export default class RefBase{
protected _RefMgractivity:RefMgractivityBase<IRefactivity>;
protected _RefMgractivityTab:RefMgractivityTabBase<IRefactivityTab>;
protected _RefMgrad:RefMgradBase<IRefad>;
protected _RefMgradvisor:RefMgradvisorBase<IRefadvisor>;
protected _RefMgrarmyLevel:RefMgrarmyLevelBase<IRefarmyLevel>;
protected _RefMgrarmySkillLevelUp:RefMgrarmySkillLevelUpBase<IRefarmySkillLevelUp>;
protected _RefMgrarmySkin:RefMgrarmySkinBase<IRefarmySkin>;
protected _RefMgrartifact:RefMgrartifactBase<IRefartifact>;
protected _RefMgrartifactLevel:RefMgrartifactLevelBase<IRefartifactLevel>;
protected _RefMgraudioConfig:RefMgraudioConfigBase<IRefaudioConfig>;
protected _RefMgrbaseBuilding:RefMgrbaseBuildingBase<IRefbaseBuilding>;
protected _RefMgrbaseBuildingLevel:RefMgrbaseBuildingLevelBase<IRefbaseBuildingLevel>;
protected _RefMgrbattleTokenConfig:RefMgrbattleTokenConfigBase<IRefbattleTokenConfig>;
protected _RefMgrbattleTokenPlan:RefMgrbattleTokenPlanBase<IRefbattleTokenPlan>;
protected _RefMgrbattleTokenReward:RefMgrbattleTokenRewardBase<IRefbattleTokenReward>;
protected _RefMgrbfUnionRankAward:RefMgrbfUnionRankAwardBase<IRefbfUnionRankAward>;
protected _RefMgrbigMapCamp:RefMgrbigMapCampBase<IRefbigMapCamp>;
protected _RefMgrbigMapMonster:RefMgrbigMapMonsterBase<IRefbigMapMonster>;
protected _RefMgrbigmapQueue:RefMgrbigmapQueueBase<IRefbigmapQueue>;
protected _RefMgrbigmapWorld:RefMgrbigmapWorldBase<IRefbigmapWorld>;
protected _RefMgrbigNum:RefMgrbigNumBase<IRefbigNum>;
protected _RefMgrbuild:RefMgrbuildBase<IRefbuild>;
protected _RefMgrcampProduceBuffId:RefMgrcampProduceBuffIdBase<IRefcampProduceBuffId>;
protected _RefMgrcardLevelUp:RefMgrcardLevelUpBase<IRefcardLevelUp>;
protected _RefMgrcardUiArtCamp:RefMgrcardUiArtCampBase<IRefcardUiArtCamp>;
protected _RefMgrcardUiArtClass:RefMgrcardUiArtClassBase<IRefcardUiArtClass>;
protected _RefMgrcardUiArtRarity:RefMgrcardUiArtRarityBase<IRefcardUiArtRarity>;
protected _RefMgrcelebrationConfig:RefMgrcelebrationConfigBase<IRefcelebrationConfig>;
protected _RefMgrcelebrationRank:RefMgrcelebrationRankBase<IRefcelebrationRank>;
protected _RefMgrcelebrationShop:RefMgrcelebrationShopBase<IRefcelebrationShop>;
protected _RefMgrcelebrationTarget:RefMgrcelebrationTargetBase<IRefcelebrationTarget>;
protected _RefMgrchapterName:RefMgrchapterNameBase<IRefchapterName>;
protected _RefMgrdayChallengeActTask:RefMgrdayChallengeActTaskBase<IRefdayChallengeActTask>;
protected _RefMgrdayChallengeActTaskProgress:RefMgrdayChallengeActTaskProgressBase<IRefdayChallengeActTaskProgress>;
protected _RefMgrdefenceModWave:RefMgrdefenceModWaveBase<IRefdefenceModWave>;
protected _RefMgrequip:RefMgrequipBase<IRefequip>;
protected _RefMgrequipLevel:RefMgrequipLevelBase<IRefequipLevel>;
protected _RefMgrequipLib:RefMgrequipLibBase<IRefequipLib>;
protected _RefMgrequipRank:RefMgrequipRankBase<IRefequipRank>;
protected _RefMgrequipType:RefMgrequipTypeBase<IRefequipType>;
protected _RefMgrfirstRechargeNew:RefMgrfirstRechargeNewBase<IReffirstRechargeNew>;
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
protected _RefMgrguankaChapter:RefMgrguankaChapterBase<IRefguankaChapter>;
protected _RefMgrguankaGift:RefMgrguankaGiftBase<IRefguankaGift>;
protected _RefMgrguankaReward:RefMgrguankaRewardBase<IRefguankaReward>;
protected _RefMgrguards:RefMgrguardsBase<IRefguards>;
protected _RefMgrguideDialog:RefMgrguideDialogBase<IRefguideDialog>;
protected _RefMgrguideStep:RefMgrguideStepBase<IRefguideStep>;
protected _RefMgrhead:RefMgrheadBase<IRefhead>;
protected _RefMgrheroSkill:RefMgrheroSkillBase<IRefheroSkill>;
protected _RefMgricon:RefMgriconBase<IReficon>;
protected _RefMgridConfig:RefMgridConfigBase<IRefidConfig>;
protected _RefMgrinteractReward:RefMgrinteractRewardBase<IRefinteractReward>;
protected _RefMgritem:RefMgritemBase<IRefitem>;
protected _RefMgritemBox:RefMgritemBoxBase<IRefitemBox>;
protected _RefMgritemBoxPro:RefMgritemBoxProBase<IRefitemBoxPro>;
protected _RefMgritemCraft:RefMgritemCraftBase<IRefitemCraft>;
protected _RefMgritemType:RefMgritemTypeBase<IRefitemType>;
protected _RefMgrlevel:RefMgrlevelBase<IReflevel>;
protected _RefMgrlevelFirstPassReward:RefMgrlevelFirstPassRewardBase<IReflevelFirstPassReward>;
protected _RefMgrlevelInfo:RefMgrlevelInfoBase<IReflevelInfo>;
protected _RefMgrlevelMapGrideReward:RefMgrlevelMapGrideRewardBase<IReflevelMapGrideReward>;
protected _RefMgrlottery:RefMgrlotteryBase<IReflottery>;
protected _RefMgrmapconfig:RefMgrmapconfigBase<IRefmapconfig>;
protected _RefMgrmapTerrian:RefMgrmapTerrianBase<IRefmapTerrian>;
protected _RefMgrmatchTips:RefMgrmatchTipsBase<IRefmatchTips>;
protected _RefMgrmL:RefMgrmLBase<IRefmL>;
protected _RefMgrmonster:RefMgrmonsterBase<IRefmonster>;
protected _RefMgrmonsterBox:RefMgrmonsterBoxBase<IRefmonsterBox>;
protected _RefMgrmonsterCard:RefMgrmonsterCardBase<IRefmonsterCard>;
protected _RefMgrmonsterSkillType:RefMgrmonsterSkillTypeBase<IRefmonsterSkillType>;
protected _RefMgrmonthCardActPlan:RefMgrmonthCardActPlanBase<IRefmonthCardActPlan>;
protected _RefMgrneutralEnhanceGate:RefMgrneutralEnhanceGateBase<IRefneutralEnhanceGate>;
protected _RefMgrneutralResourceGroup:RefMgrneutralResourceGroupBase<IRefneutralResourceGroup>;
protected _RefMgrnewTreasureBoxConfig:RefMgrnewTreasureBoxConfigBase<IRefnewTreasureBoxConfig>;
protected _RefMgrnpcTeam:RefMgrnpcTeamBase<IRefnpcTeam>;
protected _RefMgropen:RefMgropenBase<IRefopen>;
protected _RefMgropenGridReward:RefMgropenGridRewardBase<IRefopenGridReward>;
protected _RefMgrpayChannel:RefMgrpayChannelBase<IRefpayChannel>;
protected _RefMgrplotCard:RefMgrplotCardBase<IRefplotCard>;
protected _RefMgrpvpArtifact:RefMgrpvpArtifactBase<IRefpvpArtifact>;
protected _RefMgrpvpAttrMap:RefMgrpvpAttrMapBase<IRefpvpAttrMap>;
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
protected _RefMgrrechargeDaily:RefMgrrechargeDailyBase<IRefrechargeDaily>;
protected _RefMgrrechargeGiftActPlan:RefMgrrechargeGiftActPlanBase<IRefrechargeGiftActPlan>;
protected _RefMgrrefToCodeEnum:RefMgrrefToCodeEnumBase<IRefrefToCodeEnum>;
protected _RefMgrresourceShop:RefMgrresourceShopBase<IRefresourceShop>;
protected _RefMgrroleProperty:RefMgrrolePropertyBase<IRefroleProperty>;
protected _RefMgrserverRank:RefMgrserverRankBase<IRefserverRank>;
protected _RefMgrsevenDayPoint:RefMgrsevenDayPointBase<IRefsevenDayPoint>;
protected _RefMgrsevenDayShop:RefMgrsevenDayShopBase<IRefsevenDayShop>;
protected _RefMgrsevenDayTask:RefMgrsevenDayTaskBase<IRefsevenDayTask>;
protected _RefMgrshare:RefMgrshareBase<IRefshare>;
protected _RefMgrshiMengBattleConfig:RefMgrshiMengBattleConfigBase<IRefshiMengBattleConfig>;
protected _RefMgrskillAttr:RefMgrskillAttrBase<IRefskillAttr>;
protected _RefMgrskillAttrModifier:RefMgrskillAttrModifierBase<IRefskillAttrModifier>;
protected _RefMgrskillBuff:RefMgrskillBuffBase<IRefskillBuff>;
protected _RefMgrskillEffect:RefMgrskillEffectBase<IRefskillEffect>;
protected _RefMgrskillEffectDamageType:RefMgrskillEffectDamageTypeBase<IRefskillEffectDamageType>;
protected _RefMgrskillType:RefMgrskillTypeBase<IRefskillType>;
protected _RefMgrskillView:RefMgrskillViewBase<IRefskillView>;
protected _RefMgrskin:RefMgrskinBase<IRefskin>;
protected _RefMgrspiritAnimal:RefMgrspiritAnimalBase<IRefspiritAnimal>;
protected _RefMgrspiritAnimalType:RefMgrspiritAnimalTypeBase<IRefspiritAnimalType>;
protected _RefMgrtaskMain:RefMgrtaskMainBase<IReftaskMain>;
protected _RefMgrtaskType:RefMgrtaskTypeBase<IReftaskType>;
protected _RefMgrtaskUnion:RefMgrtaskUnionBase<IReftaskUnion>;
protected _RefMgrtaskUnionProgress:RefMgrtaskUnionProgressBase<IReftaskUnionProgress>;
protected _RefMgrunionDiscount:RefMgrunionDiscountBase<IRefunionDiscount>;
protected _RefMgrunionLevel:RefMgrunionLevelBase<IRefunionLevel>;
protected _RefMgrunionOfficial:RefMgrunionOfficialBase<IRefunionOfficial>;
protected _RefMgrunionShop:RefMgrunionShopBase<IRefunionShop>;
protected _RefMgrviewtype:RefMgrviewtypeBase<IRefviewtype>;
protected _RefMgrwall:RefMgrwallBase<IRefwall>;
protected _RefMgrwallType:RefMgrwallTypeBase<IRefwallType>;
protected _RefMgrzcGuide:RefMgrzcGuideBase<IRefzcGuide>;
protected _RefMgrzcGuideParams:RefMgrzcGuideParamsBase<IRefzcGuideParams>;
get RefMgractivity(){if(!this._RefMgractivity){this._RefMgractivity=new RefMgractivityBase<IRefactivity>()}return this._RefMgractivity}
get RefMgractivityTab(){if(!this._RefMgractivityTab){this._RefMgractivityTab=new RefMgractivityTabBase<IRefactivityTab>()}return this._RefMgractivityTab}
get RefMgrad(){if(!this._RefMgrad){this._RefMgrad=new RefMgradBase<IRefad>()}return this._RefMgrad}
get RefMgradvisor(){if(!this._RefMgradvisor){this._RefMgradvisor=new RefMgradvisorBase<IRefadvisor>()}return this._RefMgradvisor}
get RefMgrarmyLevel(){if(!this._RefMgrarmyLevel){this._RefMgrarmyLevel=new RefMgrarmyLevelBase<IRefarmyLevel>()}return this._RefMgrarmyLevel}
get RefMgrarmySkillLevelUp(){if(!this._RefMgrarmySkillLevelUp){this._RefMgrarmySkillLevelUp=new RefMgrarmySkillLevelUpBase<IRefarmySkillLevelUp>()}return this._RefMgrarmySkillLevelUp}
get RefMgrarmySkin(){if(!this._RefMgrarmySkin){this._RefMgrarmySkin=new RefMgrarmySkinBase<IRefarmySkin>()}return this._RefMgrarmySkin}
get RefMgrartifact(){if(!this._RefMgrartifact){this._RefMgrartifact=new RefMgrartifactBase<IRefartifact>()}return this._RefMgrartifact}
get RefMgrartifactLevel(){if(!this._RefMgrartifactLevel){this._RefMgrartifactLevel=new RefMgrartifactLevelBase<IRefartifactLevel>()}return this._RefMgrartifactLevel}
get RefMgraudioConfig(){if(!this._RefMgraudioConfig){this._RefMgraudioConfig=new RefMgraudioConfigBase<IRefaudioConfig>()}return this._RefMgraudioConfig}
get RefMgrbaseBuilding(){if(!this._RefMgrbaseBuilding){this._RefMgrbaseBuilding=new RefMgrbaseBuildingBase<IRefbaseBuilding>()}return this._RefMgrbaseBuilding}
get RefMgrbaseBuildingLevel(){if(!this._RefMgrbaseBuildingLevel){this._RefMgrbaseBuildingLevel=new RefMgrbaseBuildingLevelBase<IRefbaseBuildingLevel>()}return this._RefMgrbaseBuildingLevel}
get RefMgrbattleTokenConfig(){if(!this._RefMgrbattleTokenConfig){this._RefMgrbattleTokenConfig=new RefMgrbattleTokenConfigBase<IRefbattleTokenConfig>()}return this._RefMgrbattleTokenConfig}
get RefMgrbattleTokenPlan(){if(!this._RefMgrbattleTokenPlan){this._RefMgrbattleTokenPlan=new RefMgrbattleTokenPlanBase<IRefbattleTokenPlan>()}return this._RefMgrbattleTokenPlan}
get RefMgrbattleTokenReward(){if(!this._RefMgrbattleTokenReward){this._RefMgrbattleTokenReward=new RefMgrbattleTokenRewardBase<IRefbattleTokenReward>()}return this._RefMgrbattleTokenReward}
get RefMgrbfUnionRankAward(){if(!this._RefMgrbfUnionRankAward){this._RefMgrbfUnionRankAward=new RefMgrbfUnionRankAwardBase<IRefbfUnionRankAward>()}return this._RefMgrbfUnionRankAward}
get RefMgrbigMapCamp(){if(!this._RefMgrbigMapCamp){this._RefMgrbigMapCamp=new RefMgrbigMapCampBase<IRefbigMapCamp>()}return this._RefMgrbigMapCamp}
get RefMgrbigMapMonster(){if(!this._RefMgrbigMapMonster){this._RefMgrbigMapMonster=new RefMgrbigMapMonsterBase<IRefbigMapMonster>()}return this._RefMgrbigMapMonster}
get RefMgrbigmapQueue(){if(!this._RefMgrbigmapQueue){this._RefMgrbigmapQueue=new RefMgrbigmapQueueBase<IRefbigmapQueue>()}return this._RefMgrbigmapQueue}
get RefMgrbigmapWorld(){if(!this._RefMgrbigmapWorld){this._RefMgrbigmapWorld=new RefMgrbigmapWorldBase<IRefbigmapWorld>()}return this._RefMgrbigmapWorld}
get RefMgrbigNum(){if(!this._RefMgrbigNum){this._RefMgrbigNum=new RefMgrbigNumBase<IRefbigNum>()}return this._RefMgrbigNum}
get RefMgrbuild(){if(!this._RefMgrbuild){this._RefMgrbuild=new RefMgrbuildBase<IRefbuild>()}return this._RefMgrbuild}
get RefMgrcampProduceBuffId(){if(!this._RefMgrcampProduceBuffId){this._RefMgrcampProduceBuffId=new RefMgrcampProduceBuffIdBase<IRefcampProduceBuffId>()}return this._RefMgrcampProduceBuffId}
get RefMgrcardLevelUp(){if(!this._RefMgrcardLevelUp){this._RefMgrcardLevelUp=new RefMgrcardLevelUpBase<IRefcardLevelUp>()}return this._RefMgrcardLevelUp}
get RefMgrcardUiArtCamp(){if(!this._RefMgrcardUiArtCamp){this._RefMgrcardUiArtCamp=new RefMgrcardUiArtCampBase<IRefcardUiArtCamp>()}return this._RefMgrcardUiArtCamp}
get RefMgrcardUiArtClass(){if(!this._RefMgrcardUiArtClass){this._RefMgrcardUiArtClass=new RefMgrcardUiArtClassBase<IRefcardUiArtClass>()}return this._RefMgrcardUiArtClass}
get RefMgrcardUiArtRarity(){if(!this._RefMgrcardUiArtRarity){this._RefMgrcardUiArtRarity=new RefMgrcardUiArtRarityBase<IRefcardUiArtRarity>()}return this._RefMgrcardUiArtRarity}
get RefMgrcelebrationConfig(){if(!this._RefMgrcelebrationConfig){this._RefMgrcelebrationConfig=new RefMgrcelebrationConfigBase<IRefcelebrationConfig>()}return this._RefMgrcelebrationConfig}
get RefMgrcelebrationRank(){if(!this._RefMgrcelebrationRank){this._RefMgrcelebrationRank=new RefMgrcelebrationRankBase<IRefcelebrationRank>()}return this._RefMgrcelebrationRank}
get RefMgrcelebrationShop(){if(!this._RefMgrcelebrationShop){this._RefMgrcelebrationShop=new RefMgrcelebrationShopBase<IRefcelebrationShop>()}return this._RefMgrcelebrationShop}
get RefMgrcelebrationTarget(){if(!this._RefMgrcelebrationTarget){this._RefMgrcelebrationTarget=new RefMgrcelebrationTargetBase<IRefcelebrationTarget>()}return this._RefMgrcelebrationTarget}
get RefMgrchapterName(){if(!this._RefMgrchapterName){this._RefMgrchapterName=new RefMgrchapterNameBase<IRefchapterName>()}return this._RefMgrchapterName}
get RefMgrdayChallengeActTask(){if(!this._RefMgrdayChallengeActTask){this._RefMgrdayChallengeActTask=new RefMgrdayChallengeActTaskBase<IRefdayChallengeActTask>()}return this._RefMgrdayChallengeActTask}
get RefMgrdayChallengeActTaskProgress(){if(!this._RefMgrdayChallengeActTaskProgress){this._RefMgrdayChallengeActTaskProgress=new RefMgrdayChallengeActTaskProgressBase<IRefdayChallengeActTaskProgress>()}return this._RefMgrdayChallengeActTaskProgress}
get RefMgrdefenceModWave(){if(!this._RefMgrdefenceModWave){this._RefMgrdefenceModWave=new RefMgrdefenceModWaveBase<IRefdefenceModWave>()}return this._RefMgrdefenceModWave}
get RefMgrequip(){if(!this._RefMgrequip){this._RefMgrequip=new RefMgrequipBase<IRefequip>()}return this._RefMgrequip}
get RefMgrequipLevel(){if(!this._RefMgrequipLevel){this._RefMgrequipLevel=new RefMgrequipLevelBase<IRefequipLevel>()}return this._RefMgrequipLevel}
get RefMgrequipLib(){if(!this._RefMgrequipLib){this._RefMgrequipLib=new RefMgrequipLibBase<IRefequipLib>()}return this._RefMgrequipLib}
get RefMgrequipRank(){if(!this._RefMgrequipRank){this._RefMgrequipRank=new RefMgrequipRankBase<IRefequipRank>()}return this._RefMgrequipRank}
get RefMgrequipType(){if(!this._RefMgrequipType){this._RefMgrequipType=new RefMgrequipTypeBase<IRefequipType>()}return this._RefMgrequipType}
get RefMgrfirstRechargeNew(){if(!this._RefMgrfirstRechargeNew){this._RefMgrfirstRechargeNew=new RefMgrfirstRechargeNewBase<IReffirstRechargeNew>()}return this._RefMgrfirstRechargeNew}
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
get RefMgrguankaChapter(){if(!this._RefMgrguankaChapter){this._RefMgrguankaChapter=new RefMgrguankaChapterBase<IRefguankaChapter>()}return this._RefMgrguankaChapter}
get RefMgrguankaGift(){if(!this._RefMgrguankaGift){this._RefMgrguankaGift=new RefMgrguankaGiftBase<IRefguankaGift>()}return this._RefMgrguankaGift}
get RefMgrguankaReward(){if(!this._RefMgrguankaReward){this._RefMgrguankaReward=new RefMgrguankaRewardBase<IRefguankaReward>()}return this._RefMgrguankaReward}
get RefMgrguards(){if(!this._RefMgrguards){this._RefMgrguards=new RefMgrguardsBase<IRefguards>()}return this._RefMgrguards}
get RefMgrguideDialog(){if(!this._RefMgrguideDialog){this._RefMgrguideDialog=new RefMgrguideDialogBase<IRefguideDialog>()}return this._RefMgrguideDialog}
get RefMgrguideStep(){if(!this._RefMgrguideStep){this._RefMgrguideStep=new RefMgrguideStepBase<IRefguideStep>()}return this._RefMgrguideStep}
get RefMgrhead(){if(!this._RefMgrhead){this._RefMgrhead=new RefMgrheadBase<IRefhead>()}return this._RefMgrhead}
get RefMgrheroSkill(){if(!this._RefMgrheroSkill){this._RefMgrheroSkill=new RefMgrheroSkillBase<IRefheroSkill>()}return this._RefMgrheroSkill}
get RefMgricon(){if(!this._RefMgricon){this._RefMgricon=new RefMgriconBase<IReficon>()}return this._RefMgricon}
get RefMgridConfig(){if(!this._RefMgridConfig){this._RefMgridConfig=new RefMgridConfigBase<IRefidConfig>()}return this._RefMgridConfig}
get RefMgrinteractReward(){if(!this._RefMgrinteractReward){this._RefMgrinteractReward=new RefMgrinteractRewardBase<IRefinteractReward>()}return this._RefMgrinteractReward}
get RefMgritem(){if(!this._RefMgritem){this._RefMgritem=new RefMgritemBase<IRefitem>()}return this._RefMgritem}
get RefMgritemBox(){if(!this._RefMgritemBox){this._RefMgritemBox=new RefMgritemBoxBase<IRefitemBox>()}return this._RefMgritemBox}
get RefMgritemBoxPro(){if(!this._RefMgritemBoxPro){this._RefMgritemBoxPro=new RefMgritemBoxProBase<IRefitemBoxPro>()}return this._RefMgritemBoxPro}
get RefMgritemCraft(){if(!this._RefMgritemCraft){this._RefMgritemCraft=new RefMgritemCraftBase<IRefitemCraft>()}return this._RefMgritemCraft}
get RefMgritemType(){if(!this._RefMgritemType){this._RefMgritemType=new RefMgritemTypeBase<IRefitemType>()}return this._RefMgritemType}
get RefMgrlevel(){if(!this._RefMgrlevel){this._RefMgrlevel=new RefMgrlevelBase<IReflevel>()}return this._RefMgrlevel}
get RefMgrlevelFirstPassReward(){if(!this._RefMgrlevelFirstPassReward){this._RefMgrlevelFirstPassReward=new RefMgrlevelFirstPassRewardBase<IReflevelFirstPassReward>()}return this._RefMgrlevelFirstPassReward}
get RefMgrlevelInfo(){if(!this._RefMgrlevelInfo){this._RefMgrlevelInfo=new RefMgrlevelInfoBase<IReflevelInfo>()}return this._RefMgrlevelInfo}
get RefMgrlevelMapGrideReward(){if(!this._RefMgrlevelMapGrideReward){this._RefMgrlevelMapGrideReward=new RefMgrlevelMapGrideRewardBase<IReflevelMapGrideReward>()}return this._RefMgrlevelMapGrideReward}
get RefMgrlottery(){if(!this._RefMgrlottery){this._RefMgrlottery=new RefMgrlotteryBase<IReflottery>()}return this._RefMgrlottery}
get RefMgrmapconfig(){if(!this._RefMgrmapconfig){this._RefMgrmapconfig=new RefMgrmapconfigBase<IRefmapconfig>()}return this._RefMgrmapconfig}
get RefMgrmapTerrian(){if(!this._RefMgrmapTerrian){this._RefMgrmapTerrian=new RefMgrmapTerrianBase<IRefmapTerrian>()}return this._RefMgrmapTerrian}
get RefMgrmatchTips(){if(!this._RefMgrmatchTips){this._RefMgrmatchTips=new RefMgrmatchTipsBase<IRefmatchTips>()}return this._RefMgrmatchTips}
get RefMgrmL(){if(!this._RefMgrmL){this._RefMgrmL=new RefMgrmLBase<IRefmL>()}return this._RefMgrmL}
get RefMgrmonster(){if(!this._RefMgrmonster){this._RefMgrmonster=new RefMgrmonsterBase<IRefmonster>()}return this._RefMgrmonster}
get RefMgrmonsterBox(){if(!this._RefMgrmonsterBox){this._RefMgrmonsterBox=new RefMgrmonsterBoxBase<IRefmonsterBox>()}return this._RefMgrmonsterBox}
get RefMgrmonsterCard(){if(!this._RefMgrmonsterCard){this._RefMgrmonsterCard=new RefMgrmonsterCardBase<IRefmonsterCard>()}return this._RefMgrmonsterCard}
get RefMgrmonsterSkillType(){if(!this._RefMgrmonsterSkillType){this._RefMgrmonsterSkillType=new RefMgrmonsterSkillTypeBase<IRefmonsterSkillType>()}return this._RefMgrmonsterSkillType}
get RefMgrmonthCardActPlan(){if(!this._RefMgrmonthCardActPlan){this._RefMgrmonthCardActPlan=new RefMgrmonthCardActPlanBase<IRefmonthCardActPlan>()}return this._RefMgrmonthCardActPlan}
get RefMgrneutralEnhanceGate(){if(!this._RefMgrneutralEnhanceGate){this._RefMgrneutralEnhanceGate=new RefMgrneutralEnhanceGateBase<IRefneutralEnhanceGate>()}return this._RefMgrneutralEnhanceGate}
get RefMgrneutralResourceGroup(){if(!this._RefMgrneutralResourceGroup){this._RefMgrneutralResourceGroup=new RefMgrneutralResourceGroupBase<IRefneutralResourceGroup>()}return this._RefMgrneutralResourceGroup}
get RefMgrnewTreasureBoxConfig(){if(!this._RefMgrnewTreasureBoxConfig){this._RefMgrnewTreasureBoxConfig=new RefMgrnewTreasureBoxConfigBase<IRefnewTreasureBoxConfig>()}return this._RefMgrnewTreasureBoxConfig}
get RefMgrnpcTeam(){if(!this._RefMgrnpcTeam){this._RefMgrnpcTeam=new RefMgrnpcTeamBase<IRefnpcTeam>()}return this._RefMgrnpcTeam}
get RefMgropen(){if(!this._RefMgropen){this._RefMgropen=new RefMgropenBase<IRefopen>()}return this._RefMgropen}
get RefMgropenGridReward(){if(!this._RefMgropenGridReward){this._RefMgropenGridReward=new RefMgropenGridRewardBase<IRefopenGridReward>()}return this._RefMgropenGridReward}
get RefMgrpayChannel(){if(!this._RefMgrpayChannel){this._RefMgrpayChannel=new RefMgrpayChannelBase<IRefpayChannel>()}return this._RefMgrpayChannel}
get RefMgrplotCard(){if(!this._RefMgrplotCard){this._RefMgrplotCard=new RefMgrplotCardBase<IRefplotCard>()}return this._RefMgrplotCard}
get RefMgrpvpArtifact(){if(!this._RefMgrpvpArtifact){this._RefMgrpvpArtifact=new RefMgrpvpArtifactBase<IRefpvpArtifact>()}return this._RefMgrpvpArtifact}
get RefMgrpvpAttrMap(){if(!this._RefMgrpvpAttrMap){this._RefMgrpvpAttrMap=new RefMgrpvpAttrMapBase<IRefpvpAttrMap>()}return this._RefMgrpvpAttrMap}
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
get RefMgrrechargeDaily(){if(!this._RefMgrrechargeDaily){this._RefMgrrechargeDaily=new RefMgrrechargeDailyBase<IRefrechargeDaily>()}return this._RefMgrrechargeDaily}
get RefMgrrechargeGiftActPlan(){if(!this._RefMgrrechargeGiftActPlan){this._RefMgrrechargeGiftActPlan=new RefMgrrechargeGiftActPlanBase<IRefrechargeGiftActPlan>()}return this._RefMgrrechargeGiftActPlan}
get RefMgrrefToCodeEnum(){if(!this._RefMgrrefToCodeEnum){this._RefMgrrefToCodeEnum=new RefMgrrefToCodeEnumBase<IRefrefToCodeEnum>()}return this._RefMgrrefToCodeEnum}
get RefMgrresourceShop(){if(!this._RefMgrresourceShop){this._RefMgrresourceShop=new RefMgrresourceShopBase<IRefresourceShop>()}return this._RefMgrresourceShop}
get RefMgrroleProperty(){if(!this._RefMgrroleProperty){this._RefMgrroleProperty=new RefMgrrolePropertyBase<IRefroleProperty>()}return this._RefMgrroleProperty}
get RefMgrserverRank(){if(!this._RefMgrserverRank){this._RefMgrserverRank=new RefMgrserverRankBase<IRefserverRank>()}return this._RefMgrserverRank}
get RefMgrsevenDayPoint(){if(!this._RefMgrsevenDayPoint){this._RefMgrsevenDayPoint=new RefMgrsevenDayPointBase<IRefsevenDayPoint>()}return this._RefMgrsevenDayPoint}
get RefMgrsevenDayShop(){if(!this._RefMgrsevenDayShop){this._RefMgrsevenDayShop=new RefMgrsevenDayShopBase<IRefsevenDayShop>()}return this._RefMgrsevenDayShop}
get RefMgrsevenDayTask(){if(!this._RefMgrsevenDayTask){this._RefMgrsevenDayTask=new RefMgrsevenDayTaskBase<IRefsevenDayTask>()}return this._RefMgrsevenDayTask}
get RefMgrshare(){if(!this._RefMgrshare){this._RefMgrshare=new RefMgrshareBase<IRefshare>()}return this._RefMgrshare}
get RefMgrshiMengBattleConfig(){if(!this._RefMgrshiMengBattleConfig){this._RefMgrshiMengBattleConfig=new RefMgrshiMengBattleConfigBase<IRefshiMengBattleConfig>()}return this._RefMgrshiMengBattleConfig}
get RefMgrskillAttr(){if(!this._RefMgrskillAttr){this._RefMgrskillAttr=new RefMgrskillAttrBase<IRefskillAttr>()}return this._RefMgrskillAttr}
get RefMgrskillAttrModifier(){if(!this._RefMgrskillAttrModifier){this._RefMgrskillAttrModifier=new RefMgrskillAttrModifierBase<IRefskillAttrModifier>()}return this._RefMgrskillAttrModifier}
get RefMgrskillBuff(){if(!this._RefMgrskillBuff){this._RefMgrskillBuff=new RefMgrskillBuffBase<IRefskillBuff>()}return this._RefMgrskillBuff}
get RefMgrskillEffect(){if(!this._RefMgrskillEffect){this._RefMgrskillEffect=new RefMgrskillEffectBase<IRefskillEffect>()}return this._RefMgrskillEffect}
get RefMgrskillEffectDamageType(){if(!this._RefMgrskillEffectDamageType){this._RefMgrskillEffectDamageType=new RefMgrskillEffectDamageTypeBase<IRefskillEffectDamageType>()}return this._RefMgrskillEffectDamageType}
get RefMgrskillType(){if(!this._RefMgrskillType){this._RefMgrskillType=new RefMgrskillTypeBase<IRefskillType>()}return this._RefMgrskillType}
get RefMgrskillView(){if(!this._RefMgrskillView){this._RefMgrskillView=new RefMgrskillViewBase<IRefskillView>()}return this._RefMgrskillView}
get RefMgrskin(){if(!this._RefMgrskin){this._RefMgrskin=new RefMgrskinBase<IRefskin>()}return this._RefMgrskin}
get RefMgrspiritAnimal(){if(!this._RefMgrspiritAnimal){this._RefMgrspiritAnimal=new RefMgrspiritAnimalBase<IRefspiritAnimal>()}return this._RefMgrspiritAnimal}
get RefMgrspiritAnimalType(){if(!this._RefMgrspiritAnimalType){this._RefMgrspiritAnimalType=new RefMgrspiritAnimalTypeBase<IRefspiritAnimalType>()}return this._RefMgrspiritAnimalType}
get RefMgrtaskMain(){if(!this._RefMgrtaskMain){this._RefMgrtaskMain=new RefMgrtaskMainBase<IReftaskMain>()}return this._RefMgrtaskMain}
get RefMgrtaskType(){if(!this._RefMgrtaskType){this._RefMgrtaskType=new RefMgrtaskTypeBase<IReftaskType>()}return this._RefMgrtaskType}
get RefMgrtaskUnion(){if(!this._RefMgrtaskUnion){this._RefMgrtaskUnion=new RefMgrtaskUnionBase<IReftaskUnion>()}return this._RefMgrtaskUnion}
get RefMgrtaskUnionProgress(){if(!this._RefMgrtaskUnionProgress){this._RefMgrtaskUnionProgress=new RefMgrtaskUnionProgressBase<IReftaskUnionProgress>()}return this._RefMgrtaskUnionProgress}
get RefMgrunionDiscount(){if(!this._RefMgrunionDiscount){this._RefMgrunionDiscount=new RefMgrunionDiscountBase<IRefunionDiscount>()}return this._RefMgrunionDiscount}
get RefMgrunionLevel(){if(!this._RefMgrunionLevel){this._RefMgrunionLevel=new RefMgrunionLevelBase<IRefunionLevel>()}return this._RefMgrunionLevel}
get RefMgrunionOfficial(){if(!this._RefMgrunionOfficial){this._RefMgrunionOfficial=new RefMgrunionOfficialBase<IRefunionOfficial>()}return this._RefMgrunionOfficial}
get RefMgrunionShop(){if(!this._RefMgrunionShop){this._RefMgrunionShop=new RefMgrunionShopBase<IRefunionShop>()}return this._RefMgrunionShop}
get RefMgrviewtype(){if(!this._RefMgrviewtype){this._RefMgrviewtype=new RefMgrviewtypeBase<IRefviewtype>()}return this._RefMgrviewtype}
get RefMgrwall(){if(!this._RefMgrwall){this._RefMgrwall=new RefMgrwallBase<IRefwall>()}return this._RefMgrwall}
get RefMgrwallType(){if(!this._RefMgrwallType){this._RefMgrwallType=new RefMgrwallTypeBase<IRefwallType>()}return this._RefMgrwallType}
get RefMgrzcGuide(){if(!this._RefMgrzcGuide){this._RefMgrzcGuide=new RefMgrzcGuideBase<IRefzcGuide>()}return this._RefMgrzcGuide}
get RefMgrzcGuideParams(){if(!this._RefMgrzcGuideParams){this._RefMgrzcGuideParams=new RefMgrzcGuideParamsBase<IRefzcGuideParams>()}return this._RefMgrzcGuideParams}

}
export class RefMgractivityBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("activity")}}
export class RefMgractivityTabBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("activityTab")}}
export class RefMgradBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("ad")}}
export class RefMgradvisorBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("advisor")}}
export class RefMgrarmyLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("armyLevel")}}
export class RefMgrarmySkillLevelUpBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("armySkillLevelUp")}}
export class RefMgrarmySkinBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("armySkin")}}
export class RefMgrartifactBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("artifact")}}
export class RefMgrartifactLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("artifactLevel")}}
export class RefMgraudioConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("audioConfig")}}
export class RefMgrbaseBuildingBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("baseBuilding")}}
export class RefMgrbaseBuildingLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("baseBuildingLevel")}}
export class RefMgrbattleTokenConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("battleTokenConfig")}}
export class RefMgrbattleTokenPlanBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("battleTokenPlan")}}
export class RefMgrbattleTokenRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("battleTokenReward")}}
export class RefMgrbfUnionRankAwardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bfUnionRankAward")}}
export class RefMgrbigMapCampBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigMapCamp")}}
export class RefMgrbigMapMonsterBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigMapMonster")}}
export class RefMgrbigmapQueueBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapQueue")}}
export class RefMgrbigmapWorldBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigmapWorld")}}
export class RefMgrbigNumBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("bigNum")}}
export class RefMgrbuildBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("build")}}
export class RefMgrcampProduceBuffIdBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("campProduceBuffId")}}
export class RefMgrcardLevelUpBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("cardLevelUp")}}
export class RefMgrcardUiArtCampBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("cardUiArtCamp")}}
export class RefMgrcardUiArtClassBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("cardUiArtClass")}}
export class RefMgrcardUiArtRarityBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("cardUiArtRarity")}}
export class RefMgrcelebrationConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("celebrationConfig")}}
export class RefMgrcelebrationRankBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("celebrationRank")}}
export class RefMgrcelebrationShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("celebrationShop")}}
export class RefMgrcelebrationTargetBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("celebrationTarget")}}
export class RefMgrchapterNameBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("chapterName")}}
export class RefMgrdayChallengeActTaskBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("dayChallengeActTask")}}
export class RefMgrdayChallengeActTaskProgressBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("dayChallengeActTaskProgress")}}
export class RefMgrdefenceModWaveBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("defenceModWave")}}
export class RefMgrequipBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("equip")}}
export class RefMgrequipLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("equipLevel")}}
export class RefMgrequipLibBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("equipLib")}}
export class RefMgrequipRankBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("equipRank")}}
export class RefMgrequipTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("equipType")}}
export class RefMgrfirstRechargeNewBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("firstRechargeNew")}}
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
export class RefMgrguankaChapterBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaChapter")}}
export class RefMgrguankaGiftBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaGift")}}
export class RefMgrguankaRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guankaReward")}}
export class RefMgrguardsBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guards")}}
export class RefMgrguideDialogBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guideDialog")}}
export class RefMgrguideStepBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("guideStep")}}
export class RefMgrheadBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("head")}}
export class RefMgrheroSkillBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("heroSkill")}}
export class RefMgriconBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("icon")}}
export class RefMgridConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("idConfig")}}
export class RefMgrinteractRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("interactReward")}}
export class RefMgritemBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("item")}}
export class RefMgritemBoxBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("itemBox")}}
export class RefMgritemBoxProBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("itemBoxPro")}}
export class RefMgritemCraftBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("itemCraft")}}
export class RefMgritemTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("itemType")}}
export class RefMgrlevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("level")}}
export class RefMgrlevelFirstPassRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("levelFirstPassReward")}}
export class RefMgrlevelInfoBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("levelInfo")}}
export class RefMgrlevelMapGrideRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("levelMapGrideReward")}}
export class RefMgrlotteryBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("lottery")}}
export class RefMgrmapconfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("mapconfig")}}
export class RefMgrmapTerrianBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("mapTerrian")}}
export class RefMgrmatchTipsBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("matchTips")}}
export class RefMgrmLBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("mL")}}
export class RefMgrmonsterBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("monster")}}
export class RefMgrmonsterBoxBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("monsterBox")}}
export class RefMgrmonsterCardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("monsterCard")}}
export class RefMgrmonsterSkillTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("monsterSkillType")}}
export class RefMgrmonthCardActPlanBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("monthCardActPlan")}}
export class RefMgrneutralEnhanceGateBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("neutralEnhanceGate")}}
export class RefMgrneutralResourceGroupBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("neutralResourceGroup")}}
export class RefMgrnewTreasureBoxConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("newTreasureBoxConfig")}}
export class RefMgrnpcTeamBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("npcTeam")}}
export class RefMgropenBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("open")}}
export class RefMgropenGridRewardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("openGridReward")}}
export class RefMgrpayChannelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("payChannel")}}
export class RefMgrplotCardBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("plotCard")}}
export class RefMgrpvpArtifactBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpArtifact")}}
export class RefMgrpvpAttrMapBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("pvpAttrMap")}}
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
export class RefMgrrechargeDailyBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("rechargeDaily")}}
export class RefMgrrechargeGiftActPlanBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("rechargeGiftActPlan")}}
export class RefMgrrefToCodeEnumBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("refToCodeEnum")}}
export class RefMgrresourceShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("resourceShop")}}
export class RefMgrrolePropertyBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("roleProperty")}}
export class RefMgrserverRankBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("serverRank")}}
export class RefMgrsevenDayPointBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("sevenDayPoint")}}
export class RefMgrsevenDayShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("sevenDayShop")}}
export class RefMgrsevenDayTaskBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("sevenDayTask")}}
export class RefMgrshareBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("share")}}
export class RefMgrshiMengBattleConfigBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("shiMengBattleConfig")}}
export class RefMgrskillAttrBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillAttr")}}
export class RefMgrskillAttrModifierBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillAttrModifier")}}
export class RefMgrskillBuffBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillBuff")}}
export class RefMgrskillEffectBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillEffect")}}
export class RefMgrskillEffectDamageTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillEffectDamageType")}}
export class RefMgrskillTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillType")}}
export class RefMgrskillViewBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skillView")}}
export class RefMgrskinBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("skin")}}
export class RefMgrspiritAnimalBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("spiritAnimal")}}
export class RefMgrspiritAnimalTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("spiritAnimalType")}}
export class RefMgrtaskMainBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("taskMain")}}
export class RefMgrtaskTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("taskType")}}
export class RefMgrtaskUnionBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("taskUnion")}}
export class RefMgrtaskUnionProgressBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("taskUnionProgress")}}
export class RefMgrunionDiscountBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("unionDiscount")}}
export class RefMgrunionLevelBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("unionLevel")}}
export class RefMgrunionOfficialBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("unionOfficial")}}
export class RefMgrunionShopBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("unionShop")}}
export class RefMgrviewtypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("viewtype")}}
export class RefMgrwallBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("wall")}}
export class RefMgrwallTypeBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("wallType")}}
export class RefMgrzcGuideBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("zcGuide")}}
export class RefMgrzcGuideParamsBase<T extends IRefBase> extends RefMgrBase<T>{constructor(){super("zcGuideParams")}}
