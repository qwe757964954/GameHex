/**
* PathUtils 
*/
export class PathUtils {
    static __cname: string = "PathUtils";
    static join(...args:string[]){
        return args.map(v=>v.endsWith("/") ? v.slice(0,-1) : v).join("/")
    }

    static basename(filepath){
        let arr = filepath.split("/")
        return arr.pop()
    }
}