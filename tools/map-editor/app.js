(function () {
  'use strict';

  var MIN_ROWS = 4, MAX_ROWS = 60, MIN_COLS = 4, MAX_COLS = 60;
  var MAX_SECTIONS = 4;
  var VOID = -1, NEUTRAL = 0;
  var DIR_EVEN = [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [-1, 1]];
  var DIR_ODD = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, -1], [-1, 0]];
  var ROWS = 20, COLS = 11;
  var SERVER_URL = 'http://127.0.0.1:8787/';
  var grid = [], paths = [], library = {};
  var decorBrush = '', decorKind = 'free';
  // 自由装饰是整张地图上的纯表现对象；不参与格子镜像和虚空清理。
  var freeDecor = [], selectedFreeDecorId = null, freeDecorSnap = false, nextFreeDecorId = 1;
  // 装饰清单：decorLibrary = 可选的全部名字（扫到的美术 + 自定义）；
  // decorImages = 其中"服务端确实有图"的那些 —— 决定画布上画真图还是画占位菱形。
  // decorSizes = 每张已出图装饰的原始像素尺寸（服务端 /api/decor 附带）——
  // 新摆放时默认按 1:1 落地，编辑器里看到的大小 == 工程实际渲染大小。
  var decorLibrary = [], decorImages = {}, decorSizes = {};
  // 自定义名能不能真的记住，取决于有没有连上服务端（/api/decor 写盘）。
  // 先乐观置真，`loadDecorLibrary` 拿到结果后再定；只影响提示文案，不影响画图。
  var decorRememberSupported = true;
  var PLAYER_COUNT = 2, CITY_MODE = 'fixed';
  var MIRROR_VERTICAL = true, MIRROR_HORIZONTAL = false;
  var homes = [null, null, null, null];
  // 资源点是地图玩法配置，不隶属于主城模式；固定主城和自选主城地图共用这份数据。
  // 每个点位先配置一个确定资源，仍沿用运行时的 { resourceId: weight } 资源池结构。
  var resourcePoints = [];
  var RESOURCE_TYPES = [
    { id: 'chest', label: '宝箱', asset: 'image/map-resource/chest' },
    { id: 'gold', label: '金币', asset: 'image/map-resource/gold' },
    { id: 'mine', label: '金矿', asset: 'image/map-resource/mine' },
    { id: 'unit_cap', label: '兵力', asset: 'image/map-resource/unit_cap' },
    { id: 'artifact_charge', label: '神器', asset: 'image/map-resource/artifact_charge' }
  ];
  var RESOURCE_LABELS = { chest: '宝箱', gold: '金币', mine: '金矿', unit_cap: '兵力', artifact_charge: '神器' };
  var RESOURCE_ASSETS = { chest: 'image/map-resource/chest', gold: 'image/map-resource/gold', mine: 'image/map-resource/mine', unit_cap: 'image/map-resource/unit_cap', artifact_charge: 'image/map-resource/artifact_charge' };
  var resourceBrush = '';
  var resourceImages = {};
  var passthrough = {};
  var brush = 1, showGrid = false, flashTimer = 0, dirty = false;
  // 背景图：读 art.background（无则默认 image/zdbg1，最常用的海岛沙地）。
  // 渲染规则与游戏 TerritoryMapView.syncBackground 同口径 —— scale = max(W/图W, H/图H)，
  // 等比 cover（**不拉伸**）、溢出部分由 SVG 的 preserveAspectRatio 切掉。
  var DEFAULT_BACKGROUND = 'image/zdbg1';
  var backgroundName = DEFAULT_BACKGROUND;
  var showBackground = true;
  // 上一次写进 backgroundLayer 的 markup —— 同值就不再重写（重写会重建 <image>、大图要重新解码）。
  var backgroundMarkupCache = null;
  var BRUSH_RADIUS_MAX = 2;
  var brushRadius = 0;
  // 指针轨迹按 STROKE_STEP（svg 用户单位）采样，快速拖动不会跳格。
  var STROKE_STEP = 12;
  // 画布几何 = 工程**渲染**间距的 1:1（不再是把逻辑网格等比放大）。
  // 数字的唯一来源是 assets/script/app/zcds/view/ZCGameViewUtil.ts：
  //   地块图 = 对局扁平蒙版 hex_flat（130×119 画布 / 面 123×90；领地章节图仍是 2.5D img_land_01_gray）。
  //   两者画布、格面、格面位置逐像素同位，所以这一套几何两边通用。

  //   ⚠️ 扁平格子**紧贴**（相邻格共享边，只留 1px 抗锯齿格线），没有侧壁压盖问题；

  //   ⚠️ 格子外框画的是**格面**（半宽 61.5 / 半高 44.5），不是整图外形 ——
  //   格面中心比整图中心高 12.5px，画整图轮廓会把两侧透明边一起框进去。
  //   两侧任一处改了都要同步另一处，否则"编辑器里看着贴齐"和"游戏里真的贴齐"就变成两回事。
  //   相位 = HEX_ROW / 4（偶/奇列加 ±PHASE ⇒ 相邻列实际差半行，蜂窝交错）。
  //   别写死数字：行距一改，相位必须跟着变，否则相邻列错位、格子对不齐。
  //   列距 92.25（= 1.5×格面半宽）/ 行距 90（= 格面高）。
  //   🔴 行距必须 = 格面高，**不能为了"露出格线"加大**：加大后上下相邻格之间
  //      会张出 (行距−90)px 的真缝，整片地形被切成"一格格独立的小砖"。
  //      行距=90 时相邻格严丝合缝 ⇒ 拼成连续平面。且此时相位 90/4 = 22.5 自动正确。
  var HEX_COL = 92.25, HEX_ROW = 90, HEX_PHASE = 22.5, HEX_R = 65, HEX_HALF_H = 59.5;
  // 格面外框（可见六边形台面），编辑器画格子轮廓线用。
  var HEX_TOP_R = 61.5, HEX_TOP_HALF_H = 45, HEX_TOP_LIFT = 12.5;
  var MAX_UNDO = 80;
  var undoStack = [], redoStack = [];
  var stroke = null, panning = null, spaceDown = false, hover = null;
  var zoom = 1, panX = 0, panY = 0, baseHalfW = 513, baseHalfH = 1079;
  var centers = [], cursorLayer = null, cursorPaths = [];
  var svg = document.getElementById('board');

  function $(id) { return document.getElementById(id); }
  function clampInt(value, lo, hi) {
    var n = parseInt(value, 10);
    return isNaN(n) ? lo : Math.max(lo, Math.min(hi, n));
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function flash(message, kind) {
    var box = $('libFlash');
    box.textContent = message;
    box.className = 'flash' + (kind ? ' ' + kind : '');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { box.textContent = ''; box.className = 'flash'; }, 6000);
  }
  function syncDirtyUI() {
    var badge = $('dirtyBadge');
    if (badge) {
      badge.hidden = !dirty;
      badge.textContent = dirty ? '未保存' : '已保存';
    }
    var meta = $('metaInfo');
    if (meta && meta.classList) {
      if (dirty && meta.classList.add) meta.classList.add('dirty');
      else if (!dirty && meta.classList.remove) meta.classList.remove('dirty');
    }
  }
  function setDirty(value) {
    dirty = value === true;
    syncDirtyUI();
  }
  function markDirty() { if (!dirty) setDirty(true); }
  function activeBrushLabel() {
    if (brush === 'freeDecor') return decorBrush ? '自由装饰：' + decorBrush : '自由装饰';
    if (brush === 'resource') return resourceBrush ? '资源：' + (RESOURCE_LABELS[resourceBrush] || resourceBrush) : '资源';
    if (brush === 'home') return '主城';
    if (brush === 'neutral') return '中立格';
    if (brush === 'void') return '虚空';
    return '分区 ' + brush;
  }
  function cloneResourcePoints(points) {
    return points.map(function (point) {
      var pool = {};
      Object.keys(point.pool || {}).forEach(function (key) { pool[key] = point.pool[key]; });
      var copy = { row: point.row, column: point.column, pool: pool };
      if (Number.isInteger(point.section)) copy.section = point.section;
      if (typeof point.depth === 'string') copy.depth = point.depth;
      return copy;
    });
  }
  function resourceLabel(point) {
    var pool = point && point.pool ? point.pool : {};
    var ids = Object.keys(pool);
    if (!ids.length) return '未配置资源';
    return ids.map(function (id) { return (RESOURCE_LABELS[id] || id) + ' ×' + pool[id]; }).join(' / ');
  }
  function resourceIdAt(point) {
    var pool = point && point.pool ? point.pool : {};
    return Object.keys(pool).find(function (id) { return typeof pool[id] === 'number' && pool[id] > 0; }) || '';
  }
  function resourcePointAt(row, column) {
    return resourcePoints.find(function (point) { return point.row === row && point.column === column; }) || null;
  }
  function resourceImageUrl(resourceId) {
    var asset = RESOURCE_ASSETS[resourceId];
    return asset ? '/map-resource/' + encodeURIComponent(asset) : '';
  }
  function resourcePointDistance(from, to) {
    if (from.row === to.row && from.column === to.column) return 0;
    var seen = {};
    var queue = [{ row: from.row, column: from.column, distance: 0 }];
    seen[from.row * COLS + from.column] = true;
    for (var head = 0; head < queue.length; head += 1) {
      var current = queue[head];
      var adjacent = neighbors(current.row, current.column);
      for (var i = 0; i < adjacent.length; i += 1) {
        var key = adjacent[i][0] * COLS + adjacent[i][1];
        if (seen[key]) continue;
        if (adjacent[i][0] === to.row && adjacent[i][1] === to.column) return current.distance + 1;
        seen[key] = true;
        queue.push({ row: adjacent[i][0], column: adjacent[i][1], distance: current.distance + 1 });
      }
    }
    return Infinity;
  }
  function resourceMinDistance() {
    var configured = passthrough.spacing && Number(passthrough.spacing.resourceMinDistance);
    return Number.isFinite(configured) ? Math.max(3, configured) : 3;
  }
  function renderResourcePanel() {
    var list = $('resourceList');
    if (!list) return;
    list.innerHTML = RESOURCE_TYPES.map(function (type) {
      var hasImage = resourceImages[type.asset] === true;
      var visual = hasImage
        ? '<img class="resourceThumb" src="' + esc(resourceImageUrl(type.id)) + '" alt="">'
        : '<span class="resourceFallback">' + esc(type.label.charAt(0)) + '</span>';
      return '<button class="resourceItem' + (brush === 'resource' && resourceBrush === type.id ? ' on' : '') +
        '" data-resource="' + esc(type.id) + '" title="选择' + esc(type.label) + '">' + visual +
        '<span class="resourceName">' + esc(type.label) + '</span></button>';
    }).join('');
  }
  function setResourceBrush(resourceId) {
    if (!RESOURCE_ASSETS[resourceId]) return;
    resourceBrush = resourceId;
    brush = 'resource';
    renderResourcePanel();
    syncControls();
    if (hover) drawCursor(brushCells(hover.row, hover.column, brushRadius));
  }
  function addResourcePoint(row, column, resourceId, weight) {
    var pointRow = Number(row), pointColumn = Number(column), pointWeight = Number(weight);
    if (!Number.isInteger(pointRow) || !Number.isInteger(pointColumn) || pointRow < 0 || pointRow >= ROWS || pointColumn < 0 || pointColumn >= COLS) {
      throw new Error('资源点坐标不在当前地图内');
    }
    if (grid[pointRow][pointColumn] !== NEUTRAL) throw new Error('资源点只能放在中立格上');
    if (typeof resourceId !== 'string' || !resourceId) throw new Error('请选择资源类型');
    if (!Number.isFinite(pointWeight) || pointWeight <= 0) throw new Error('资源权重必须大于 0');
    var before = snapshot();
    var index = resourcePoints.findIndex(function (point) { return point.row === pointRow && point.column === pointColumn; });
    var nearest = resourcePoints.filter(function (_, currentIndex) { return currentIndex !== index; }).some(function (point) {
      return resourcePointDistance({ row: pointRow, column: pointColumn }, point) < resourceMinDistance();
    });
    if (nearest) throw new Error('资源点之间至少相距 ' + resourceMinDistance() + ' 格');
    var point = { row: pointRow, column: pointColumn, pool: {} };
    point.pool[resourceId] = pointWeight;
    if (index >= 0) resourcePoints[index] = point;
    else resourcePoints.push(point);
    render();
    commitUndo(before);
  }
  function removeResourcePoint(index) {
    if (!Number.isInteger(index) || index < 0 || index >= resourcePoints.length) return false;
    var before = snapshot();
    resourcePoints.splice(index, 1);
    render();
    return commitUndo(before);
  }
  function showServerLink() { $('openServer').hidden = false; }
  function serviceError(error) {
    if (error && (error.name === 'TypeError' || error.name === 'SyntaxError')) {
      return '当前页面没有连接地图服务。请双击 tools/map-editor/open-editor.cmd，再点下方链接继续编辑。';
    }
    return error.message;
  }
  function transferredLayout() {
    var hash = window.location && window.location.hash;
    if (!hash || hash.slice(0, 5) !== '#map=') return null;
    try { return JSON.parse(decodeURIComponent(hash.slice(5))); }
    catch (error) { flash('地图链接无效：' + error.message, 'err'); return null; }
  }

  // ---- 分区与镜像 -------------------------------------------------------------
  // 分区号按象限编码（0-based 的 bit0 = 上下、bit1 = 左右）：1 = 下左、2 = 上左、
  // 3 = 下右、4 = 上右。与客户端 ZCMapConfig 的 buildSectionMirrorTable 同源。
  function mirrorMask() {
    if (PLAYER_COUNT <= 3) return 1;
    return (MIRROR_VERTICAL ? 1 : 0) | (MIRROR_HORIZONTAL ? 2 : 0);
  }
  function mirrorSection(section) {
    if (section <= 0) return section;
    return ((section - 1) ^ mirrorMask()) + 1;
  }
  function mirrored() { return MIRROR_VERTICAL || MIRROR_HORIZONTAL; }
  function topRows() { return ROWS - Math.ceil(ROWS / 2); }
  function halfCols() { return Math.ceil(COLS / 2); }
  /** 三人分区：2 区占上带 1/3 高，下 2/3 归 1 / 3 区 —— 三块面积近似相等。 */
  function threeBand() { return Math.max(1, Math.round(ROWS / 3)); }
  /** 分区的唯一入口：新建、切人数、改尺寸都走这里，避免两处规则漂移。 */
  function sectionAt(row, column) {
    if (PLAYER_COUNT === 3) return row < threeBand() ? 2 : (column >= halfCols() ? 3 : 1);
    var section = row < topRows() ? 2 : 1;
    if (PLAYER_COUNT === 4 && column >= halfCols()) section += 2;
    return section;
  }
  /**
   * 主城是否落在"中线的己方一侧"。
   * 2 / 4 人的分界就是上下半场；3 人的上带高度是 threeBand()，跟 Math.floor(ROWS / 2) 不是同一个数，
   * 套错口径会在某些尺寸上误报"不在中线己方一侧"。横向那一半由 grid 值检查兜住。
   */
  function homeOnOwnSide(index, home) {
    if (PLAYER_COUNT === 3) return index === 1 ? home.row < threeBand() : home.row >= threeBand();
    return ((index & 1) === 1) ? home.row < Math.floor(ROWS / 2) : home.row >= Math.floor(ROWS / 2);
  }
  /**
   * 各人数下**唯一合法**的镜像组合（锁死项）—— 单一口径，UI 开关 / API / 载入校验都从这里取，
   * 免得"3 人必须关"散成几处判断、日后各改一半（改尺寸那次就是这么漏的）。
   *
   *   2 人：**不锁**（返回 null）。上下镜像给「默认开」，但策划能自己关掉 —— 放装饰时要摆
   *         非对称点缀（礁石、沉船扎堆），对折生成的对侧装饰会跟着一起长出来，很碍事。
   *         ⚠️ 关掉之后 1 区的格数**不再等于**该方开局领地（`ZC_INITIAL_TERRITORY`）：
   *         两家一样多这件事从"镜像保证"变成"策划自己保证"，`validate()` 只报 warn 不拦。
   *   3 人：一律关。3 是奇数，矩形棋盘的上下 / 左右翻转都配不出第三块分区。
   *   4 人：不锁（四象限，上下 / 左右各自可选）。
   *
   * 返回 `null` 表示该人数不锁；否则返回的对象就是**唯一合法**的镜像组合。
   */
  function forcedMirror(playerCount) {
    if (playerCount === 3) return { vertical: false, horizontal: false };
    return null;
  }
  /**
   * 各人数下**默认**落到的镜像组合 —— 「默认」不是「强制」，除非同时被 `forcedMirror` 锁住。
   * 只在两处用：`setPlayerCount()` 切人数时落初值、以及新建 / 重置。
   * 改人数**不能**在这里判合法性，那是 forcedMirror 的活。
   */
  function defaultMirror(playerCount) {
    if (playerCount === 3) return { vertical: false, horizontal: false };
    // 4 人：四象限，上下 + 左右都开，只画左下 1/4。
    if (playerCount === 4) return { vertical: true, horizontal: true };
    // 2 人：上下开（1 区在下、2 区在上，对折生成上半场）。
    return { vertical: true, horizontal: false };
  }
  function mirrorHomeOf(home, section) {
    var bits = section - 1;
    return {
      row: (bits & 1) ? ROWS - 1 - home.row : home.row,
      column: (bits & 2) ? COLS - 1 - home.column : home.column
    };
  }
  function isStoredCell(row, column) {
    return (!MIRROR_VERTICAL || row >= topRows()) && (!MIRROR_HORIZONTAL || column < halfCols());
  }
  function sourceCell(row, column) {
    return {
      row: MIRROR_VERTICAL && row < topRows() ? ROWS - 1 - row : row,
      column: MIRROR_HORIZONTAL && column >= halfCols() ? COLS - 1 - column : column
    };
  }
  /**
   * 该格相对存储侧翻掉了几位：bit0 = 上下、bit1 = 左右。
   * 必须逐格算：四象限只存 1/4 时，上半场左半场只翻了上下一位（1→2 区），
   * 只有同时翻上下与左右才落到对角（1→4 区）。
   */
  function flipBits(row, column) {
    return (MIRROR_VERTICAL && row < topRows() ? 1 : 0) | (MIRROR_HORIZONTAL && column >= halfCols() ? 2 : 0);
  }
  function sectionAfterFlip(value, flip) {
    if (value <= 0 || !flip) return value;
    // 2 / 3 人只有上下是分区维度（3 人地图不做旋转对称），列位只影响几何。
    var effective = PLAYER_COUNT <= 3 ? (flip & 1) : flip;
    return effective ? ((value - 1) ^ effective) + 1 : value;
  }
  function hexPixelDistance(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  /**
   * 三人标准布局：三个主城构成等边三角形（顶点在上、底边在下），
   * 两两距离相等，任何一方都不会因"离谁近"而先天吃亏。
   *
   * ⚠️ 挑解必须按画布上的**实际像素距离**（直接问 `hexCenter`），不能写成
   * "Δ = W·列距·√3/行距"那种闭式系数：格子是压扁的、奇偶列还差半个行距的相位，
   * 系数一旦和画布几何脱钩，格距一改（例如从 90/105 换成与工程 1:1 的 92/90），
   * 这份默认解就从"等边"退化成 653.5 / 653.5 / 736.0（极差 12.6%）。
   * 所以这里把放得下的 (W, Δ) 全算一遍，取三边极差最小的一组；并列时取更宽的
   * （三点更分散 = 开局更晚接触）。W 不限奇偶 —— 相位差已经进了像素距离里。
   * 上点压中线列（COLS 为奇数时才严格左右对称），下两点各距左 / 右边 W 列。
   */
  function threeHomes() {
    var mid = Math.round((COLS - 1) / 2);
    // 主城要留出 7 格蜂巢：左右各留 1 列，上下各留 1 行。
    var maxWidth = Math.max(1, Math.min(mid - 1, COLS - 2 - mid));
    var limit = Math.max(1, ROWS - 3);
    var best = null;
    for (var width = 1; width <= maxWidth; width += 1) {
      for (var delta = 1; delta <= limit; delta += 1) {
        var upper = hexCenter(0, mid);
        var lowerLeft = hexCenter(delta, mid - width);
        var lowerRight = hexCenter(delta, mid + width);
        var base = hexPixelDistance(lowerLeft, lowerRight);
        var sideLeft = hexPixelDistance(upper, lowerLeft);
        var sideRight = hexPixelDistance(upper, lowerRight);
        var spread = Math.max(base, sideLeft, sideRight) / Math.min(base, sideLeft, sideRight) - 1;
        if (!best || spread < best.spread - 1e-12
            || (Math.abs(spread - best.spread) <= 1e-12 && width > best.width)) {
          best = { width: width, delta: delta, spread: spread };
        }
      }
    }
    var width = best.width;
    var delta = best.delta;
    // 上点至少离顶边 1 行、下点至少离底边 1 行，主城 7 格蜂巢才不会越界。
    var top = Math.round(((ROWS - 1) * 1.5 - 2 * delta) / 3);
    top = Math.max(1, Math.min(Math.max(1, ROWS - 2 - delta), top));
    return [
      { row: top + delta, column: Math.max(0, mid - width) },
      { row: top, column: mid },
      { row: top + delta, column: Math.min(COLS - 1, mid + width) },
    ];
  }

  function defaultHome(section) {
    if (PLAYER_COUNT === 3) {
      var trio = threeHomes();
      return { row: trio[section - 1].row, column: trio[section - 1].column };
    }
    var row = ((section - 1) & 1) ? 1 : ROWS - 2;
    var column = ((section - 1) & 2) ? COLS - 2 : 1;
    return { row: Math.max(0, Math.min(ROWS - 1, row)), column: Math.max(0, Math.min(COLS - 1, column)) };
  }

  function sectionLabel(section) {
    if (section === VOID) return '虚空';
    if (section === NEUTRAL) return '中立';
    return section + ' 区';
  }
  function tokenOf(value) { return value === VOID ? '.' : String(value); }
  function parseToken(token) {
    if (token === '.') return VOID;
    if (token === 'N' || token === '0') return NEUTRAL;
    if (token === '#' || token === '1') return 1;
    if (token === '-' || token === '2') return 2;
    if (token === '3') return 3;
    if (token === '4') return 4;
    throw new Error('字符画里的非法字符：' + token);
  }

  // 旧版 art.tiles 行列键只用于载入时过滤；场景装饰统一写入 art.freeDecor。
  var DECOR_CELL_KEY = /^(\d+),(\d+)$/;
  /** 未出图占位符按资源名稳定取色。 */
  var DECOR_PALETTE = ['#4C5BD4', '#8A5A00', '#2F6F3E', '#A32D2D', '#5B4B8A', '#1F6F6F', '#7A4B2A', '#3B5B7A'];
  function decorColor(name) {
    var hash = 0;
    for (var i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 100003;
    return DECOR_PALETTE[hash % DECOR_PALETTE.length];
  }
  function pruneResourcePoints() {
    var before = resourcePoints.length;
    resourcePoints = resourcePoints.filter(function (point) {
      return point.row >= 0 && point.row < ROWS && point.column >= 0 && point.column < COLS &&
        grid[point.row][point.column] === NEUTRAL;
    });
    return before - resourcePoints.length;
  }
  /**
   * 装饰清单。两组分开收：
   *   scanned —— 服务端扫 `assets/resources/image/decor` 得到的（**有图**，画布上画真图）；
   *   custom  —— 记在服务端的自定义资源名（美术还没出图也能先摆，写盘所以刷新不丢）。
   * 同一个名字两边都有时算"有图"。
   */
  function setDecorLibrary(scanned, custom, sizes) {
    decorImages = {};
    // 尺寸映射跟着扫到的清单一起进：`{ 资源名: {width, height} }`，没出图的自定义名没有键。
    decorSizes = (sizes && typeof sizes === 'object' && !Array.isArray(sizes)) ? sizes : {};
    decorLibrary = [];
    var groups = [scanned, custom];
    for (var g = 0; g < groups.length; g += 1) {
      var names = Array.isArray(groups[g]) ? groups[g] : [];
      for (var i = 0; i < names.length; i += 1) {
        var name = String(names[i] || '').trim();
        if (!name) continue;
        if (g === 0) decorImages[name] = true;
        if (decorLibrary.indexOf(name) < 0) decorLibrary.push(name);
      }
    }
    if (decorBrush && decorLibrary.indexOf(decorBrush) < 0) decorLibrary.push(decorBrush);
    renderDecorPanel();
    // 图库是异步加载的：地图数据可能先画成占位（`decorImages` 还没到），这里补齐后
    // **必须重画装饰层**，否则画布上的装饰永远停在占位矩形、真图不出现。
    drawFreeDecor();
  }
  /** 装饰资源名 → 图片地址。服务端 `/decor/<名字>` 会自动补扩展名。 */
  function decorUrl(name) { return '/decor/' + encodeURI(name); }

  /**
   * 资源名 → 分组标题。
   *   `image/decor/sea/reef`  → `sea`（取 image/decor/ 之后的**第一段**子目录）
   *   `image/decor/reef`      → `其他`（没有子目录）
   *   `reef_01`               → `自定义`（压根不在 image/decor/ 下）
   * 分组只为"好找"，不影响任何落盘数据 —— 资源名原样存进 art.freeDecor[].art。
   */
  function decorGroupTitle(name) {
    var prefix = 'image/decor/';
    var text = String(name || '');
    if (text.indexOf(prefix) !== 0) return '自定义';
    var rest = text.slice(prefix.length);
    var slash = rest.indexOf('/');
    return slash > 0 ? rest.slice(0, slash) : '其他';
  }
  /** 资源名 → 卡片上显示的名字（只留末段）。`image/decor/sea/reef` → `reef`。 */
  function decorLeafName(name) {
    var text = String(name || '');
    var slash = text.lastIndexOf('/');
    return slash >= 0 ? text.slice(slash + 1) : text;
  }
  /**
   * 装饰清单 → 分组。纯函数、不碰 DOM（`tests/map-editor.test.ts` 直接测它）。
   *
   * 返回 `[{ title, items: [{ name, label, hasArt }] }]`：
   *   - 组按标题字典序（英文主题在前、`自定义`/`其他` 这类中文组在后），组内按全名字典序 ——
   *     顺序稳定，用例能写死期望值，界面也不会每次刷新换位置；
   *   - 同名的重复项只保留一次（清单是"扫到的 + 自定义"两组并集，天然可能重）。
   */
  function groupDecorEntries(names, images) {
    var hasArtOf = images || {};
    var buckets = {};
    var order = [];
    var seen = {};
    var list = Array.isArray(names) ? names : [];
    for (var i = 0; i < list.length; i += 1) {
      var name = String(list[i] || '').trim();
      if (!name || seen[name]) continue;
      seen[name] = true;
      var title = decorGroupTitle(name);
      if (!buckets[title]) { buckets[title] = []; order.push(title); }
      buckets[title].push({
        name: name,
        label: decorLeafName(name),
        hasArt: hasArtOf[name] === true,
      });
    }
    order.sort();
    var groups = [];
    for (var g = 0; g < order.length; g += 1) {
      var items = buckets[order[g]];
      items.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
      groups.push({ title: order[g], items: items });
    }
    return groups;
  }
  /**
   * 把自定义资源名记到服务端 —— 这是"刷新之后不用重新定义"的落地处（写进
   * `tools/map-editor/decor-library.json`）。已经有图的名字不必记；没连服务（直接双击
   * index.html）时只能留在当前页面里。
   */
  async function rememberDecorName(name) {
    if (!name || decorImages[name]) return;
    try {
      await api('/api/decor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name }),
      });
    } catch (error) {
      // 没连服务（直接双击 index.html）时名字只留在当前页面，下次打开要重填 ——
      // 不报错、不阻断画图：这是降级路径，不是失败。
    }
  }
  function setDecorBrush(name) {
    decorBrush = String(name == null ? '' : name).trim();
    if (decorBrush && decorLibrary.indexOf(decorBrush) < 0) decorLibrary.push(decorBrush);
    brush = 'freeDecor';
    renderDecorPanel();
    syncControls();
    if (hover) drawCursor(brushCells(hover.row, hover.column, brushRadius));
    void rememberDecorName(decorBrush);
  }
  function setDecorKind(kind) {
    decorKind = 'free';
    brush = 'freeDecor';
    syncControls();
    renderDecorPanel();
  }

  function cloneFreeDecor(items) {
    return (Array.isArray(items) ? items : []).map(function (item) {
      return {
        id: item.id, art: item.art, x: item.x, y: item.y,
        width: item.width, height: item.height, rotation: item.rotation,
        flipX: item.flipX === true, flipY: item.flipY === true, locked: item.locked === true
      };
    });
  }
  function freeDecorById(id) {
    return freeDecor.find(function (item) { return item.id === id; }) || null;
  }
  function setFreeDecorSnap(value) {
    freeDecorSnap = value === true;
    var input = $('freeDecorSnap');
    if (input) input.checked = freeDecorSnap;
  }
  function setFreeDecorBrush(name) {
    setDecorBrush(name);
    brush = 'freeDecor';
    syncControls();
  }
  function nearestHexCenter(x, y) {
    var best = null, bestDistance = Infinity;
    for (var index = 0; index < centers.length; index += 1) {
      var point = centers[index];
      var distance = (point.x - x) * (point.x - x) + (point.y - y) * (point.y - y);
      if (distance < bestDistance) { bestDistance = distance; best = point; }
    }
    return best ? { x: best.x, y: best.y } : { x: x, y: y };
  }
  function addFreeDecor(art, x, y) {
    var name = String(art || decorBrush || '').trim();
    if (!name || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    var before = snapshot();
    var point = freeDecorSnap ? nearestHexCenter(x, y) : { x: x, y: y };
    // 默认尺寸 = 图片原始像素（工程渲染 1:1，`installDecor` 就是按存储宽高落地）；
    // 没出图的自定义名没有尺寸，退回旧默认（3 列距 × 1 行距）占位，出图后重摆即 1:1。
    var size = decorSizes[name];
    var width = size && size.width > 0 ? size.width : HEX_COL * 3;
    var height = size && size.height > 0 ? size.height : HEX_ROW;
    var item = {
      id: nextFreeDecorId++, art: name, x: point.x, y: point.y,
      width: width, height: height, rotation: 0,
      flipX: false, flipY: false, locked: false
    };
    freeDecor.push(item);
    selectedFreeDecorId = item.id;
    brush = 'freeDecor';
    renderDecorPanel();
    render();
    commitUndo(before);
    return item.id;
  }
  function selectFreeDecor(id) {
    selectedFreeDecorId = freeDecorById(id) ? id : null;
    render();
    return selectedFreeDecorId !== null;
  }
  function applyFreeDecorPatch(id, patch) {
    var item = freeDecorById(id);
    if (!item || item.locked || !patch || typeof patch !== 'object') return false;
    var allowed = ['x', 'y', 'width', 'height', 'rotation', 'flipX', 'flipY'];
    var changed = false;
    for (var index = 0; index < allowed.length; index += 1) {
      var key = allowed[index];
      if (patch[key] === undefined) continue;
      if ((key === 'flipX' || key === 'flipY') && typeof patch[key] !== 'boolean') continue;
      if (key !== 'flipX' && key !== 'flipY' && !Number.isFinite(patch[key])) continue;
      if ((key === 'width' || key === 'height') && patch[key] < 1) continue;
      if (item[key] === patch[key]) continue;
      item[key] = patch[key];
      changed = true;
    }
    if (changed) render();
    return changed;
  }
  function updateSelectedFreeDecor(patch) {
    var item = freeDecorById(selectedFreeDecorId);
    if (!item || item.locked) return false;
    var before = snapshot();
    if (!applyFreeDecorPatch(item.id, patch)) return false;
    commitUndo(before);
    return true;
  }
  function moveSelectedFreeDecor(x, y) {
    return updateSelectedFreeDecor({ x: x, y: y });
  }
  function duplicateFreeDecor(id) {
    var source = freeDecorById(id);
    if (!source) return null;
    var before = snapshot();
    var copy = cloneFreeDecor([source])[0];
    copy.id = nextFreeDecorId++;
    copy.x += 18;
    copy.y += 18;
    copy.locked = false;
    freeDecor.push(copy);
    selectedFreeDecorId = copy.id;
    render();
    commitUndo(before);
    return copy.id;
  }
  function deleteFreeDecor(id) {
    var index = freeDecor.findIndex(function (item) { return item.id === id; });
    if (index < 0) return false;
    var before = snapshot();
    freeDecor.splice(index, 1);
    if (selectedFreeDecorId === id) selectedFreeDecorId = null;
    render();
    commitUndo(before);
    return true;
  }
  function deleteSelectedFreeDecor() {
    return deleteFreeDecor(selectedFreeDecorId);
  }
  function duplicateSelectedFreeDecor() {
    return duplicateFreeDecor(selectedFreeDecorId);
  }
  function toggleSelectedFreeDecorLock() {
    var item = freeDecorById(selectedFreeDecorId);
    return item ? setFreeDecorLocked(item.id, !item.locked) : false;
  }
  function setFreeDecorLocked(id, locked) {
    var item = freeDecorById(id);
    if (!item || item.locked === (locked === true)) return false;
    var before = snapshot();
    item.locked = locked === true;
    render();
    commitUndo(before);
    return true;
  }

  /**
   * 清空重画 / 三人图改尺寸重建时的默认底图：**全图中立格**，只把各方主城那一小块
   * （主城 + 6 邻格）涂成所属分区。主城必须落在自己的分区里，这一小块同时就是该方的
   * 开局领地（客户端 `ZC_INITIAL_TERRITORY` = 地图上 1 区的格数）。
   *
   * 本作地图的中立格占比很高，所以底图从"中立"起步、由策划按需圈画；
   * 反过来先铺满分区色再一格一格擦成中立，成本高且容易漏。
   */
  function newGrid() {
    grid = [];
    for (var row = 0; row < ROWS; row += 1) {
      var line = [];
      for (var column = 0; column < COLS; column += 1) line.push(NEUTRAL);
      grid.push(line);
    }
    homes = [null, null, null, null];
    freeDecor = [];
    nextFreeDecorId = 1;
    selectedFreeDecorId = null;
    if (CITY_MODE === 'fixed') {
      for (var index = 0; index < PLAYER_COUNT; index += 1) {
        homes[index] = defaultHome(index + 1);
      }
    }
    seedHomeCells();
    applyMirror();
  }

  /**
   * 收回主城盘：把各方主城盘的格还原成中立格。主城盘是**布局产物**（跟着人数 / 尺寸 /
   * 主城模式走），不是策划画的内容 —— 切人数或切主城模式前先收回，否则旧主城盘会留在
   * 图上变成几个"没有主城的色块"，把三分布局搞成 14/14/7 这种畸形比例。
   *
   * 镜像开启时同时退"原格"和"原格在存储侧的对应格"：flat-top 的奇列相位让行镜像下的
   * 邻域不是行对称的，只按邻居表退会漏格；而调用方随后那次 applyMirror 会把非存储侧整片
   * 从存储侧重算，所以两处一起退才能一次收干净。
   * 只退掉"颜色正好等于该座位号"的格：策划改画成别的分区色 / 虚空的一律不动。
   */
  function unseedHomeCells() {
    for (var index = 0; index < MAX_SECTIONS; index += 1) {
      var home = homes[index];
      if (!home) continue;
      var cells = [[home.row, home.column]].concat(neighbors(home.row, home.column));
      for (var i = 0; i < cells.length; i += 1) {
        var row = cells[i][0], column = cells[i][1];
        if (grid[row][column] === index + 1) grid[row][column] = NEUTRAL;
        if (!mirrored()) continue;
        var source = sourceCell(row, column);
        if (grid[source.row][source.column] === index + 1) grid[source.row][source.column] = NEUTRAL;
      }
    }
  }

  /**
   * 给各方主城盘（主城 + 6 个邻格）落分区色。布局重算的公共尾巴：新建、切人数、改尺寸、
   * 切主城模式都要过一遍 —— 少了这一步，主城会压在中立格上，校验面板直接报红。
   *
   * 只改中立格：已有分区色与虚空原样保留，所以切人数时这里是"补主城盘"而不是"重画"。
   * 主城邻格若落在虚空上会被跳过（蜂巢留缺口），由校验面板提示"压在虚空上"。
   */
  function seedHomeCells() {
    if (CITY_MODE !== 'fixed') return;
    for (var index = 0; index < PLAYER_COUNT; index += 1) {
      var home = homes[index];
      if (!home) continue;
      var cells = [[home.row, home.column]].concat(neighbors(home.row, home.column));
      for (var i = 0; i < cells.length; i += 1) {
        if (grid[cells[i][0]][cells[i][1]] === NEUTRAL) grid[cells[i][0]][cells[i][1]] = index + 1;
      }
    }
  }

  /** 把镜像侧按 1 区侧重新生成。只做生成，不动主城 —— 布局重算（新建 / 切人数 / 改尺寸）产出的默认主城还没等策划画内容，此时按"主城格分区号必须等于座位号"去清会把它全杀光。 */
  function applyMirror() {
    if (mirrored()) {
      for (var row = 0; row < ROWS; row += 1) {
        for (var column = 0; column < COLS; column += 1) {
          if (isStoredCell(row, column)) continue;
          var source = sourceCell(row, column);
          var value = grid[source.row][source.column];
          grid[row][column] = value === VOID ? VOID : sectionAfterFlip(value, flipBits(row, column));
        }
      }
      // fixed 模式只写 homes[0]，其余由镜像生成；select 模式 homes 是用户手动放置的，
      // 不能被自动镜像覆盖。
      if (CITY_MODE === 'fixed') {
        for (var index = 1; index < PLAYER_COUNT; index += 1) {
          if (!homes[0]) continue;
          var mirroredHome = mirrorHomeOf(homes[0], index + 1);
          if (mirroredHome.row >= 0 && mirroredHome.row < ROWS && mirroredHome.column >= 0 && mirroredHome.column < COLS) {
            homes[index] = mirroredHome;
          }
        }
      }
    }
  }

  /** 用户手工编辑后的收尾：先镜像，再让无效资源点和主城失效。 */
  function applyMirrorAndPrune() {
    applyMirror();
    pruneResourcePoints();
    dropStaleHomes();
  }

  /** 主城格被改成虚空 / 别的分区时，该主城作废。 */
  function dropStaleHomes() {
    for (var index = 0; index < MAX_SECTIONS; index += 1) {
      var home = homes[index];
      if (!home) continue;
      if (index >= PLAYER_COUNT || grid[home.row] === undefined) {
        homes[index] = null;
        continue;
      }
      // select 模式主城可放任意格（含中立格），只校验坐标在地图内；
      // fixed 模式主城必须落在自己分区格上。
      if (CITY_MODE !== 'select' && grid[home.row][home.column] !== index + 1) {
        homes[index] = null;
      }
    }
  }

  function clampHomes() {
    for (var index = 0; index < MAX_SECTIONS; index += 1) {
      var home = homes[index];
      if (!home) continue;
      if (home.row < 0 || home.row >= ROWS || home.column < 0 || home.column >= COLS) { homes[index] = null; continue; }
      // 主城占 7 格蜂巢，中心至少离边 1 格，否则蜂巢会伸出棋盘。
      home.row = Math.max(1, Math.min(ROWS - 2, home.row));
      home.column = Math.max(1, Math.min(COLS - 2, home.column));
    }
  }

  function syncSizeInputs(notice) {
    $('inCols').value = COLS;
    $('inRows').value = ROWS;
    $('metaInfo').textContent = COLS + ' 列 × ' + ROWS + ' 行 · ' + PLAYER_COUNT + ' 人 · ' +
      (CITY_MODE === 'fixed' ? '固定主城' : '自选主城') + ' · ' +
      (mirrored() ? ((MIRROR_VERTICAL ? '上下' : '') + (MIRROR_HORIZONTAL ? '左右' : '') + '镜像') : '无镜像');
    syncDirtyUI();
    var toolStatus = $('toolStatus');
    if (toolStatus) toolStatus.textContent = '当前工具：' + activeBrushLabel() + ' · 笔刷 ' + (brushRadius === 0 ? '1 格' : brushRadius === 1 ? '7 格' : '19 格');
    $('sizeHint').textContent = '列数 ' + MIN_COLS + '~' + MAX_COLS + '、行数 ' + MIN_ROWS + '~' + MAX_ROWS +
      ' 任意整数；行数为奇数时中线行镜像到自身。';
    var warnings = [];
    if (notice) warnings.push(notice);
    if (ROWS % 2) warnings.push('当前行数为奇数：中线行镜像到自身，一般留作中立格。');
    if (MIRROR_HORIZONTAL && COLS % 2) {
      warnings.push('当前列数为奇数：左右镜像的中线列会镜像到自身，四象限建议改用偶数列。');
    }
    $('sizeWarn').hidden = !warnings.length;
    $('sizeWarn').textContent = warnings.join(' ');
  }

  /** 分区形状只由「人数 + 行列」决定：改人数或改尺寸后重排归属，虚空与中立原样保留。 */
  function remapSections() {
    for (var row = 0; row < ROWS; row += 1) {
      for (var column = 0; column < COLS; column += 1) {
        var value = grid[row][column];
        if (value <= NEUTRAL) continue;
        grid[row][column] = value > PLAYER_COUNT ? NEUTRAL : sectionAt(row, column);
      }
    }
  }

  /** 固定主城模式下按当前人数与尺寸重算主城（三人是等边三点）。 */
  function resetHomes() {
    homes = [null, null, null, null];
    if (CITY_MODE !== 'fixed') return;
    for (var seat = 0; seat < PLAYER_COUNT; seat += 1) homes[seat] = defaultHome(seat + 1);
  }

  function setSize(rows, columns) {
    var r = clampInt(rows, MIN_ROWS, MAX_ROWS);
    var c = clampInt(columns, MIN_COLS, MAX_COLS);
    if (r === ROWS && c === COLS) { syncSizeInputs(); return; }
    var before = snapshot();
    var oldRows = ROWS, oldCols = COLS, oldGrid = grid, oldHomes = homes.slice();
    ROWS = r;
    COLS = c;
    // 三人的分区与主城完全由棋盘尺寸决定（等边三点），改尺寸就整体重建，不做平移保留 ——
    // 平移会留下贴边主城和大片虚空，且等边关系一定被破坏。
    if (PLAYER_COUNT === 3) {
      newGrid();
      syncSizeInputs();
      buildBoard();
      render();
      commitUndo(before);
      return;
    }
    // 行列变更以中线为基准保留已有内容（《地图编辑器需求文档》3.2）。
    var rowShift = Math.floor(ROWS / 2) - Math.floor(oldRows / 2);
    var columnShift = Math.floor(COLS / 2) - Math.floor(oldCols / 2);
    grid = [];
    for (var row = 0; row < ROWS; row += 1) {
      var line = [];
      for (var column = 0; column < COLS; column += 1) {
        var sourceRow = row - rowShift, sourceColumn = column - columnShift;
        var inside = sourceRow >= 0 && sourceRow < oldRows && sourceColumn >= 0 && sourceColumn < oldCols;
        line.push(inside ? oldGrid[sourceRow][sourceColumn] : VOID);
      }
      grid.push(line);
    }
    homes = oldHomes.map(function (home) {
      return home ? { row: home.row + rowShift, column: home.column + columnShift } : null;
    });
    while (homes.length < MAX_SECTIONS) homes.push(null);
    clampHomes();
    // 主城是"平移保留"来的，落点可能已经被平移到虚空或别人的分区上，这里必须过一遍失效检查。
    applyMirrorAndPrune();
    syncSizeInputs();
    buildBoard();
    render();
    commitUndo(before);
  }

  function setPlayerCount(count) {
    if (count === PLAYER_COUNT) return;
    var before = snapshot();
    PLAYER_COUNT = count;
    // 先按**旧的**镜像位收回旧主城盘，并把旧镜像位下的非存储侧整片重算一次（这一步之后
    // 旧盘才算真的消失，因为镜像侧是派生物、不跟着逐格退），最后才改镜像位。
    unseedHomeCells();
    applyMirror();
    // 切到 2 人时若原来没开上下镜像（从 3 / 4 人图切过来），对侧内容会按下半场重算 —— 得先说一声，
    // 否则策划只会看到"我上半场画的东西没了"。
    var turnedOnVertical = PLAYER_COUNT === 2 && !MIRROR_VERTICAL;
    // 切人数落到该人数的**默认**镜像组合：4 人四象限（上下 + 左右）、3 人无镜像、2 人上下开。
    // ⚠️ 这里是「默认」不是「强制」—— 2 人不再锁死，切过去之后用户还能自己取消勾选。
    var preset = defaultMirror(PLAYER_COUNT);
    MIRROR_VERTICAL = preset.vertical;
    MIRROR_HORIZONTAL = preset.horizontal;
    // 人数变了，分区形状与主城都跟着重算：切到 3 人立刻有 3 区 + 等边三点，切到 4 人立刻有四象限。
    remapSections();
    resetHomes();
    // 新主城大多压在中立格上（底图默认全中立），必须补上主城盘的分区色，主城才立得住。
    seedHomeCells();
    syncControls();
    applyMirror();
    syncSizeInputs();
    buildBoard();
    render();
    if (turnedOnVertical) flash('已按 2 人默认开启上下镜像，对侧内容按下半场重算（要摆非对称装饰可以再关掉）', 'warn');
    commitUndo(before);
  }

  function setCityMode(mode) {
    if (mode === CITY_MODE) return;
    var before = snapshot();
    unseedHomeCells();
    CITY_MODE = mode;
    homes = [null, null, null, null];
    if (CITY_MODE === 'fixed') {
      for (var index = 0; index < PLAYER_COUNT; index += 1) homes[index] = defaultHome(index + 1);
      seedHomeCells();
    }
    // 收回主城盘后，非存储侧必须从存储侧重算一次 —— 否则镜像出来的那几格会留在图上
    // （切到自选主城时尤其明显：存储侧退干净了，对侧还剩两块）。
    applyMirror();
    syncControls();
    syncSizeInputs();
    render();
    commitUndo(before);
  }

  function setMirror(vertical, horizontal) {
    // 3 人一律关镜像：UI 上那个勾已经 disabled，但 API（__editor.setMirror）和载入路径照样会
    // 走到这里，所以强制收在 forcedMirror 这一处，别只堵 UI。
    // 2 人**不锁** —— 上下镜像「默认开」是 defaultMirror() 的事，这里必须让用户能真的关掉。
    var forced = forcedMirror(PLAYER_COUNT);
    var nextV = forced ? forced.vertical : vertical === true;
    // 左右镜像只对 4 人的四象限有意义；1v1 与 3 人没有左右方向的分区伙伴。
    var next = forced ? forced.horizontal : (PLAYER_COUNT === 4 && horizontal === true);
    if (nextV === MIRROR_VERTICAL && next === MIRROR_HORIZONTAL) return;
    var before = snapshot();
    MIRROR_VERTICAL = nextV;
    MIRROR_HORIZONTAL = next;
    syncControls();
    syncSizeInputs();
    render();
    commitUndo(before);
  }

  function applyLayout(data, clean) {
    if (!data || typeof data !== 'object') throw new Error('不是地图 JSON');
    var before = snapshot();
    var version = data.version == null ? 1 : data.version;
    if (version !== 1 && version !== 2 && version !== 3) throw new Error('地图版本只支持 1、2 或 3');
    var rows = clampInt(data.rows, MIN_ROWS, MAX_ROWS);
    var columns = clampInt(data.columns, MIN_COLS, version >= 3 ? MAX_COLS : 30);
    if (version <= 2 && rows % 2) throw new Error('v1/v2 地图行数必须为偶数');
    if (!Array.isArray(data.ascii)) throw new Error('缺少 ascii 字符画');
    var mirrorVertical = data.mirrorVertical === true;
    var mirrorHorizontal = data.mirrorHorizontal === true;
    var mirror180 = data.mirror180 === true;
    // 3 人必须不镜像。这里只认**声明的人数**，所以能在算行数之前就判死 —— 报错说到点子上，
    // 否则一张不合规的图会被报成"行数不匹配"，看不出真正原因。
    // 2 人**不拦**：上下镜像可开可关，关掉时 ascii 存整场 —— 行数由下面的 expectedRows 按
    // mirrorVertical 现算，两种都成立，不需要额外分支。
    // ⚠️ 180° 旋转镜像对 2 人仍不成立（会把 1 区转到对角 4 区，不是"上下对折"）、3 人也没有旋转伙伴。
    var declaredPlayers = data.playerCount === 3 || data.playerCount === 4 ? data.playerCount : 2;
    var forced = forcedMirror(declaredPlayers);
    if (forced && (mirrorVertical !== forced.vertical || mirrorHorizontal !== forced.horizontal || mirror180)) {
      throw new Error('3 人地图必须关闭镜像（3 是奇数，翻转配不出第三块分区）');
    }
    // 2 人的 180° 与"锁不锁镜像"无关，得单独拦：forcedMirror 里已经没有 2 人的条目了。
    if (declaredPlayers === 2 && mirror180) {
      throw new Error('2 人地图不能用 180° 旋转镜像（会把 1 区转到对角，要用就用上下镜像）');
    }
    var expectedRows = mirror180 ? rows / 2 : mirrorVertical ? Math.ceil(rows / 2) : rows;
    var expectedCols = version >= 3 && mirrorHorizontal ? Math.ceil(columns / 2) : columns;
    var invalidToken = version <= 1 ? /[^.#-]/ : version === 2 ? /[^.#N-]/ : /[^.#N01234-]/;
    if (data.ascii.length !== expectedRows || data.ascii.some(function (line) {
      return typeof line !== 'string' || line.length !== expectedCols || invalidToken.test(line);
    })) throw new Error('字符画行数或列数不匹配（应为 ' + expectedRows + ' 行 × ' + expectedCols + ' 列）');

    PLAYER_COUNT = data.playerCount === 3 || data.playerCount === 4 ? data.playerCount : 2;
    CITY_MODE = data.cityMode === 'select' ? 'select' : 'fixed';
    ROWS = rows;
    COLS = columns;
    MIRROR_VERTICAL = mirrorVertical;
    MIRROR_HORIZONTAL = mirrorHorizontal;
    passthrough = {};
    ['regions', 'resourcePoints', 'spacing', 'art'].forEach(function (key) {
      if (data[key] !== undefined) passthrough[key] = data[key];
    });
    var importedResourcePoints = Array.isArray(data.resourcePoints) ? data.resourcePoints : [];
    resourcePoints = [];
    delete passthrough.resourcePoints;

    var top = rows - expectedRows;
    var half = version >= 3 && mirrorHorizontal ? Math.ceil(columns / 2) : columns;
    grid = [];
    for (var row = 0; row < rows; row += 1) {
      var line = [];
      for (var column = 0; column < columns; column += 1) {
        var sourceRow, sourceColumn, flip;
        if (mirror180) {
          var lower = row >= rows / 2;
          sourceRow = lower ? rows - 1 - row : row;
          sourceColumn = lower ? columns - 1 - column : column;
          flip = lower ? 3 : 0;
        } else {
          var rowMirrored = mirrorVertical && row < top;
          sourceRow = rowMirrored ? rows - 1 - row - top : row - top;
          var columnMirrored = version >= 3 && mirrorHorizontal && column >= half;
          sourceColumn = columnMirrored ? columns - 1 - column : column;
          flip = (rowMirrored ? 1 : 0) | (columnMirrored ? 2 : 0);
        }
        var value = parseToken(data.ascii[sourceRow][sourceColumn]);
        var section = sectionAfterFlip(value, flip);
        if (section > PLAYER_COUNT) {
          throw new Error(PLAYER_COUNT + ' 人镜像地图里 ' + value + ' 区没有镜像伙伴，不能只画在一侧');
        }
        line.push(section);
      }
      grid.push(line);
    }
    resourcePoints = cloneResourcePoints(importedResourcePoints);
    for (var resourceIndex = 0; resourceIndex < resourcePoints.length; resourceIndex += 1) {
      var resourcePoint = resourcePoints[resourceIndex];
      if (!Number.isInteger(resourcePoint.row) || !Number.isInteger(resourcePoint.column) ||
          resourcePoint.row < 0 || resourcePoint.row >= rows || resourcePoint.column < 0 || resourcePoint.column >= columns ||
          grid[resourcePoint.row][resourcePoint.column] !== NEUTRAL ||
          (resourcePoint.section !== undefined && resourcePoint.section !== 0)) {
        throw new Error('资源点只能落在中立格上，且分区必须为 0');
      }
    }

    homes = [null, null, null, null];
    freeDecor = [];
    nextFreeDecorId = 1;
    selectedFreeDecorId = null;
    var list = Array.isArray(data.homes) && data.homes.length
      ? data.homes
      : (data.playerHome && data.enemyHome ? [data.playerHome, data.enemyHome] : []);
    for (var index = 0; index < PLAYER_COUNT; index += 1) {
      var home = list[index];
      if (!home || !Number.isInteger(home.row) || !Number.isInteger(home.column)) continue;
      if (home.row < 0 || home.row >= rows || home.column < 0 || home.column >= columns) continue;
      homes[index] = { row: home.row, column: home.column };
    }
    var importedFreeDecor = data.art && typeof data.art === 'object' && !Array.isArray(data.art)
      && Array.isArray(data.art.freeDecor) ? data.art.freeDecor : [];
    var importedFreeDecorIds = {};
    for (var freeIndex = 0; freeIndex < importedFreeDecor.length; freeIndex += 1) {
      var freeItem = importedFreeDecor[freeIndex];
      if (!freeItem || typeof freeItem !== 'object' || typeof freeItem.art !== 'string' || !freeItem.art.trim() ||
          !Number.isFinite(freeItem.x) || !Number.isFinite(freeItem.y) ||
          !Number.isFinite(freeItem.width) || freeItem.width < 1 ||
          !Number.isFinite(freeItem.height) || freeItem.height < 1 ||
          (freeItem.rotation !== undefined && !Number.isFinite(freeItem.rotation))) continue;
      var freeId = Number.isInteger(freeItem.id) && freeItem.id > 0 && !importedFreeDecorIds[freeItem.id]
        ? freeItem.id : nextFreeDecorId++;
      while (importedFreeDecorIds[freeId]) freeId = nextFreeDecorId++;
      importedFreeDecorIds[freeId] = true;
      nextFreeDecorId = Math.max(nextFreeDecorId, freeId + 1);
      freeDecor.push({
        id: freeId, art: freeItem.art.trim(), x: freeItem.x, y: freeItem.y,
        width: freeItem.width, height: freeItem.height, rotation: freeItem.rotation || 0,
        flipX: freeItem.flipX === true, flipY: freeItem.flipY === true, locked: freeItem.locked === true
      });
    }
    selectedFreeDecorId = null;
    dropStaleHomes();
    // 旧版 art.tiles 的按格装饰不再导入；装饰统一由 art.freeDecor 编辑和落盘。
    // 背景图：art.background 直接读出来；缺失时回退到默认 zdbg1。客户端 art.background 字段
    // 与编辑器同源，资源名形如 `image/<子目录>/<名字>`（同 deco 命名口径）。
    var artBackground = data.art && typeof data.art === 'object' && !Array.isArray(data.art) ? data.art.background : null;
    if (typeof artBackground === 'string' && artBackground.trim()) {
      backgroundName = artBackground.trim();
    } else {
      backgroundName = DEFAULT_BACKGROUND;
    }
    if (data.id !== undefined) $('mapId').value = data.id;
    if (data.name !== undefined) $('mapName').value = data.name;
    syncControls();
    syncSizeInputs();
    buildBoard();
    render();
    commitUndo(before);
    setDirty(clean === true ? false : true);
  }

  function clearGrid() {
    var before = snapshot();
    newGrid();
    syncControls();
    render();
    commitUndo(before);
    flash('已清空为全中立底图：只保留各方主城盘（主城 + 6 邻格），其余全部是中立格。');
  }

  // ---- 绘制 -------------------------------------------------------------------
  function hexCenter(row, column) {
    return {
      x: (column - (COLS - 1) / 2) * HEX_COL,
      y: -(((ROWS - 1) / 2 - row) * HEX_ROW + (column & 1 ? HEX_PHASE : -HEX_PHASE))
    };
  }
  function hexPathD(cx, cy) {
    // 用**顶面**外框（HEX_TOP_*），不是整图外形 —— 见上面常量处的说明。
    // 🔴 台面在 `hexCenter`（整图中心）**上方** `HEX_TOP_LIFT`，而本文件的 y 是 **SVG 向下**
    //    （见 hexCenter 的取负写法）⇒ 这里必须**减** LIFT。写成加号会把整张网格画低 25px，
    //    与工程格面中心差出 2×LIFT。
    var offsets = [[1, 0], [0.5, 1], [-0.5, 1], [-1, 0], [-0.5, -1], [0.5, -1]]
      .map(function (point) {
        return [point[0] * HEX_TOP_R, point[1] * HEX_TOP_HALF_H - HEX_TOP_LIFT];
      });
    return offsets.map(function (point, index) {
      return (index ? 'L' : 'M') + (cx + point[0]).toFixed(1) + ' ' + (cy + point[1]).toFixed(1);
    }).join('') + 'Z';
  }

  // ---- 笔刷 -------------------------------------------------------------------
  /** 几何邻居：不排除虚空格（笔刷要能贴着海岸线画）。连通性检查另用 neighbors()。 */
  function hexNeighbors(row, column) {
    var dirs = column & 1 ? DIR_ODD : DIR_EVEN;
    var result = [];
    for (var i = 0; i < dirs.length; i += 1) {
      var nextRow = row + dirs[i][1], nextColumn = column + dirs[i][0];
      if (nextRow >= 0 && nextRow < ROWS && nextColumn >= 0 && nextColumn < COLS) {
        result.push({ row: nextRow, column: nextColumn });
      }
    }
    return result;
  }
  /** 笔刷覆盖面：以 (row, column) 为中心、六边形半径 radius。0 = 1 格、1 = 7 格、2 = 19 格。 */
  function brushCells(row, column, radius) {
    var level = radius === undefined ? brushRadius : radius;
    var cells = [{ row: row, column: column }];
    if (!level) return cells;
    var seen = {};
    seen[row * COLS + column] = true;
    var frontier = [{ row: row, column: column }];
    for (var step = 0; step < level; step += 1) {
      var next = [];
      for (var i = 0; i < frontier.length; i += 1) {
        var around = hexNeighbors(frontier[i].row, frontier[i].column);
        for (var j = 0; j < around.length; j += 1) {
          var key = around[j].row * COLS + around[j].column;
          if (seen[key]) continue;
          seen[key] = true;
          cells.push(around[j]);
          next.push(around[j]);
        }
      }
      frontier = next;
    }
    return cells;
  }
  /** 屏幕坐标 → svg 用户坐标。没有 CTM（测试桩 / 降级环境）时按 1:1 处理。 */
  function toLocal(clientX, clientY) {
    var ctm = svg.getScreenCTM ? svg.getScreenCTM() : null;
    if (ctm && typeof ctm.inverse === 'function' && svg.createSVGPoint) {
      var point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      var local = point.matrixTransform(ctm.inverse());
      return { x: local.x, y: local.y };
    }
    return { x: clientX, y: clientY };
  }
  /**
   * 用户坐标落在哪个格：取最近格中心（即六边形 Voronoi），超出格子外框算点在棋盘外。
   * 越界判定**必须分轴**：格子是压扁的（半宽 62 > 半高 45），用单个半径会把上下相邻格之间
   * 那块"其实已经在格外"的区域也算进来 —— 指针明明落在两格中间，却提示落在某一格上。
   */
  function cellAtLocal(x, y) {
    var best = null, bestDistance = Infinity;
    for (var i = 0; i < centers.length; i += 1) {
      var dx = x - centers[i].x, dy = y - centers[i].y;
      var distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; best = centers[i]; }
    }
    if (!best) return null;
    if (Math.abs(x - best.x) > HEX_R || Math.abs(y - best.y) > HEX_HALF_H) return null;
    return { row: best.row, column: best.column };
  }
  /** 沿 from→to 采样出沿途所有格（含笔刷半径）：这是"拖动不漏格"的关键。 */
  function walkStroke(from, to, radius, emit) {
    var dx = to.x - from.x, dy = to.y - from.y;
    var distance = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.max(1, Math.min(600, Math.ceil(distance / STROKE_STEP)));
    for (var i = 0; i <= steps; i += 1) {
      var t = i / steps;
      var cell = cellAtLocal(from.x + dx * t, from.y + dy * t);
      if (!cell) continue;
      var cells = brushCells(cell.row, cell.column, radius);
      for (var j = 0; j < cells.length; j += 1) emit(cells[j]);
    }
  }

  // ---- 视图（滚轮缩放 / 中键或空格平移）----------------------------------------
  /**
   * 当前视口矩形 —— `viewBox` 与背景图盒的**唯一写入口**。
   *
   * 🔴 两处必须是同一个盒子：背景图靠 `preserveAspectRatio="xMidYMid slice"` 做等比 cover
   * 铺满视口，图盒一旦偏离 viewBox，可见区域就只剩图盒与视口的交集（曾多减了一个 halfW/halfH ⇒
   * 右侧与下侧各空半屏，全链路零报错）。共用本函数后这类漂移在结构上不可能发生。
   */
  function viewportRect() {
    var halfW = baseHalfW / zoom, halfH = baseHalfH / zoom;
    return { x: panX - halfW, y: panY - halfH, width: halfW * 2, height: halfH * 2 };
  }
  function applyView() {
    var rect = viewportRect();
    svg.setAttribute('viewBox', rect.x.toFixed(1) + ' ' + rect.y.toFixed(1) + ' ' +
      rect.width.toFixed(1) + ' ' + rect.height.toFixed(1));
    // 背景图占满 viewBox，缩放 / 平移变了必须重画。
    drawBackground();
    fitCanvas();
  }
  /**
   * 画布元素尺寸保持 = viewBox 比例（contain 到 `.stage` 容器）。
   *
   * SVG 默认 `preserveAspectRatio="xMidYMid meet"`：元素比例一旦偏离 viewBox（CSS 里
   * `height:100%` + `max-width:100%` 会把画布拉成任意形状），棋盘与背景只铺在中间一块、
   * 四周露出深色底 —— 用户看到的"棋盘周围一圈黑"。比例对齐后 viewBox 内容恰好铺满画布，
   * 背景**始终全景可见**，平移 / 缩放时与棋盘一起走。
   */
  function fitCanvas() {
    var stage = svg.parentElement;
    if (!stage) return;
    var availW = stage.clientWidth, availH = stage.clientHeight;
    if (!(availW > 0) || !(availH > 0)) return;
    var rect = viewportRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    // zoom 只改 viewBox 世界尺寸、不改比例 ⇒ 算出的像素尺寸不变，同值守卫直接跳过。
    var scale = Math.min(availW / rect.width, availH / rect.height);
    var next = rect.width * scale + 'px', nextH = rect.height * scale + 'px';
    if (svg.style.width === next && svg.style.height === nextH) return;
    svg.style.width = next;
    svg.style.height = nextH;
  }
  function resetView() { zoom = 1; panX = 0; panY = 0; applyView(); }
  function zoomAt(clientX, clientY, factor) {
    var next = Math.max(0.4, Math.min(6, zoom * factor));
    if (next === zoom) return;
    var before = toLocal(clientX, clientY);
    zoom = next;
    applyView();
    var after = toLocal(clientX, clientY);
    panX += before.x - after.x;
    panY += before.y - after.y;
    applyView();
  }

  // ---- 光标预览 ---------------------------------------------------------------
  function buildCursorLayer() {
    cursorLayer = null;
    cursorPaths = [];
    if (!document.createElementNS) return;
    cursorLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    cursorLayer.setAttribute('class', 'cursorLayer');
    cursorLayer.setAttribute('pointer-events', 'none');
    svg.appendChild(cursorLayer);
  }
  function drawCursor(cells) {
    if (!cursorLayer) return;
    while (cursorPaths.length < cells.length) {
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'cursorCell');
      cursorLayer.appendChild(path);
      cursorPaths.push(path);
    }
    for (var i = 0; i < cursorPaths.length; i += 1) {
      if (i >= cells.length) { cursorPaths[i].setAttribute('d', ''); continue; }
      var center = hexCenter(cells[i].row, cells[i].column);
      cursorPaths[i].setAttribute('d', hexPathD(center.x, center.y));
      cursorPaths[i].setAttribute('class', 'cursorCell' + (grid[cells[i].row][cells[i].column] === VOID ? ' on-void' : ''));
    }
  }
  function updateHover(local) {
    hover = local ? cellAtLocal(local.x, local.y) : null;
    drawCursor(hover ? brushCells(hover.row, hover.column, brushRadius) : []);
    updateReadout();
  }
  function updateReadout() {
    var box = $('cursorInfo');
    if (!box) return;
    var size = brushRadius === 0 ? '1×1' : brushRadius === 1 ? '7 格' : '19 格';
    if (!hover) { box.textContent = '指针在棋盘外 · 笔刷 ' + size; return; }
    var value = grid[hover.row][hover.column];
    var resourcePoint = resourcePointAt(hover.row, hover.column);
    var resourceId = resourceIdAt(resourcePoint);
    box.textContent = '(' + hover.row + ', ' + hover.column + ') · ' + sectionLabel(value) +
      (resourceId ? ' · ' + (RESOURCE_LABELS[resourceId] || resourceId) : '') + ' · 笔刷 ' + size;
  }
  function buildBoard() {
    var pad = 3;
    baseHalfW = ((COLS - 1) * HEX_COL + 2 * HEX_R) / 2 + pad;
    baseHalfH = ((ROWS - 1) * HEX_ROW + 2 * HEX_HALF_H + 2 * HEX_PHASE) / 2 + pad;
    var html = '';
    centers = [];
    for (var row = 0; row < ROWS; row += 1) {
      for (var column = 0; column < COLS; column += 1) {
        var center = hexCenter(row, column);
        centers.push({ row: row, column: column, x: center.x, y: center.y });
        html += '<path d="' + hexPathD(center.x, center.y) + '" data-r="' + row +
          '" data-c="' + column + '" class="hex"/>';
      }
    }
    // 渲染层 = 背景 / hex（grid 之前） / 自由装饰 / 资源 —— 文档顺序 = 绘制顺序，
    // 背景要在最底层，资源层最后画（鼠标右键光标预影像之外）。
    svg.innerHTML = '<g class="backgroundLayer"></g>' + html +
      '<g class="freeDecorLayer"></g><g class="resourceLayer"></g>';
    // 整块 svg 换了 ⇒ 背景层是全新的空 <g>，同值守卫的缓存必须作废（否则新层永远不被写入）。
    backgroundMarkupCache = null;
    paths = Array.prototype.slice.call(svg.querySelectorAll('path.hex'));
    buildCursorLayer();
    applyView();
  }

  function freeDecorOverlapsImportantCell(item) {
    var points = [];
    homes.forEach(function (home) { if (home) points.push(hexCenter(home.row, home.column)); });
    resourcePoints.forEach(function (point) { points.push(hexCenter(point.row, point.column)); });
    // 用装饰可视框的旋转后 AABB 做提示，不作为摆放约束；允许用户覆盖后继续保存。
    var radians = Math.abs((item.rotation || 0) * Math.PI / 180);
    var halfWidth = (Math.abs(Math.cos(radians)) * item.width + Math.abs(Math.sin(radians)) * item.height) / 2;
    var halfHeight = (Math.abs(Math.sin(radians)) * item.width + Math.abs(Math.cos(radians)) * item.height) / 2;
    return points.some(function (point) {
      return Math.abs(point.x - item.x) <= halfWidth + HEX_TOP_R
        && Math.abs(point.y - item.y) <= halfHeight + HEX_TOP_HALF_H;
    });
  }
  function freeDecorMarkup() {
    var parts = [];
    var items = freeDecor.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    for (var index = 0; index < items.length; index += 1) {
      var item = items[index];
      var selected = item.id === selectedFreeDecorId;
      var warning = freeDecorOverlapsImportantCell(item);
      var transform = 'translate(' + item.x.toFixed(1) + ' ' + item.y.toFixed(1) + ') rotate(' +
        (item.rotation || 0).toFixed(1) + ') scale(' + (item.flipX ? -1 : 1) + ' ' + (item.flipY ? -1 : 1) + ')';
      var id = esc(item.id);
      parts.push('<g class="freeDecorObject' + (selected ? ' selected' : '') + (warning ? ' warning' : '') +
        (item.locked ? ' locked' : '') + '" data-free-decor-id="' + id + '" transform="' + transform + '">');
      if (decorImages[item.art]) {
        parts.push('<image class="freeDecorImage" data-free-decor-id="' + id + '" href="' + esc(decorUrl(item.art)) +
          '" x="' + (-item.width / 2).toFixed(1) + '" y="' + (-item.height / 2).toFixed(1) +
          '" width="' + item.width.toFixed(1) + '" height="' + item.height.toFixed(1) +
          '" preserveAspectRatio="xMidYMid meet"><title>' + esc(item.art) +
          (warning ? ' · 与主城或资源点重叠' : '') + '</title></image>');
      } else {
        parts.push('<rect class="freeDecorPlaceholder" data-free-decor-id="' + id + '" x="' + (-item.width / 2).toFixed(1) +
          '" y="' + (-item.height / 2).toFixed(1) + '" width="' + item.width.toFixed(1) + '" height="' +
          item.height.toFixed(1) + '"><title>' + esc(item.art) + '</title></rect>');
      }
      if (selected) {
        parts.push('<rect class="freeDecorBounds" x="' + (-item.width / 2).toFixed(1) + '" y="' +
          (-item.height / 2).toFixed(1) + '" width="' + item.width.toFixed(1) + '" height="' +
          item.height.toFixed(1) + '" pointer-events="none"></rect>');
        // 四角缩放柄（同 Cocos 节点编辑器）：每个角一个视觉小圆 + 一个更大的透明命中圆，
        // 命中圆 r=14 让"角点外部一点点"也能抓住；角符号 data-cx/cy 决定缩放时固定哪个对角。
        var corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
        for (var cornerIndex = 0; cornerIndex < corners.length; cornerIndex += 1) {
          var cornerX = corners[cornerIndex][0], cornerY = corners[cornerIndex][1];
          var handleX = (cornerX * item.width / 2).toFixed(1);
          var handleY = (cornerY * item.height / 2).toFixed(1);
          parts.push('<circle class="freeDecorHandle scale" data-free-decor-id="' + id +
            '" data-handle="scale" data-cx="' + cornerX + '" data-cy="' + cornerY +
            '" cx="' + handleX + '" cy="' + handleY + '" r="6"></circle>');
          parts.push('<circle class="freeDecorHandleHit" data-free-decor-id="' + id +
            '" data-handle="scale" data-cx="' + cornerX + '" data-cy="' + cornerY +
            '" cx="' + handleX + '" cy="' + handleY + '" r="14"></circle>');
        }
        parts.push('<circle class="freeDecorHandle rotate" data-free-decor-id="' + id + '" data-handle="rotate" cx="0" cy="' +
          (-item.height / 2 - 18).toFixed(1) + '" r="6"></circle>');
        parts.push('<circle class="freeDecorHandleHit rotateHit" data-free-decor-id="' + id + '" data-handle="rotate" cx="0" cy="' +
          (-item.height / 2 - 18).toFixed(1) + '" r="14"></circle>');
      }
      parts.push('</g>');
    }
    return parts.join('');
  }
  function drawFreeDecor() {
    var layers = svg.querySelectorAll ? svg.querySelectorAll('g.freeDecorLayer') : null;
    if (layers && layers.length) layers[0].innerHTML = freeDecorMarkup();
  }
  /**
   * 背景图层：把 `art.background`（默认 image/zdbg1）铺在棋盘下，**与棋盘一体缩放平移**。
   *
   * 背景中心**锚定棋盘中心 (0,0)**：平移时 viewBox 移动、背景自动跟随（markup 不变，不重画）。
   * 尺寸取 `max(棋盘包围盒, 当前 viewBox)`：
   *   - 放大（viewBox ≤ 包围盒）：背景 = 包围盒，随格子**同比例放大** —— 格子稳稳"在背景上"；
   *   - 缩小（viewBox > 包围盒）：背景 = viewBox，**始终铺满视野** —— 全景可见、无黑边。
   * 溢出由 `preserveAspectRatio="xMidYMid slice"` 切掉（绝不拉伸）。
   * 关闭背景（`showBackground=false`）或名字为空时清空图层，不占绘制。
   */
  /**
   * 背景图标记（纯函数）：图盒中心 (0,0)，宽高 = max(viewBox, 棋盘包围盒)。
   * 包围盒与 `buildBoard` 的 baseHalfW/H 同源（去掉 pad）。
   * 关掉背景或没名字时返回空串。
   */
  function backgroundMarkup() {
    if (!backgroundName || !showBackground) return '';
    var rect = viewportRect();
    var boardWidth = (COLS - 1) * HEX_COL + 2 * HEX_R;
    var boardHeight = (ROWS - 1) * HEX_ROW + 2 * HEX_HALF_H + 2 * HEX_PHASE;
    var width = Math.max(rect.width, boardWidth);
    var height = Math.max(rect.height, boardHeight);
    return '<image class="backgroundImage" href="' + esc('/bg/' + backgroundName) +
      '" x="' + (-width / 2).toFixed(1) + '" y="' + (-height / 2).toFixed(1) +
      '" width="' + width.toFixed(2) + '" height="' + height.toFixed(2) +
      '" preserveAspectRatio="xMidYMid slice"></image>';
  }
  function drawBackground() {
    var layers = svg.querySelectorAll ? svg.querySelectorAll('g.backgroundLayer') : null;
    if (!layers || !layers.length) return;
    var next = backgroundMarkup();
    // 同值守卫：`render()` 每落一笔都会调到这里，无脑重写 innerHTML 会**重建 `<image>` 元素** ——
    // 大图（zdbg1 有 1.6MB）每次都要重新解码，表现为底图闪一下 / 有时整块空白。
    // markup 没变就直接跳过；`buildBoard` 换了整块 svg.innerHTML 时把缓存清掉。
    if (next === backgroundMarkupCache) return;
    backgroundMarkupCache = next;
    layers[0].innerHTML = next;
  }
  function resourceMarkup() {
    var parts = [];
    for (var index = 0; index < resourcePoints.length; index += 1) {
      var point = resourcePoints[index];
      var resourceId = resourceIdAt(point);
      if (!resourceId) continue;
      var center = hexCenter(point.row, point.column);
      var label = RESOURCE_LABELS[resourceId] || resourceId;
      var hasImage = resourceImages[RESOURCE_ASSETS[resourceId]] === true;
      if (hasImage) {
        var href = resourceImageUrl(resourceId);
        parts.push('<image class="resourceImage" href="' + esc(href) + '" x="' + (center.x - 25).toFixed(1) +
          '" y="' + (center.y - 25).toFixed(1) + '" width="50" height="50" preserveAspectRatio="xMidYMid meet">' +
          '<title>' + esc(label) + '</title></image>');
      } else {
        // 没出图的资源（unit_cap / artifact_charge）画文字标记，避免 404。
        parts.push('<text class="resourceFallbackText" x="' + center.x.toFixed(1) +
          '" y="' + (center.y + 5).toFixed(1) + '" text-anchor="middle" font-size="16" fill="#fff">' +
          esc(label.charAt(0)) + '<title>' + esc(label) + '</title></text>');
      }
    }
    return parts.join('');
  }
  function drawResources() {
    var layers = svg.querySelectorAll ? svg.querySelectorAll('g.resourceLayer') : null;
    if (layers && layers.length) layers[0].innerHTML = resourceMarkup();
  }

  // ---- 写入与撤销 -------------------------------------------------------------
  function snapshot() {
    return {
      rows: ROWS, columns: COLS, playerCount: PLAYER_COUNT, cityMode: CITY_MODE,
      mirrorVertical: MIRROR_VERTICAL, mirrorHorizontal: MIRROR_HORIZONTAL,
      grid: grid.map(function (row) { return row.slice(); }),
      freeDecor: cloneFreeDecor(freeDecor),
      resourcePoints: cloneResourcePoints(resourcePoints),
      homes: homes.map(function (home) { return home ? { row: home.row, column: home.column } : null; })
    };
  }
  function sameSnapshot(a, b) {
    if (a.rows !== b.rows || a.columns !== b.columns || a.playerCount !== b.playerCount ||
        a.cityMode !== b.cityMode || a.mirrorVertical !== b.mirrorVertical ||
        a.mirrorHorizontal !== b.mirrorHorizontal) return false;
    for (var index = 0; index < a.homes.length; index += 1) {
      var left = a.homes[index], right = b.homes[index];
      if ((left ? left.row + ':' + left.column : '-') !== (right ? right.row + ':' + right.column : '-')) return false;
    }
    for (var row = 0; row < a.grid.length; row += 1) {
      if (a.grid[row].length !== b.grid[row].length) return false;
      for (var column = 0; column < a.grid[row].length; column += 1) {
        if (a.grid[row][column] !== b.grid[row][column]) return false;
      }
    }
    if (JSON.stringify(a.freeDecor || []) !== JSON.stringify(b.freeDecor || [])) return false;
    if (JSON.stringify(a.resourcePoints || []) !== JSON.stringify(b.resourcePoints || [])) return false;
    return true;
  }
  function syncUndoButtons() {
    var undoButton = $('btnUndo'), redoButton = $('btnRedo');
    if (undoButton) undoButton.disabled = !undoStack.length;
    if (redoButton) redoButton.disabled = !redoStack.length;
  }
  /** 一次可撤销的操作 = 一次指针按下到抬起（或一次菜单动作）。 */
  function pushUndo(before) {
    undoStack.push(before);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    syncUndoButtons();
  }
  function commitUndo(before) {
    if (!before || sameSnapshot(before, snapshot())) return false;
    pushUndo(before);
    markDirty();
    return true;
  }
  function restoreSnapshot(state) {
    ROWS = state.rows;
    COLS = state.columns;
    PLAYER_COUNT = state.playerCount;
    CITY_MODE = state.cityMode;
    MIRROR_VERTICAL = state.mirrorVertical;
    MIRROR_HORIZONTAL = state.mirrorHorizontal;
    grid = state.grid.map(function (row) { return row.slice(); });
    freeDecor = cloneFreeDecor(state.freeDecor || []);
    nextFreeDecorId = freeDecor.reduce(function (next, item) {
      return Number.isInteger(item.id) ? Math.max(next, item.id + 1) : next;
    }, 1);
    if (!freeDecorById(selectedFreeDecorId)) selectedFreeDecorId = null;
    resourcePoints = cloneResourcePoints(state.resourcePoints || []);
    homes = state.homes.map(function (home) { return home ? { row: home.row, column: home.column } : null; });
    while (homes.length < MAX_SECTIONS) homes.push(null);
    syncControls();
    syncSizeInputs();
    buildBoard();
    render();
  }
  function undo() {
    if (!undoStack.length) { flash('没有可撤销的操作', 'err'); return false; }
    redoStack.push(snapshot());
    restoreSnapshot(undoStack.pop());
    markDirty();
    syncUndoButtons();
    return true;
  }
  function redo() {
    if (!redoStack.length) { flash('没有可重做的操作', 'err'); return false; }
    undoStack.push(snapshot());
    restoreSnapshot(redoStack.pop());
    markDirty();
    syncUndoButtons();
    return true;
  }
  function setBrushRadius(radius) {
    var next = Math.max(0, Math.min(BRUSH_RADIUS_MAX, radius));
    if (next === brushRadius) return;
    brushRadius = next;
    syncControls();
    if (hover) drawCursor(brushCells(hover.row, hover.column, brushRadius));
    updateReadout();
  }

  /**
   * 一次写入多格：整批共用一次镜像重算 + 一次重绘。
   * 拖动时每帧只走这里，不用按格重复 applyMirror / render。
   * selected 省略 = 当前笔刷；返回是否真的改了东西。
   */
  function paintCells(cells, selected) {
    var mode = selected === undefined ? brush : selected;
    var changed = false;
    var blocked = 0;
    for (var i = 0; i < cells.length; i += 1) {
      var row = cells[i].row, column = cells[i].column;
      if (!Number.isInteger(row) || !Number.isInteger(column) ||
          row < 0 || row >= ROWS || column < 0 || column >= COLS) continue;
      var source = mirrored() ? sourceCell(row, column) : { row: row, column: column };
      if (mode === 'home' || mode === 'home-clear') {
        if (mode === 'home-clear') {
          // 右键：清除该格上的主城（格子本身不变）。
          for (var clearSlot = 0; clearSlot < PLAYER_COUNT; clearSlot += 1) {
            if (homes[clearSlot] && homes[clearSlot].row === row && homes[clearSlot].column === column) {
              homes[clearSlot] = null;
              changed = true;
            }
          }
          continue;
        }
        // 主城位置不随分区格镜像，用实际点击坐标（跟资源点同理）。
        var homeRow = row, homeColumn = column;
        if (grid[homeRow][homeColumn] === VOID) {
          flash('主城不能放在虚空格上', 'err'); continue;
        }
        if (CITY_MODE === 'fixed') {
          // fixed 模式：必须落在自己分区格上。
          var fixedSection = grid[homeRow][homeColumn];
          if (fixedSection <= NEUTRAL) { flash('主城只能落在某一分区的可通行格上', 'err'); continue; }
          if (!homes[fixedSection - 1] ||
              homes[fixedSection - 1].row !== homeRow || homes[fixedSection - 1].column !== homeColumn) {
            homes[fixedSection - 1] = { row: homeRow, column: homeColumn };
            changed = true;
          }
        } else {
          // select 模式：任意可通行格；点击位置已有某方 home 则更新该方，否则放第一个空 slot。
          var existingSlot = -1;
          for (var slot = 0; slot < PLAYER_COUNT; slot += 1) {
            if (homes[slot] && homes[slot].row === homeRow && homes[slot].column === homeColumn) {
              existingSlot = slot; break;
            }
          }
          if (existingSlot >= 0) continue;
          var emptySlot = -1;
          for (slot = 0; slot < PLAYER_COUNT; slot += 1) {
            if (!homes[slot]) { emptySlot = slot; break; }
          }
          if (emptySlot < 0) {
            flash('每方主城都已放置，先右键清除再移动', 'err');
            return changed;
          }
          homes[emptySlot] = { row: homeRow, column: homeColumn };
          changed = true;
        }
      } else if (mode === 'resource' || mode === 'resource-clear') {
        // 资源点是中立玩法数据，不随分区格镜像：用用户实际点击的坐标，不做 sourceCell 翻转。
        var pointRow = row, pointColumn = column;
        if (mode === 'resource-clear') {
          var resourceIndex = resourcePoints.findIndex(function (point) {
            return point.row === pointRow && point.column === pointColumn;
          });
          if (resourceIndex >= 0) {
            resourcePoints.splice(resourceIndex, 1);
            changed = true;
          }
        } else if (!resourceBrush) {
          flash('请先选择宝箱、金币或金矿图标', 'err');
        } else if (grid[pointRow][pointColumn] !== NEUTRAL) {
          blocked += 1;
        } else {
          var point = { row: pointRow, column: pointColumn, pool: {} };
          point.pool[resourceBrush] = 1;
          var existingIndex = resourcePoints.findIndex(function (entry) {
            return entry.row === pointRow && entry.column === pointColumn;
          });
          var tooClose = resourcePoints.some(function (entry, entryIndex) {
            return entryIndex !== existingIndex && resourcePointDistance(point, entry) < resourceMinDistance();
          });
          if (tooClose) {
            blocked += 1;
          } else if (existingIndex >= 0) {
            if (resourceIdAt(resourcePoints[existingIndex]) !== resourceBrush) {
              resourcePoints[existingIndex] = point;
              changed = true;
            }
          } else {
            resourcePoints.push(point);
            changed = true;
          }
        }
      } else {
        var value = mode === 'void' ? VOID : mode === 'neutral' ? NEUTRAL : Number(mode);
        if (mirrored() && value > 0 && mirrorSection(value) > PLAYER_COUNT) {
          flash('镜像开启时 ' + value + ' 区没有镜像伙伴，请先关闭镜像或改画 1 / 2 区', 'err');
          return changed;
        }
        // 镜像开启时也只写存储侧，对侧由 applyMirror 统一生成。
        if (grid[source.row][source.column] !== value) {
          grid[source.row][source.column] = value;
          changed = true;
        }
      }
    }
    if (!changed) {
      if (blocked) flash('资源只能放在与其他资源相距至少 ' + resourceMinDistance() + ' 格的中立格；已跳过 ' + blocked + ' 格', 'err');
      return false;
    }
    // 用户这一笔可能涂掉主城格或资源点宿主格，所以编辑路径要连带失效检查。
    applyMirrorAndPrune();
    render();
    if (blocked) flash('资源只能放在与其他资源相距至少 ' + resourceMinDistance() + ' 格的中立格；已跳过 ' + blocked + ' 格', 'err');
    return true;
  }
  /** 单格写入：脚本与测试的稳定入口，不扩散笔刷半径。 */
  function paintCell(row, column, selected) {
    return paintCells([{ row: row, column: column }], selected);
  }
  /** 交互写入：以该格为中心按当前笔刷半径扩散。 */
  function paintAt(row, column, selected) {
    return paintCells(brushCells(row, column, brushRadius), selected);
  }

  function neighbors(row, column) {
    var dirs = column & 1 ? DIR_ODD : DIR_EVEN;
    var result = [];
    for (var i = 0; i < dirs.length; i += 1) {
      var nr = row + dirs[i][1], nc = column + dirs[i][0];
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] !== VOID) result.push([nr, nc]);
    }
    return result;
  }

  function sectionCounts() {
    var counts = [0, 0, 0, 0, 0];   // 0 = 中立，1..4 = 分区
    var empty = 0;
    for (var row = 0; row < ROWS; row += 1) {
      for (var column = 0; column < COLS; column += 1) {
        var value = grid[row][column];
        if (value === VOID) { empty += 1; continue; }
        counts[value] += 1;
      }
    }
    return { counts: counts, empty: empty };
  }

  function connectivityReport() {
    var start = null;
    // 主城格可能还没画（在虚空上），拿它当起点会把虚空格也算进 reached，导致 playable - reached 变成负数。
    for (var index = 0; index < PLAYER_COUNT && !start; index += 1) {
      var candidate = homes[index];
      if (candidate && grid[candidate.row][candidate.column] !== VOID) start = candidate;
    }
    if (!start) {
      for (var row = 0; row < ROWS && !start; row += 1) {
        for (var column = 0; column < COLS; column += 1) {
          if (grid[row][column] !== VOID) { start = { row: row, column: column }; break; }
        }
      }
    }
    if (!start) return { reached: 0 };
    var seen = new Set([start.row * COLS + start.column]);
    var queue = [start];
    for (var head = 0; head < queue.length; head += 1) {
      var cell = queue[head];
      var ns = neighbors(cell.row, cell.column);
      for (var i = 0; i < ns.length; i += 1) {
        var id = ns[i][0] * COLS + ns[i][1];
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push({ row: ns[i][0], column: ns[i][1] });
      }
    }
    return { reached: seen.size, hasStart: true };
  }

  function validate() {
    var stats = sectionCounts();
    var checks = [];
    var playable = ROWS * COLS - stats.empty;
    checks.push([playable > 0 ? 'ok' : 'err', '可通行格：' + playable + ' / 虚空：' + stats.empty]);

    var decorTotal = freeDecor.length;
    if (decorTotal) {
      var decorNames = [];
      for (var decorIndex = 0; decorIndex < freeDecor.length; decorIndex += 1) {
        if (decorNames.indexOf(freeDecor[decorIndex].art) < 0) decorNames.push(freeDecor[decorIndex].art);
      }
      checks.push(['ok', '场景装饰：' + decorTotal + ' 个 · ' + decorNames.length + ' 种（' +
        decorNames.slice(0, 3).join(' / ') + (decorNames.length > 3 ? ' 等' : '') + '）']);
    }
    var invalidResources = [];
    var resourceCells = {};
    for (var resourceIndex = 0; resourceIndex < resourcePoints.length; resourceIndex += 1) {
      var resourcePoint = resourcePoints[resourceIndex];
      var resourceKey = resourcePoint.row + ',' + resourcePoint.column;
      var resourcePool = resourcePoint.pool || {};
      var validPool = Object.keys(resourcePool).some(function (id) {
        return typeof resourcePool[id] === 'number' && resourcePool[id] > 0;
      });
      if (!Number.isInteger(resourcePoint.row) || !Number.isInteger(resourcePoint.column) ||
          resourcePoint.row < 0 || resourcePoint.row >= ROWS || resourcePoint.column < 0 || resourcePoint.column >= COLS ||
          grid[resourcePoint.row][resourcePoint.column] !== NEUTRAL || resourceCells[resourceKey] || !validPool) {
        invalidResources.push(resourceKey);
      }
      resourceCells[resourceKey] = true;
    }
    if (invalidResources.length) {
      checks.push(['err', '资源点必须位于唯一的中立格且至少配置一种正权重资源：' + invalidResources.join(' / ')]);
    } else if (resourcePoints.length) {
      checks.push(['ok', '资源点：' + resourcePoints.length + ' 个（固定主城与自选主城地图均可配置）']);
    }

    if (CITY_MODE === 'select') {
      // select 模式全是中立格，不校验分区；显示中立格数与已配置的默认主城。
      checks.push(['ok', '中立格：' + stats.counts[NEUTRAL] + ' 格（自选主城可建在任意格）']);
      var placedHomes = 0;
      for (var homeSlot = 0; homeSlot < PLAYER_COUNT; homeSlot += 1) {
        if (homes[homeSlot]) placedHomes += 1;
      }
      checks.push([placedHomes > 0 ? 'ok' : 'warn',
        '默认主城：' + placedHomes + ' / ' + PLAYER_COUNT + '（未配置时超时随机选点）']);
    } else {
      for (var section = 1; section <= PLAYER_COUNT; section += 1) {
        checks.push([stats.counts[section] > 0 ? 'ok' : 'err',
          section + ' 区：' + stats.counts[section] + ' 格']);
      }
      var counts = stats.counts.slice(1, PLAYER_COUNT + 1);
      var balanced = counts.every(function (value) { return value === counts[0]; });
      checks.push([balanced ? 'ok' : 'warn', '各方格数：' + counts.join(' / ') + (balanced ? '' : '（不强制相等）')]);
    }

    if (mirrored()) {
      var broken = 0;
      for (var row = 0; row < ROWS; row += 1) {
        for (var column = 0; column < COLS; column += 1) {
          if (isStoredCell(row, column)) continue;
          var source = sourceCell(row, column);
          var expected = grid[source.row][source.column];
          expected = expected === VOID ? VOID : sectionAfterFlip(expected, flipBits(row, column));
          if (grid[row][column] !== expected) broken += 1;
        }
      }
      checks.push([broken ? 'err' : 'ok', broken ? '镜像关系不成立（' + broken + ' 格）' : '镜像关系成立']);
    }

    if (CITY_MODE === 'fixed') {
      var missing = [];
      for (var index = 0; index < PLAYER_COUNT; index += 1) {
        var home = homes[index];
        if (!home) { missing.push(index + 1); continue; }
        var onSide = homeOnOwnSide(index, home);
        var cell = grid[home.row][home.column];
        var why = cell === index + 1 ? '' : cell === VOID ? ' 压在虚空上' : cell === NEUTRAL ? ' 压在中立格上' : ' 不在本区';
        checks.push([cell === index + 1 && onSide ? 'ok' : 'err',
          index + 1 + ' 区主城：(' + home.row + ', ' + home.column + ')' + why + (onSide ? '' : '，不在中线己方一侧')]);
      }
      checks.push([missing.length ? 'err' : 'ok',
        missing.length ? '缺少主城：' + missing.join(' / ') + ' 区' : '每方都有一座主城']);
    } else {
      var fallback = [];
      for (var fIndex = 0; fIndex < PLAYER_COUNT; fIndex += 1) {
        var fHome = homes[fIndex];
        if (fHome) fallback.push((fIndex + 1) + '区(' + fHome.row + ',' + fHome.column + ')');
      }
      checks.push(fallback.length
        ? ['ok', '自选主城：默认主城 ' + fallback.join('，') + '（超时未选时落点）']
        : ['ok', '自选主城：未设默认主城，超时未选时随机落点']);
    }

    var report = connectivityReport();
    var connected = report.hasStart === true && report.reached === playable;
    if (report.hasStart) {
      checks.push([connected ? 'ok' : 'err',
        connected ? '全部可通行格连通' : '有 ' + (playable - report.reached) + ' 格不连通']);
    }

    if (homeNeighborWarning()) checks.push(homeNeighborWarning());

    return { counts: stats.counts, empty: stats.empty, playable: playable, connected: connected,
      decor: decorTotal, decorStrays: [], checks: checks };
  }

  function homeNeighborWarning() {
    if (CITY_MODE !== 'fixed') return null;
    var sizes = [];
    for (var index = 0; index < PLAYER_COUNT; index += 1) {
      if (!homes[index]) return null;
      var home = homes[index];
      var count = neighbors(home.row, home.column).length;
      sizes.push(count);
      if (!homeOnOwnSide(index, home)) return null;
    }
    var equal = sizes.every(function (value) { return value === sizes[0]; });
    return equal ? null : ['warn', '主城邻格数：' + sizes.join(' / ')];
  }

  function asciiLines() {
    // 镜像开启时只写 1 区侧的象限（行存下半场、列存左半场），与客户端读入口径一致。
    var startRow = MIRROR_VERTICAL ? topRows() : 0;
    var rowCount = MIRROR_VERTICAL ? ROWS - startRow : ROWS;
    var colCount = MIRROR_HORIZONTAL ? halfCols() : COLS;
    var lines = [];
    for (var offset = 0; offset < rowCount; offset += 1) {
      var row = startRow + offset;
      var line = '';
      for (var column = 0; column < colCount; column += 1) line += tokenOf(grid[row][column]);
      lines.push(line);
    }
    return lines;
  }

  /**
   * 落盘的 art：地块贴图保留分区键，自由装饰统一写入 freeDecor。
   * 旧版 'row,column' 装饰键一律丢掉，避免继续产出无法编辑的装饰。
   * 装饰与透传都为空时返回 null，免得每张图都挂一个空 art 对象。
   */
  function artOut() {
    var source = passthrough.art && typeof passthrough.art === 'object' && !Array.isArray(passthrough.art)
      ? passthrough.art : null;
    var tiles = {};
    var inherited = source && source.tiles && typeof source.tiles === 'object' && !Array.isArray(source.tiles)
      ? source.tiles : null;
    if (inherited) {
      var keys = Object.keys(inherited);
      for (var i = 0; i < keys.length; i += 1) {
        if (DECOR_CELL_KEY.test(keys[i])) continue;
        tiles[keys[i]] = inherited[keys[i]];
      }
    }
    var art = {};
    var sourceKeys = source ? Object.keys(source) : [];
    for (var k = 0; k < sourceKeys.length; k += 1) {
      if (sourceKeys[k] !== 'tiles' && sourceKeys[k] !== 'freeDecor') art[sourceKeys[k]] = source[sourceKeys[k]];
    }
    if (Object.keys(tiles).length) art.tiles = tiles;
    if (freeDecor.length) art.freeDecor = cloneFreeDecor(freeDecor);
    // 背景图：默认 image/zdbg1 不写出来（编辑器启动态默认值），其余都写出 —— 客户端用 art.background
    // 判断"是否有自定义背景"。未点 / 改时为默认值；用户改过后写到 art 上。
    if (backgroundName && backgroundName !== DEFAULT_BACKGROUND) art.background = backgroundName;
    return Object.keys(art).length ? art : null;
  }

  function buildJSON() {
    var id = $('mapId').value.trim() || 'map';
    var name = $('mapName').value.trim() || id;
    var data = {
      id: id, name: name, version: 3, rows: ROWS, columns: COLS,
      playerCount: PLAYER_COUNT, cityMode: CITY_MODE,
      mirrorVertical: MIRROR_VERTICAL, mirrorHorizontal: MIRROR_HORIZONTAL, mirror180: false,
      ascii: asciiLines()
    };
    // fixed 模式 homes 必填；select 模式 homes 是可选的默认主城（fallback）。
    var hasHome = homes.some(function (home) { return !!home; });
    if (CITY_MODE === 'fixed' || hasHome) {
      data.homes = [];
      for (var index = 0; index < PLAYER_COUNT; index += 1) {
        data.homes.push(homes[index] ? { row: homes[index].row, column: homes[index].column } : null);
      }
    }
    ['regions', 'spacing'].forEach(function (key) {
      if (passthrough[key] !== undefined) data[key] = passthrough[key];
    });
    if (resourcePoints.length) data.resourcePoints = cloneResourcePoints(resourcePoints);
    // 场景装饰统一写进 art.freeDecor，不参与格子字符画。
    var art = artOut();
    if (art) data.art = art;
    return data;
  }

  function render() {
    for (var row = 0; row < ROWS; row += 1) {
      for (var column = 0; column < COLS; column += 1) {
        var index = row * COLS + column;
        var value = grid[row][column];
        var home = '';
        for (var slot = 0; slot < MAX_SECTIONS; slot += 1) {
          if (homes[slot] && homes[slot].row === row && homes[slot].column === column) home = ' home-' + (slot + 1);
        }
        var cls = home ? 'hex' + home
          : value === VOID ? 'hex ' + (showGrid ? 'void' : 'void-plain')
            : value === NEUTRAL ? 'hex neutral' : 'hex section-' + value;
        paths[index].setAttribute('class', cls);
      }
    }
    var report = validate();
    // 背景层在最底层，每次重新计算（棋盘尺寸 / 缩放 / 平移变化都会影响）。
    drawBackground();
    // 场景装饰在 hex 之上，格子上色之后再画。
    drawFreeDecor();
    drawResources();
    for (var section = 1; section <= MAX_SECTIONS; section += 1) {
      var cell = $('statS' + section);
      if (!cell) continue;
      cell.textContent = section <= PLAYER_COUNT ? report.counts[section] : '—';
      var wrap = $('statS' + section + 'Wrap');
      if (wrap) wrap.hidden = section > PLAYER_COUNT;
    }
    $('statNeutral').textContent = report.counts[NEUTRAL];
    $('statVoid').textContent = report.empty;
    if ($('statDecor')) $('statDecor').textContent = report.decor;
    renderResourcePanel();
    $('checks').innerHTML = report.checks.map(function (item) {
      var mark = item[0] === 'ok' ? '✓' : item[0] === 'err' ? '!' : '·';
      return '<li><span class="tag ' + item[0] + '">' + mark + '</span><span>' + esc(item[1]) + '</span></li>';
    }).join('');
    $('asciiOut').textContent = asciiLines().join('\n');
    $('jsonOut').textContent = JSON.stringify(buildJSON(), null, 2);
    updateSaveButton();
    if (hover) drawCursor(brushCells(hover.row, hover.column, brushRadius));
    updateReadout();
    syncFreeDecorInspector();
  }

  // ---- 服务端 -----------------------------------------------------------------
  async function api(path, options) {
    var response = await fetch(path, options);
    var body = await response.json();
    if (!response.ok) throw new Error(body.error || '请求失败');
    return body;
  }
  async function loadLibrary() {
    try {
      var result = await api('/api/presets');
      library = {};
      result.presets.forEach(function (preset) { library[preset.id] = preset; });
      renderLibrary();
      var initial = transferredLayout() || library.river || library.standard;
      if (initial) applyLayout(initial, true);
      // 载入预设属于"打开文件"，不该出现在撤销栈里。
      undoStack.length = 0;
      redoStack.length = 0;
      syncUndoButtons();
    } catch (error) {
      showServerLink();
      flash(serviceError(error), 'err');
    }
  }
  /** 装饰清单面板：选中项即装饰笔刷；"不摆装饰"用来擦掉虚空格上已有的装饰。 */
  /**
   * 一张装饰卡片：有图画真缩略图，没图画占位菱形（名字哈希上色）。
   * 卡片上只写末段名（`sea/whirlpool` → `whirlpool`），全名挂 `title` —— 198px 的左栏放不下全名。
   */
  function decorCardHtml(name, hasArt, label) {
    var on = (brush === 'freeDecor' && decorBrush === name) ? ' on' : '';
    var swatch = hasArt
      ? '<img class="swDecorImg" src="' + esc(decorUrl(name)) + '" alt="">'
      : '<span class="swDecor' + (name ? '' : ' plain') + '"' +
        (name ? ' style="background:' + decorColor(name) + '"' : '') + '></span>';
    return '<button class="decorItem' + on + '" data-decor="' + esc(name) + '" title="' +
      esc(name || '不摆装饰 —— 点虚空格清掉上面的装饰') + '">' + swatch +
      '<span class="decorName">' + esc(name ? (label || decorLeafName(name)) : '不摆') + '</span>' +
      (name && !hasArt ? '<span class="decorNoArt">未出图</span>' : '') + '</button>';
  }
  function renderDecorPanel() {
    var box = $('decorList');
    if (!box) return;
    var items = decorLibrary.slice();
    if (decorBrush && items.indexOf(decorBrush) < 0) items.push(decorBrush);
    // 「不摆装饰」不参与分组：它不是一种装饰，是"擦掉"。
    var html = '<div class="decorGroup"><div class="decorGrid">' + decorCardHtml('', false, '') +
      '</div></div>';
    var groups = groupDecorEntries(items, decorImages);
    for (var g = 0; g < groups.length; g += 1) {
      var cards = '';
      for (var i = 0; i < groups[g].items.length; i += 1) {
        var entry = groups[g].items[i];
        cards += decorCardHtml(entry.name, entry.hasArt, entry.label);
      }
      html += '<div class="decorGroup"><p class="decorGroupTitle">' + esc(groups[g].title) +
        '<em>' + groups[g].items.length + '</em></p><div class="decorGrid">' + cards +
        '</div></div>';
    }
    box.innerHTML = html;
    var hint = $('decorHint');
    if (!hint) return;
    var withArt = items.filter(function (name) { return decorImages[name] === true; }).length;
    hint.textContent = items.length
      ? '共 ' + items.length + ' 种、' + groups.length + ' 组（按 image/decor 下的子目录分）：' +
        withArt + ' 种已出图；其余是自定义名（' + (decorRememberSupported
          ? '已记在服务端，刷新不用重填'
          : '没连服务端，只在当前页面有效、刷新要重填') +
        '）。落盘写进 art.freeDecor。'
      : '没扫到装饰资源、也没有自定义名（assets/resources/image/decor 为空或不存在）—— ' +
        '在下面填一个资源名即可开始摆，' + (decorRememberSupported
          ? '这个名字会被记住。' : '没连服务端，这个名字刷新后会丢。');
  }
  async function loadDecorLibrary() {
    try {
      var result = await api('/api/decor');
      decorRememberSupported = true;
      setDecorLibrary(
        Array.isArray(result.decor) ? result.decor : [],
        Array.isArray(result.custom) ? result.custom : [],
        result.sizes,
      );
    } catch (error) {
      // 直接双击 index.html（没连服务）也要能用：清单为空，靠手填资源名。
      // 但"记住了"这句话这时是假的 —— 记在服务端才谈得上持久，所以要把开关关掉，
      // 提示改成"这次能用、刷新要重填"，别让用户以为名字已经存住了。
      decorRememberSupported = false;
      setDecorLibrary([]);
    }
  }
  async function loadResourceLibrary() {
    try {
      var result = await api('/api/map-resources');
      resourceImages = {};
      (Array.isArray(result.assets) ? result.assets : []).forEach(function (asset) { resourceImages[asset] = true; });
    } catch (error) {
      // 直接打开 HTML 时仍可选资源笔刷；本地服务可用后会替换为项目内真实资源缩略图。
      resourceImages = {};
    }
    renderResourcePanel();
  }

  function renderLibrary() {
    var keys = Object.keys(library).sort();
    $('customList').innerHTML = keys.length ? keys.map(function (key) {
      var preset = library[key];
      return '<div class="item" data-key="' + esc(key) + '"><span class="nm">' + esc(preset.name || key) +
        '<em>' + esc(key) + ' · ' + (preset.playerCount || 2) + ' 人 · ' +
        (preset.cityMode === 'select' ? '自选' : '固定') + '</em></span><span class="sz">' +
        preset.columns + '×' + preset.rows + '</span><button class="del" data-del="' + esc(key) +
        '" title="删除预设">×</button></div>';
    }).join('') : '<p class="empty">还没有预设文件，保存当前地图即可创建。</p>';
    updateSaveButton();
  }
  function updateSaveButton() {
    var id = $('mapId').value.trim();
    $('btnSavePreset').textContent = library[id] ? '覆盖预设「' + (library[id].name || id) + '」' : '保存当前为预设';
  }
  async function savePreset() {
    var data = buildJSON();
    if (!/^[a-zA-Z0-9_-]+$/.test(data.id)) { flash('map-id 只能包含英文字母、数字、_ 或 -', 'err'); return; }
    try {
      var result = await api('/api/presets/' + encodeURIComponent(data.id), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      library[data.id] = result.preset;
      renderLibrary();
      setDirty(false);
      flash('已保存到 presets/' + data.id + '.json', 'ok');
    } catch (error) { showServerLink(); flash('保存失败：' + serviceError(error), 'err'); }
  }
  async function deletePreset(key) {
    try {
      await api('/api/presets/' + encodeURIComponent(key), { method: 'DELETE' });
      delete library[key];
      renderLibrary();
      flash('已删除 presets/' + key + '.json', 'ok');
    } catch (error) { showServerLink(); flash('删除失败：' + serviceError(error), 'err'); }
  }

  function syncControls() {
    Array.prototype.forEach.call(document.querySelectorAll('#segCount button'), function (button) {
      button.classList.toggle('on', Number(button.dataset.count) === PLAYER_COUNT);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#segCity button'), function (button) {
      button.classList.toggle('on', button.dataset.mode === CITY_MODE);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.brush'), function (button) {
      var value = button.dataset.brush;
      var section = Number(value);
      var isSection = value !== '' && !isNaN(section);
      button.hidden = isSection ? section > PLAYER_COUNT : false;
      button.classList.toggle('on', isSection ? Number(brush) === section : brush === value);
    });
    // 装饰清单与笔刷列表是两套按钮，但共用 brush——切到别的笔刷时装饰项要跟着灭灯。
    Array.prototype.forEach.call(document.querySelectorAll('.decorItem'), function (button) {
      button.classList.toggle('on', brush === 'freeDecor' && decorBrush === (button.dataset.decor || ''));
    });
    var freeControls = $('freeDecorControls');
    if (freeControls) freeControls.hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll('.resourceItem'), function (button) {
      button.classList.toggle('on', brush === 'resource' && resourceBrush === (button.dataset.resource || ''));
    });
    // 3 人锁"关"：disabled 比"点了弹错再自己回勾"清楚，也堵住键盘可达性绕过。
    // 2 人**不锁** —— 上下镜像默认勾上（`defaultMirror`），但用户可以取消，好摆非对称装饰。
    var locked = forcedMirror(PLAYER_COUNT) !== null;
    $('optMirrorV').checked = MIRROR_VERTICAL;
    $('optMirrorV').disabled = locked;
    $('optMirrorH').checked = MIRROR_HORIZONTAL;
    $('optMirrorH').disabled = PLAYER_COUNT <= 3;
    $('optBackground').checked = showBackground;
    $('hint2').hidden = PLAYER_COUNT !== 2;
    $('hint3').hidden = PLAYER_COUNT !== 3;
    $('hintHome').hidden = CITY_MODE !== 'fixed';
    Array.prototype.forEach.call(document.querySelectorAll('#segBrush button'), function (button) {
      button.classList.toggle('on', Number(button.dataset.radius) === brushRadius);
    });
    syncUndoButtons();
    updateReadout();
    syncFreeDecorInspector();
  }

  function syncFreeDecorInspector() {
    var item = freeDecorById(selectedFreeDecorId);
    var inspector = $('freeDecorInspector');
    if (inspector) inspector.hidden = decorKind !== 'free' || !item;
    var snap = $('freeDecorSnap');
    if (snap) snap.checked = freeDecorSnap;
    var fields = [
      ['freeDecorX', item && item.x], ['freeDecorY', item && item.y],
      ['freeDecorWidth', item && item.width], ['freeDecorHeight', item && item.height],
      ['freeDecorRotation', item && item.rotation || 0]
    ];
    fields.forEach(function (entry) {
      var input = $(entry[0]);
      if (!input) return;
      input.value = item ? String(entry[1]) : '';
      input.disabled = !item || item.locked;
    });
    ['btnFreeDecorFlipX', 'btnFreeDecorFlipY'].forEach(function (id) {
      var button = $(id);
      if (button) button.disabled = !item || item.locked;
    });
    var duplicate = $('btnFreeDecorDuplicate');
    var remove = $('btnFreeDecorDelete');
    var lock = $('btnFreeDecorLock');
    if (duplicate) duplicate.disabled = !item;
    if (remove) remove.disabled = !item;
    if (lock) {
      lock.disabled = !item;
      lock.textContent = item && item.locked ? '解锁' : '锁定';
    }
  }

  function wireEvents() {
    /** 指针位置 → svg 用户坐标；合成事件没有坐标时退回按事件目标格的中心。 */
    function pointerLocal(event) {
      if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        return toLocal(event.clientX, event.clientY);
      }
      var target = event.target;
      if (!target || !target.dataset || target.dataset.r === undefined) return null;
      var center = hexCenter(parseInt(target.dataset.r, 10), parseInt(target.dataset.c, 10));
      return { x: center.x, y: center.y };
    }
    var paintLoop = null;
    function stopPaintLoop() {
      if (paintLoop) { cancelAnimationFrame(paintLoop); paintLoop = null; }
    }
    function endStroke(commit) {
      panning = null;
      markPanning(false);
      stopPaintLoop();
      if (!stroke) return;
      if (commit) commitUndo(stroke.before);
      stroke = null;
    }
    var freeDecorDrag = null;
    function endFreeDecorDrag(commit) {
      if (!freeDecorDrag) return;
      var before = freeDecorDrag.before;
      freeDecorDrag = null;
      if (commit) commitUndo(before);
      syncFreeDecorInspector();
    }
    function markPanning(on) {
      var stage = $('stage');
      if (!stage || !stage.classList) return;
      if (on) stage.classList.add('panning'); else stage.classList.remove('panning');
    }

    svg.addEventListener('pointerdown', function (event) {
      // 中键、或空格 + 左键 = 平移画布。
      if (event.button === 1 || (spaceDown && event.button === 0)) {
        panning = { x: event.clientX, y: event.clientY, panX: panX, panY: panY };
        markPanning(true);
        if (svg.setPointerCapture && event.pointerId !== undefined) svg.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      if (event.button !== 0 && event.button !== 2) return;
      var local = pointerLocal(event);
      if (!local) return;
      var target = event.target && event.target.closest ? event.target.closest('[data-free-decor-id]') : null;
      if (target) {
        var targetId = Number(target.dataset.freeDecorId);
        var targetItem = freeDecorById(targetId);
        if (targetItem) {
          selectFreeDecor(targetId);
          if (event.button === 0 && !targetItem.locked) {
            var handle = target.dataset.handle || '';
            var dx = local.x - targetItem.x, dy = local.y - targetItem.y;
            freeDecorDrag = {
              id: targetId, handle: handle, before: snapshot(), startX: local.x, startY: local.y,
              x: targetItem.x, y: targetItem.y, width: targetItem.width, height: targetItem.height,
              rotation: targetItem.rotation || 0,
              // 按下的缩放角（±1），四个角决定缩放时固定哪个对角。
              cornerX: Number(target.dataset.cx) || 0, cornerY: Number(target.dataset.cy) || 0,
              startDistance: Math.max(1, Math.sqrt(dx * dx + dy * dy)),
              startAngle: Math.atan2(dy, dx) * 180 / Math.PI
            };
            if (svg.setPointerCapture && event.pointerId !== undefined) {
              try { svg.setPointerCapture(event.pointerId); } catch (error) { /* 合成事件没有真实 pointerId */ }
            }
            event.preventDefault();
          }
        }
        return;
      }
      // 自由装饰按地图坐标摆放，空白处即使不在任何格子上也能放置。
      if (decorKind === 'free' && brush === 'freeDecor') {
        if (event.button === 0 && decorBrush) addFreeDecor(decorBrush, local.x, local.y);
        else if (event.button === 0 && selectedFreeDecorId !== null) { selectedFreeDecorId = null; render(); }
        event.preventDefault();
        return;
      }
      var cell = cellAtLocal(local.x, local.y);
      if (!cell) return;
      // 一次按下到抬起 = 一个撤销步；笔画期间只记起点快照。
      // 右键：资源笔刷删除资源点，其余格子笔刷擦成虚空。
      var eraseMode = brush === 'resource' && resourceBrush ? 'resource-clear'
        : brush === 'home' ? 'home-clear' : 'void';
      stroke = {
        before: snapshot(), last: local, erase: eraseMode,
        mode: event.button === 2 ? eraseMode : undefined
      };
      if (svg.setPointerCapture && event.pointerId !== undefined) {
        try { svg.setPointerCapture(event.pointerId); } catch (error) { /* 合成事件没有真实 pointerId */ }
      }
      paintAt(cell.row, cell.column, stroke.mode);
      drawCursor([]);
      event.preventDefault();
      // 按住不放：每帧在当前指针位置重复铺色。
      var autoPaintMode = (event.button === 2) ? (stroke.erase || 'void') : stroke.mode;
      if (autoPaintMode !== 'resource' && autoPaintMode !== 'resource-clear') {
        stopPaintLoop();
        var tick = function () {
          if (!stroke) return;
          var local = pointerLocal(lastPointerEvent);
          if (local) {
            var c = cellAtLocal(local.x, local.y);
            if (c) paintAt(c.row, c.column, autoPaintMode);
          }
          paintLoop = requestAnimationFrame(tick);
        };
        paintLoop = requestAnimationFrame(tick);
      }
    });

    var lastPointerEvent = null;
    svg.addEventListener('pointermove', function (event) {
      lastPointerEvent = event;
      var local = pointerLocal(event);
      if (panning && typeof event.clientX === 'number') {
        var origin = toLocal(panning.x, panning.y);
        panX = panning.panX + (origin.x - local.x);
        panY = panning.panY + (origin.y - local.y);
        applyView();
        return;
      }
      if (freeDecorDrag) {
        var moving = freeDecorById(freeDecorDrag.id);
        if (!moving || moving.locked) { endFreeDecorDrag(false); return; }
        var drag = freeDecorDrag;
        if (drag.handle === 'scale') {
          var radians = drag.rotation * Math.PI / 180;
          var worldDx = local.x - drag.startX, worldDy = local.y - drag.startY;
          var localDx = Math.cos(radians) * worldDx + Math.sin(radians) * worldDy;
          var localDy = -Math.sin(radians) * worldDx + Math.cos(radians) * worldDy;
          // 按下的角（±1）。缩放时**对角固定**、被按角跟随指针 —— 同 Cocos 节点编辑器。
          // 直接点本体（没有角符号）时退化为右下角语义，保证旧行为不丢。
          var sx = drag.cornerX || 1, sy = drag.cornerY || 1;
          if ($('freeDecorRatio').checked) {
            // 等比：因子 = 指针到固定对角的距离 / 起始对角距离。
            var fixedX = -sx * drag.width / 2, fixedY = -sy * drag.height / 2;
            var curX = sx * drag.width / 2 + localDx, curY = sy * drag.height / 2 + localDy;
            var startDist = Math.max(1, Math.sqrt(drag.width * drag.width + drag.height * drag.height));
            var curDist = Math.max(1, Math.sqrt((curX - fixedX) * (curX - fixedX) + (curY - fixedY) * (curY - fixedY)));
            var factor = Math.max(0.05, curDist / startDist);
            moving.width = Math.max(1, drag.width * factor);
            moving.height = Math.max(1, drag.height * factor);
          } else {
            moving.width = Math.max(1, drag.width + 2 * sx * localDx * (moving.flipX ? -1 : 1));
            moving.height = Math.max(1, drag.height + 2 * sy * localDy * (moving.flipY ? -1 : 1));
          }
        } else if (drag.handle === 'rotate') {
          var angle = Math.atan2(local.y - drag.y, local.x - drag.x) * 180 / Math.PI;
          moving.rotation = drag.rotation + angle - drag.startAngle;
        } else {
          var nextX = drag.x + local.x - drag.startX;
          var nextY = drag.y + local.y - drag.startY;
          var point = freeDecorSnap ? nearestHexCenter(nextX, nextY) : { x: nextX, y: nextY };
          moving.x = point.x; moving.y = point.y;
        }
        render();
        return;
      }
      if (!local) return;
      if (!stroke) { updateHover(local); return; }
      // 沿上一采样点到当前点补齐沿途所有格 —— 快速拖动不掉格。
      var mode = (event.buttons & 2) ? (stroke.erase || 'void') : stroke.mode;
      var batch = [], seen = {};
      walkStroke(stroke.last, local, brushRadius, function (cell) {
        var key = cell.row * COLS + cell.column;
        if (seen[key]) return;
        seen[key] = true;
        batch.push(cell);
      });
      stroke.last = local;
      if (batch.length) paintCells(batch, mode);
    });

    svg.addEventListener('pointerleave', function () { if (!stroke) updateHover(null); });
    svg.addEventListener('contextmenu', function (event) { event.preventDefault(); });
    svg.addEventListener('wheel', function (event) {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    window.addEventListener('resize', function () { fitCanvas(); });
    window.addEventListener('pointerup', function () { endStroke(true); endFreeDecorDrag(true); });
    window.addEventListener('blur', function () { endStroke(true); endFreeDecorDrag(true); });
    window.addEventListener('keydown', function (event) {
      var tag = event.target && event.target.tagName ? String(event.target.tagName).toLowerCase() : '';
      var key = event.key || '';
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 's') {
        if (event.preventDefault) event.preventDefault();
        savePreset();
        return;
      }
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (key === ' ') {
        spaceDown = true;
        if (event.preventDefault) event.preventDefault();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        var lower = key.toLowerCase();
        if (lower === 'd' && decorKind === 'free' && selectedFreeDecorId !== null) {
          if (event.preventDefault) event.preventDefault();
          duplicateSelectedFreeDecor();
          return;
        }
        if (lower === 'z' && !event.shiftKey) { if (event.preventDefault) event.preventDefault(); undo(); return; }
        if ((lower === 'z' && event.shiftKey) || lower === 'y') {
          if (event.preventDefault) event.preventDefault();
          redo();
        }
        return;
      }
      if (decorKind === 'free' && selectedFreeDecorId !== null && (key === 'Delete' || key === 'Backspace')) {
        if (event.preventDefault) event.preventDefault();
        deleteSelectedFreeDecor();
      }
      else if (decorKind === 'free' && selectedFreeDecorId !== null &&
               (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown')) {
        if (event.preventDefault) event.preventDefault();
        var item = freeDecorById(selectedFreeDecorId);
        var nudge = event.shiftKey ? 1 : 5;
        if (item) {
          var nx = item.x + (key === 'ArrowLeft' ? -nudge : key === 'ArrowRight' ? nudge : 0);
          var ny = item.y + (key === 'ArrowUp' ? -nudge : key === 'ArrowDown' ? nudge : 0);
          moveSelectedFreeDecor(nx, ny);
        }
      }
      else if (key === '[') setBrushRadius(brushRadius - 1);
      else if (key === ']') setBrushRadius(brushRadius + 1);
      else if (key === '0') resetView();
    });
    window.addEventListener('keyup', function (event) { if ((event.key || '') === ' ') spaceDown = false; });
    window.addEventListener('beforeunload', function (event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });

    var brushes = document.querySelectorAll('.brush');
    for (var i = 0; i < brushes.length; i += 1) {
      brushes[i].addEventListener('click', function () {
        var value = this.dataset.brush;
        brush = isNaN(Number(value)) ? value : Number(value);
        syncControls();
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('#segBrush button'), function (button) {
      button.addEventListener('click', function () { setBrushRadius(Number(this.dataset.radius)); });
    });
    $('freeDecorSnap').addEventListener('change', function () { setFreeDecorSnap(this.checked); });
    $('btnFreeDecorDuplicate').addEventListener('click', duplicateSelectedFreeDecor);
    $('btnFreeDecorDelete').addEventListener('click', deleteSelectedFreeDecor);
    $('btnFreeDecorLock').addEventListener('click', toggleSelectedFreeDecorLock);
    $('btnFreeDecorFlipX').addEventListener('click', function () {
      var item = freeDecorById(selectedFreeDecorId);
      if (item) updateSelectedFreeDecor({ flipX: !item.flipX });
    });
    $('btnFreeDecorFlipY').addEventListener('click', function () {
      var item = freeDecorById(selectedFreeDecorId);
      if (item) updateSelectedFreeDecor({ flipY: !item.flipY });
    });
    function bindFreeDecorNumber(id, key) {
      $(id).addEventListener('change', function () {
        var value = Number(this.value);
        if (!Number.isFinite(value)) { syncFreeDecorInspector(); return; }
        var patch = {}; patch[key] = value;
        var item = freeDecorById(selectedFreeDecorId);
        if (item && $('freeDecorRatio').checked && (key === 'width' || key === 'height')) {
          var ratio = item.width / item.height;
          if (key === 'width') patch.height = Math.max(1, value / ratio);
          else patch.width = Math.max(1, value * ratio);
        }
        updateSelectedFreeDecor(patch);
      });
    }
    bindFreeDecorNumber('freeDecorX', 'x');
    bindFreeDecorNumber('freeDecorY', 'y');
    bindFreeDecorNumber('freeDecorWidth', 'width');
    bindFreeDecorNumber('freeDecorHeight', 'height');
    bindFreeDecorNumber('freeDecorRotation', 'rotation');
    if ($('btnUndo')) $('btnUndo').addEventListener('click', undo);
    if ($('btnRedo')) $('btnRedo').addEventListener('click', redo);
    if ($('btnFit')) $('btnFit').addEventListener('click', resetView);
    Array.prototype.forEach.call(document.querySelectorAll('#segCount button'), function (button) {
      button.addEventListener('click', function () { setPlayerCount(Number(this.dataset.count)); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#segCity button'), function (button) {
      button.addEventListener('click', function () { setCityMode(this.dataset.mode); });
    });
    $('optGrid').addEventListener('change', function () { showGrid = this.checked; render(); });
    $('optBackground').addEventListener('change', function () { showBackground = this.checked; render(); });
    // 2 人必开 / 3 人必关的强制收在 setMirror 里（唯一入口）；这里只把用户的勾传下去。
    $('optMirrorV').addEventListener('change', function () {
      setMirror(this.checked, MIRROR_HORIZONTAL);
    });
    $('optMirrorH').addEventListener('change', function () { setMirror(MIRROR_VERTICAL, this.checked); });
    $('inCols').addEventListener('change', function () { setSize(ROWS, this.value); });
    $('inRows').addEventListener('change', function () { setSize(this.value, COLS); });
    $('mapId').addEventListener('input', function () { markDirty(); render(); });
    $('mapName').addEventListener('input', function () { markDirty(); render(); });
    $('btnClear').addEventListener('click', clearGrid);
    $('btnSavePreset').addEventListener('click', savePreset);
    $('openServer').addEventListener('click', function () {
      this.href = SERVER_URL + '#map=' + encodeURIComponent(JSON.stringify(buildJSON()));
    });
    $('btnImport').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try { applyLayout(JSON.parse(reader.result), false); flash('地图已导入，可保存为预设', 'ok'); }
        catch (error) { flash('导入失败：' + error.message, 'err'); }
      };
      reader.readAsText(file);
      this.value = '';
    });
    $('customList').addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.dataset && target.dataset.del !== undefined) {
        deletePreset(target.dataset.del);
        return;
      }
      var item = target && target.closest ? target.closest('.item') : null;
      if (item && library[item.dataset.key]) applyLayout(library[item.dataset.key], true);
    });
    // 装饰清单是动态生成的，用事件委托收点击。
    $('decorList').addEventListener('click', function (event) {
      var target = event.target;
      var item = target && target.closest ? target.closest('.decorItem') : null;
      if (item) {
        setDecorBrush(item.dataset.decor || '');
        if (decorKind === 'free') flash('已选中自由装饰：点击画布空白处放置，然后拖动调整', 'ok');
      }
    });
    $('btnDecorAdd').addEventListener('click', function () {
      var input = $('inDecor');
      var name = input ? String(input.value || '').trim() : '';
      if (!name) { flash('先填一个装饰资源名，例如 reef_01', 'err'); return; }
      setDecorBrush(name);
      if (input) input.value = '';
      flash('已选中装饰「' + name + '」：点击画布放置，可拖动和调整大小', 'ok');
    });
    $('resourceList').addEventListener('click', function (event) {
      var target = event.target;
      while (target && (!target.dataset || !target.dataset.resource)) target = target.parentNode;
      if (!target || !target.dataset || !target.dataset.resource) return;
      setResourceBrush(target.dataset.resource);
      flash('已选择' + (RESOURCE_LABELS[target.dataset.resource] || target.dataset.resource) + '：点击中立格放置，右键删除', 'ok');
    });
  }

  newGrid();
  buildBoard();
  wireEvents();
  syncControls();
  syncSizeInputs();
  render();
  loadLibrary();
  loadDecorLibrary();
  loadResourceLibrary();

  window.__editor = {
    setSize: setSize, setPlayerCount: setPlayerCount, setCityMode: setCityMode, setMirror: setMirror,
    // 镜像策略：`forcedMirror` = 锁死项（非 null 才不可改），`defaultMirror` = 切人数时的默认值。
    // 两者都暴露出来，探针/用例才能断言"默认开但不是强制"这件事本身，而不是只测副作用。
    forcedMirror: forcedMirror, defaultMirror: defaultMirror,
    applyLayout: applyLayout, clearGrid: clearGrid,
    paint: paintCell, paintCells: paintCells, brushCells: brushCells, hexNeighbors: hexNeighbors,
    toLocal: toLocal, cellAtLocal: cellAtLocal, walkStroke: walkStroke, hexCenter: hexCenter,
    setBrushRadius: setBrushRadius, undo: undo, redo: redo, resetView: resetView, zoomAt: zoomAt,
    setDecorBrush: setDecorBrush, setDecorLibrary: setDecorLibrary,
    setDecorKind: setDecorKind, addFreeDecor: addFreeDecor, selectFreeDecor: selectFreeDecor,
    moveSelectedFreeDecor: moveSelectedFreeDecor, updateSelectedFreeDecor: updateSelectedFreeDecor,
    duplicateFreeDecor: duplicateFreeDecor, deleteFreeDecor: deleteFreeDecor,
    setFreeDecorLocked: setFreeDecorLocked, setFreeDecorSnap: setFreeDecorSnap,
    freeDecorMarkup: freeDecorMarkup,
    rememberDecorName: rememberDecorName, groupDecorEntries: groupDecorEntries,
    setResourceBrush: setResourceBrush, resourceMarkup: resourceMarkup,
    addResourcePoint: addResourcePoint, removeResourcePoint: removeResourcePoint,
    // 视图矩形 / 背景图标记：判据要能断言「图盒 == viewBox」（见 viewportRect 的红字说明）。
    viewportRect: viewportRect, backgroundMarkup: backgroundMarkup, fitCanvas: fitCanvas,
    snapshot: snapshot, commitUndo: commitUndo,
    buildJSON: buildJSON, validate: validate,
    // 画布几何：与工程渲染间距 1:1（来源 ZCGameViewUtil）。探针与用例都靠它断言，
    // 免得把 92.25/90/顶面 123×90 这些数字散在测试里各写一份。
    // tileWidth/Height = 顶面尺寸（= hexPathD 画的外框），halfWidth/Height 同源。
    // 立体地块的整图（130×119）另见 topLift / imageWidth / imageHeight。
    geometry: {
      column: HEX_COL, row: HEX_ROW, phase: HEX_PHASE,
      halfWidth: HEX_TOP_R, halfHeight: HEX_TOP_HALF_H,
      tileWidth: HEX_TOP_R * 2, tileHeight: HEX_TOP_HALF_H * 2,
      topLift: HEX_TOP_LIFT,
      imageWidth: HEX_R * 2, imageHeight: HEX_HALF_H * 2,
    },
    state: function () {
      return {
        rows: ROWS, cols: COLS, playerCount: PLAYER_COUNT, cityMode: CITY_MODE,
        brush: brush,
        mirrorVertical: MIRROR_VERTICAL, mirrorHorizontal: MIRROR_HORIZONTAL,
        brushRadius: brushRadius, zoom: zoom, panX: panX, panY: panY,
        undoDepth: undoStack.length, redoDepth: redoStack.length,
        grid: grid.map(function (row) { return row.slice(); }),
        freeDecor: cloneFreeDecor(freeDecor), selectedFreeDecorId: selectedFreeDecorId,
        freeDecorSnap: freeDecorSnap, decorKind: decorKind,
        decorBrush: decorBrush, decorLibrary: decorLibrary.slice(),
        decorImages: Object.keys(decorImages).sort(),
        decorSizes: decorSizes,
        decorRememberSupported: decorRememberSupported,
        resourceBrush: resourceBrush, resourceImages: Object.keys(resourceImages).sort(),
        resourcePoints: cloneResourcePoints(resourcePoints),
        homes: homes.slice(0, MAX_SECTIONS), paths: paths.length, json: buildJSON()
      };
    }
  };
})();
