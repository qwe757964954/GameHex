import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

class FakeNode {
    active = true;
    angle = 0;
    parent: FakeNode | null = null;

    constructor(readonly name: string) {}

    setParent(parent: FakeNode): void {
        this.parent = parent;
    }

    on(): void {}
}

class FakeComponent {
    node = new FakeNode('Panel');
}

class FakeButton extends FakeComponent {
    static readonly EventType = { CLICK: 'click' };
    interactable = true;
}

class FakeLabel extends FakeComponent {
    string = '';
}

test('detail hides the start label and disables the button while loading, then restores', () => {
    const source = readFileSync('assets/script/app/territory/view/TerritorySiteDetailPanel.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        experimentalDecorators: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: moduleExports,
        require: (id: string) => {
            if (id === './TerritoryEvents') {
                return {
                    TERRITORY_EVENTS: {
                        DETAIL_CLOSE: 'territory:detail-close',
                        DETAIL_START: 'territory:detail-start',
                    },
                };
            }
            if (id !== 'cc') throw new Error(`Unexpected dependency: ${id}`);
            return {
                _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
                Button: FakeButton,
                Component: FakeComponent,
                Label: FakeLabel,
            };
        },
    });
    const Panel = moduleExports.TerritorySiteDetailPanel as new () => {
        node: FakeNode;
        titleLabel: FakeLabel;
        subtitleLabel: FakeLabel;
        infoLabel: FakeLabel;
        startLabel: FakeLabel;
        startButton: FakeButton;
        open(content: { title: string; subtitle: string; info: string; canStart: boolean;
            startCaption: string; startEnabled: boolean; isLoading: boolean }): void;
        close(): void;
    };
    const panel = new Panel();
    panel.titleLabel = new FakeLabel();
    panel.subtitleLabel = new FakeLabel();
    panel.infoLabel = new FakeLabel();
    panel.startLabel = new FakeLabel();
    panel.startButton = new FakeButton();
    const normal = { title: '关卡', subtitle: '', info: '', canStart: true,
        startCaption: '开战', startEnabled: true, isLoading: false };
    panel.open(normal);
    assert.equal(panel.startLabel.node.active, true);
    assert.equal(panel.startButton.interactable, true);
    panel.open({ ...normal, startCaption: '正在解锁…', startEnabled: false, isLoading: true });
    assert.equal(panel.startLabel.node.active, false);
    assert.equal(panel.startButton.interactable, false);
    panel.close();
    panel.open(normal);
    assert.equal(panel.startLabel.node.active, true);
});
