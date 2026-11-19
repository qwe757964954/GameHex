interface IRefactivity extends IRefBase
{
resId:number
type:number
name:string
plan:number
}
type IRefactivity_resId=number
type IRefactivity_type=number
type IRefactivity_name=string
type IRefactivity_plan=number

interface refGen{activity:IRefactivity}


interface IRefactivityTab extends IRefBase
{
id:number
name:string
tlType:any[]
desc:string
key:string
}
type IRefactivityTab_id=number
type IRefactivityTab_name=string
type IRefactivityTab_tlType=any[]
type IRefactivityTab_desc=string
type IRefactivityTab_key=string

interface refGen{activityTab:IRefactivityTab}


interface IRefad extends IRefBase
{
type:number
desc:string
key:string
limit:number
rewards:any[]
cdTime:number
huaweiAdUnitId:string
}
type IRefad_type=number
type IRefad_desc=string
type IRefad_key=string
type IRefad_limit=number
type IRefad_rewards=any[]
type IRefad_cdTime=number
type IRefad_huaweiAdUnitId=string

interface refGen{ad:IRefad}


interface IRefadvisor extends IRefBase
{
id:number
resId:number
advisorName:string
bindHead:any[]
sortId:number
armyId:number
iconKaPai:string
quality:number
model:string
head?:string
}
type IRefadvisor_id=number
type IRefadvisor_resId=number
type IRefadvisor_advisorName=string
type IRefadvisor_bindHead=any[]
type IRefadvisor_sortId=number
type IRefadvisor_armyId=number
type IRefadvisor_iconKaPai=string
type IRefadvisor_quality=number
type IRefadvisor_model=string
type IRefadvisor_head=string

interface refGen{advisor:IRefadvisor}


interface IRefarmyLevel extends IRefBase
{
id:number
level:number
costGoldCnt:number
costItemID:number
costItemNum:number
attrList?:any[]
modify?:any[]
modifyDesc?:string
icon?:string
Scale?:number
}
type IRefarmyLevel_id=number
type IRefarmyLevel_level=number
type IRefarmyLevel_costGoldCnt=number
type IRefarmyLevel_costItemID=number
type IRefarmyLevel_costItemNum=number
type IRefarmyLevel_attrList=any[]
type IRefarmyLevel_modify=any[]
type IRefarmyLevel_modifyDesc=string
type IRefarmyLevel_icon=string
type IRefarmyLevel_Scale=number

interface refGen{armyLevel:IRefarmyLevel}


interface IRefarmySkillLevelUp extends IRefBase
{
id:number
name?:string
desc?:string
unlockarmylevel:number
skilllevel:number
costCoinID:number
costCoinNum:number
costArmySkillLevelID:number
costArmySkillLevelNum:number
armySkillType:number
modfiy:any[]
}
type IRefarmySkillLevelUp_id=number
type IRefarmySkillLevelUp_name=string
type IRefarmySkillLevelUp_desc=string
type IRefarmySkillLevelUp_unlockarmylevel=number
type IRefarmySkillLevelUp_skilllevel=number
type IRefarmySkillLevelUp_costCoinID=number
type IRefarmySkillLevelUp_costCoinNum=number
type IRefarmySkillLevelUp_costArmySkillLevelID=number
type IRefarmySkillLevelUp_costArmySkillLevelNum=number
type IRefarmySkillLevelUp_armySkillType=number
type IRefarmySkillLevelUp_modfiy=any[]

interface refGen{armySkillLevelUp:IRefarmySkillLevelUp}


interface IRefarmySkin extends IRefBase
{
id:number
advisorName:string
bindHead:any[]
sortId:number
armyId:number
model:string
}
type IRefarmySkin_id=number
type IRefarmySkin_advisorName=string
type IRefarmySkin_bindHead=any[]
type IRefarmySkin_sortId=number
type IRefarmySkin_armyId=number
type IRefarmySkin_model=string

interface refGen{armySkin:IRefarmySkin}


interface IRefartifact extends IRefBase
{
id:number
resId:number
advisorName:string
sortId:number
model:string
quality:number
attribute1:string
}
type IRefartifact_id=number
type IRefartifact_resId=number
type IRefartifact_advisorName=string
type IRefartifact_sortId=number
type IRefartifact_model=string
type IRefartifact_quality=number
type IRefartifact_attribute1=string

interface refGen{artifact:IRefartifact}


interface IRefartifactLevel extends IRefBase
{
level:number
costItemId:number
costNum:number
costGold:number
entryValue1:number
}
type IRefartifactLevel_level=number
type IRefartifactLevel_costItemId=number
type IRefartifactLevel_costNum=number
type IRefartifactLevel_costGold=number
type IRefartifactLevel_entryValue1=number

interface refGen{artifactLevel:IRefartifactLevel}


interface IRefaudioConfig extends IRefBase
{
key:string
value:string
m4a?:string
}
type IRefaudioConfig_key=string
type IRefaudioConfig_value=string
type IRefaudioConfig_m4a=string

interface refGen{audioConfig:IRefaudioConfig}


interface IRefbaseBuilding extends IRefBase
{
id:number
baseBuildName:string
baseBuildType:number
baseBuildAttribute:any[]
baseBuildSize:number
unlockType:number
unlockParam:number
isSeason:number
baseBuildIcon?:string
baseBuildInfo?:string
baseBuildMaxNum:number
basebuildPositon:number
canMove:number
sort:number
}
type IRefbaseBuilding_id=number
type IRefbaseBuilding_baseBuildName=string
type IRefbaseBuilding_baseBuildType=number
type IRefbaseBuilding_baseBuildAttribute=any[]
type IRefbaseBuilding_baseBuildSize=number
type IRefbaseBuilding_unlockType=number
type IRefbaseBuilding_unlockParam=number
type IRefbaseBuilding_isSeason=number
type IRefbaseBuilding_baseBuildIcon=string
type IRefbaseBuilding_baseBuildInfo=string
type IRefbaseBuilding_baseBuildMaxNum=number
type IRefbaseBuilding_basebuildPositon=number
type IRefbaseBuilding_canMove=number
type IRefbaseBuilding_sort=number

interface refGen{baseBuilding:IRefbaseBuilding}


interface IRefbaseBuildingLevel extends IRefBase
{
id:number
buildLevel:number
costGrain:number
costWood:number
costIron:number
instantCost:number
preBuild:any[]
buildTime:number
maxOtherLevel:number
resCap:number
attrBonus:any[]
resType:number
producePerHour:number
produceCap:number
}
type IRefbaseBuildingLevel_id=number
type IRefbaseBuildingLevel_buildLevel=number
type IRefbaseBuildingLevel_costGrain=number
type IRefbaseBuildingLevel_costWood=number
type IRefbaseBuildingLevel_costIron=number
type IRefbaseBuildingLevel_instantCost=number
type IRefbaseBuildingLevel_preBuild=any[]
type IRefbaseBuildingLevel_buildTime=number
type IRefbaseBuildingLevel_maxOtherLevel=number
type IRefbaseBuildingLevel_resCap=number
type IRefbaseBuildingLevel_attrBonus=any[]
type IRefbaseBuildingLevel_resType=number
type IRefbaseBuildingLevel_producePerHour=number
type IRefbaseBuildingLevel_produceCap=number

interface refGen{baseBuildingLevel:IRefbaseBuildingLevel}


interface IRefbattleTokenConfig extends IRefBase
{
key:string
value:number
}
type IRefbattleTokenConfig_key=string
type IRefbattleTokenConfig_value=number

interface refGen{battleTokenConfig:IRefbattleTokenConfig}


interface IRefbattleTokenPlan extends IRefBase
{
resId:number
type:number
order:number
rmb:number
openCostItemResId:number
openCostItemNum:number
rewardPlan:number
}
type IRefbattleTokenPlan_resId=number
type IRefbattleTokenPlan_type=number
type IRefbattleTokenPlan_order=number
type IRefbattleTokenPlan_rmb=number
type IRefbattleTokenPlan_openCostItemResId=number
type IRefbattleTokenPlan_openCostItemNum=number
type IRefbattleTokenPlan_rewardPlan=number

interface refGen{battleTokenPlan:IRefbattleTokenPlan}


interface IRefbattleTokenReward extends IRefBase
{
plan:number
level:number
reward:any[]
}
type IRefbattleTokenReward_plan=number
type IRefbattleTokenReward_level=number
type IRefbattleTokenReward_reward=any[]

interface refGen{battleTokenReward:IRefbattleTokenReward}


interface IRefbfUnionRankAward extends IRefBase
{
id:number
rank:any[]
reward:any[]
}
type IRefbfUnionRankAward_id=number
type IRefbfUnionRankAward_rank=any[]
type IRefbfUnionRankAward_reward=any[]

interface refGen{bfUnionRankAward:IRefbfUnionRankAward}


interface IRefbigmapBuilding extends IRefBase
{
id:number
baseBuildName:string
baseBuildType:number
occupyHex:number
maxOwnNum:number
unlockChapter:number
queueType:number
sort:number
baseBuildInfo:string
}
type IRefbigmapBuilding_id=number
type IRefbigmapBuilding_baseBuildName=string
type IRefbigmapBuilding_baseBuildType=number
type IRefbigmapBuilding_occupyHex=number
type IRefbigmapBuilding_maxOwnNum=number
type IRefbigmapBuilding_unlockChapter=number
type IRefbigmapBuilding_queueType=number
type IRefbigmapBuilding_sort=number
type IRefbigmapBuilding_baseBuildInfo=string

interface refGen{bigmapBuilding:IRefbigmapBuilding}


interface IRefbigmapBuildingLevel extends IRefBase
{
id:number
buildLevel:number
costGrain:number
costWood:number
costIron:number
instantCost:number
preBuildId:number
preBuildLevel:number
buildTime:number
maxOtherLevel:number
resCap:number
attrBonus:number
}
type IRefbigmapBuildingLevel_id=number
type IRefbigmapBuildingLevel_buildLevel=number
type IRefbigmapBuildingLevel_costGrain=number
type IRefbigmapBuildingLevel_costWood=number
type IRefbigmapBuildingLevel_costIron=number
type IRefbigmapBuildingLevel_instantCost=number
type IRefbigmapBuildingLevel_preBuildId=number
type IRefbigmapBuildingLevel_preBuildLevel=number
type IRefbigmapBuildingLevel_buildTime=number
type IRefbigmapBuildingLevel_maxOtherLevel=number
type IRefbigmapBuildingLevel_resCap=number
type IRefbigmapBuildingLevel_attrBonus=number

interface refGen{bigmapBuildingLevel:IRefbigmapBuildingLevel}


interface IRefbigmapBuildingProduce extends IRefBase
{
id:number
buildLevel:number
resType:string
producePerHour:number
produceCap:number
techGroup:string
}
type IRefbigmapBuildingProduce_id=number
type IRefbigmapBuildingProduce_buildLevel=number
type IRefbigmapBuildingProduce_resType=string
type IRefbigmapBuildingProduce_producePerHour=number
type IRefbigmapBuildingProduce_produceCap=number
type IRefbigmapBuildingProduce_techGroup=string

interface refGen{bigmapBuildingProduce:IRefbigmapBuildingProduce}


interface IRefbigMapCamp extends IRefBase
{
campId:number
campName:string
chapter:number
gateNo:number
campBattleId:number
occupyType:number
rallyOpen:number
campSize:number
adjacentcampIds:any[]
openDay:number
dailyBattleLimit:number
staminaCost:number
rankMinScore:number
warScoreRate:number
singleDamageScoreMax:number
maxScoreConfig:number
occupyScore:number
minOccupyScore:number
rankResetTime:number
warScoreReset:number
buffGroupId:any[]
occupyBuffEffectId:any[]
campDefenceEffect:any[]
firstReward:any[]
occupyReward:any[]
buffConNum:number
buffReduceRate:number
buffInflucenRate:number
campIcon:string
campDesc:string
}
type IRefbigMapCamp_campId=number
type IRefbigMapCamp_campName=string
type IRefbigMapCamp_chapter=number
type IRefbigMapCamp_gateNo=number
type IRefbigMapCamp_campBattleId=number
type IRefbigMapCamp_occupyType=number
type IRefbigMapCamp_rallyOpen=number
type IRefbigMapCamp_campSize=number
type IRefbigMapCamp_adjacentcampIds=any[]
type IRefbigMapCamp_openDay=number
type IRefbigMapCamp_dailyBattleLimit=number
type IRefbigMapCamp_staminaCost=number
type IRefbigMapCamp_rankMinScore=number
type IRefbigMapCamp_warScoreRate=number
type IRefbigMapCamp_singleDamageScoreMax=number
type IRefbigMapCamp_maxScoreConfig=number
type IRefbigMapCamp_occupyScore=number
type IRefbigMapCamp_minOccupyScore=number
type IRefbigMapCamp_rankResetTime=number
type IRefbigMapCamp_warScoreReset=number
type IRefbigMapCamp_buffGroupId=any[]
type IRefbigMapCamp_occupyBuffEffectId=any[]
type IRefbigMapCamp_campDefenceEffect=any[]
type IRefbigMapCamp_firstReward=any[]
type IRefbigMapCamp_occupyReward=any[]
type IRefbigMapCamp_buffConNum=number
type IRefbigMapCamp_buffReduceRate=number
type IRefbigMapCamp_buffInflucenRate=number
type IRefbigMapCamp_campIcon=string
type IRefbigMapCamp_campDesc=string

