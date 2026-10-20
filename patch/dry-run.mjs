// 试运行（dry-run）：只分析、不写盘。任何锚点不是唯一命中都会报出来。
import { buildGroups } from './edits.mjs';
import { analyze } from './apply-engine.mjs';

const groups = buildGroups();
let bad = 0;
const seen = new Set();
for (const g of groups) {
  const a = analyze(g.rel, g.edits);
  const uniqFind = new Set(g.edits.map((e) => e.find)).size;
  if (uniqFind !== g.edits.length) {
    console.log(`!! ${g.rel}: 改动集内有重复锚点`);
    bad += 1;
  }
  for (const e of g.edits) {
    if (seen.has(e.id)) console.log(`!! 改动 id 重复：${e.id}`);
    seen.add(e.id);
  }
  console.log(`\n=== ${g.rel} （${g.edits.length} 条改动）===`);
  for (const f of a.failures) { console.log(`  ✗ ${f}`); bad += 1; }
  console.log(`  已应用=${a.applied.length} 待应用=${a.pending.length} 失败=${a.failures.length}`);
  for (const id of a.pending) console.log(`    · 待应用 ${id}`);
  for (const id of a.applied) console.log(`    · 已应用 ${id}`);
}
console.log(`\n汇总：共 ${seen.size} 条改动，问题 ${bad} 处`);
process.exit(bad === 0 ? 0 : 1);
