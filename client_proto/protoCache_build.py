import json
import os
def process_files():
    nokeys = {}
    item_key_list = []

    # 读取 txt 文件
    with open('protoCache_list.txt', 'r', encoding='utf-8') as txt_file:
        for line in txt_file:
            line = line.strip()
            parts = line.split()
            name = parts[0]
            if len(parts) == 2:
                nokeys[name] = True
            
            item_key_list.append(name)


    with open('protoCompiled_no_namespace.json', 'r', encoding='utf-8') as json_file:
        json_data = json.load(json_file)["nested"]
	# "CmdCastleWorkShop": {
		# "tlKey": [
			# "id"
		# ],
    # "tmField": {
        # "history": {
            # "fieldNumber": 6,
            # "name": "history",
            # "type": "string"
        # },
        # "id": {
            # "fieldNumber": 1,
            # "name": "id",
            # "type": "sint32"
        # },
        # "level": {
            # "fieldNumber": 2,
            # "name": "level",
            # "type": "sint32"
        # },
        # "levelEndTime": {
            # "fieldNumber": 4,
            # "name": "levelEndTime",
            # "type": "sint64"
        # },
        # "rewardEndTime": {
            # "fieldNumber": 5,
            # "name": "rewardEndTime",
            # "type": "sint64"
        # },
        # "rewardNum": {
            # "fieldNumber": 3,
            # "name": "rewardNum",
            # "type": "sint32"
        # }
    # }
# <=

      # "CmdCastleWorkShop": {
          # "fields": {
            # "history": {
              # "id": 6,
              # "rule": "required",
              # "type": "string"
            # },
            # "id": {
              # "id": 1,
              # "rule": "required",
              # "type": "sint32"
            # },
            # "level": {
              # "id": 2,
              # "rule": "required",
              # "type": "sint32"
            # },
            # "levelEndTime": {
              # "id": 4,
              # "rule": "required",
              # "type": "sint64"
            # },
            # "rewardEndTime": {
              # "id": 5,
              # "rule": "required",
              # "type": "sint64"
            # },
            # "rewardNum": {
              # "id": 3,
              # "rule": "required",
              # "type": "sint32"
            # }
          # }
    result = {}
    for item_key in item_key_list:
        
        data = json_data.get(item_key)
        if name == None:
            print(f"|{item_key}|, {json_data}")
            
        fields = data.get("fields")
        tmField = {}
        tlKey = []
        new_data = {"tlKey": tlKey, "tmField":tmField}
        for name, field in fields.items():
            fieldNumber = field.get("id")
            tmField[name] = {"fieldNumber": fieldNumber, "type":field.get("type"), "name":name}
            if fieldNumber == 1 and nokeys.get(name, None) == None:
                tlKey.append(name)
                
        result[item_key] = new_data
    
    output_path = os.path.join('..', 'assets', 'resources', 'config', 'protoCache.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=4)
    
    print(f"write {output_path}")
    return result



process_files()
