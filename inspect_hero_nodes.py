import json
p="assets/resources/ui/heroObtain/HeroObtain.prefab"
items=json.load(open(p,encoding="utf-8"))
for name in ["Rays","Shadow","HeroRoot","HeroHost","Title","Plate","Badge","Name","Shard","BarBg","BarFill","Count","Hint"]:
    n=next(x for x in items if x.get("__type__")=="cc.Node" and x.get("_name")==name)
    print(name, n["_lpos"]["x"], n["_lpos"]["y"])