interface refGen{bigMapCamp:IRefbigMapCamp}


interface IRefbigmapCity extends IRefBase
{
cityId:number
cityName:string
layer:number
available:number
cityLevel:number
exclusive:number
unlockChapter:number
openDay:number
staminaCost:number
defenseHp:number
radiateCapacity:number
cityLevelCoeff:number
prevCityId:number
rewardCoin:number
cityDesc:string
slot:number
slotCount:number
}
type IRefbigmapCity_cityId=number
type IRefbigmapCity_cityName=string
type IRefbigmapCity_layer=number
type IRefbigmapCity_available=number
type IRefbigmapCity_cityLevel=number
type IRefbigmapCity_exclusive=number
type IRefbigmapCity_unlockChapter=number
type IRefbigmapCity_openDay=number
type IRefbigmapCity_staminaCost=number
type IRefbigmapCity_defenseHp=number
type IRefbigmapCity_radiateCapacity=number
type IRefbigmapCity_cityLevelCoeff=number
type IRefbigmapCity_prevCityId=number
type IRefbigmapCity_rewardCoin=number
type IRefbigmapCity_cityDesc=string
type IRefbigmapCity_slot=number
type IRefbigmapCity_slotCount=number

interface refGen{bigmapCity:IRefbigmapCity}


interface IRefbigmapCityLevel extends IRefBase
{
cityLevel:number
warScoreRate:number
occupyScore:number
powerThreshold:number
cityLevelCoeff:number
staminaCost:number
minOccupyWarScore:number
defenseHp:number
}
type IRefbigmapCityLevel_cityLevel=number
type IRefbigmapCityLevel_warScoreRate=number
type IRefbigmapCityLevel_occupyScore=number
type IRefbigmapCityLevel_powerThreshold=number
type IRefbigmapCityLevel_cityLevelCoeff=number
type IRefbigmapCityLevel_staminaCost=number
type IRefbigmapCityLevel_minOccupyWarScore=number
type IRefbigmapCityLevel_defenseHp=number

interface refGen{bigmapCityLevel:IRefbigmapCityLevel}


interface IRefbigmapMonster extends IRefBase
{
monsterId:number
monsterName:string
monsterLevel:number
monsterSize:number
monsterBattle:number
recommendAttack:number
staminaCost:number
rallyOpen:number
rallyNum:number
unlockType:number
unlockValue:number
firstKillDropId:any[]
normalDropId:any[]
monsterHeaIcon:string
monsterModel:string
}
type IRefbigmapMonster_monsterId=number
type IRefbigmapMonster_monsterName=string
type IRefbigmapMonster_monsterLevel=number
type IRefbigmapMonster_monsterSize=number
type IRefbigmapMonster_monsterBattle=number
type IRefbigmapMonster_recommendAttack=number
type IRefbigmapMonster_staminaCost=number
type IRefbigmapMonster_rallyOpen=number
type IRefbigmapMonster_rallyNum=number
type IRefbigmapMonster_unlockType=number
type IRefbigmapMonster_unlockValue=number
type IRefbigmapMonster_firstKillDropId=any[]
type IRefbigmapMonster_normalDropId=any[]
type IRefbigmapMonster_monsterHeaIcon=string
type IRefbigmapMonster_monsterModel=string

interface refGen{bigmapMonster:IRefbigmapMonster}


interface IRefbigmapQueue extends IRefBase
{
id:number
maxBuildQueue:number
initBuildQueue:number
queueUnlockCost2:number
queueUnlockCost3:number
cancelReturnRate:number
upgradeUnlockChapter:number
}
type IRefbigmapQueue_id=number
type IRefbigmapQueue_maxBuildQueue=number
type IRefbigmapQueue_initBuildQueue=number
type IRefbigmapQueue_queueUnlockCost2=number
type IRefbigmapQueue_queueUnlockCost3=number
type IRefbigmapQueue_cancelReturnRate=number
type IRefbigmapQueue_upgradeUnlockChapter=number

interface refGen{bigmapQueue:IRefbigmapQueue}


interface IRefbigmapRank extends IRefBase
{
rank:number
coeffPct:number
}
type IRefbigmapRank_rank=number
type IRefbigmapRank_coeffPct=number

interface refGen{bigmapRank:IRefbigmapRank}


interface IRefbigmapResource extends IRefBase
{
resType:string
resName:string
icon:string
startAmount:number
showInBar:number
}
type IRefbigmapResource_resType=string
type IRefbigmapResource_resName=string
type IRefbigmapResource_icon=string
type IRefbigmapResource_startAmount=number
type IRefbigmapResource_showInBar=number

interface refGen{bigmapResource:IRefbigmapResource}


interface IRefbigmapSchedule extends IRefBase
{
scheduleId:number
utcOffsetHours:number
openTime:string
lockTime:string
settleTime:string
snapshotTime:string
}
type IRefbigmapSchedule_scheduleId=number
type IRefbigmapSchedule_utcOffsetHours=number
type IRefbigmapSchedule_openTime=string
type IRefbigmapSchedule_lockTime=string
type IRefbigmapSchedule_settleTime=string
type IRefbigmapSchedule_snapshotTime=string

interface refGen{bigmapSchedule:IRefbigmapSchedule}


interface IRefbigmapScoreRule extends IRefBase
{
scoreRuleId:number
marginalDamageCap:number
rankExtendStepPct:number
rankExtendMinPct:number
crowdBase:number
crowdK:number
offRangeDamageCutPct:number
npcScoreRatio:number
}
type IRefbigmapScoreRule_scoreRuleId=number
type IRefbigmapScoreRule_marginalDamageCap=number
type IRefbigmapScoreRule_rankExtendStepPct=number
type IRefbigmapScoreRule_rankExtendMinPct=number
type IRefbigmapScoreRule_crowdBase=number
type IRefbigmapScoreRule_crowdK=number
type IRefbigmapScoreRule_offRangeDamageCutPct=number
type IRefbigmapScoreRule_npcScoreRatio=number

interface refGen{bigmapScoreRule:IRefbigmapScoreRule}


interface IRefbigmapStamina extends IRefBase
{
configId:number
staminaMax:number
recoverInterval:number
buyTimesDaily:number
buyCost:number
overflowKeep:number
}
type IRefbigmapStamina_configId=number
type IRefbigmapStamina_staminaMax=number
type IRefbigmapStamina_recoverInterval=number
type IRefbigmapStamina_buyTimesDaily=number
type IRefbigmapStamina_buyCost=number
type IRefbigmapStamina_overflowKeep=number

interface refGen{bigmapStamina:IRefbigmapStamina}


interface IRefbigmapWorld extends IRefBase
{
worldId:number
worldName:string
rows:number
cols:number
cityRing1:number
cityRing2:number
baseRadiusMin:number
baseRadiusMax:number
npcBaseCount:number
monsterRingMax:number
}
type IRefbigmapWorld_worldId=number
type IRefbigmapWorld_worldName=string
type IRefbigmapWorld_rows=number
type IRefbigmapWorld_cols=number
type IRefbigmapWorld_cityRing1=number
type IRefbigmapWorld_cityRing2=number
type IRefbigmapWorld_baseRadiusMin=number
type IRefbigmapWorld_baseRadiusMax=number
type IRefbigmapWorld_npcBaseCount=number
type IRefbigmapWorld_monsterRingMax=number

interface refGen{bigmapWorld:IRefbigmapWorld}


interface IRefbigNum extends IRefBase
{
minNum:string
num:string
flag:string
}
type IRefbigNum_minNum=string
type IRefbigNum_num=string
type IRefbigNum_flag=string

interface refGen{bigNum:IRefbigNum}


interface IRefbuild extends IRefBase
{
buildId:number
buildType:number
buildresource:string
buildSize:number
}
type IRefbuild_buildId=number
type IRefbuild_buildType=number
type IRefbuild_buildresource=string
type IRefbuild_buildSize=number

interface refGen{build:IRefbuild}


interface IRefcampProduceBuffId extends IRefBase
{
campBuffId:number
camp:string
conBuildType:number
conBuildValue:number
}
type IRefcampProduceBuffId_campBuffId=number
type IRefcampProduceBuffId_camp=string
type IRefcampProduceBuffId_conBuildType=number
type IRefcampProduceBuffId_conBuildValue=number

interface refGen{campProduceBuffId:IRefcampProduceBuffId}


interface IRefcardLevelUp extends IRefBase
{
id:number
level:number
costCardID:number
costCardNum:number
costArmyLevelID:number
costGeneralLevelID:number
costArmyLevelNum:number
attrList:any[]
skillList:any[]
modifyDesc?:string
}
type IRefcardLevelUp_id=number
type IRefcardLevelUp_level=number
type IRefcardLevelUp_costCardID=number
type IRefcardLevelUp_costCardNum=number
type IRefcardLevelUp_costArmyLevelID=number
type IRefcardLevelUp_costGeneralLevelID=number
type IRefcardLevelUp_costArmyLevelNum=number
type IRefcardLevelUp_attrList=any[]
type IRefcardLevelUp_skillList=any[]
type IRefcardLevelUp_modifyDesc=string

interface refGen{cardLevelUp:IRefcardLevelUp}


interface IRefcardUiArtCamp extends IRefBase
{
camp:string
name:string
}
type IRefcardUiArtCamp_camp=string
type IRefcardUiArtCamp_name=string

interface refGen{cardUiArtCamp:IRefcardUiArtCamp}


interface IRefcardUiArtClass extends IRefBase
{
class:string
name:string
sort:number
badge:string
boardHero:string
}
type IRefcardUiArtClass_class=string
type IRefcardUiArtClass_name=string
type IRefcardUiArtClass_sort=number
type IRefcardUiArtClass_badge=string
type IRefcardUiArtClass_boardHero=string

interface refGen{cardUiArtClass:IRefcardUiArtClass}


interface IRefcardUiArtRarity extends IRefBase
{
rarity:string
name:string
sort:number
face:string
disc:string
frame:string
diamond:string
}
type IRefcardUiArtRarity_rarity=string
type IRefcardUiArtRarity_name=string
type IRefcardUiArtRarity_sort=number
type IRefcardUiArtRarity_face=string
type IRefcardUiArtRarity_disc=string
type IRefcardUiArtRarity_frame=string
type IRefcardUiArtRarity_diamond=string

interface refGen{cardUiArtRarity:IRefcardUiArtRarity}


interface IRefcelebrationConfig extends IRefBase
{
id:number
start:number
end:number
rankType:number
name:string
targetGroupId:number
rankGroupId:number
sellGroupId:number
goto:number
tips:string
}
type IRefcelebrationConfig_id=number
type IRefcelebrationConfig_start=number
type IRefcelebrationConfig_end=number
type IRefcelebrationConfig_rankType=number
type IRefcelebrationConfig_name=string
type IRefcelebrationConfig_targetGroupId=number
type IRefcelebrationConfig_rankGroupId=number
type IRefcelebrationConfig_sellGroupId=number
type IRefcelebrationConfig_goto=number
type IRefcelebrationConfig_tips=string

interface refGen{celebrationConfig:IRefcelebrationConfig}


interface IRefcelebrationRank extends IRefBase
{
id:number
subId:number
start:number
end:number
rewards1:any[]
count:number
rewards2:any[]
}
type IRefcelebrationRank_id=number
type IRefcelebrationRank_subId=number
type IRefcelebrationRank_start=number
type IRefcelebrationRank_end=number
type IRefcelebrationRank_rewards1=any[]
type IRefcelebrationRank_count=number
type IRefcelebrationRank_rewards2=any[]

interface refGen{celebrationRank:IRefcelebrationRank}


interface IRefcelebrationShop extends IRefBase
{
id:number
subId:number
name:string
rewards:any[]
rmb:number
costType:number
costCount:number
limit:number
price:number
discount:number
}
type IRefcelebrationShop_id=number
type IRefcelebrationShop_subId=number
type IRefcelebrationShop_name=string
type IRefcelebrationShop_rewards=any[]
type IRefcelebrationShop_rmb=number
type IRefcelebrationShop_costType=number
type IRefcelebrationShop_costCount=number
type IRefcelebrationShop_limit=number
type IRefcelebrationShop_price=number
type IRefcelebrationShop_discount=number

