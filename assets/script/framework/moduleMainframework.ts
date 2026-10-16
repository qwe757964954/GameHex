import { UpdateBeat } from "./utils/UpdateBeat";

(function () {
    window["frameworkUpdate"] = function (dt: number) {
        UpdateBeat.loop(dt);
    }
    console.log("module finish framework")
})();
console.log("module end framework")
