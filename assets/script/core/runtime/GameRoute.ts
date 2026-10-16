/** 应用级页面/阶段标识。业务页面只依赖路由，不依赖具体 Procedure 类。 */
export enum GameRoute {
    Update = 'update',
    Login = 'login',
    PostLogin = 'post-login',
    Main = 'main',
    Matching = 'matching',
    Battle = 'battle',
}