interface refGen{celebrationShop:IRefcelebrationShop}


interface IRefcelebrationTarget extends IRefBase
{
id:number
subId:number
count:number
rewards:any[]
}
type IRefcelebrationTarget_id=number
type IRefcelebrationTarget_subId=number
type IRefcelebrationTarget_count=number
type IRefcelebrationTarget_rewards=any[]

interface refGen{celebrationTarget:IRefcelebrationTarget}


interface IRefchapterName extends IRefBase
{
chapterId:number
chapterTitle:string
chapterName:string
}
type IRefchapterName_chapterId=number
type IRefchapterName_chapterTitle=string
type IRefchapterName_chapterName=string

interface refGen{chapterName:IRefchapterName}


interface IRefdayChallengeActTask extends IRefBase
{
resId:number
plan:number
name:string
targetType:number
param:any
order:number
unlockChapter:number
goto:number
reward:any[]
}
type IRefdayChallengeActTask_resId=number
type IRefdayChallengeActTask_plan=number
type IRefdayChallengeActTask_name=string
type IRefdayChallengeActTask_targetType=number
type IRefdayChallengeActTask_param=any
type IRefdayChallengeActTask_order=number
type IRefdayChallengeActTask_unlockChapter=number
type IRefdayChallengeActTask_goto=number
type IRefdayChallengeActTask_reward=any[]

interface refGen{dayChallengeActTask:IRefdayChallengeActTask}


interface IRefdayChallengeActTaskProgress extends IRefBase
{
id:number
priceType:number
cost:number
rewards:any[]
}
type IRefdayChallengeActTaskProgress_id=number
type IRefdayChallengeActTaskProgress_priceType=number
type IRefdayChallengeActTaskProgress_cost=number
type IRefdayChallengeActTaskProgress_rewards=any[]

interface refGen{dayChallengeActTaskProgress:IRefdayChallengeActTaskProgress}


interface IRefdefenceModWave extends IRefBase
{
startId:number
waveId:number
waveShowTime:number
monsterId:number
monsterSize:number
monsterNum:number
hpRate:number
atkRate:number
restMonsterNum:number
monsterType:number
}
type IRefdefenceModWave_startId=number
type IRefdefenceModWave_waveId=number
type IRefdefenceModWave_waveShowTime=number
type IRefdefenceModWave_monsterId=number
type IRefdefenceModWave_monsterSize=number
type IRefdefenceModWave_monsterNum=number
type IRefdefenceModWave_hpRate=number
type IRefdefenceModWave_atkRate=number
type IRefdefenceModWave_restMonsterNum=number
type IRefdefenceModWave_monsterType=number

interface refGen{defenceModWave:IRefdefenceModWave}


interface IRefdefenceWaveReward extends IRefBase
{
startId:number
order:number
waveRewards:any[]
}
type IRefdefenceWaveReward_startId=number
type IRefdefenceWaveReward_order=number
type IRefdefenceWaveReward_waveRewards=any[]

interface refGen{defenceWaveReward:IRefdefenceWaveReward}


interface IRefequip extends IRefBase
{
resId:number
name:string
type:number
equipType:number
icon:string
consumeId:number
rank:number
quality:number
rarity:number
}
type IRefequip_resId=number
type IRefequip_name=string
type IRefequip_type=number
type IRefequip_equipType=number
type IRefequip_icon=string
type IRefequip_consumeId=number
type IRefequip_rank=number
type IRefequip_quality=number
type IRefequip_rarity=number

interface refGen{equip:IRefequip}


interface IRefequipLevel extends IRefBase
{
equipLevel:number
gold:number
drawings:number
attack:number
hpPer:number
}
type IRefequipLevel_equipLevel=number
type IRefequipLevel_gold=number
type IRefequipLevel_drawings=number
type IRefequipLevel_attack=number
type IRefequipLevel_hpPer=number

interface refGen{equipLevel:IRefequipLevel}


interface IRefequipLib extends IRefBase
{
id:number
lib:number
weight:number
attribute:string
}
type IRefequipLib_id=number
type IRefequipLib_lib=number
type IRefequipLib_weight=number
type IRefequipLib_attribute=string

interface refGen{equipLib:IRefequipLib}


interface IRefequipRank extends IRefBase
{
id:number
rank:number
qualityLevel:number
quality:number
rarity:number
qualityName:string
rarityName:string
decompose:number
cost:number
washCost:number
libCount:number
attack:number
hpPer:number
add1:number
add2:number
add3:number
}
type IRefequipRank_id=number
type IRefequipRank_rank=number
type IRefequipRank_qualityLevel=number
type IRefequipRank_quality=number
type IRefequipRank_rarity=number
type IRefequipRank_qualityName=string
type IRefequipRank_rarityName=string
type IRefequipRank_decompose=number
type IRefequipRank_cost=number
type IRefequipRank_washCost=number
type IRefequipRank_libCount=number
type IRefequipRank_attack=number
type IRefequipRank_hpPer=number
type IRefequipRank_add1=number
type IRefequipRank_add2=number
type IRefequipRank_add3=number

interface refGen{equipRank:IRefequipRank}


interface IRefequipType extends IRefBase
{
type:number
name:string
key:string
}
type IRefequipType_type=number
type IRefequipType_name=string
type IRefequipType_key=string

interface refGen{equipType:IRefequipType}


interface IReffirstRechargeNew extends IRefBase
{
id:number
rmb:number
desc:string
rewards1:any[]
rewards2:any[]
rewards3:any[]
}
type IReffirstRechargeNew_id=number
type IReffirstRechargeNew_rmb=number
type IReffirstRechargeNew_desc=string
type IReffirstRechargeNew_rewards1=any[]
type IReffirstRechargeNew_rewards2=any[]
type IReffirstRechargeNew_rewards3=any[]

interface refGen{firstRechargeNew:IReffirstRechargeNew}


interface IRefgameConfig extends IRefBase
{
key:string
value:any
}
type IRefgameConfig_key=string
type IRefgameConfig_value=any

interface refGen{gameConfig:IRefgameConfig}


interface IRefgem extends IRefBase
{
resId:number
gemType:number
type:number
equipId:number
desc:string
icon:string
}
type IRefgem_resId=number
type IRefgem_gemType=number
type IRefgem_type=number
type IRefgem_equipId=number
type IRefgem_desc=string
type IRefgem_icon=string

interface refGen{gem:IRefgem}


interface IRefgemAttribute extends IRefBase
{
id:number
modify:any[]
modifyDesc:string
quality:number
pro:number
type:number
gemIds:any[]
armyType:any[]
skillId?:number
}
type IRefgemAttribute_id=number
type IRefgemAttribute_modify=any[]
type IRefgemAttribute_modifyDesc=string
type IRefgemAttribute_quality=number
type IRefgemAttribute_pro=number
type IRefgemAttribute_type=number
type IRefgemAttribute_gemIds=any[]
type IRefgemAttribute_armyType=any[]
type IRefgemAttribute_skillId=number

interface refGen{gemAttribute:IRefgemAttribute}


interface IRefgemBox extends IRefBase
{
id:number
desc:string
rewards:any[]
rareRewards:any[]
gemPro:number
priceType:number
cost:number
freeTimes:number
quality:number
quality2:number
limit:number
priceType3:number
cost3:number
cost2:number
show:any[]
}
type IRefgemBox_id=number
type IRefgemBox_desc=string
type IRefgemBox_rewards=any[]
type IRefgemBox_rareRewards=any[]
type IRefgemBox_gemPro=number
type IRefgemBox_priceType=number
type IRefgemBox_cost=number
type IRefgemBox_freeTimes=number
type IRefgemBox_quality=number
type IRefgemBox_quality2=number
type IRefgemBox_limit=number
type IRefgemBox_priceType3=number
type IRefgemBox_cost3=number
type IRefgemBox_cost2=number
type IRefgemBox_show=any[]

interface refGen{gemBox:IRefgemBox}


interface IRefgemQuality extends IRefBase
{
quality:number
desc:string
consume:number
consume1:number
icon:string
}
type IRefgemQuality_quality=number
type IRefgemQuality_desc=string
type IRefgemQuality_consume=number
type IRefgemQuality_consume1=number
type IRefgemQuality_icon=string

interface refGen{gemQuality:IRefgemQuality}


interface IRefgemShop extends IRefBase
{
id:number
desc:string
rewards:any[]
priceType:number
cost:number
doubleTimes:number
limit:number
}
type IRefgemShop_id=number
type IRefgemShop_desc=string
type IRefgemShop_rewards=any[]
type IRefgemShop_priceType=number
type IRefgemShop_cost=number
type IRefgemShop_doubleTimes=number
type IRefgemShop_limit=number

interface refGen{gemShop:IRefgemShop}


interface IRefgeneral extends IRefBase
{
id:number
resId:number
name:string
head:string
bindHead:any[]
model:string
quality:number
armyId:number
hp:number
atk:number
spd:number
recruit:number
cd:number
max:number
attackRange:number
attackPriority:any[]
order:number
prototypeSize:number
showSize:number
shadowSize:any[]
desc1:string
}
type IRefgeneral_id=number
type IRefgeneral_resId=number
type IRefgeneral_name=string
type IRefgeneral_head=string
type IRefgeneral_bindHead=any[]
type IRefgeneral_model=string
type IRefgeneral_quality=number
type IRefgeneral_armyId=number
type IRefgeneral_hp=number
type IRefgeneral_atk=number
type IRefgeneral_spd=number
type IRefgeneral_recruit=number
type IRefgeneral_cd=number
type IRefgeneral_max=number
type IRefgeneral_attackRange=number
type IRefgeneral_attackPriority=any[]
type IRefgeneral_order=number
type IRefgeneral_prototypeSize=number
type IRefgeneral_showSize=number
type IRefgeneral_shadowSize=any[]
type IRefgeneral_desc1=string

interface refGen{general:IRefgeneral}


interface IRefgeneralStar extends IRefBase
{
id:number
star:number
costItemID:number
costItemNum:number
skillIcon:string
skillName:string
desc:string
modify:any[]
impactData:any[]
}
type IRefgeneralStar_id=number
type IRefgeneralStar_star=number
type IRefgeneralStar_costItemID=number
type IRefgeneralStar_costItemNum=number
type IRefgeneralStar_skillIcon=string
type IRefgeneralStar_skillName=string
type IRefgeneralStar_desc=string
type IRefgeneralStar_modify=any[]
type IRefgeneralStar_impactData=any[]

interface refGen{generalStar:IRefgeneralStar}


interface IRefgiftShop extends IRefBase
{
id:number
type:number
type2:number
title?:string
desc:string
rewards:any[]
priceType:number
cost:number
limit:number
discount:number
}
type IRefgiftShop_id=number
type IRefgiftShop_type=number
type IRefgiftShop_type2=number
type IRefgiftShop_title=string
type IRefgiftShop_desc=string
type IRefgiftShop_rewards=any[]
type IRefgiftShop_priceType=number
type IRefgiftShop_cost=number
type IRefgiftShop_limit=number
type IRefgiftShop_discount=number

interface refGen{giftShop:IRefgiftShop}


interface IRefgoldShop extends IRefBase
{
id:number
desc:string
rewards:any[]
icon:string
priceType:number
cost:number
discount:number
interval:number
freeTimes:number
adTimes:number
limit:number
}
type IRefgoldShop_id=number
type IRefgoldShop_desc=string
type IRefgoldShop_rewards=any[]
type IRefgoldShop_icon=string
type IRefgoldShop_priceType=number
type IRefgoldShop_cost=number
type IRefgoldShop_discount=number
type IRefgoldShop_interval=number
type IRefgoldShop_freeTimes=number
type IRefgoldShop_adTimes=number
type IRefgoldShop_limit=number

interface refGen{goldShop:IRefgoldShop}


interface IRefgrade extends IRefBase
{
gradeId:number
gradePointRange:any[]
winAddPoint:number
streakWinAddPoint:number
streakWinMaxPoints:number
failReducePoint:number
gradeReward:any[]
gradeName:string
}
type IRefgrade_gradeId=number
type IRefgrade_gradePointRange=any[]
type IRefgrade_winAddPoint=number
type IRefgrade_streakWinAddPoint=number
type IRefgrade_streakWinMaxPoints=number
type IRefgrade_failReducePoint=number
type IRefgrade_gradeReward=any[]
type IRefgrade_gradeName=string

interface refGen{grade:IRefgrade}


