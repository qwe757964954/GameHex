import { createServer, get } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { normalizeTerritoryMap, TerritoryValidationError } from './formats/territory-format.js';
import { BigmapValidationError, normalizeBigmapLayout } from './formats/bigmap-format.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const presetDir = join(root, 'presets');
const territoryPresetDir = join(root, 'presets', 'territory');
// 大地图布局预设（编辑器保存到这里；发布时才写 assets）。
const bigmapPresetDir = join(root, 'presets', 'bigmap');
// 场景装饰贴图目录（相对游戏 resources）：资源名写进 art.freeDecor[].art。
const resourcesDir = join(root, '..', '..', 'assets', 'resources');
const territoryResourceDir = join(resourcesDir, 'config', 'territory-maps');
const bigmapResourceDir = join(resourcesDir, 'config', 'bigmap-maps');
const remoteRefDir = join(root, '..', '..', 'assets', 'remoteRef');
const territoryAssetDir = join(resourcesDir, 'image', 'territory');
const decorDir = join(resourcesDir, 'image', 'decor');
const mapResourceDir = join(resourcesDir, 'image', 'map-resource');
/**
 * 编辑器专用的资源图标回退（这两类在对局中不是静态图：unit_cap 是格内中立兵、
 * artifact_charge 是玩家本局携带的神器）。map-resource 目录没出图时，用工程内
 * 已有图标让编辑器显示成与对局一致的图标，而不是文字。
 */
const mapResourceFallback = {
  unit_cap: join(resourcesDir, 'image', 'buildings', 'barracks-peashooter.png'),
  artifact_charge: join(resourcesDir, 'image', 'artifact', '阿哈利姆神杖.png'),
};
/** 装饰资源名的固定前缀（相对 resources、不带扩展名）。 */
const decorPrefix = 'image/decor/';
const mapResourcePrefix = 'image/map-resource/';
/**
 * 棋盘背景图的资源前缀。`art.background` 存的是 `image/<名字>`（相对 resources、不带扩展名），
 * 与游戏里 `resources.load` 取的是**同一个文件** —— 编辑器里看到的衬底就是局内那张，
 * 策划摆装饰时不必靠脑补。默认值是 `image/zdbg1`。
 */
const backgroundPrefix = 'image/';
/**
 * 自定义装饰资源名（美术还没出图时也能先摆）的持久化文件，写在编辑器目录下：
 * 刷新页面 / 换浏览器都还在，不用每次重新定义。只增不减 —— 要删直接编辑这个文件。
 */
const decorNamesFile = join(root, 'decor-library.json');
const port = Number(process.env.MAP_EDITOR_PORT || 8787);
const address = `http://127.0.0.1:${port}/`;
const idPattern = /^[a-zA-Z0-9_-]+$/;

/**
 * 客户端输入校验失败 ⇒ 400。
 *
 * 以前是靠 `message.includes('必须') || ('地图') || ('预设') || ('自由装饰')` 猜：
 * 新写一句报错文案只要没带这几个字，就会被当成 500，前端提示变成"服务不可用"，
 * 查起来是"明明只是填错了一个数"（这种坑留过一次就够了）。现在按**类型**判。
 */
class RequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestError';
    this.statusCode = 400;
  }
}

/**
 * 原子写 JSON：先写 `<target>.writing`，再 rename 覆盖。
 *
 * `writeFile` 是「截断 → 写入」两步：中途崩了 / 断电 / 进程被杀，留下的是**半截 JSON**，
 * 编辑器再打开直接 parse 错，那一版图就没了（SVN 能 revert，但丢的是刚刚那次编辑）。
 * 同分区 rename 是原子的 —— 要么旧文件完好，要么新文件完整，不会有中间态。
 */
