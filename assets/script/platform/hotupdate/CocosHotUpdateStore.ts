import { sys } from 'cc';
import type { HotUpdateManifest, HotUpdateStoredState, HotUpdateStore } from '../../core/update/HotUpdateTypes';

const STORAGE_KEY = 'city1001.hotupdate.state.v1';

export class CocosHotUpdateStore implements HotUpdateStore {
    read(): HotUpdateStoredState {
        const stored = this.readUnsafe();
        if (stored?.clientId) return stored;
        const initial: HotUpdateStoredState = { clientId: this.createClientId() };
        this.write(initial);
        return initial;
    }

    commit(manifest: HotUpdateManifest): HotUpdateStoredState {
        const current = this.read();
        const next: HotUpdateStoredState = {
            clientId: current.clientId,
            activeManifest: manifest,
            previousManifest: current.activeManifest?.releaseId === manifest.releaseId
                ? current.previousManifest
                : current.activeManifest,
        };
        this.write(next);
        return next;
    }

    private readUnsafe(): HotUpdateStoredState | null {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const value = JSON.parse(raw) as HotUpdateStoredState;
            if (!value || typeof value !== 'object' || typeof value.clientId !== 'string') return null;
            return value;
        } catch (error) {
            console.warn('[HotUpdateStore] 本地状态损坏，已忽略', error);
            return null;
        }
    }

    private write(value: HotUpdateStoredState): void {
        sys.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    }

    private createClientId(): string {
        const random = Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, '0');
        return `${Date.now().toString(36)}-${random}`;
    }
}