interface IRefguanka extends IRefBase
{
type:number
order:number
time:number
tlRate:any[]
tlMonsterNum:any[]
attrRate:number
}
type IRefguanka_type=number
type IRefguanka_order=number
type IRefguanka_time=number
type IRefguanka_tlRate=any[]
type IRefguanka_tlMonsterNum=any[]
type IRefguanka_attrRate=number

interface refGen{guanka:IRefguanka}


interface IRefguankaChapter extends IRefBase
{
chapter:number
chapterIcon:string
chapterName:string
star:number
pool:number
}
type IRefguankaChapter_chapter=number
type IRefguankaChapter_chapterIcon=string
type IRefguankaChapter_chapterName=string
type IRefguankaChapter_star=number
type IRefguankaChapter_pool=number

interface refGen{guankaChapter:IRefguankaChapter}


interface IRefguankaGift extends IRefBase
{
id:number
level:number
priceType:number
cost:number
rewards:any[]
limit:number
discount:number
}
type IRefguankaGift_id=number
type IRefguankaGift_level=number
type IRefguankaGift_priceType=number
type IRefguankaGift_cost=number
type IRefguankaGift_rewards=any[]
type IRefguankaGift_limit=number
type IRefguankaGift_discount=number

interface refGen{guankaGift:IRefguankaGift}


interface IRefguankaReward extends IRefBase
{
level:number
instanceType:number
relateId?:number
order:number
map:string
chapter:number
stage:number
end:number
guanKaType:number
hpRate:number
atkRate:number
marchId:number
showModel?:string
recommendtroop:any[]
tlMonster:any[]
tlBoss:any[]
showReward:any[]
battleTime:number
guankaHp:number
buff:any
idleRewards?:any[]
}
type IRefguankaReward_level=number
type IRefguankaReward_instanceType=number
type IRefguankaReward_relateId=number
type IRefguankaReward_order=number
type IRefguankaReward_map=string
type IRefguankaReward_chapter=number
type IRefguankaReward_stage=number
type IRefguankaReward_end=number
type IRefguankaReward_guanKaType=number
type IRefguankaReward_hpRate=number
type IRefguankaReward_atkRate=number
type IRefguankaReward_marchId=number
type IRefguankaReward_showModel=string
type IRefguankaReward_recommendtroop=any[]
type IRefguankaReward_tlMonster=any[]
type IRefguankaReward_tlBoss=any[]
type IRefguankaReward_showReward=any[]
type IRefguankaReward_battleTime=number
type IRefguankaReward_guankaHp=number
type IRefguankaReward_buff=any
type IRefguankaReward_idleRewards=any[]

interface refGen{guankaReward:IRefguankaReward}


interface IRefguards extends IRefBase
{
id:number
resId:number
guardsName:string
bindHead:any[]
sortId:number
piece:number
number:number
qualityID:number
attribute0:string
attribute1:string
attribute2:string
attribute3:string
exSkillId:any[]
model:string
head:string
rmb:number
}
type IRefguards_id=number
type IRefguards_resId=number
type IRefguards_guardsName=string
type IRefguards_bindHead=any[]
type IRefguards_sortId=number
type IRefguards_piece=number
type IRefguards_number=number
type IRefguards_qualityID=number
type IRefguards_attribute0=string
type IRefguards_attribute1=string
type IRefguards_attribute2=string
type IRefguards_attribute3=string
type IRefguards_exSkillId=any[]
type IRefguards_model=string
type IRefguards_head=string
type IRefguards_rmb=number

interface refGen{guards:IRefguards}


interface IRefguideDialog extends IRefBase
{
id:number
group:string
order:number
speaker:string
content:string
}
type IRefguideDialog_id=number
type IRefguideDialog_group=string
type IRefguideDialog_order=number
type IRefguideDialog_speaker=string
type IRefguideDialog_content=string

interface refGen{guideDialog:IRefguideDialog}


interface IRefguideStep extends IRefBase
{
guideId:number
stepId:string
flowName:string
triggerType:string
maskType:string
focusNode:string
requireAction:string
dialogId?:string
completeCond:string
skipAble:number
rewardJson:any[]
nextStep:string
}
type IRefguideStep_guideId=number
type IRefguideStep_stepId=string
type IRefguideStep_flowName=string
type IRefguideStep_triggerType=string
type IRefguideStep_maskType=string
type IRefguideStep_focusNode=string
type IRefguideStep_requireAction=string
type IRefguideStep_dialogId=string
type IRefguideStep_completeCond=string
type IRefguideStep_skipAble=number
type IRefguideStep_rewardJson=any[]
type IRefguideStep_nextStep=string

interface refGen{guideStep:IRefguideStep}


interface IRefhead extends IRefBase
{
resId:number
type:number
icon:string
quality:number
name:string
desc:string
}
type IRefhead_resId=number
type IRefhead_type=number
type IRefhead_icon=string
type IRefhead_quality=number
type IRefhead_name=string
type IRefhead_desc=string

interface refGen{head:IRefhead}


interface IRefheroSkill extends IRefBase
{
id:number
resId:number
Name:string
bindHead:any[]
sortId:number
model:string
skill:number
iconKaPai:string
}
type IRefheroSkill_id=number
type IRefheroSkill_resId=number
type IRefheroSkill_Name=string
type IRefheroSkill_bindHead=any[]
type IRefheroSkill_sortId=number
type IRefheroSkill_model=string
type IRefheroSkill_skill=number
type IRefheroSkill_iconKaPai=string

interface refGen{heroSkill:IRefheroSkill}


interface IReficon extends IRefBase
{
key:string
path:string
}
type IReficon_key=string
type IReficon_path=string

interface refGen{icon:IReficon}


interface IRefidConfig extends IRefBase
{
id:number
key:string
cacheName:string
flag:string
fileName:string
min:number
max:number
}
type IRefidConfig_id=number
type IRefidConfig_key=string
type IRefidConfig_cacheName=string
type IRefidConfig_flag=string
type IRefidConfig_fileName=string
type IRefidConfig_min=number
type IRefidConfig_max=number

interface refGen{idConfig:IRefidConfig}


interface IRefinteractReward extends IRefBase
{
id:number
boxid:number
type:number
battlelevel:number
rewards:any[]
additions:any[]
model?:string
}
type IRefinteractReward_id=number
type IRefinteractReward_boxid=number
type IRefinteractReward_type=number
type IRefinteractReward_battlelevel=number
type IRefinteractReward_rewards=any[]
type IRefinteractReward_additions=any[]
type IRefinteractReward_model=string

interface refGen{interactReward:IRefinteractReward}


interface IRefitem extends IRefBase
{
resId:number
name:string
desc?:string
useType?:number
type?:number
quality?:number
icon?:string
access?:any[]
useJump?:number
key?:string
itemBox?:any[]
}
type IRefitem_resId=number
type IRefitem_name=string
type IRefitem_desc=string
type IRefitem_useType=number
type IRefitem_type=number
type IRefitem_quality=number
type IRefitem_icon=string
type IRefitem_access=any[]
type IRefitem_useJump=number
type IRefitem_key=string
type IRefitem_itemBox=any[]

interface refGen{item:IRefitem}


interface IRefitemBox extends IRefBase
{
boxResId:number
type:number
number:number
number2:number
}
type IRefitemBox_boxResId=number
type IRefitemBox_type=number
type IRefitemBox_number=number
type IRefitemBox_number2=number

interface refGen{itemBox:IRefitemBox}


interface IRefitemBoxPro extends IRefBase
{
boxResId:number
resId:number
pro:number
minNumber:number
maxNumber?:number
showPer?:string
}
type IRefitemBoxPro_boxResId=number
type IRefitemBoxPro_resId=number
type IRefitemBoxPro_pro=number
type IRefitemBoxPro_minNumber=number
type IRefitemBoxPro_maxNumber=number
type IRefitemBoxPro_showPer=string

interface refGen{itemBoxPro:IRefitemBoxPro}


interface IRefitemCraft extends IRefBase
{
id:number
number:number
reward:any
}
type IRefitemCraft_id=number
type IRefitemCraft_number=number
type IRefitemCraft_reward=any

interface refGen{itemCraft:IRefitemCraft}


interface IRefitemType extends IRefBase
{
type:number
name:string
key:string
}
type IRefitemType_type=number
type IRefitemType_name=string
type IRefitemType_key=string

interface refGen{itemType:IRefitemType}


interface IReflevel extends IRefBase
{
level:number
exp:number
}
type IReflevel_level=number
type IReflevel_exp=number

interface refGen{level:IReflevel}


interface IReflevelFirstPassReward extends IRefBase
{
levelId:number
firstPassReward:any[]
}
type IReflevelFirstPassReward_levelId=number
type IReflevelFirstPassReward_firstPassReward=any[]

interface refGen{levelFirstPassReward:IReflevelFirstPassReward}


interface IReflevelInfo extends IRefBase
{
levelId:number
levelType:number
levelMod:number
levelModValue:number
selectBaseMod:number
levelCost:number
levelChapter:number
chapterStage:number
gradeProModifier:any
openGrideTime:number
extraCards:any
levelMonsterGroup:any
idleReward:any[]
}
type IReflevelInfo_levelId=number
type IReflevelInfo_levelType=number
type IReflevelInfo_levelMod=number
type IReflevelInfo_levelModValue=number
type IReflevelInfo_selectBaseMod=number
type IReflevelInfo_levelCost=number
type IReflevelInfo_levelChapter=number
type IReflevelInfo_chapterStage=number
type IReflevelInfo_gradeProModifier=any
type IReflevelInfo_openGrideTime=number
type IReflevelInfo_extraCards=any
type IReflevelInfo_levelMonsterGroup=any
type IReflevelInfo_idleReward=any[]

interface refGen{levelInfo:IReflevelInfo}


interface IReflevelMapGrideReward extends IRefBase
{
rewardId:number
rewardGroup:any[]
}
type IReflevelMapGrideReward_rewardId=number
type IReflevelMapGrideReward_rewardGroup=any[]

interface refGen{levelMapGrideReward:IReflevelMapGrideReward}


interface IReflottery extends IRefBase
{
id:number
name:string
desc:string
rewards:any[]
showrewards:any[]
rewardPro:number
priceType:number
cost:number
priceType2:number
cost2:number
cost3:number
switchgear:any[]
luckMax:number
grandprize:any[]
progressbarMax:number
countReward:any[]
tips:string
limit:number
battletokenType:number
}
type IReflottery_id=number
type IReflottery_name=string
type IReflottery_desc=string
type IReflottery_rewards=any[]
type IReflottery_showrewards=any[]
type IReflottery_rewardPro=number
type IReflottery_priceType=number
type IReflottery_cost=number
type IReflottery_priceType2=number
type IReflottery_cost2=number
type IReflottery_cost3=number
type IReflottery_switchgear=any[]
type IReflottery_luckMax=number
type IReflottery_grandprize=any[]
type IReflottery_progressbarMax=number
type IReflottery_countReward=any[]
type IReflottery_tips=string
type IReflottery_limit=number
type IReflottery_battletokenType=number

interface refGen{lottery:IReflottery}


interface IRefmapconfig extends IRefBase
{
line:number
row:number
name?:string
zoom?:number
offsetX?:number
offsetY?:number
}
type IRefmapconfig_line=number
type IRefmapconfig_row=number
type IRefmapconfig_name=string
type IRefmapconfig_zoom=number
type IRefmapconfig_offsetX=number
type IRefmapconfig_offsetY=number

interface refGen{mapconfig:IRefmapconfig}


interface IRefmapTerrian extends IRefBase
{
id:number
level:number
model:string
}
type IRefmapTerrian_id=number
type IRefmapTerrian_level=number
type IRefmapTerrian_model=string

interface refGen{mapTerrian:IRefmapTerrian}


interface IRefmatchTips extends IRefBase
{
id:string
order:number
text:string
remark:string
}
type IRefmatchTips_id=string
type IRefmatchTips_order=number
type IRefmatchTips_text=string
type IRefmatchTips_remark=string

interface refGen{matchTips:IRefmatchTips}


interface IRefmL extends IRefBase
{
id:number
key:string
name:string
}
type IRefmL_id=number
type IRefmL_key=string
type IRefmL_name=string

interface refGen{mL:IRefmL}


