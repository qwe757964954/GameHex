import type { AssetService } from '../asset/AssetService';
import type { SessionAssetService } from '../asset/SessionAssetService';
import type { ConfigService } from '../config/ConfigService';
import type { NetworkTransport } from '../network/NetworkTransport';
import type { ICallbackOwnerRegistry } from './CallbackOwner';

/** 启动时一次性装配的跨模块服务。 */
export interface GameContext {
    readonly assets: AssetService;
    readonly sessionAssets: SessionAssetService;
    readonly configs: ConfigService;
    readonly network: NetworkTransport;
    readonly callbackOwners?: ICallbackOwnerRegistry;
}
