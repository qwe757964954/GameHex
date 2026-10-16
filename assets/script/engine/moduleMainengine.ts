import { EngineMain } from "./EngineMain";

(function () {
    let engine = new EngineMain();
    engine.init();
    EngineMain.instance = engine;
    console.log("module finish engine")
})();
console.log("module end engine")
