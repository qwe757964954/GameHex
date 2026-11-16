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

/** 单位逻辑采样点之间的插值；长帧、时间回退和实体回收都不跨段插。*/
export class ZCUnitRenderInterpolator {
    private readonly samples = new Map<number, IZCUnitRenderSample>();
    private readonly position = { x: 0, y: 0 };

    positionOf(
        unit: IZCUnitRenderPosition,
        frame: IZCUnitRenderTime,
        currentX = unit.freeX,
        currentY = unit.freeY,
    ): Readonly<{ x: number; y: number }> {
        const time = frame.snapshot.elapsedSeconds;
        let sample = this.samples.get(unit.id);
        if (!sample || time < sample.time) {
            sample = { time, fromX: currentX, fromY: currentY, x: currentX, y: currentY };
            this.samples.set(unit.id, sample);
        } else if (time !== sample.time) {
            const continuous = time - sample.time <= frame.simulationStepSeconds + 1e-9;
            // 超过一个逻辑帧就当跳变，从当前位置重新起段，避免拉出一条长线。
            sample.fromX = continuous ? sample.x : currentX;
            sample.fromY = continuous ? sample.y : currentY;
            sample.x = currentX;
            sample.y = currentY;
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
