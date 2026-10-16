import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('断线先弹顶层共用弹窗，确认后才走 Socket + 角色登录恢复链', () => {
    const gameNet = readFileSync('assets/script/app/net/GameNet.ts', 'utf8');

    assert.match(gameNet, /addListener\('trtReconnect', this, this\.onTransportDisconnected\)/);
    assert.match(gameNet, /CommonTips\.open\(\{/);
    assert.match(gameNet, /layer:\s*PopupLayer\.TOP/);
    assert.match(gameNet, /closeOnBlank:\s*false/);
    assert.match(gameNet, /showCancel:\s*false/);
    assert.match(gameNet, /showClose:\s*false/);
    assert.match(gameNet, /content:\s*'检测到网络已断开，重新连接!'/);
    assert.match(gameNet, /onSure:\s*\(\) => \{ void this\.reconnectAndLogin\(\); \}/);

    const socketReconnect = gameNet.indexOf("netSocket.reconnect('reconnect')");
    const roleRelogin = gameNet.indexOf('const result = await login()', socketReconnect);
    const resumeRequests = gameNet.indexOf("execute('reconnectSuccessAndLogin')", roleRelogin);
    assert.ok(socketReconnect >= 0, '确定按钮必须发起 Socket 重连');
    assert.ok(roleRelogin > socketReconnect, 'Socket 连回后必须再做角色登录');
    assert.ok(resumeRequests > roleRelogin, '角色登录成功后才能恢复积压请求');
});

test('角色重登录明确携带 reconnect=true，首次登录仍为 false', () => {
    const loginRoot = readFileSync('assets/script/app/login/LoginRoot.ts', 'utf8');

    assert.match(loginRoot, /this\.playerLogin\(net, user, session, false\)/);
    assert.match(
        loginRoot,
        /configureReconnectLogin\(\(\) => this\.playerLogin\(net, user, session, true\)\)/,
    );
    assert.match(loginRoot, /\breconnect,\s*\n\s*openid:/);
});

test('网络错误只请求弹窗，不再绕过确认自动切换 reconnect 状态', () => {
    const connectedState = readFileSync('assets/script/framework/net/state/ConnectedNetState.ts', 'utf8');
    const method = connectedState.slice(connectedState.indexOf('async SwitchToReconnectNetState()'));

    assert.match(method, /showDisconnectDialog/);
    assert.match(method, /execute\("trtReconnect"\)/);
    assert.doesNotMatch(method.slice(0, 500), /socket\.switchTo\("reconnect"/);
});
