import { ScriptObject } from "../base/ScriptObject";
import { Container } from "../container/Container";
import { World } from "./World";

let map = {}
function record(key:string, time:number){
    map[key] = time
    print()
}

let _t = 0
function print(){
    let frame = (cc.game as any).frameCount
    if(frame - _t > 60){
        _t = frame
        console.log(JSON.stringify(map))
    }
}

export abstract class System extends ScriptObject
{
    protected world:World
    protected container:Container
    init(world:World, container:Container)
    {
        this.world = world
        this.container = container
        this.onInit(world, container)
    }

    destroy(): void {
        this.Release()
        super.destroy()
    }

    Start(){
        this.onStart()
    }

    Release(){
        this.onRelease()
    }

    /**
     * 每帧调用
     * @param dt 
     */
    Update(dt:number)
    {   
        // let old = (cc.game as any).totalTime * 1000
        this.onUpdate(dt)
        // let now = (cc.game as any).totalTime * 1000
        // record(this["className"], now-old)
    }

    LateUpdate(dt:number){
        this.onLateUpdate(dt)
    }

    //#region 子类重写
    /**
     * container.start前调用
     * @param world 
     * @param container 
     */
    onInit(world: World, container: Container)
    {

    }
    
    onStart(){}

    onRelease(){}

    protected onUpdate(dt:number){}
    protected onLateUpdate(dt:number){}
    //#endregion


}

