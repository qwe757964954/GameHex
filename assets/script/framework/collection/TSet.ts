

import { TMap } from './TMap';

export class TSet<V> {
	static __cname: string = "TSet";

	map: TMap<V, boolean>
	constructor() {
		this.map = new TMap<V, boolean>()
	}

	get values(): V[] {
		return this.map.keys
	}

	get length(): number {
		return this.map.keys.length
	}

	add(v: V) {
		this.map.set(v, true)
	}

	remove(v: V) {
		this.map.remove(v)
	}

	has(v: V) {
		return this.map.get(v) != null
	}

	clear() {
		this.map.clear()
	}
}