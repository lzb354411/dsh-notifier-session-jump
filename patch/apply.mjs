// 应用补丁（写入已装插件；任何一条锚点不唯一就整体中止、不写文件）
import { buildGroups } from './edits.mjs';
import { applyPatch } from './apply-engine.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const timestampArg = args.find((a) => a.startsWith('--timestamp='));

const result = applyPatch(buildGroups(), {
  dryRun,
  timestamp: timestampArg ? timestampArg.slice('--timestamp='.length) : undefined,
});

if (!result.ok) {
  console.log('补丁中止，未写入任何文件：');
  for (const f of result.failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`补丁应用${result.dryRun ? '（试运行，未写盘）' : '成功'}`);
console.log(`  时间戳：${result.timestamp ?? '(试运行未取)'}`);
console.log(`  备份根：${result.backupRoot ?? '(试运行未备份)'}`);
if (result.dryRun) {
  const total = result.analyses.reduce((n, a) => n + a.pending.length, 0);
  console.log(`  试运行结论：${total === 0 ? '补丁已在位，无需改动' : `共 ${total} 条待应用；试运行不写任何文件`}`);
} else {
  console.log(`  写入文件：${result.wrote.length === 0 ? '（无变化，已应用过）' : result.wrote.join('、')}`);
}
for (const a of result.analyses) {
  console.log(`  ${a.rel}：新增应用 ${a.pending.length} 条，此前已应用 ${a.applied.length} 条`);
}
