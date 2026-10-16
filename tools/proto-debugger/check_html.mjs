/**
 * 校验 index.html：内联脚本语法、外部引用存在、页面标题。
 * 用法：node tools/proto-debugger/check_html.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = resolve(HERE, 'index.html');
const html = readFileSync(HTML, 'utf8');

let failed = false;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed = true; };

const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1];
ok(!!title && title.trim().length > 0, '页面标题非空：' + (title || '(缺失)'));

const inline = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
ok(inline.length >= 1, `内联 script 数量 ${inline.length}`);
inline.forEach((m, i) => {
    try {
        new Function(m[1]); // 仅编译检查语法，不执行
        ok(true, `内联 script #${i + 1} 语法 OK（${m[1].length} 字符）`);
    } catch (e) {
        ok(false, `内联 script #${i + 1} 语法错误：${e.message}`);
    }
});

const refs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
for (const r of refs) ok(existsSync(resolve(HERE, r)), `外部引用存在：${r}`);

process.exit(failed ? 1 : 0);