interface IRefmonster extends IRefBase
{
id:number
name:string
model:string
mask:number
order:number
positionScale?:number
prototypeSize:number
showSize:number
shadowSize:any[]
atkNums:number
atkSpacing?:number
type:number
type2:number
exp:number
buff:any
skill:any[]
behavior:number
hp:number
atk:number
spd:number
spdX:number
attackRange:number
searchInterval:number
findRange:number
attackPriority:number
attackType:number
isBoss:number
isFly:number
desc1?:string
quote1?:string
quote2?:string
quote3?:string
battlezoom:number
addHurt?:any[]
reduceHurt?:any[]
immunityBuffs?:any[]
shadow?:string
recruitSize?:number
icon?:string
}
type IRefmonster_id=number
type IRefmonster_name=string
type IRefmonster_model=string
type IRefmonster_mask=number
type IRefmonster_order=number
type IRefmonster_positionScale=number
type IRefmonster_prototypeSize=number
type IRefmonster_showSize=number
type IRefmonster_shadowSize=any[]
type IRefmonster_atkNums=number
type IRefmonster_atkSpacing=number
type IRefmonster_type=number
type IRefmonster_type2=number
type IRefmonster_exp=number
type IRefmonster_buff=any
type IRefmonster_skill=any[]
type IRefmonster_behavior=number
type IRefmonster_hp=number
type IRefmonster_atk=number
type IRefmonster_spd=number
type IRefmonster_spdX=number
type IRefmonster_attackRange=number
type IRefmonster_searchInterval=number
type IRefmonster_findRange=number
type IRefmonster_attackPriority=number
type IRefmonster_attackType=number
type IRefmonster_isBoss=number
type IRefmonster_isFly=number
type IRefmonster_desc1=string
type IRefmonster_quote1=string
type IRefmonster_quote2=string
type IRefmonster_quote3=string
type IRefmonster_battlezoom=number
type IRefmonster_addHurt=any[]
type IRefmonster_reduceHurt=any[]
type IRefmonster_immunityBuffs=any[]
type IRefmonster_shadow=string
type IRefmonster_recruitSize=number
type IRefmonster_icon=string

interface refGen{monster:IRefmonster}


interface IRefmonsterCard extends IRefBase
{
id:number
name:string
type:string
rarity:number
enabled:number
description?:string
buildSeconds:number
buildAttackTime:number
buildAttackRange:number
buildDamge:number
goldDigTime:number
soilderAddTime:number
cycleBaseValue:number
buildDigGoldNum:number
baseHp:number
buildNumLimit:number
cyclePerTierValue?:number
buildIcon?:string
unitId?:number
traits?:any
unitMaxHp?:number
unitAttack?:number
unitMoveSpeed?:number
unitAttackRange?:number
unitAttackInterval?:number
unitAttackDuration?:number
unitAttackHitTime?:number
unitBodyRadius?:number
unitFlying?:number
unitCanAttackAir?:number
unitHero?:number
unitStatus?:string
unitPrefabPath?:string
unitSkillId?:number
attackStyle?:number
headIcon?:string
}
type IRefmonsterCard_id=number
type IRefmonsterCard_name=string
type IRefmonsterCard_type=string
type IRefmonsterCard_rarity=number
type IRefmonsterCard_enabled=number
type IRefmonsterCard_description=string
type IRefmonsterCard_buildSeconds=number
type IRefmonsterCard_buildAttackTime=number
type IRefmonsterCard_buildAttackRange=number
type IRefmonsterCard_buildDamge=number
type IRefmonsterCard_goldDigTime=number
type IRefmonsterCard_soilderAddTime=number
type IRefmonsterCard_cycleBaseValue=number
type IRefmonsterCard_buildDigGoldNum=number
type IRefmonsterCard_baseHp=number
type IRefmonsterCard_buildNumLimit=number
type IRefmonsterCard_cyclePerTierValue=number
type IRefmonsterCard_buildIcon=string
type IRefmonsterCard_unitId=number
type IRefmonsterCard_traits=any
type IRefmonsterCard_unitMaxHp=number
type IRefmonsterCard_unitAttack=number
type IRefmonsterCard_unitMoveSpeed=number
type IRefmonsterCard_unitAttackRange=number
type IRefmonsterCard_unitAttackInterval=number
type IRefmonsterCard_unitAttackDuration=number
type IRefmonsterCard_unitAttackHitTime=number
type IRefmonsterCard_unitBodyRadius=number
type IRefmonsterCard_unitFlying=number
type IRefmonsterCard_unitCanAttackAir=number
type IRefmonsterCard_unitHero=number
type IRefmonsterCard_unitStatus=string
type IRefmonsterCard_unitPrefabPath=string
type IRefmonsterCard_unitSkillId=number
type IRefmonsterCard_attackStyle=number
type IRefmonsterCard_headIcon=string

interface refGen{monsterCard:IRefmonsterCard}


interface IRefmonsterSkillType extends IRefBase
{
id:number
key:string
skillType:number
attr:any[]
}
type IRefmonsterSkillType_id=number
type IRefmonsterSkillType_key=string
type IRefmonsterSkillType_skillType=number
type IRefmonsterSkillType_attr=any[]

interface refGen{monsterSkillType:IRefmonsterSkillType}


interface IRefmonthCardActPlan extends IRefBase
{
plan:number
limitTimeCardResId:number
type:number
desc:string
rmb:number
continueDays:number
privilege:any[]
buyReward:any[]
dayReward:any[]
}
type IRefmonthCardActPlan_plan=number
type IRefmonthCardActPlan_limitTimeCardResId=number
type IRefmonthCardActPlan_type=number
type IRefmonthCardActPlan_desc=string
type IRefmonthCardActPlan_rmb=number
type IRefmonthCardActPlan_continueDays=number
type IRefmonthCardActPlan_privilege=any[]
type IRefmonthCardActPlan_buyReward=any[]
type IRefmonthCardActPlan_dayReward=any[]

interface refGen{monthCardActPlan:IRefmonthCardActPlan}


interface IRefneutralEnhanceGate extends IRefBase
{
id:number
name:string
effectType:number
value:number
scale:number
hpRate:number
windowSeconds:number
cooldownSeconds:number
attackSpeedMultiplier:number
moveMultiplier:number
damageMultiplier:number
}
type IRefneutralEnhanceGate_id=number
type IRefneutralEnhanceGate_name=string
type IRefneutralEnhanceGate_effectType=number
type IRefneutralEnhanceGate_value=number
type IRefneutralEnhanceGate_scale=number
type IRefneutralEnhanceGate_hpRate=number
type IRefneutralEnhanceGate_windowSeconds=number
type IRefneutralEnhanceGate_cooldownSeconds=number
type IRefneutralEnhanceGate_attackSpeedMultiplier=number
type IRefneutralEnhanceGate_moveMultiplier=number
type IRefneutralEnhanceGate_damageMultiplier=number

interface refGen{neutralEnhanceGate:IRefneutralEnhanceGate}


interface IRefneutralResourceGroup extends IRefBase
{
groupId:number
id:number
groupName:string
resourceType:number
weight:number
param:number
icon:string
}
type IRefneutralResourceGroup_groupId=number
type IRefneutralResourceGroup_id=number
type IRefneutralResourceGroup_groupName=string
type IRefneutralResourceGroup_resourceType=number
type IRefneutralResourceGroup_weight=number
type IRefneutralResourceGroup_param=number
type IRefneutralResourceGroup_icon=string

interface refGen{neutralResourceGroup:IRefneutralResourceGroup}


interface IRefnewTreasureBoxConfig extends IRefBase
{
cardBoxID:number
cardBoxOpenTime:number
cardBoxOpenNow:string
cardMoneyRange:any[]
cardBoxDrawTimes:number
cardDropRate:any[]
cardBoxLimitNumber:string
cardBoxProtectTimes:number
protectPoolDraw:string
cardBoxName:string
cardBoxIconName:string
}
type IRefnewTreasureBoxConfig_cardBoxID=number
type IRefnewTreasureBoxConfig_cardBoxOpenTime=number
type IRefnewTreasureBoxConfig_cardBoxOpenNow=string
type IRefnewTreasureBoxConfig_cardMoneyRange=any[]
type IRefnewTreasureBoxConfig_cardBoxDrawTimes=number
type IRefnewTreasureBoxConfig_cardDropRate=any[]
type IRefnewTreasureBoxConfig_cardBoxLimitNumber=string
type IRefnewTreasureBoxConfig_cardBoxProtectTimes=number
type IRefnewTreasureBoxConfig_protectPoolDraw=string
type IRefnewTreasureBoxConfig_cardBoxName=string
type IRefnewTreasureBoxConfig_cardBoxIconName=string

interface refGen{newTreasureBoxConfig:IRefnewTreasureBoxConfig}


interface IRefnewTreasureBoxQueueConfig extends IRefBase
{
lineId:number
lineBattleChapter:any[]
lineCon:number
lineTriggerType:number
triggerValue:number
triggerTimes:number
lineOrder:number
lineRandom:number
lineBox:any[]
}
type IRefnewTreasureBoxQueueConfig_lineId=number
type IRefnewTreasureBoxQueueConfig_lineBattleChapter=any[]
type IRefnewTreasureBoxQueueConfig_lineCon=number
type IRefnewTreasureBoxQueueConfig_lineTriggerType=number
type IRefnewTreasureBoxQueueConfig_triggerValue=number
type IRefnewTreasureBoxQueueConfig_triggerTimes=number
type IRefnewTreasureBoxQueueConfig_lineOrder=number
type IRefnewTreasureBoxQueueConfig_lineRandom=number
type IRefnewTreasureBoxQueueConfig_lineBox=any[]

interface refGen{newTreasureBoxQueueConfig:IRefnewTreasureBoxQueueConfig}


interface IRefnpcTeam extends IRefBase
{
npcTeamId:number
npcTeamType:number
npcTeamMatch:any[]
npcCard:any[]
}
type IRefnpcTeam_npcTeamId=number
type IRefnpcTeam_npcTeamType=number
type IRefnpcTeam_npcTeamMatch=any[]
type IRefnpcTeam_npcCard=any[]

interface refGen{npcTeam:IRefnpcTeam}


interface IRefopen extends IRefBase
{
refId:number
belond:number
order:number
resShowType:any[]
url?:string
type?:number
tipShow?:string
isShowOpen?:number
tlRDResId?:any[]
visibleCondition:any[]
condition:any[]
RDExpr?:string
preResId?:number
ShowPreResId?:number
name?:string
icon?:string
}
type IRefopen_refId=number
type IRefopen_belond=number
type IRefopen_order=number
type IRefopen_resShowType=any[]
type IRefopen_url=string
type IRefopen_type=number
type IRefopen_tipShow=string
type IRefopen_isShowOpen=number
type IRefopen_tlRDResId=any[]
type IRefopen_visibleCondition=any[]
type IRefopen_condition=any[]
type IRefopen_RDExpr=string
type IRefopen_preResId=number
type IRefopen_ShowPreResId=number
type IRefopen_name=string
type IRefopen_icon=string

interface refGen{open:IRefopen}


interface IRefopenGridReward extends IRefBase
{
chapterId:number
openGrid:number
gridRewards:any[]
}
type IRefopenGridReward_chapterId=number
type IRefopenGridReward_openGrid=number
type IRefopenGridReward_gridRewards=any[]

interface refGen{openGridReward:IRefopenGridReward}


interface IRefpayChannel extends IRefBase
{
id:number
key:string
type:number
name:string
rmb:number
productid:number
coin:number
coin2:number
path?:string
isShow?:number
}
type IRefpayChannel_id=number
type IRefpayChannel_key=string
type IRefpayChannel_type=number
type IRefpayChannel_name=string
type IRefpayChannel_rmb=number
type IRefpayChannel_productid=number
type IRefpayChannel_coin=number
type IRefpayChannel_coin2=number
type IRefpayChannel_path=string
type IRefpayChannel_isShow=number

interface refGen{payChannel:IRefpayChannel}


interface IRefplotCard extends IRefBase
{
id:number
card:number
order:number
name:string
icon:string
descinfo:string
complete:number
}
type IRefplotCard_id=number
type IRefplotCard_card=number
type IRefplotCard_order=number
type IRefplotCard_name=string
type IRefplotCard_icon=string
type IRefplotCard_descinfo=string
type IRefplotCard_complete=number

interface refGen{plotCard:IRefplotCard}


interface IRefpvpArtifact extends IRefBase
{
artifactId:number
order:number
name:string
icon:string
effectType:number
effectValue:number
effectSeconds:number
chargePerGoldSpend:number
chargeFull:number
maxStored:number
cooldownSeconds:number
activeDesc:string
unlocked:number
remark:string
}
type IRefpvpArtifact_artifactId=number
type IRefpvpArtifact_order=number
type IRefpvpArtifact_name=string
type IRefpvpArtifact_icon=string
type IRefpvpArtifact_effectType=number
type IRefpvpArtifact_effectValue=number
type IRefpvpArtifact_effectSeconds=number
type IRefpvpArtifact_chargePerGoldSpend=number
type IRefpvpArtifact_chargeFull=number
type IRefpvpArtifact_maxStored=number
type IRefpvpArtifact_cooldownSeconds=number
type IRefpvpArtifact_activeDesc=string
type IRefpvpArtifact_unlocked=number
type IRefpvpArtifact_remark=string

