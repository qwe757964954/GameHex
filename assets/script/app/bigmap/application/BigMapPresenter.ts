/** 兼容旧调用方的导出路径；运行时只保留一份 Model 实现。 */
export * from './BigMapModel';
export { BigMapModel as BigMapPresenter, type IBigMapModelDeps as IBigMapPresenterDeps } from './BigMapModel';
