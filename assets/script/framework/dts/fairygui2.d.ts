/**
 * 扩展
 */


declare namespace fgui {
    class UIConfig {
        static buttonSoundCustom: string;
    }
}
declare namespace fgui {
    interface GcomponentGen {
        com: string
        ctrl: { [key in string]: string; }
        trans: string
    }

    interface GComponent<D extends GcomponentGen = GcomponentGen> extends fgui.GObject {

        tm2<T extends fgui.GComponent = fgui.GComponent>(name1: D["com"] | string, name2?: D["com"] | string, name3?: D["com"] | string): T;

        tm<T extends fgui.GObject >(name1: D["com"], name2?: D["com"], name3?: D["com"]): T;
        tmone<T extends fgui.GComponent>(name: D["com"]): T;
        tmc<K extends keyof D['ctrl']>(ctrlName: K): Controller;
        tmt(transName: D["trans"]): fgui.Transition;

        setSelectedIndex<K extends keyof D['ctrl']>(ctrlName: K, index: number);
        getSelectedIndex<K extends keyof D['ctrl']>(ctrlName: K): number;
        setSelectedPage<K extends keyof D['ctrl'], C extends D['ctrl']>(ctrlName: K, page: C[K]);
        getSelectedPage<K extends keyof D['ctrl'], C extends D['ctrl']>(ctrlName: K): C[K];

        doAfterAddChild(item: any): void;
        doRmoveChild(item: any, isRecursion: boolean = true): void;


        toFull(parentSize?: boolean): GComponent;
        toCenter(offsetX?: number, offsetY?: number): GComponent;
        toFullCenter(offsetX?: number, offsetY?: number): GComponent;

        toParent(parent: fairygui.GComponent): GComponent;
        toFullParent(parent: fairygui.GComponent): GComponent;
        toCenterParent(parent: fairygui.GComponent, offsetX?: number, offsetY?: number): GComponent;
        toFullCenterParent(parent: fairygui.GComponent, offsetX?: number, offsetY?: number): GComponent;
    }
}


declare namespace fgui {
    interface GObject {

        setUserData(key: string, value: any);
        getUserData(key: string): any;
        deleteUserData(key: string): any;
        cleanUserData(): any;

        toFull(): GObject;
        toCenter(offsetX?: number, offsetY?: number): GObject;
        toFullCenter(offsetX?: number, offsetY?: number): GObject;

        toParent(parent: fairygui.GComponent): GObject;
        toFullParent(parent: fairygui.GComponent): GObject;
        toCenterParent(parent: fairygui.GComponent, offsetX?: number, offsetY?: number): GObject;
        toFullCenterParent(parent: fairygui.GComponent, offsetX?: number, offsetY?: number): GObject;

        setOn(type: string, listener: Function, thisObj: any, useCapture?: boolean): void;
        removeOn(type: string, listener?: Function, thisObj?: any, useCapture?: boolean): void;
        setClick(listener: Function, thisObj: any, clickEffect: boolean = true, clickCooldown?: number): void;
        removeClick(listener?: Function, thisObj?: any): void;

        /**
         * 设置长按点击事件
         * @param onClickItem 回调
         * @param caller 调用对象
         * @param delay 按下时长判断为长按事件，默认0.5秒，外面传递毫秒
         * com.setLongPress(this.test,this)
         * com.setLongPress(this.test,this,500)
         */
        setLongPress(onClickItem: () => void, caller: { destroyed: boolean }, delay?: number)
        removeLongPress(onClickItem?: () => void, caller?: { destroyed: boolean })
        onLongPressTouchStart(evt: fgui.Event)
        onLongPressTouchEnd(evt: fgui.Event)
        onTick(dt: number)
        private _maxWaitLongPress
        private _waitLongPress: number
        private _lastPutTime: number
        private _longPressDown: boolean

        initByAddChild(): void;
        doBeforeRemoveChild(): void;
        destroy(): void;
        destroyed: boolean;

        resourceURL2: string;
        resourceObjName: string;
        createVisible: boolean;

        /**
         * 移除方式, 创建的组件根据这个值,移除的时候是加池,还是销毁
         * 默认空或destroy就是销毁,pool就放入内存池
         */
        removeType: "destroy" | "pool"

        /**销毁时回调，用来移除引用 */
        _setOnDisposeClearRef(callback: Function)
        _onDisposeClearRef()

        
        /**禁止手动修改text */
        set text(value: never)
        get text(): string
        /**
         * 设置颜色
         */
        public setColor(color:cc.Color):void
        /**
         * 设置文本，默认翻译
         * @param str 允许类似 "{0}年{1}月{2}日"
         * @param arg 格式化 类似 "2018","2","14"
         */
        public setText(str: string|number, ...arg:(string|number)[]);
         /**
          * 设置数值，默认保留2位小数
          * @param num 
          * @param fractionDigits 保留小数，默认2
          */
        public setNumber(num:string|number, fractionDigits?:number)
         /**
          * 设置大数，默认保留2位小数
          * @param num 
          * @param fractionDigits 保留小数，默认2
          */
        public setBigNumber(num:string|number, fractionDigits?:number)
    }
}

type FguiRemoveType = fgui.GObject["removeType"];

declare module fgui {
    interface UIPackage {
        sprites: any;
        items: any;
    }
}

declare module fgui {
    interface GList {
        public setItemData(itemInfoList: any);
        public getItemData(index: number);
        public getClickIndex(): number;
        public getClickData(): any;
        public itemRendererWrap: (index: number, item: GObject) => void;
        public itemProviderWrap: (index: number) => string;
        public onClickItemWrap: (item: GObject) => void;
        public init(caller?: { destroyed: boolean }, itemRenderer?: (index: number, item: GObject, data: any) => void, onClickItem?: (index: number, item: GObject, data: any) => void, itemProvider?: (index: number, itemInfo: any) => string);
        public initVirtualList(caller?: { destroyed: boolean }, itemRenderer?: (index: number, item: GObject, data: any) => void, onClickItem?: (index: number, item: GObject, data: any) => void, itemProvider?: (index: number, itemInfo: any) => string);
        public update(itemInfoList?: any[], itemCount?: number, minSize?: number, offsetSize?: number);
        public update2(numItems: number, itemInfoList?: any[], itemCount?: number, minSize?: number, offsetSize?: number);
        public clear();
        public updateShowItem(itemRenderer?: (index: number, item: fgui.GObject, data: any) => void, caller?: { destroyed: boolean });
        public curLineItemCount
        public curLineItemCount2
    }
}

declare module fgui {
    interface ScrollPane {
        set vtScrollBar(vtScrollBar: GScrollBar);
        public setVtScrollBar(vtScrollBar: GScrollBar);
    }
}

declare namespace fgui {
    interface GButton {
        
        /**禁止手动修改text */
        set text(value: never)
        get text(): string
        public soundCustom: string;
    }
}
declare namespace fgui {
    interface Transition {
        public getTransitionTime(): number;
    }
}
declare namespace fgui{
    interface TextField{
        /**禁止手动修改text */
        set text(value: never)
        get text(): string
    }
    }

