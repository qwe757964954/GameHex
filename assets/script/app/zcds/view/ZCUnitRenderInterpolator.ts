interface IZCUnitRenderSample {
    time: number;
    fromX: number;
    fromY: number;
    x: number;
    y: number;
}

export interface IZCUnitRenderPosition {
    readonly id: number;
    readonly freeX: number;
    readonly freeY: number;
}

export interface IZCUnitRenderTime {
    readonly simulationStepSeconds: number;
    readonly interpolationAlpha: number;
    readonly snapshot: Readonly<{ elapsedSeconds: number }>;
}

/** 单位逻辑采样点之间的纯表现插值；长帧、回退时间和实体回收都不会跨段插值。 */
export class ZCUnitRenderInterpolator {
    private readonly samples = new Map<number, IZCUnitRenderSample>();
    private readonly position = { x: 0, y: 0 };

    positionOf(
        unit: IZCUnitRenderPosition,
        frame: IZCUnitRenderTime,
        currentX = unit.freeX,
        currentY = unit.freeY,
    ): Readonly<{ x: number; y: number }> {
        const x = currentX;
        const y = currentY;
        const time = frame.snapshot.elapsedSeconds;
        let sample = this.samples.get(unit.id);
        if (!sample || time < sample.time) {
            sample = { time, fromX: x, fromY: y, x, y };
            this.samples.set(unit.id, sample);
        } else if (time !== sample.time) {
            const continuous = time - sample.time <= frame.simulationStepSeconds + 1e-9;
            sample.fromX = continuous ? sample.x : x;
            sample.fromY = continuous ? sample.y : y;
            sample.x = x;
            sample.y = y;
            sample.time = time;
        }
        const alpha = frame.interpolationAlpha;
        this.position.x = sample.fromX + (sample.x - sample.fromX) * alpha;
        this.position.y = sample.fromY + (sample.y - sample.fromY) * alpha;
        return this.position;
    }

    forget(unitId: number): void {
        this.samples.delete(unitId);
    }

    clear(): void {
        this.samples.clear();
    }
}
