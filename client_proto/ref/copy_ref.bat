pushd %~dp0
python ref_compress_json.py "..\doc\塔防数据配置\json\client"
python ref_ref_type_all_gen.py "..\doc\塔防数据配置\json\client"
python ref_RefBase_gen.py "..\doc\塔防数据配置\json\client"
python ref_enum_gen.py "..\doc\塔防数据配置\json\client"