async function writeJsonAtomic(target, value) {
  const temp = `${target}.writing`;
  const text = JSON.stringify(value, null, 2) + '\n';
  await writeFile(temp, text, 'utf8');
  try {
    await rename(temp, target);
  } catch (error) {
    // Windows 上目标被占用（编辑器预览 / 杀软扫描）时 rename 会 EPERM/EBUSY，等一下重试一次。
    if (error.code !== 'EPERM' && error.code !== 'EBUSY') {
      await unlink(temp).catch(() => {});
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    try {
      await rename(temp, target);
    } catch (again) {
      await unlink(temp).catch(() => {});
      throw again;
    }
  }
}
const shouldOpen = process.argv.includes('--open');
// 三个编辑器共用一个服务，用启动参数决定打开哪个页面（各自的 .cmd 里带这个开关）。
const launchPath = process.argv.includes('--bigmap') ? 'bigmap.html'
  : process.argv.includes('--territory') ? 'territory.html' : '';

function openBrowser() {
  if (!shouldOpen || process.platform !== 'win32') return;
  spawn('cmd.exe', ['/c', 'start', '', address + launchPath], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
}

function runningEditor() {
  return new Promise((resolve) => {
    const request = get(address + 'api/presets', { timeout: 2000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (part) => { body += part; });
      response.on('end', () => {
        try { resolve(response.statusCode === 200 && Array.isArray(JSON.parse(body).presets)); }
        catch { resolve(false); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

/**
 * 端口上那个服务认不认这个页面。
 *
 * 光判断「有人在监听」不够：端口上可能是**加这个页面之前**的旧进程，
 * 它会把 `/bigmap.html` 走到兜底返回 `{"error":"页面或预设不存在"}` ——
 * 用户看到的是一个 JSON 报错，而终端只写「已在运行」，根本查不到原因。
 */
function servesPage(page) {
  return new Promise((resolve) => {
    const request = get(address + page, { timeout: 2000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

/**
 * 扫装饰贴图目录，返回可直接写进 art.freeDecor[].art 的资源名（相对 resources、不带扩展名）。
 * 目录不存在就返回空数组 —— 编辑器允许先手填资源名占位，出图后自动进清单。
 */
async function listDecor(dir, prefix, out) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await listDecor(join(dir, entry.name), `${prefix}${entry.name}/`, out);
      continue;
    }
    if (!/\.(png|jpe?g)$/i.test(entry.name)) continue;
    out.push(`${prefix}${entry.name.replace(/\.[^.]+$/, '')}`);
  }
}

/**
 * 读图片原始像素尺寸（PNG 头 / JPEG SOF 段），不依赖第三方库。
 * 编辑器新摆装饰时用它做 1:1 默认尺寸 —— 工程里装饰就是按原始像素落地的
 * （`UITransform.setContentSize(item.width, item.height)`，1 渲染单位 = 1 像素）。
 * 解析失败（格式未知 / 文件残缺）返回 null，由调用方回退默认尺寸。
 */
async function readImageSize(file) {
  let handle;
  try {
    handle = await open(file, 'r');
    const probe = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
    const buf = bytesRead < probe.length ? probe.subarray(0, bytesRead) : probe;
    if (buf.length < 8) return null;
    // PNG：签名 8 字节 + IHDR（第 16 字节起宽高各 4 字节，big-endian）。
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
        && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) {
      if (buf.length < 24) return null;
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    // JPEG：`FF D8` 开头，跳过各标记段找 SOF（0xC0~0xCF 除 C4/C8/CC），
    // 段内 [精度 1B][高 2B][宽 2B]，宽高在段头偏移 +5 / +7。
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let i = 2;
      while (i + 9 <= buf.length) {
        if (buf[i] !== 0xFF) { i += 1; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF
            && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          const height = buf.readUInt16BE(i + 5);
          const width = buf.readUInt16BE(i + 7);
          return width > 0 && height > 0 ? { width, height } : null;
        }
        const segmentLength = buf.readUInt16BE(i + 2);
        if (segmentLength < 2) return null;
        i += 2 + segmentLength;
      }
    }
    return null;
  } catch { return null; }
  finally { if (handle) await handle.close().catch(() => {}); }
}

/** 资源名 → 磁盘上的贴图文件（自动试扩展名）；名字越界 / 文件不存在都返回 null。 */
async function findDecorFile(name) {
  const clean = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  // 只认 `image/decor/...`：这是唯一把磁盘路径交给浏览器的入口，必须挡住 `../`
  // 和指向别的资源目录的名字，否则一个 /decor/../config/maps/river 就能读到任意文件。
  if (!clean.startsWith(decorPrefix) || clean.includes('..')) return null;
  const relative = clean.slice(decorPrefix.length);
  if (!relative) return null;
  // 清单里的名字一律不带扩展名（listDecor 就是这么吐的），但策划手填时常会连 .png 一起写进来。
  // 先把带后缀的原名原样试一次，否则 `reef.png` 会被拼成 `reef.png.png` → 静默 404、画布上不出图。
  const candidates = /\.(png|jpe?g)$/i.test(relative)
    ? [relative]
    : ['.png', '.jpg', '.jpeg'].map((ext) => relative + ext);
  for (const candidate of candidates) {
    const file = join(decorDir, candidate);
    try { await stat(file); return file; }
    catch { /* 换下一个扩展名 */ }
  }
  return null;
}

async function findMapResourceFile(name) {
  const clean = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean.startsWith(mapResourcePrefix) || clean.includes('..')) return null;
  const relative = clean.slice(mapResourcePrefix.length);
  if (!relative) return null;
  const candidates = /\.(png|jpe?g)$/i.test(relative)
    ? [relative]
    : ['.png', '.jpg', '.jpeg'].map((ext) => relative + ext);
  for (const candidate of candidates) {
    const file = join(mapResourceDir, candidate);
    try { await stat(file); return file; }
    catch { /* try next extension */ }
  }
  // 回退图标：unit_cap / artifact_charge。
  const fallback = mapResourceFallback[relative];
  if (fallback) {
    try { await stat(fallback); return fallback; }
    catch { /* 回退图缺失则 404 */ }
  }
  return null;
}

/**
 * 资源名 → 磁盘上的背景图（自动试扩展名）。背景图一律落在 `assets/resources/image/` 下，
 * 与装饰同一套防越界口径：只认 `image/` 前缀、挡 `..`，否则 `/bg/config/maps/river`
 * 就能读到工程里任意文件。
 */
async function findBackgroundFile(name) {
  const clean = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean.startsWith(backgroundPrefix) || clean.includes('..')) return null;
  const relative = clean.slice(backgroundPrefix.length);
  if (!relative) return null;
  const candidates = /\.(png|jpe?g)$/i.test(relative)
    ? [relative]
    : ['.png', '.jpg', '.jpeg'].map((ext) => relative + ext);
  for (const candidate of candidates) {
    const file = join(resourcesDir, 'image', candidate);
    try { await stat(file); return file; }
    catch { /* 换下一个扩展名 */ }
  }
  return null;
}

/** 读自定义装饰清单。文件不存在 / 内容坏掉都当空清单 —— 这份缓存不该拖垮编辑器。 */
async function readDecorNames() {
  try {
    const data = JSON.parse(await readFile(decorNamesFile, 'utf8'));
    return Array.isArray(data.decor)
      ? data.decor.filter((name) => typeof name === 'string' && name.trim())
      : [];
  } catch { return []; }
}

async function addDecorName(name) {
  const names = await readDecorNames();
  if (names.indexOf(name) < 0) names.push(name);
  await writeJsonAtomic(decorNamesFile, { decor: names });
  return names;
}

async function listTerritoryAssets(dir, prefix, out) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      await listTerritoryAssets(join(dir, entry.name), `${relative}/`, out);
      continue;
    }
    if (/\.(png|jpe?g|webp)$/i.test(entry.name)) out.push(relative.replace(/\.[^.]+$/, ''));
  }
}

async function readTerritoryPreset(id) {
  return normalizeTerritoryMap(JSON.parse(await readFile(join(territoryPresetDir, `${id}.json`), 'utf8')), id);
}

async function publishTerritoryPreset(id) {
  const { map, warnings } = await readTerritoryPreset(id);
  await mkdir(territoryResourceDir, { recursive: true });
  const target = join(territoryResourceDir, `${id}.json`);
  await writeJsonAtomic(target, map);
  const meta = `${target}.meta`;
  try { await stat(meta); }
  catch {
    await writeJsonAtomic(meta, { ver: '1.1.2', importer: 'json', imported: true, uuid: '', files: {} });
  }
  return { map, warnings, target: 'assets/resources/config/territory-maps' };
}

/** 读 remoteRef 配置表里的某个 id 列（`{k,v}` 压缩格式）；读不到返回 null（对账降级为跳过）。 */
async function readRefIdSet(tableName, idField) {
  try {
    const raw = JSON.parse(await readFile(join(remoteRefDir, `${tableName}.json`), 'utf8'));
    const keys = Array.isArray(raw?.k) ? raw.k : [];
    const index = keys.indexOf(idField);
    if (index < 0 || !Array.isArray(raw?.v)) return null;
    return new Set(raw.v.map((row) => Number(row[index])));
  } catch { return null; }
}

/** 把 `{k,v}` 压缩表解成对象数组；读不到返回 null。编辑器靠它拉城池/野怪清单。 */
async function readRefRows(tableName) {
  try {
    const raw = JSON.parse(await readFile(join(remoteRefDir, `${tableName}.json`), 'utf8'));
    const keys = Array.isArray(raw?.k) ? raw.k : [];
    if (!Array.isArray(raw?.v)) return null;
    return raw.v.map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index]])));
  } catch { return null; }
}