interface refGen{pvpArtifact:IRefpvpArtifact}


interface IRefpvpAttrMap extends IRefBase
{
legacyKey:string
domain:string
statId?:string
operation?:string
sourceUnit?:string
scale:number
priority?:number
enabled:number
min?:number
max?:number
handlerKey?:string
}
type IRefpvpAttrMap_legacyKey=string
type IRefpvpAttrMap_domain=string
type IRefpvpAttrMap_statId=string
type IRefpvpAttrMap_operation=string
type IRefpvpAttrMap_sourceUnit=string
type IRefpvpAttrMap_scale=number
type IRefpvpAttrMap_priority=number
type IRefpvpAttrMap_enabled=number
type IRefpvpAttrMap_min=number
type IRefpvpAttrMap_max=number
type IRefpvpAttrMap_handlerKey=string

interface refGen{pvpAttrMap:IRefpvpAttrMap}


interface IRefpvpBond extends IRefBase
{
id:string
name:string
condition:string
threshold:number
effect:string
trait:string
target:string
effectType:string
effectValue:number
}
type IRefpvpBond_id=string
type IRefpvpBond_name=string
type IRefpvpBond_condition=string
type IRefpvpBond_threshold=number
type IRefpvpBond_effect=string
type IRefpvpBond_trait=string
type IRefpvpBond_target=string
type IRefpvpBond_effectType=string
type IRefpvpBond_effectValue=number

interface refGen{pvpBond:IRefpvpBond}


interface IRefpvpCard extends IRefBase
{
id:number
name:string
type:string
rarity:number
skillList:any[]
enabled:number
description:string
buildSeconds:number
buildAttackTime:number
buildAttackRange:number
buildDamge:number
goldDigTime:number
soilderAddTime:number
cycleBaseValue:number
buildDigGoldNum:number
baseHp:number
buildNumLimit:number
cyclePerTierValue?:number
buildIcon?:string
unitId?:number
traits?:any
unitMaxHp?:number
unitAttack?:number
unitMoveSpeed?:number
unitAttackRange?:number
unitAttackInterval?:number
unitAttackDuration?:number
unitAttackHitTime?:number
unitBodyRadius?:number
unitFlying?:number
unitCanAttackAir?:number
unitHero?:number
unitStatus?:string
unitPrefabPath?:string
prefabSize?:number
unitSkillId?:number
attackStyle?:number
headIcon?:string
unitValueFactor?:number
}
type IRefpvpCard_id=number
type IRefpvpCard_name=string
type IRefpvpCard_type=string
type IRefpvpCard_rarity=number
type IRefpvpCard_skillList=any[]
type IRefpvpCard_enabled=number
type IRefpvpCard_description=string
type IRefpvpCard_buildSeconds=number
type IRefpvpCard_buildAttackTime=number
type IRefpvpCard_buildAttackRange=number
type IRefpvpCard_buildDamge=number
type IRefpvpCard_goldDigTime=number
type IRefpvpCard_soilderAddTime=number
type IRefpvpCard_cycleBaseValue=number
type IRefpvpCard_buildDigGoldNum=number
type IRefpvpCard_baseHp=number
type IRefpvpCard_buildNumLimit=number
type IRefpvpCard_cyclePerTierValue=number
type IRefpvpCard_buildIcon=string
type IRefpvpCard_unitId=number
type IRefpvpCard_traits=any
type IRefpvpCard_unitMaxHp=number
type IRefpvpCard_unitAttack=number
type IRefpvpCard_unitMoveSpeed=number
type IRefpvpCard_unitAttackRange=number
type IRefpvpCard_unitAttackInterval=number
type IRefpvpCard_unitAttackDuration=number
type IRefpvpCard_unitAttackHitTime=number
type IRefpvpCard_unitBodyRadius=number
type IRefpvpCard_unitFlying=number
type IRefpvpCard_unitCanAttackAir=number
type IRefpvpCard_unitHero=number
type IRefpvpCard_unitStatus=string
type IRefpvpCard_unitPrefabPath=string
type IRefpvpCard_prefabSize=number
type IRefpvpCard_unitSkillId=number
type IRefpvpCard_attackStyle=number
type IRefpvpCard_headIcon=string
type IRefpvpCard_unitValueFactor=number

interface refGen{pvpCard:IRefpvpCard}


interface IRefpvpCounter extends IRefBase
{
dimension:string
attacker:string
defender:string
damageMultiplier:number
}
type IRefpvpCounter_dimension=string
type IRefpvpCounter_attacker=string
type IRefpvpCounter_defender=string
type IRefpvpCounter_damageMultiplier=number

interface refGen{pvpCounter:IRefpvpCounter}


interface IRefpvpGlobal extends IRefBase
{
key:string
value:number
}
type IRefpvpGlobal_key=string
type IRefpvpGlobal_value=number

interface refGen{pvpGlobal:IRefpvpGlobal}


interface IRefpvpModifierOverride extends IRefBase
{
modifierId:number
legacyKey?:string
targetUnitId?:string
domain?:string
statId?:string
operation?:string
value?:number
enabled:number
targetUnitIds?:string
valuesJson?:string
}
type IRefpvpModifierOverride_modifierId=number
type IRefpvpModifierOverride_legacyKey=string
type IRefpvpModifierOverride_targetUnitId=string
type IRefpvpModifierOverride_domain=string
type IRefpvpModifierOverride_statId=string
type IRefpvpModifierOverride_operation=string
type IRefpvpModifierOverride_value=number
type IRefpvpModifierOverride_enabled=number
type IRefpvpModifierOverride_targetUnitIds=string
type IRefpvpModifierOverride_valuesJson=string

interface refGen{pvpModifierOverride:IRefpvpModifierOverride}


interface IRefpvpPity extends IRefBase
{
id:number
tileType:number
targetRarity:string
triggerCount:number
resetOnTarget:number
countEmptyDraw:number
}
type IRefpvpPity_id=number
type IRefpvpPity_tileType=number
type IRefpvpPity_targetRarity=string
type IRefpvpPity_triggerCount=number
type IRefpvpPity_resetOnTarget=number
type IRefpvpPity_countEmptyDraw=number

interface refGen{pvpPity:IRefpvpPity}


interface IRefpvpSkill extends IRefBase
{
skillId:number
name:string
mode:string
effectKey?:string
projectileKey?:string
projectileSpeed:number
areaRadius?:number
empoweredEvery:number
empoweredSkillId:number
effectPrefabPath?:string
trigger?:string
cooldown:number
onHitStatusId?:string
impactEffectPrefabPath?:string
damageRate?:number
durationSeconds?:number
waves?:number
slowRatio?:number
secondarySkillId?:number
chargeDistance?:number
chargeSpeedScale?:number
impactEffectAnchor?:number
}
type IRefpvpSkill_skillId=number
type IRefpvpSkill_name=string
type IRefpvpSkill_mode=string
type IRefpvpSkill_effectKey=string
type IRefpvpSkill_projectileKey=string
type IRefpvpSkill_projectileSpeed=number
type IRefpvpSkill_areaRadius=number
type IRefpvpSkill_empoweredEvery=number
type IRefpvpSkill_empoweredSkillId=number
type IRefpvpSkill_effectPrefabPath=string
type IRefpvpSkill_trigger=string
type IRefpvpSkill_cooldown=number
type IRefpvpSkill_onHitStatusId=string
type IRefpvpSkill_impactEffectPrefabPath=string
type IRefpvpSkill_damageRate=number
type IRefpvpSkill_durationSeconds=number
type IRefpvpSkill_waves=number
type IRefpvpSkill_slowRatio=number
type IRefpvpSkill_secondarySkillId=number
type IRefpvpSkill_chargeDistance=number
type IRefpvpSkill_chargeSpeedScale=number
type IRefpvpSkill_impactEffectAnchor=number

interface refGen{pvpSkill:IRefpvpSkill}


interface IRefpvpSkillBinding extends IRefBase
{
legacySkillId:number
pvpSkillId:number
targetUnitId:string
behaviorKey:string
trigger:string
stateMode:string
parameterKey:string
parameterStatId:string
enabled:number
}
type IRefpvpSkillBinding_legacySkillId=number
type IRefpvpSkillBinding_pvpSkillId=number
type IRefpvpSkillBinding_targetUnitId=string
type IRefpvpSkillBinding_behaviorKey=string
type IRefpvpSkillBinding_trigger=string
type IRefpvpSkillBinding_stateMode=string
type IRefpvpSkillBinding_parameterKey=string
type IRefpvpSkillBinding_parameterStatId=string
type IRefpvpSkillBinding_enabled=number

interface refGen{pvpSkillBinding:IRefpvpSkillBinding}


interface IRefpvpSkillPlan extends IRefBase
{
enabled:number
modifierId:number
unitId:string
skillChainId:number
skillName:string
skillLevel:number
unlockHeroLevel?:number
skillKind:string
passiveScope:string
progressionMode:string
pvpSkillId:number
triggerEvent?:string
stateMode:string
targetSelector?:string
statId:string
operation?:string
value:number
durationSeconds?:number
maxStacks?:number
cooldown?:number
maxTriggers?:number
desc:string
sourceVersion:string
publishStatus?:string
skillParamJson?:any
statusId?:any
statusStatJson?:any
behaviorKey?:any
}
type IRefpvpSkillPlan_enabled=number
type IRefpvpSkillPlan_modifierId=number
type IRefpvpSkillPlan_unitId=string
type IRefpvpSkillPlan_skillChainId=number
type IRefpvpSkillPlan_skillName=string
type IRefpvpSkillPlan_skillLevel=number
type IRefpvpSkillPlan_unlockHeroLevel=number
type IRefpvpSkillPlan_skillKind=string
type IRefpvpSkillPlan_passiveScope=string
type IRefpvpSkillPlan_progressionMode=string
type IRefpvpSkillPlan_pvpSkillId=number
type IRefpvpSkillPlan_triggerEvent=string
type IRefpvpSkillPlan_stateMode=string
type IRefpvpSkillPlan_targetSelector=string
type IRefpvpSkillPlan_statId=string
type IRefpvpSkillPlan_operation=string
type IRefpvpSkillPlan_value=number
type IRefpvpSkillPlan_durationSeconds=number
type IRefpvpSkillPlan_maxStacks=number
type IRefpvpSkillPlan_cooldown=number
type IRefpvpSkillPlan_maxTriggers=number
type IRefpvpSkillPlan_desc=string
type IRefpvpSkillPlan_sourceVersion=string
type IRefpvpSkillPlan_publishStatus=string
type IRefpvpSkillPlan_skillParamJson=any
type IRefpvpSkillPlan_statusId=any
type IRefpvpSkillPlan_statusStatJson=any
type IRefpvpSkillPlan_behaviorKey=any

interface refGen{pvpSkillPlan:IRefpvpSkillPlan}


interface IRefpvpStatus extends IRefBase
{
legacyBuffKey:string
statusId:string
name:string
durationSeconds:number
intervalSeconds:number
maxStacks:number
refreshPolicy:string
handlerKey:string
statJson:string
enabled:number
control?:string
periodicAmountPct?:number
periodicBasis?:string
periodicCapMultiplier?:number
}
type IRefpvpStatus_legacyBuffKey=string
type IRefpvpStatus_statusId=string
type IRefpvpStatus_name=string
type IRefpvpStatus_durationSeconds=number
type IRefpvpStatus_intervalSeconds=number
type IRefpvpStatus_maxStacks=number
type IRefpvpStatus_refreshPolicy=string
type IRefpvpStatus_handlerKey=string
type IRefpvpStatus_statJson=string
type IRefpvpStatus_enabled=number
type IRefpvpStatus_control=string
type IRefpvpStatus_periodicAmountPct=number
type IRefpvpStatus_periodicBasis=string
type IRefpvpStatus_periodicCapMultiplier=number

interface refGen{pvpStatus:IRefpvpStatus}


interface IRefpvpTile extends IRefBase
{
id:number
name:string
icon:string
price:number
rarityWeights:any
eligibleCardTypes:any[]
pityGroup?:string
description:string
weight:number
initialCountLimit:number
setCountLimit:number
}
type IRefpvpTile_id=number
type IRefpvpTile_name=string
type IRefpvpTile_icon=string
type IRefpvpTile_price=number
type IRefpvpTile_rarityWeights=any
type IRefpvpTile_eligibleCardTypes=any[]
type IRefpvpTile_pityGroup=string
type IRefpvpTile_description=string
type IRefpvpTile_weight=number
type IRefpvpTile_initialCountLimit=number
type IRefpvpTile_setCountLimit=number

interface refGen{pvpTile:IRefpvpTile}


