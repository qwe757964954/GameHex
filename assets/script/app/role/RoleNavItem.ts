import { _decorator, Button, CCInteger, Component } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { RoleEvent } from './RoleEvents';
import type { RoleNavId } from './RoleTypes';

const { ccclass, property } = _decorator;

/**
 * 角色页左侧导航的一格（挂 `ui/Role/Role.prefab` 的 `NavHero` / `NavMilitia` / … / `NavLeaderSkill`）。
 *
 * 这一格只做一件事：点击时把 `navId` 派发出去。由本组件自己绑 CLICK，
 * 宿主 `RolePage` 不再按节点名遍历、取 Button、再绑一次（节点名与 navId 的对应关系放在 Inspector 里）。
 *
 * `navId` 是数据，**不从节点名反推** —— 改名 / 换序都不会静默错位。
 */
@ccclass('RoleNavItem')
export class RoleNavItem extends Component {
    @property({ type: CCInteger, tooltip: '导航 id：1 武将 / 2 民兵 / 3 共鸣 / 4 近卫 / 5 预览 / 6 宝物 / 7 主公技' })
    navId: RoleNavId = 1;

    protected onLoad(): void {
        this.node.on(Button.EventType.CLICK, this.onClick, this);
    }

    private onClick = (): void => {
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'nav', navId: this.navId });
    };
}
