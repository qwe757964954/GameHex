@echo off
chcp 936 >nul
setlocal

REM ============================================================
REM 客户端 ref 生成流程（迁入 Demo3.8 项目版）
REM 输入: D:\City1001\doc\塔防数据配置\json\client  （转表 json）
REM 输出: assets\remoteRef\*.json + refSmallAll.json
REM        assets\script\app\generated\refGen\ref_type_all.d.ts
REM        assets\script\app\generated\refGen\RefBase.ts
REM        assets\script\app\generated\refGen\RefEnum.ts
REM
REM [5/5] 是 PVP-卡牌「单位列」守卫（合表后）：兵种卡的两列必须成对、
REM       预置/技能必须真实存在、建筑卡的 unitId 必须留空。
REM       见 tools\pvp_card_check.py。同源单测：tests\pvp-card-unit-columns.test.ts。
REM ============================================================

pushd %~dp0

set PYTHON=C:\Users\hedao\.workbuddy\binaries\python\envs\default\Scripts\python.exe
if not exist "%PYTHON%" set PYTHON=python

echo ============================================================
echo [1/5] ref_compress_json  -^>  assets\remoteRef
echo ============================================================
"%PYTHON%" ref_compress_json.py "D:\City1001\doc\塔防数据配置\json\client"
if errorlevel 1 goto :err

echo ============================================================
echo [2/5] ref_ref_type_all_gen  -^>  refGen\ref_type_all.d.ts
echo ============================================================
"%PYTHON%" ref_ref_type_all_gen.py "D:\City1001\doc\塔防数据配置\json\client"
if errorlevel 1 goto :err

echo ============================================================
echo [3/5] ref_RefBase_gen  -^>  refGen\RefBase.ts
echo ============================================================
"%PYTHON%" ref_RefBase_gen.py
if errorlevel 1 goto :err

echo ============================================================
echo [4/5] ref_enum_gen  -^>  refGen\RefEnum.ts
echo ============================================================
"%PYTHON%" ref_enum_gen.py "D:\City1001\doc\塔防数据配置\json\client"
if errorlevel 1 goto :err

echo ============================================================
echo [5/5] pvp_card_check  -^>  pvpCard unit-column guard
echo ============================================================
set PYTHONIOENCODING=gbk
"%PYTHON%" "%~dp0..\pvp_card_check.py"
if errorlevel 1 goto :map_err

echo ============================================================
echo 全部完成
echo ============================================================
popd
endlocal
exit /b 0

:map_err
echo.
echo PVP unit-column guard FAILED: see the report above.
echo Typical causes: a barracks card filled only one of unitPrefabPath / unitSkillId,
echo a unitPrefabPath that has no .prefab, a unitSkillId missing from pvpSkill,
echo or a BUILDING card (main city / gold mine) that filled unitId -- unitId must be
echo empty on building cards, otherwise the runtime preload gate blocks the match.
popd
endlocal
exit /b 1

:err
echo 生成失败，请检查上方错误信息
popd
endlocal
exit /b 1