interface IRefpvpTileGen extends IRefBase
{
tileType:number
name:string
weight:number
status:string
}
type IRefpvpTileGen_tileType=number
type IRefpvpTileGen_name=string
type IRefpvpTileGen_weight=number
type IRefpvpTileGen_status=string

interface refGen{pvpTileGen:IRefpvpTileGen}


interface IRefpvpTileGenParams extends IRefBase
{
key:string
value:number
}
type IRefpvpTileGenParams_key=string
type IRefpvpTileGenParams_value=number

interface refGen{pvpTileGenParams:IRefpvpTileGenParams}


interface IRefpvpUnitGrowth extends IRefBase
{
unitId:string
level:number
attackFlat:number
attackRate:number
maxHpFlat:number
maxHpRate:number
moveSpeedRate:number
attackRangeFlat:number
enabled:number
}
type IRefpvpUnitGrowth_unitId=string
type IRefpvpUnitGrowth_level=number
type IRefpvpUnitGrowth_attackFlat=number
type IRefpvpUnitGrowth_attackRate=number
type IRefpvpUnitGrowth_maxHpFlat=number
type IRefpvpUnitGrowth_maxHpRate=number
type IRefpvpUnitGrowth_moveSpeedRate=number
type IRefpvpUnitGrowth_attackRangeFlat=number
type IRefpvpUnitGrowth_enabled=number

interface refGen{pvpUnitGrowth:IRefpvpUnitGrowth}


interface IRefrechargeDaily extends IRefBase
{
round:number
days:number
openGainItemNum:number
rewards:any[]
finishRewards:any[]
}
type IRefrechargeDaily_round=number
type IRefrechargeDaily_days=number
type IRefrechargeDaily_openGainItemNum=number
type IRefrechargeDaily_rewards=any[]
type IRefrechargeDaily_finishRewards=any[]

interface refGen{rechargeDaily:IRefrechargeDaily}


interface IRefrechargeGiftActPlan extends IRefBase
{
plan:number
rechargeProcess:number
rechargeReward:any[]
}
type IRefrechargeGiftActPlan_plan=number
type IRefrechargeGiftActPlan_rechargeProcess=number
type IRefrechargeGiftActPlan_rechargeReward=any[]

interface refGen{rechargeGiftActPlan:IRefrechargeGiftActPlan}


interface IRefrefToCodeEnum extends IRefBase
{
enumName:string
fname:string
key:string
value:string
}
type IRefrefToCodeEnum_enumName=string
type IRefrefToCodeEnum_fname=string
type IRefrefToCodeEnum_key=string
type IRefrefToCodeEnum_value=string

interface refGen{refToCodeEnum:IRefrefToCodeEnum}


interface IRefresourceShop extends IRefBase
{
id:number
desc:string
rewards:any[]
priceType:number
cost:number
limit:number
}
type IRefresourceShop_id=number
type IRefresourceShop_desc=string
type IRefresourceShop_rewards=any[]
type IRefresourceShop_priceType=number
type IRefresourceShop_cost=number
type IRefresourceShop_limit=number

interface refGen{resourceShop:IRefresourceShop}


interface IRefroleProperty extends IRefBase
{
resId:number
key:string
type:number
name:string
quality:number
describe:string
showType:number
unenoughTips?:string
access?:any[]
useJump?:number
icon?:string
isbig?:number
}
type IRefroleProperty_resId=number
type IRefroleProperty_key=string
type IRefroleProperty_type=number
type IRefroleProperty_name=string
type IRefroleProperty_quality=number
type IRefroleProperty_describe=string
type IRefroleProperty_showType=number
type IRefroleProperty_unenoughTips=string
type IRefroleProperty_access=any[]
type IRefroleProperty_useJump=number
type IRefroleProperty_icon=string
type IRefroleProperty_isbig=number

interface refGen{roleProperty:IRefroleProperty}


interface IRefserverRank extends IRefBase
{
min:number
max:number
limit:number
reward:any[]
}
type IRefserverRank_min=number
type IRefserverRank_max=number
type IRefserverRank_limit=number
type IRefserverRank_reward=any[]

interface refGen{serverRank:IRefserverRank}


interface IRefsevenDayPoint extends IRefBase
{
resId:number
point:number
reward:any[]
}
type IRefsevenDayPoint_resId=number
type IRefsevenDayPoint_point=number
type IRefsevenDayPoint_reward=any[]

interface refGen{sevenDayPoint:IRefsevenDayPoint}


interface IRefsevenDayShop extends IRefBase
{
id:number
days:number
type:number
typeName:string
name:string
rewards:any[]
priceType:number
originalPrice:number
cost:number
limit:number
discount:number
}
type IRefsevenDayShop_id=number
type IRefsevenDayShop_days=number
type IRefsevenDayShop_type=number
type IRefsevenDayShop_typeName=string
type IRefsevenDayShop_name=string
type IRefsevenDayShop_rewards=any[]
type IRefsevenDayShop_priceType=number
type IRefsevenDayShop_originalPrice=number
type IRefsevenDayShop_cost=number
type IRefsevenDayShop_limit=number
type IRefsevenDayShop_discount=number

interface refGen{sevenDayShop:IRefsevenDayShop}


interface IRefsevenDayTask extends IRefBase
{
resId:number
days:number
type:number
typeName:string
name:string
targetType:number
param:any
reward:any[]
goto:number
}
type IRefsevenDayTask_resId=number
type IRefsevenDayTask_days=number
type IRefsevenDayTask_type=number
type IRefsevenDayTask_typeName=string
type IRefsevenDayTask_name=string
type IRefsevenDayTask_targetType=number
type IRefsevenDayTask_param=any
type IRefsevenDayTask_reward=any[]
type IRefsevenDayTask_goto=number

interface refGen{sevenDayTask:IRefsevenDayTask}


interface IRefshare extends IRefBase
{
channel:number
key:string
title:string
desc:string
}
type IRefshare_channel=number
type IRefshare_key=string
type IRefshare_title=string
type IRefshare_desc=string

interface refGen{share:IRefshare}


interface IRefshiMengBattleConfig extends IRefBase
{
id:number
guankaId:number
name:string
battleLeve:number
costs:any[]
assistCosts:any[]
showBuff:string
buff:any[]
}
type IRefshiMengBattleConfig_id=number
type IRefshiMengBattleConfig_guankaId=number
type IRefshiMengBattleConfig_name=string
type IRefshiMengBattleConfig_battleLeve=number
type IRefshiMengBattleConfig_costs=any[]
type IRefshiMengBattleConfig_assistCosts=any[]
type IRefshiMengBattleConfig_showBuff=string
type IRefshiMengBattleConfig_buff=any[]

interface refGen{shiMengBattleConfig:IRefshiMengBattleConfig}


interface IRefskillAttr extends IRefBase
{
id:number
skillId:number
key:string
desc?:string
numberType:number
key2:string
value?:string
type:string
params?:any
}
type IRefskillAttr_id=number
type IRefskillAttr_skillId=number
type IRefskillAttr_key=string
type IRefskillAttr_desc=string
type IRefskillAttr_numberType=number
type IRefskillAttr_key2=string
type IRefskillAttr_value=string
type IRefskillAttr_type=string
type IRefskillAttr_params=any

interface refGen{skillAttr:IRefskillAttr}


interface IRefskillAttrModifier extends IRefBase
{
id:number
name?:string
icon?:string
desc?:string
describe?:any
modify:any[]
descinfo?:string
armyTalent?:any
}
type IRefskillAttrModifier_id=number
type IRefskillAttrModifier_name=string
type IRefskillAttrModifier_icon=string
type IRefskillAttrModifier_desc=string
type IRefskillAttrModifier_describe=any
type IRefskillAttrModifier_modify=any[]
type IRefskillAttrModifier_descinfo=string
type IRefskillAttrModifier_armyTalent=any

interface refGen{skillAttrModifier:IRefskillAttrModifier}


interface IRefskillBuff extends IRefBase
{
key:string
type:string
desc:string
model?:string
position:number
overlying:any[]
category:number
param:any
}
type IRefskillBuff_key=string
type IRefskillBuff_type=string
type IRefskillBuff_desc=string
type IRefskillBuff_model=string
type IRefskillBuff_position=number
type IRefskillBuff_overlying=any[]
type IRefskillBuff_category=number
type IRefskillBuff_param=any

interface refGen{skillBuff:IRefskillBuff}


interface IRefskillEffect extends IRefBase
{
key:string
effects:any[]
}
type IRefskillEffect_key=string
type IRefskillEffect_effects=any[]

interface refGen{skillEffect:IRefskillEffect}


interface IRefskillEffectDamageType extends IRefBase
{
key:string
value:number
name:string
}
type IRefskillEffectDamageType_key=string
type IRefskillEffectDamageType_value=number
type IRefskillEffectDamageType_name=string

interface refGen{skillEffectDamageType:IRefskillEffectDamageType}


interface IRefskillType extends IRefBase
{
id:number
key:string
name:string
attrSkillName:string
icon:string
rangeType:number
atkRate:number
aoeRate:number
keepDamageRate:number
consumeId:number
roleLevel:number
cdType:number
attr:any[]
desc?:string
}
type IRefskillType_id=number
type IRefskillType_key=string
type IRefskillType_name=string
type IRefskillType_attrSkillName=string
type IRefskillType_icon=string
type IRefskillType_rangeType=number
type IRefskillType_atkRate=number
type IRefskillType_aoeRate=number
type IRefskillType_keepDamageRate=number
type IRefskillType_consumeId=number
type IRefskillType_roleLevel=number
type IRefskillType_cdType=number
type IRefskillType_attr=any[]
type IRefskillType_desc=string

interface refGen{skillType:IRefskillType}


interface IRefskillView extends IRefBase
{
skillId:number
baseSkillId:number
desc?:string
anim?:any[]
hurt?:any[]
hitTime?:number
totalTime:number
skillRange?:any[]
exSkillId?:number
exHurt?:any[]
exSkillNeedTimes?:number
showEffect?:any[]
}
type IRefskillView_skillId=number
type IRefskillView_baseSkillId=number
type IRefskillView_desc=string
type IRefskillView_anim=any[]
type IRefskillView_hurt=any[]
type IRefskillView_hitTime=number
type IRefskillView_totalTime=number
type IRefskillView_skillRange=any[]
type IRefskillView_exSkillId=number
type IRefskillView_exHurt=any[]
type IRefskillView_exSkillNeedTimes=number
type IRefskillView_showEffect=any[]

interface refGen{skillView:IRefskillView}


interface IRefskin extends IRefBase
{
resId:number
type:number
name:string
model:string
icon:string
iconKaPai:string
iconHalf:string
quality:number
desc:string
desc1:string
desc2:string
attrAddition:any[]
useAttrAddition:any[]
bindHead:any[]
splitReward:any[]
}
type IRefskin_resId=number
type IRefskin_type=number
type IRefskin_name=string
type IRefskin_model=string
type IRefskin_icon=string
type IRefskin_iconKaPai=string
type IRefskin_iconHalf=string
type IRefskin_quality=number
type IRefskin_desc=string
type IRefskin_desc1=string
type IRefskin_desc2=string
type IRefskin_attrAddition=any[]
type IRefskin_useAttrAddition=any[]
type IRefskin_bindHead=any[]
type IRefskin_splitReward=any[]

interface refGen{skin:IRefskin}


interface IRefspiritAnimal extends IRefBase
{
resId:number
animalId:number
step:number
stepUpCostSame:any[]
stepUpCostCamp:any[]
attrList:any[]
}
type IRefspiritAnimal_resId=number
type IRefspiritAnimal_animalId=number
type IRefspiritAnimal_step=number
type IRefspiritAnimal_stepUpCostSame=any[]
type IRefspiritAnimal_stepUpCostCamp=any[]
type IRefspiritAnimal_attrList=any[]

interface refGen{spiritAnimal:IRefspiritAnimal}


interface IRefspiritAnimalType extends IRefBase
{
animalId:number
attrSkillName:string
skillId:number
key:string
camp:number
skill:any
name:string
icon:string
iconKaPai:string
iconSkill:string
showSize:number
model:string
desc:string
spd:number
atkSpacing:number
atkRange:number
}
type IRefspiritAnimalType_animalId=number
type IRefspiritAnimalType_attrSkillName=string
type IRefspiritAnimalType_skillId=number
type IRefspiritAnimalType_key=string
type IRefspiritAnimalType_camp=number
type IRefspiritAnimalType_skill=any
type IRefspiritAnimalType_name=string
type IRefspiritAnimalType_icon=string
type IRefspiritAnimalType_iconKaPai=string
type IRefspiritAnimalType_iconSkill=string
type IRefspiritAnimalType_showSize=number
type IRefspiritAnimalType_model=string
type IRefspiritAnimalType_desc=string
type IRefspiritAnimalType_spd=number
type IRefspiritAnimalType_atkSpacing=number
type IRefspiritAnimalType_atkRange=number

