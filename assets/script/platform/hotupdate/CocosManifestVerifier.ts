import type {
    IHotUpdateManifest,
    IHotUpdateManifestVerifier,
    IHotUpdateReleasePointer,
} from '../../core/update/HotUpdateTypes';

type VerifyHook = (payload: string, signature: string, keyId?: string) => boolean | Promise<boolean>;

/**
 * 签名验证桥：正式环境把 Ed25519 实现挂到 globalThis.__CITY1001_VERIFY_HOT_UPDATE__。
 * 没有验签器时，只有显式开启 allowUnsignedManifests 的环境可以继续。
 */
export class CocosManifestVerifier implements IHotUpdateManifestVerifier {
    constructor(private readonly allowUnsignedManifests: boolean) { }

    async verify(pointer: IHotUpdateReleasePointer, manifest: IHotUpdateManifest): Promise<boolean> {
        if (!pointer.signature) return this.allowUnsignedManifests;
        const hook = (globalThis as {
            __CITY1001_VERIFY_HOT_UPDATE__?: VerifyHook;
        }).__CITY1001_VERIFY_HOT_UPDATE__;
        if (!hook) return this.allowUnsignedManifests;
        const payload = canonicalJson({
            pointer: {
                schemaVersion: pointer.schemaVersion,
                releaseId: pointer.releaseId,
                manifestUrl: pointer.manifestUrl,
                manifestSha256: pointer.manifestSha256,
                keyId: pointer.keyId,
                rolloutPercentage: pointer.rolloutPercentage,
                rolloutSalt: pointer.rolloutSalt,
            },
            manifest,
        });
        return await hook(payload, pointer.signature, pointer.keyId);
    }
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
}
