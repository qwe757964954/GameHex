import { EngineMain } from "../../engine/EngineMain";
import { ScriptObject } from "../base/ScriptObject";

/**
* LocalCache 
*/
export class LocalCache<T> extends ScriptObject{
    static __cname: string = "LocalCache";

    static get AccountNum (){
        return EngineMain.readLocalStorage("account_num") as  string
    }

    private _key:string
    private _data:any = {}
    constructor(key:string){
        super()
        this._key = key
    }

    Set( value:any ){
        this._data = value
    }

    Get(){
        return this._data as T
    }

    GetKey(){
        return this._key
    }

    Clear(){
        let obj = this._data
        for(let key of Object.keys(obj)){
            delete obj[key]
        }
    }

    Save(){
        let dataStr = JSON.stringify(this._data)
        if(dataStr == null)return
        EngineMain.saveLocalStorage(this._key, dataStr)
    }

    Delete(){
        EngineMain.removeLocalStorage(this._key)
    }

    Load(){
        let dataStr = EngineMain.readLocalStorage(this._key)
        if(dataStr){
            this._data = JSON.parse(dataStr)
        }else{
            // this._data = null
        }
    }
}