interface refGen{spiritAnimalType:IRefspiritAnimalType}


interface IReftaskMain extends IRefBase
{
resId:number
preResId:number
targetType:number
param:any
reward:any[]
name:string
goto?:number
}
type IReftaskMain_resId=number
type IReftaskMain_preResId=number
type IReftaskMain_targetType=number
type IReftaskMain_param=any
type IReftaskMain_reward=any[]
type IReftaskMain_name=string
type IReftaskMain_goto=number

interface refGen{taskMain:IReftaskMain}


interface IReftaskType extends IRefBase
{
type:number
name:string
key:string
}
type IReftaskType_type=number
type IReftaskType_name=string
type IReftaskType_key=string

interface refGen{taskType:IReftaskType}


interface IReftaskUnion extends IRefBase
{
resId:number
subType:number
targetType:number
param:any
reward:any[]
name:string
goto?:number
}
type IReftaskUnion_resId=number
type IReftaskUnion_subType=number
type IReftaskUnion_targetType=number
type IReftaskUnion_param=any
type IReftaskUnion_reward=any[]
type IReftaskUnion_name=string
type IReftaskUnion_goto=number

interface refGen{taskUnion:IReftaskUnion}


interface IReftaskUnionProgress extends IRefBase
{
id:number
count:number
rewards:any[]
}
type IReftaskUnionProgress_id=number
type IReftaskUnionProgress_count=number
type IReftaskUnionProgress_rewards=any[]

interface refGen{taskUnionProgress:IReftaskUnionProgress}


interface IRefunionDiscount extends IRefBase
{
id:number
rewards:any[]
priceType:number
cost:number
minPrice:number
}
type IRefunionDiscount_id=number
type IRefunionDiscount_rewards=any[]
type IRefunionDiscount_priceType=number
type IRefunionDiscount_cost=number
type IRefunionDiscount_minPrice=number

interface refGen{unionDiscount:IRefunionDiscount}


interface IRefunionLevel extends IRefBase
{
level:number
maxCount:number
exp:number
}
type IRefunionLevel_level=number
type IRefunionLevel_maxCount=number
type IRefunionLevel_exp=number

interface refGen{unionLevel:IRefunionLevel}


interface IRefunionOfficial extends IRefBase
{
position:number
name:string
canApprove:number
canEdit:number
kick:any[]
appointLeader:any[]
appointDeputy:any[]
dismiss:any[]
}
type IRefunionOfficial_position=number
type IRefunionOfficial_name=string
type IRefunionOfficial_canApprove=number
type IRefunionOfficial_canEdit=number
type IRefunionOfficial_kick=any[]
type IRefunionOfficial_appointLeader=any[]
type IRefunionOfficial_appointDeputy=any[]
type IRefunionOfficial_dismiss=any[]

interface refGen{unionOfficial:IRefunionOfficial}


interface IRefunionShop extends IRefBase
{
id:number
desc:string
rewards:any[]
priceType:number
cost:number
limitType:number
limitDesc:string
freeTimes:number
adTimes:number
limit:number
}
type IRefunionShop_id=number
type IRefunionShop_desc=string
type IRefunionShop_rewards=any[]
type IRefunionShop_priceType=number
type IRefunionShop_cost=number
type IRefunionShop_limitType=number
type IRefunionShop_limitDesc=string
type IRefunionShop_freeTimes=number
type IRefunionShop_adTimes=number
type IRefunionShop_limit=number

interface refGen{unionShop:IRefunionShop}


interface IRefviewtype extends IRefBase
{
resId:number
value:string
}
type IRefviewtype_resId=number
type IRefviewtype_value=string

interface refGen{viewtype:IRefviewtype}


interface IRefwall extends IRefBase
{
level:number
itemId:number
number:number
hp:number
istupo:number
}
type IRefwall_level=number
type IRefwall_itemId=number
type IRefwall_number=number
type IRefwall_hp=number
type IRefwall_istupo=number

interface refGen{wall:IRefwall}


interface IRefwallType extends IRefBase
{
type:number
star:number
costs:any[]
name:string
icon:string
desc:string
desc2:string
model:string
modify?:any[]
modify2?:any[]
}
type IRefwallType_type=number
type IRefwallType_star=number
type IRefwallType_costs=any[]
type IRefwallType_name=string
type IRefwallType_icon=string
type IRefwallType_desc=string
type IRefwallType_desc2=string
type IRefwallType_model=string
type IRefwallType_modify=any[]
type IRefwallType_modify2=any[]

interface refGen{wallType:IRefwallType}


interface IRefzcGuide extends IRefBase
{
id:string
order:number
title:string
icon:string
price:number
rewards:any[]
remark:string
}
type IRefzcGuide_id=string
type IRefzcGuide_order=number
type IRefzcGuide_title=string
type IRefzcGuide_icon=string
type IRefzcGuide_price=number
type IRefzcGuide_rewards=any[]
type IRefzcGuide_remark=string

interface refGen{zcGuide:IRefzcGuide}


interface IRefzcGuideParams extends IRefBase
{
key:string
value:string
}
type IRefzcGuideParams_key=string
type IRefzcGuideParams_value=string

interface refGen{zcGuideParams:IRefzcGuideParams}
type TRefName="activity.json"|"activityTab.json"|"ad.json"|"advisor.json"|"armyLevel.json"|"armySkillLevelUp.json"|"armySkin.json"|"artifact.json"|"artifactLevel.json"|"audioConfig.json"|"baseBuilding.json"|"baseBuildingLevel.json"|"battleTokenConfig.json"|"battleTokenPlan.json"|"battleTokenReward.json"|"bfUnionRankAward.json"|"bigmapBuilding.json"|"bigmapBuildingLevel.json"|"bigmapBuildingProduce.json"|"bigMapCamp.json"|"bigmapCity.json"|"bigmapCityLevel.json"|"bigmapMonster.json"|"bigmapQueue.json"|"bigmapRank.json"|"bigmapResource.json"|"bigmapSchedule.json"|"bigmapScoreRule.json"|"bigmapStamina.json"|"bigmapWorld.json"|"bigNum.json"|"build.json"|"campProduceBuffId.json"|"cardLevelUp.json"|"cardUiArtCamp.json"|"cardUiArtClass.json"|"cardUiArtRarity.json"|"celebrationConfig.json"|"celebrationRank.json"|"celebrationShop.json"|"celebrationTarget.json"|"chapterName.json"|"dayChallengeActTask.json"|"dayChallengeActTaskProgress.json"|"defenceModWave.json"|"defenceWaveReward.json"|"equip.json"|"equipLevel.json"|"equipLib.json"|"equipRank.json"|"equipType.json"|"firstRechargeNew.json"|"gameConfig.json"|"gem.json"|"gemAttribute.json"|"gemBox.json"|"gemQuality.json"|"gemShop.json"|"general.json"|"generalStar.json"|"giftShop.json"|"goldShop.json"|"grade.json"|"guanka.json"|"guankaChapter.json"|"guankaGift.json"|"guankaReward.json"|"guards.json"|"guideDialog.json"|"guideStep.json"|"head.json"|"heroSkill.json"|"icon.json"|"idConfig.json"|"interactReward.json"|"item.json"|"itemBox.json"|"itemBoxPro.json"|"itemCraft.json"|"itemType.json"|"level.json"|"levelFirstPassReward.json"|"levelInfo.json"|"levelMapGrideReward.json"|"lottery.json"|"mapconfig.json"|"mapTerrian.json"|"matchTips.json"|"mL.json"|"monster.json"|"monsterCard.json"|"monsterSkillType.json"|"monthCardActPlan.json"|"neutralEnhanceGate.json"|"neutralResourceGroup.json"|"newTreasureBoxConfig.json"|"newTreasureBoxQueueConfig.json"|"npcTeam.json"|"open.json"|"openGridReward.json"|"payChannel.json"|"plotCard.json"|"pvpArtifact.json"|"pvpAttrMap.json"|"pvpBond.json"|"pvpCard.json"|"pvpCounter.json"|"pvpGlobal.json"|"pvpModifierOverride.json"|"pvpPity.json"|"pvpSkill.json"|"pvpSkillBinding.json"|"pvpSkillPlan.json"|"pvpStatus.json"|"pvpTile.json"|"pvpTileGen.json"|"pvpTileGenParams.json"|"pvpUnitGrowth.json"|"rechargeDaily.json"|"rechargeGiftActPlan.json"|"refToCodeEnum.json"|"resourceShop.json"|"roleProperty.json"|"serverRank.json"|"sevenDayPoint.json"|"sevenDayShop.json"|"sevenDayTask.json"|"share.json"|"shiMengBattleConfig.json"|"skillAttr.json"|"skillAttrModifier.json"|"skillBuff.json"|"skillEffect.json"|"skillEffectDamageType.json"|"skillType.json"|"skillView.json"|"skin.json"|"spiritAnimal.json"|"spiritAnimalType.json"|"taskMain.json"|"taskType.json"|"taskUnion.json"|"taskUnionProgress.json"|"unionDiscount.json"|"unionLevel.json"|"unionOfficial.json"|"unionShop.json"|"viewtype.json"|"wall.json"|"wallType.json"|"zcGuide.json"|"zcGuideParams.json"

type TRefName2="activity"|"activityTab"|"ad"|"advisor"|"armyLevel"|"armySkillLevelUp"|"armySkin"|"artifact"|"artifactLevel"|"audioConfig"|"baseBuilding"|"baseBuildingLevel"|"battleTokenConfig"|"battleTokenPlan"|"battleTokenReward"|"bfUnionRankAward"|"bigmapBuilding"|"bigmapBuildingLevel"|"bigmapBuildingProduce"|"bigMapCamp"|"bigmapCity"|"bigmapCityLevel"|"bigmapMonster"|"bigmapQueue"|"bigmapRank"|"bigmapResource"|"bigmapSchedule"|"bigmapScoreRule"|"bigmapStamina"|"bigmapWorld"|"bigNum"|"build"|"campProduceBuffId"|"cardLevelUp"|"cardUiArtCamp"|"cardUiArtClass"|"cardUiArtRarity"|"celebrationConfig"|"celebrationRank"|"celebrationShop"|"celebrationTarget"|"chapterName"|"dayChallengeActTask"|"dayChallengeActTaskProgress"|"defenceModWave"|"defenceWaveReward"|"equip"|"equipLevel"|"equipLib"|"equipRank"|"equipType"|"firstRechargeNew"|"gameConfig"|"gem"|"gemAttribute"|"gemBox"|"gemQuality"|"gemShop"|"general"|"generalStar"|"giftShop"|"goldShop"|"grade"|"guanka"|"guankaChapter"|"guankaGift"|"guankaReward"|"guards"|"guideDialog"|"guideStep"|"head"|"heroSkill"|"icon"|"idConfig"|"interactReward"|"item"|"itemBox"|"itemBoxPro"|"itemCraft"|"itemType"|"level"|"levelFirstPassReward"|"levelInfo"|"levelMapGrideReward"|"lottery"|"mapconfig"|"mapTerrian"|"matchTips"|"mL"|"monster"|"monsterCard"|"monsterSkillType"|"monthCardActPlan"|"neutralEnhanceGate"|"neutralResourceGroup"|"newTreasureBoxConfig"|"newTreasureBoxQueueConfig"|"npcTeam"|"open"|"openGridReward"|"payChannel"|"plotCard"|"pvpArtifact"|"pvpAttrMap"|"pvpBond"|"pvpCard"|"pvpCounter"|"pvpGlobal"|"pvpModifierOverride"|"pvpPity"|"pvpSkill"|"pvpSkillBinding"|"pvpSkillPlan"|"pvpStatus"|"pvpTile"|"pvpTileGen"|"pvpTileGenParams"|"pvpUnitGrowth"|"rechargeDaily"|"rechargeGiftActPlan"|"refToCodeEnum"|"resourceShop"|"roleProperty"|"serverRank"|"sevenDayPoint"|"sevenDayShop"|"sevenDayTask"|"share"|"shiMengBattleConfig"|"skillAttr"|"skillAttrModifier"|"skillBuff"|"skillEffect"|"skillEffectDamageType"|"skillType"|"skillView"|"skin"|"spiritAnimal"|"spiritAnimalType"|"taskMain"|"taskType"|"taskUnion"|"taskUnionProgress"|"unionDiscount"|"unionLevel"|"unionOfficial"|"unionShop"|"viewtype"|"wall"|"wallType"|"zcGuide"|"zcGuideParams"