async function readBigmapPreset(id) {
  return normalizeBigmapLayout(JSON.parse(await readFile(join(bigmapPresetDir, `${id}.json`), 'utf8')));
}

/**
 * 大地图布局发布到客户端资源目录。
 *
 * 比领地多一道**与配置表对账**：布局里的城/怪必须在 `BigMap-*` 表里存在。
 * 少了这步，进游戏就是「图上有城、表里没数值」或「表里加了城、图上没有」，两边都不报错。
 */
async function publishBigmapPreset(id) {
  const { layout, warnings } = await readBigmapPreset(id);

  const cityIds = await readRefIdSet('bigmapCity', 'cityId');
  if (cityIds) {
    const missing = layout.cities.map((city) => city.cityId).filter((cityId) => !cityIds.has(cityId));
    if (missing.length > 0) {
      throw new BigmapValidationError(`布局里的城池 ${missing.join(',')} 不在 bigmapCity 中`);
    }
  }
  const monsterIds = await readRefIdSet('bigmapMonster', 'monsterId');
  if (monsterIds) {
    const missing = [...new Set(layout.monsters.map((monster) => monster.monsterId))]
      .filter((monsterId) => !monsterIds.has(monsterId));
    if (missing.length > 0) {
      throw new BigmapValidationError(`布局里的野怪 ${missing.join(',')} 不在 bigmapMonster 中`);
    }
  }

  await mkdir(bigmapResourceDir, { recursive: true });
  const target = join(bigmapResourceDir, `${id}.json`);
  await writeJsonAtomic(target, layout);
  const meta = `${target}.meta`;
  try { await stat(meta); }
  catch {
    await writeJsonAtomic(meta, { ver: '1.1.2', importer: 'json', imported: true, uuid: '', files: {} });
  }
  return { layout, warnings, target: 'assets/resources/config/bigmap-maps' };
}

