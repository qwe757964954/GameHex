/** Chat 招募行自己态/他人态摆位夹具：生产侧已改成 RowTemplate 的 SelfLayout marker。 */
export interface IPoint {
    readonly x: number;
    readonly y: number;
}

export interface IRecruitLayout {
    readonly background: IPoint;
    readonly head: IPoint;
    readonly name: IPoint;
    readonly infoGroup: IPoint;
    readonly nameAlign: 'left' | 'right';
}

export function recruitLayout(isSelf: boolean): IRecruitLayout {
    return isSelf
        ? {
            background: { x: -61, y: -16 },
            head: { x: 202, y: 31.5 },
            name: { x: 103, y: 111 },
            infoGroup: { x: -50.5, y: 5 },
            nameAlign: 'right',
        }
        : {
            background: { x: 62, y: -16 },
            head: { x: -204, y: 31.5 },
            name: { x: -97, y: 111 },
            infoGroup: { x: 74.5, y: 5 },
            nameAlign: 'left',
        };
}
