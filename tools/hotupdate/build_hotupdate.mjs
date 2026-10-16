import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const required = ['input', 'output', 'platform', 'channel', 'release', 'client-version', 'base-url'];
for (const name of required) {
    if (!args[name]) fail(`缺少 --${name}`);
}

const platform = args.platform;
if (!['web', 'wechat', 'douyin', 'android', 'ios'].includes(platform)) fail(`不支持的平台：${platform}`);
for (const name of ['channel', 'release']) {
    if (!/^[A-Za-z0-9._-]+$/.test(args[name])) fail(`--${name} 只能包含字母、数字、点、下划线和连字符`);
}
const input = args.input;
const output = args.output;
const baseUrl = args['base-url'].replace(/\/+$/, '');
try {
    const parsedBaseUrl = new URL(baseUrl);
    if (parsedBaseUrl.protocol !== 'https:' && parsedBaseUrl.protocol !== 'http:') throw new Error();
} catch {
    fail(`--base-url 必须是 HTTP(S) URL：${baseUrl}`);
}
const rolloutPercentage = Number(args.rollout ?? 100);
if (!Number.isFinite(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100) {
    fail('--rollout 必须是 0 到 100 之间的数字');
}
const startupBundles = new Set((args['startup-bundles'] ?? 'remoteRef').split(',').map((item) => item.trim()).filter(Boolean));
const bundleDirs = (await readdir(input, { withFileTypes: true })).filter((entry) => entry.isDirectory());
if (!bundleDirs.length) fail(`没有在 ${input} 找到 Bundle 目录`);

const bundles = {};
for (const entry of bundleDirs) {
    const bundleRoot = join(input, entry.name);
    const files = await collectFiles(bundleRoot);
    const configFiles = files.filter((file) => /^(?:cc\.)?config\.[A-Za-z0-9_-]+\.json$/.test(basename(file)));
    if (!configFiles.length) {
        fail(`Bundle ${entry.name} 缺少 config.<hash>.json；请在 Creator 正式构建中开启 MD5 Cache`);
    }
    if (configFiles.length > 1) {
        fail(`Bundle ${entry.name} 存在多个 config.<hash>.json；请清理旧构建目录后重新构建`);
    }
    const configFile = configFiles[0];
    const match = /^(?:cc\.)?config\.([A-Za-z0-9_-]+)\.json$/.exec(basename(configFile));
    const plainIndex = files.find((file) => basename(file) === 'index.js');
    if (plainIndex) {
        fail(`Bundle ${entry.name} 的 index.js 未添加版本后缀；应命名为 index.${match[1]}.js`);
    }
    const versionedIndexes = files.filter((file) => /^index\.[A-Za-z0-9_-]+\.js$/.test(basename(file)));
    if (versionedIndexes.length > 1) {
        fail(`Bundle ${entry.name} 存在多个 index.<hash>.js`);
    }
    if (versionedIndexes.length === 1 && basename(versionedIndexes[0]) !== `index.${match[1]}.js`) {
        fail(`Bundle ${entry.name} 的 config 与 index 版本后缀不一致`);
    }
    const bytes = await Promise.all(files.map(async (file) => (await stat(file)).size));
    bundles[entry.name] = {
        url: `${baseUrl}/${platform}/${args.release}/${entry.name}`,
        version: match[1],
        requiredAt: startupBundles.has(entry.name) ? 'startup' : 'onDemand',
        dependencies: [],
        size: bytes.reduce((sum, value) => sum + value, 0),
    };
}
for (const bundleName of startupBundles) {
    if (!bundles[bundleName]) fail(`启动 Bundle ${bundleName} 不在构建产物中`);
}

const manifest = {
    schemaVersion: 1,
    releaseId: args.release,
    platform,
    channel: args.channel,
    minClientVersion: args['client-version'],
    createdAt: new Date().toISOString(),
    bundles,
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestSha256 = createHash('sha256').update(manifestText).digest('hex');
const manifestUrl = `${baseUrl}/${platform}/${args.release}/manifest.json`;
const latest = {
    schemaVersion: 1,
    releaseId: args.release,
    manifestUrl,
    manifestSha256: `sha256:${manifestSha256}`,
    rolloutPercentage,
    rolloutSalt: args['rollout-salt'] ?? args.release,
};

await mkdir(output, { recursive: true });
await writeFile(join(output, 'manifest.json'), manifestText, 'utf8');
await writeFile(join(output, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`, 'utf8');
await writeFile(join(output, 'release-report.json'), `${JSON.stringify({
    platform,
    releaseId: args.release,
    manifestSha256,
    bundleCount: Object.keys(bundles).length,
    totalBytes: Object.values(bundles).reduce((sum, bundle) => sum + bundle.size, 0),
    bundles,
}, null, 2)}\n`, 'utf8');

console.log(`已生成 ${platform} / ${args.release} 热更新清单：${output}`);
console.log('当前清单未签名；正式发布前必须由外部签名步骤写入 signature 与 keyId。');

async function collectFiles(root) {
    const result = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) result.push(...await collectFiles(path));
        else if (entry.isFile()) result.push(path);
    }
    return result;
}

function parseArgs(values) {
    const result = {};
    for (let index = 0; index < values.length; index += 1) {
        const item = values[index];
        if (!item.startsWith('--')) fail(`未知参数：${item}`);
        const [rawName, inlineValue] = item.slice(2).split('=', 2);
        const value = inlineValue ?? values[++index];
        if (value == null || value.startsWith('--')) fail(`--${rawName} 缺少值`);
        result[rawName] = value;
    }
    return result;
}

function fail(message) {
    console.error(message);
    console.error('示例：node tools/hotupdate/build_hotupdate.mjs --input build/wechatgame/remote --output outputs/hotupdate/wechat/r1 --platform wechat --channel dev --release r1 --client-version 0.6.0.0 --base-url https://cdn.example.com/hotupdate');
    process.exit(1);
}
