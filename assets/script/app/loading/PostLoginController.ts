import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { GameRoute } from '../../core/runtime/GameRoute';
import { MAIN_LOADING_EVENTS, type IMainLoadingProgress } from '../main/MainLoadingEvents';
import { normalizedProgress, postLoginProgress, POST_LOGIN_ERROR_MESSAGE } from './PostLoginContract';

export interface IPostLoginControllerOptions {
    readonly startRatio: number;
    readonly failed: (error: unknown) => void;
    readonly session: {
        readonly prepare: (report: (progress: { readonly ratio: number }) => void) => Promise<void>;
        readonly bootstrapIdentity: (params: unknown) => void;
        readonly initAudio: () => void;
    };
    readonly view: {
        readonly setProgress: (ratio: number) => void;
        readonly setStatus: (message: string) => void;
    };
    readonly navigation: {
        readonly navigate: (route: string) => void;
    };
}
export class PostLoginController extends ControllerBase {
    private started = false;
    private navigating = false;
    private ready = false;
    get mainReady(): boolean { return this.ready; }
    constructor(context: IControllerContext, private readonly options: IPostLoginControllerOptions) { super(context, 'post-login'); }
    async start(params?: unknown): Promise<void> {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(MAIN_LOADING_EVENTS.PROGRESS, this.onMainProgress);
        this.listen(MAIN_LOADING_EVENTS.FAILED, this.onMainFailed);
        this.options.view.setStatus('正在加载游戏资源…');
        this.options.view.setProgress(normalizedProgress(this.options.startRatio));
        try {
            this.options.session.bootstrapIdentity(params);
            this.options.session.initAudio();
            await this.options.session.prepare(progress => {
                if (this.isDisposed) return;
                this.options.view.setProgress(postLoginProgress(this.options.startRatio, 'session', progress.ratio));
            });
            if (this.isDisposed) return;
            this.navigating = true;
            this.options.navigation.navigate(GameRoute.Main);
        } catch (error) {
            if (this.isDisposed) return;
            this.options.failed(error);
            this.options.view.setStatus(POST_LOGIN_ERROR_MESSAGE);
        }
    }
    private onMainProgress({ ratio }: IMainLoadingProgress): void {
        this.ready = this.navigating && normalizedProgress(ratio) === 1;
        this.options.view.setProgress(postLoginProgress(this.options.startRatio, 'main', ratio));
    }
    private onMainFailed(): void {
        this.ready = false;
        this.options.view.setStatus(POST_LOGIN_ERROR_MESSAGE);
    }
}
