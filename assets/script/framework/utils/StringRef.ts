import Ref from "../../app/ref/Ref";
import {Container, injectField} from "../container/Container";

export class StringRef
{
    static __cname: string = "StringRef";

    private static _inst: StringRef ;
    static inst()
    {
        if(!this._inst)
        {
            this._inst= new StringRef()
            Container.inst().inject(this._inst)
        }
        return StringRef._inst;
    }

    @injectField("Ref")
    Ref: Ref;

    GetQualityName(quality: number) {
        quality -= 1;
        quality = Math.max(quality, 0);
        let ref = this.Ref.RefMgrgameConfig.getRef("key", "qualityname")
        let qualityArr = ref.value.split(",")
        return qualityArr[quality];
    }
}