function validatePreset(data, id) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.id !== id) throw new RequestError('地图 id 与文件名不一致');
  const version = data.version == null ? 1 : data.version;
  if (version !== 1 && version !== 2 && version !== 3) throw new RequestError('地图版本只支持 1、2 或 3');
  const rows = data.rows, columns = data.columns;
  const maxColumns = version >= 3 ? 60 : 30;
  if (!Number.isInteger(rows) || rows < 4 || rows > 60 || (version <= 2 && rows % 2) ||
      !Number.isInteger(columns) || columns < 4 || columns > maxColumns) {
    throw new RequestError(version >= 3 ? '地图尺寸必须为 4~60 列、4~60 行' : '地图尺寸必须为 4~30 列、4~60 偶数行');
  }
  const playerCount = data.playerCount == null ? 2 : data.playerCount;
  if (playerCount !== 2 && playerCount !== 3 && playerCount !== 4) throw new RequestError('对局人数必须是 2、3 或 4');
  const cityMode = data.cityMode == null ? 'fixed' : data.cityMode;
  if (cityMode !== 'fixed' && cityMode !== 'select') throw new RequestError('主城模式必须是 fixed（固定主城）或 select（自选主城）');
  const mirrorVertical = data.mirrorVertical === true;
  const mirrorHorizontal = data.mirrorHorizontal === true;
  if (data.mirror180 === true && (mirrorVertical || mirrorHorizontal)) {
    throw new RequestError('不能同时使用 180° 旋转镜像与上下 / 左右镜像');
  }
  // 3 人必须不镜像。与编辑器 app.js 的 forcedMirror 同口径 —— 这条约束在编辑器、网页服务、
  // 预设生成三处都要守，否则绕开编辑器就能塞进不合规的图。
  // 2 人**不锁**：上下镜像默认开、可自行关闭（策划摆非对称装饰时要关得掉）。关掉时 ascii 存整场，
  // 下面的 expectedRows 按 mirrorVertical 现算，两种都成立。
  const forcedMirror = playerCount === 3 ? { vertical: false, horizontal: false } : null;
  if (forcedMirror && (mirrorVertical !== forcedMirror.vertical
      || mirrorHorizontal !== forcedMirror.horizontal || data.mirror180 === true)) {
    throw new RequestError('3 人地图必须关闭镜像（3 是奇数，翻转配不出第三块分区）');
  }
  // 2 人的 180° 与"锁不锁镜像"无关，单独拦：它把 1 区转到对角，不是上下对折。
  if (playerCount === 2 && data.mirror180 === true) {
    throw new RequestError('2 人地图不能用 180° 旋转镜像（会把 1 区转到对角，要用就用上下镜像）');
  }
  const invalidToken = version <= 1 ? /[^.#-]/ : version === 2 ? /[^.#N-]/ : /[^.#N01234-]/;
  const allowedText = version <= 1 ? '.#-' : version === 2 ? '.#N-' : '.01234（# / - / N 为别名）';
  // 镜像开启时只存 1 区所在的象限；列压缩自 v3 起生效。
  const expectedRows = data.mirror180 === true ? rows / 2 : mirrorVertical ? Math.ceil(rows / 2) : rows;
  const expectedColumns = version >= 3 && mirrorHorizontal ? Math.ceil(columns / 2) : columns;
  if (!Array.isArray(data.ascii) || data.ascii.length !== expectedRows ||
      data.ascii.some((line) => typeof line !== 'string' || line.length !== expectedColumns || invalidToken.test(line))) {
    throw new RequestError(`字符画必须是 ${expectedRows} 行 × ${expectedColumns} 列的 ${allowedText}`);
  }
  const tokenAt = (row, column) => {
    const rowOffset = rows - expectedRows;
    const half = version >= 3 && mirrorHorizontal ? Math.ceil(columns / 2) : columns;
    let sourceRow, sourceColumn;
    if (data.mirror180 === true) {
      const lower = row >= rows / 2;
      sourceRow = lower ? rows - 1 - row : row;
      sourceColumn = lower ? columns - 1 - column : column;
    } else {
      sourceRow = mirrorVertical && row < rowOffset ? rows - 1 - row - rowOffset : row - rowOffset;
      sourceColumn = version >= 3 && mirrorHorizontal && column >= half ? columns - 1 - column : column;
    }
    return data.ascii[sourceRow]?.[sourceColumn];
  };
  if (data.resourcePoints !== undefined) {
    if (!Array.isArray(data.resourcePoints)) throw new RequestError('资源点位必须是数组');
    for (const point of data.resourcePoints) {
      if (!point || !Number.isInteger(point.row) || !Number.isInteger(point.column) ||
          point.row < 0 || point.row >= rows || point.column < 0 || point.column >= columns) {
        throw new RequestError('资源点位坐标不在地图内');
      }
      if (tokenAt(point.row, point.column) !== '0' && tokenAt(point.row, point.column) !== 'N') {
        throw new RequestError('资源点位只能落在中立格上');
      }
      if (point.section !== undefined && point.section !== 0) throw new RequestError('中立资源点的分区必须为 0');
    }
  }
  const art = data.art;
  const freeDecor = art && typeof art === 'object' && !Array.isArray(art) ? art.freeDecor : undefined;
  if (freeDecor !== undefined) {
    if (!Array.isArray(freeDecor)) throw new RequestError('art.freeDecor 必须是数组');
    for (let index = 0; index < freeDecor.length; index += 1) {
      const item = freeDecor[index];
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new RequestError(`自由装饰 ${index} 必须是对象`);
      if (typeof item.art !== 'string' || !item.art.trim()) throw new RequestError(`自由装饰 ${index} 缺少资源名`);
      if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) throw new RequestError(`自由装饰 ${index} 坐标无效`);
      if (!Number.isFinite(item.width) || item.width <= 0 || !Number.isFinite(item.height) || item.height <= 0) {
        throw new RequestError(`自由装饰 ${index} 尺寸无效`);
      }
      if (item.rotation !== undefined && !Number.isFinite(item.rotation)) throw new RequestError(`自由装饰 ${index} 角度无效`);
      if ((item.flipX !== undefined && typeof item.flipX !== 'boolean') ||
          (item.flipY !== undefined && typeof item.flipY !== 'boolean')) {
        throw new RequestError(`自由装饰 ${index} 翻转值无效`);
      }
    }
  }
  // 背景图：写了就必须是非空字符串（资源名，相对 resources）。校验只守形状，
  // 文件在不在由客户端 `resources.load` 决定 —— 与装饰同口径。
  if (art && typeof art === 'object' && !Array.isArray(art) && art.background !== undefined) {
    if (typeof art.background !== 'string' || !art.background.trim()) {
      throw new RequestError('art.background 必须是非空字符串（背景图资源名）');
    }
  }
  let homes = [];
  const list = Array.isArray(data.homes) && data.homes.length
    ? data.homes
    : (data.playerHome && data.enemyHome ? [data.playerHome, data.enemyHome] : []);
  if (cityMode === 'fixed' && list.length !== playerCount) {
    throw new RequestError(`固定主城模式每方恰好一座主城，本图应为 ${playerCount} 座`);
  }
  // select 模式下 homes 是可选的默认主城（0 或 playerCount 座）。
  if (cityMode === 'select' && list.length !== 0 && list.length !== playerCount) {
    throw new RequestError(`自选主城模式的默认主城应为 ${playerCount} 座（或留空）`);
  }
  // select 模式下保留 null 占位，下标对应分区；fixed 模式必须全部有坐标。
  for (let i = 0; i < list.length; i += 1) {
    const home = list[i];
    if (home === null) {
      if (cityMode === 'fixed') throw new RequestError('主城坐标不在地图内');
      homes.push(null);
      continue;
    }
    if (!home || !Number.isInteger(home.row) || !Number.isInteger(home.column) ||
        home.row < 0 || home.row >= rows || home.column < 0 || home.column >= columns) {
      throw new RequestError('主城坐标不在地图内');
    }
    homes.push({ row: home.row, column: home.column });
  }
  const preset = {
    id, name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : id,
    version: 3, rows, columns, playerCount, cityMode,
    mirrorVertical, mirrorHorizontal, mirror180: false,
    ascii: data.ascii,
  };
  if (cityMode === 'fixed' || homes.length) preset.homes = homes;
  // 玩法配置先原样透传（regions / homeCandidates / resourcePoints / spacing / art），合法性由游戏侧校验，
  // 编辑器只保证结构不被写坏。
  for (const key of ['regions', 'homeCandidates', 'resourcePoints', 'spacing', 'art']) {
    if (data[key] !== undefined) preset[key] = data[key];
  }
  return preset;
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    // 大地图 100×100 + 74 座城 + 势力范围格子，体积远大于领地那 20×20 的图，上限放到 2MB。
    if (body.length > 2000000) throw new RequestError('地图文件过大');
  }
  return JSON.parse(body);
}

