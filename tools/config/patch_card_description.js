// 把设计案「卡牌描述与落地」页的**卡牌描述**写进 `pvpCard.description` 的两份 JSON。
//
// 配套脚本：`patch_card_description.py` 负责 `PVP-卡牌.xlsx / 卡牌配置` 的 I 列。
// 两个脚本读同一份设计页（A 列卡牌 ID、F 列卡牌描述），各自幂等，跑的顺序无所谓。
//
// 为什么单独一个脚本：`assets/remoteRef/*.json` 是 CRLF 列存、`json/client/*.json` 是单行 LF，
// 格式差得很细（见 `ref_table_io.js` 抬头），用 `ref_table_io` 读写才不会把整份文件重排版。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readTable, writeTable } = require('./ref_table_io.js');

const ROOT = 'D:/Alan/Project/POW';
const REMOTE = path.join(__dirname, '../../assets/remoteRef');
const CLIENT = path.join(ROOT, 'doc/塔防数据配置/json/client');
const DESIGN = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx';

/** 用工程里的 `xlsx_read.py` 读设计页（共享字符串自己解析会把索引当正文，别手写正则）。 */
function readDescriptions() {
    const output = execFileSync('python', ['-c', `
import sys, json
sys.path.insert(0, '${path.join(__dirname).replace(/\\/g, '/')}')
from xlsx_read import read_sheet
for index in range(10):
    try:
        name, rows = read_sheet(r'${DESIGN}', index)
    except Exception:
        continue
    if name != '卡牌描述与落地':
        continue
    out = []
    for _, cells in rows:
        if not cells or len(cells) < 6:
            continue
        try:
            card = int(str(cells[0]).strip())
        except (TypeError, ValueError):
            continue
        out.append([card, str(cells[5] or '').strip()])
    print(json.dumps(out, ensure_ascii=False))
    break
`], { encoding: 'utf8' });
    return new Map(JSON.parse(output));
}

function apply(table, expected) {
    let changed = 0;
    for (const row of table.rows) {
        if (row.id == null) continue;
        const text = expected.get(Number(row.id));
        if (!text || row.description === text) continue;
        row.description = text;
        changed += 1;
    }
    return changed;
}

function main() {
    const expected = readDescriptions();
    if (expected.size < 30) throw new Error(`只读到 ${expected.size} 张卡的描述，设计页结构可能变了`);
    for (const directory of [REMOTE, CLIENT]) {
        const file = path.join(directory, 'pvpCard.json');
        const table = readTable(file);
        const changed = apply(table, expected);
        if (changed) writeTable(file, table);
        console.log(`[ok] ${path.relative(ROOT, file)}：${changed} 行`);
    }
    console.log(`[ok] 设计页 ${expected.size} 张卡的描述已写进两份 pvpCard.json`);
}

main();
