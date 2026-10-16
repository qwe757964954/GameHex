import { Group } from "./Group";

export abstract class GroupSet extends Group {

    ids: Set<number> = new Set()

    getIds() {
        return this.ids
    }

    onAddEntity(entityId: number) {
        this.ids.add(entityId)
    }
    onRemoveEntity(entityId: number) {
        this.ids.delete(entityId)
    }
    onStart() {

    }
    protected onDestroy() {
        this.ids = null
    }

}