await mkdir(presetDir, { recursive: true });
await mkdir(territoryPresetDir, { recursive: true });
await mkdir(bigmapPresetDir, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', address);
    // `formats/*.js` 一律放行（地图编辑器与章节编辑器共用这一层纯逻辑，静态白名单漏一个
    // 就会让整个页面挂掉 —— 2026-09-29 新增 territory-issue-cells.js 时踩过：拿不到模块
    // ⇒ window.__territoryEditor 都不存在，看起来像「编辑器坏了」）。
    // 正则只允许 [a-z0-9-].js，不含 `..` / `/`，不会越出 formats/。
    const formatModule = /^\/formats\/([a-z0-9-]+\.js)$/.exec(url.pathname);
    // 根目录静态文件改成「后缀白名单 + 文件名不许带路径分隔符」，不再逐字枚举。
    // 之前是硬编码 /app.js、/territory.html…，每加一个页面都要改这一行；忘了就 404，
    // 而服务端**零报错**，看起来像「编辑器坏了」（2026-09-29 加 territory-issue-cells.js 踩过）。
    const pageFile = /^\/([A-Za-z0-9_-]+\.(?:html|js))$/.exec(url.pathname);
    if (req.method === 'GET' && (url.pathname === '/' || formatModule || pageFile)) {
      const filename = url.pathname === '/' ? 'index.html'
        : formatModule ? `formats/${formatModule[1]}`
          : pageFile[1];
      let content;
      try { content = await readFile(join(root, filename)); }
      catch (error) {
        if (error.code === 'ENOENT') { json(res, 404, { error: `静态文件不存在：${filename}` }); return; }
        throw error;
      }
      res.writeHead(200, { 'Content-Type': filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(content);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/presets') {
      const names = (await readdir(presetDir)).filter((name) => name.endsWith('.json') && idPattern.test(name.slice(0, -5)));
      const presets = [];
      for (const name of names) {
        const id = name.slice(0, -5);
        presets.push(validatePreset(JSON.parse(await readFile(join(presetDir, name), 'utf8')), id));
      }
      json(res, 200, { presets });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/territory-presets') {
      const names = (await readdir(territoryPresetDir)).filter((name) => name.endsWith('.json') && idPattern.test(name.slice(0, -5)));
      const presets = [];
      for (const name of names) {
        const id = name.slice(0, -5);
        const result = await readTerritoryPreset(id);
        presets.push({ ...result.map, warnings: result.warnings });
      }
      json(res, 200, { presets });
      return;
    }
    const territoryMatch = /^\/api\/territory-presets\/([^/]+)$/.exec(url.pathname);
    if (territoryMatch && idPattern.test(territoryMatch[1])) {
      const id = territoryMatch[1];
      const path = join(territoryPresetDir, `${id}.json`);
      if (req.method === 'GET') {
        const result = await readTerritoryPreset(id);
        json(res, 200, { preset: result.map, warnings: result.warnings });
        return;
      }
      if (req.method === 'PUT') {
        const result = normalizeTerritoryMap(await readBody(req), id);
        await writeJsonAtomic(path, result.map);
        json(res, 200, { preset: result.map, warnings: result.warnings });
        return;
      }
      if (req.method === 'DELETE') {
        try { await unlink(path); }
        catch (error) {
          if (error.code === 'ENOENT') { json(res, 404, { error: 'territory preset not found' }); return; }
          throw error;
        }
        json(res, 200, { deleted: id });
        return;
      }
      json(res, 405, { error: 'method not allowed' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/territory-assets') {
      const assets = [];
      await listTerritoryAssets(territoryAssetDir, 'image/territory/', assets);
      json(res, 200, { assets: assets.sort(), dir: 'assets/resources/image/territory' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/bigmap-config') {
      // 编辑器要拉「有哪些城池 / 野怪可选」，以及地图尺寸与种子上限。
      // 只读 remoteRef，不改表 —— 配置真源仍是导表链路。
      // 表名跟着转表链路走：`doc/塔防数据配置/DM-*.xlsx` 导出的就是英文 camelCase 表名
      // （`bigmapCity` 那套，见 MEMORY 规则 313）。写成旧的中文表名会读不到文件，
      // 而 `readRefRows` / `readRefIdSet` 读不到时返回 null ⇒ 对账**静默跳过**，看起来一切正常。
      const world = (await readRefRows('bigmapWorld'))?.[0] ?? null;
      const cities = (await readRefRows('bigmapCity')) ?? [];
      const monsters = (await readRefRows('bigmapMonster')) ?? [];
      json(res, 200, { world, cities, monsters });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/bigmap-presets') {
      const names = (await readdir(bigmapPresetDir)).filter((name) => name.endsWith('.json') && idPattern.test(name.slice(0, -5)));
      const presets = [];
      for (const name of names.sort()) {
        const id = name.slice(0, -5);
        try {
          const { layout, warnings } = await readBigmapPreset(id);
          presets.push({ ...layout, id, warnings });
        } catch (error) {
          // 单份坏档不该拖垮列表页：把错误挂在这条上，界面自己标红。
          presets.push({ id, error: error.message });
        }
      }
      json(res, 200, { presets });
      return;
    }
    const bigmapMatch = /^\/api\/bigmap-presets\/([^/]+)$/.exec(url.pathname);
    if (bigmapMatch && idPattern.test(bigmapMatch[1])) {
      const id = bigmapMatch[1];
      const path = join(bigmapPresetDir, `${id}.json`);
      if (req.method === 'GET') {
        const { layout, warnings } = await readBigmapPreset(id);
        json(res, 200, { preset: { ...layout, id }, warnings });
        return;
      }
      if (req.method === 'PUT') {
        const { layout, warnings } = normalizeBigmapLayout(await readBody(req));
        await writeJsonAtomic(path, layout);
        json(res, 200, { preset: { ...layout, id }, warnings });
        return;
      }
      if (req.method === 'DELETE') {
        try { await unlink(path); }
        catch (error) {
          if (error.code === 'ENOENT') { json(res, 404, { error: '大地图预设不存在' }); return; }
          throw error;
        }
        json(res, 200, { deleted: id });
        return;
      }
      json(res, 405, { error: '不支持此操作' });
      return;
    }
    const bigmapPublishMatch = /^\/api\/bigmap-publish\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'POST' && bigmapPublishMatch && idPattern.test(bigmapPublishMatch[1])) {
      const id = bigmapPublishMatch[1];
      const result = await publishBigmapPreset(id);
      json(res, 200, { ...result, preset: { ...result.layout, id } });
      return;
    }
    const publishMatch = /^\/api\/territory-publish\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'POST' && publishMatch && idPattern.test(publishMatch[1])) {
      json(res, 200, await publishTerritoryPreset(publishMatch[1]));
      return;
    }
    if (url.pathname === '/api/decor') {
      if (req.method === 'GET') {
        const decor = [];
        await listDecor(decorDir, decorPrefix, decor);
        // 每张已出图的装饰附上原始像素尺寸，编辑器新摆时默认按 1:1 落地。
        const sizes = {};
        for (const name of decor) {
          const file = await findDecorFile(name);
          if (!file) continue;
          const size = await readImageSize(file);
          if (size) sizes[name] = size;
        }
        json(res, 200, {
          decor: decor.sort(), custom: await readDecorNames(), dir: 'assets/resources/image/decor',
          sizes,
        });
        return;
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const name = body && typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) throw new RequestError('装饰资源名必须是非空字符串');
        json(res, 200, { custom: await addDecorName(name) });
        return;
      }
      json(res, 405, { error: '不支持此操作' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/map-resources') {
      const assets = [];
      await listDecor(mapResourceDir, mapResourcePrefix, assets);
      // 回退图标的两类也标记为可用，编辑器才会画图标而不是文字。
      for (const id of Object.keys(mapResourceFallback)) {
        const asset = mapResourcePrefix + id;
        if (!assets.includes(asset)) assets.push(asset);
      }
      json(res, 200, { assets: assets.sort(), dir: 'assets/resources/image/map-resource' });
      return;
    }
    // 装饰贴图本体：画布上的装饰与清单缩略图都取这里，出了图就能直接看到。
    if (req.method === 'GET' && url.pathname.startsWith('/decor/')) {
      const file = await findDecorFile(decodeURIComponent(url.pathname.slice('/decor/'.length)));
      if (!file) { json(res, 404, { error: '装饰贴图不存在' }); return; }
      res.writeHead(200, {
        'Content-Type': /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png',
        'Cache-Control': 'no-cache',
      });
      res.end(await readFile(file));
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/map-resource/')) {
      const file = await findMapResourceFile(decodeURIComponent(url.pathname.slice('/map-resource/'.length)));
      if (!file) { json(res, 404, { error: '资源图标不存在' }); return; }
      res.writeHead(200, {
        'Content-Type': /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png',
        'Cache-Control': 'no-cache',
      });
      res.end(await readFile(file));
      return;
    }
    // 棋盘背景图本体：编辑器画布衬在格之下，取的是游戏里那张同源贴图。
    if (req.method === 'GET' && url.pathname.startsWith('/bg/')) {
      const file = await findBackgroundFile(decodeURIComponent(url.pathname.slice('/bg/'.length)));
      if (!file) { json(res, 404, { error: '背景图不存在' }); return; }
      res.writeHead(200, {
        'Content-Type': /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png',
        'Cache-Control': 'no-cache',
      });
      res.end(await readFile(file));
      return;
    }
    const match = /^\/api\/presets\/([^/]+)$/.exec(url.pathname);
    if (!match || !idPattern.test(match[1])) { json(res, 404, { error: '页面或预设不存在' }); return; }
    const id = match[1];
    const path = join(presetDir, id + '.json');
    if (req.method === 'PUT') {
      const preset = validatePreset(await readBody(req), id);
      await writeJsonAtomic(path, preset);
      json(res, 200, { preset });
    } else if (req.method === 'DELETE') {
      try { await unlink(path); }
      catch (error) {
        if (error.code === 'ENOENT') { json(res, 404, { error: '预设不存在' }); return; }
        throw error;
      }
      json(res, 200, { deleted: id });
    } else {
      json(res, 405, { error: '不支持此操作' });
    }
  } catch (error) {
    // 400 只看类型，不看文案：`RequestError`（本文件校验）、两份 format 的校验错误、
    // 以及 `JSON.parse` 的 SyntaxError（请求体不是合法 JSON）。其余一律 500，别把内部故障
    // 伪装成"你填错了"。
    const badRequest = error instanceof RequestError
      || error instanceof TerritoryValidationError
      || error instanceof BigmapValidationError
      || error instanceof SyntaxError
      || error.statusCode === 400;
    json(res, badRequest ? 400 : 500, { error: error.message });
  }
});

server.on('error', async (error) => {
  if (error.code === 'EADDRINUSE' && await runningEditor()) {
    const page = launchPath || 'index.html';
    if (await servesPage(page)) {
      console.log(`地图编辑器已在运行：${address}`);
      openBrowser();
      return;
    }
    // 端口被占，但那个服务不认这个页面 ⇒ 是旧版进程（多半是上次没关的 cmd 窗口）。
    console.error(`端口 ${port} 上运行的是**旧版**编辑器服务，它没有 ${page}。`);
    console.error('请关掉之前那个编辑器窗口（或结束占用该端口的 node 进程），然后重新打开本脚本。');
    console.error(`（也可以换端口：set MAP_EDITOR_PORT=8788 后重试）`);
    process.exitCode = 1;
    return;
  }
  console.error(`地图编辑器启动失败：${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`地图编辑器：${address}`);
  console.log(`预设目录：${presetDir}`);
  openBrowser();
});
