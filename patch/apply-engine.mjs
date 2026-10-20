// dsh-notifier 会话跳转补丁 · 应用引擎
//
// 安全底线（对应 PLAN 的风险表第 3 条）：
//   1. 逐条替换，**命中次数必须恰好 1**；任何一条不满足就整体中止，且**不写出任何文件**
//      —— 半途而废的补丁比不打补丁更糟。
//   2. 写之前自动备份（原路径层次 + 同目录 .bak-时间戳）。
//   3. 幂等：已经打过补丁的文件（原文找不到、但新文找得到）记为「已应用」，可重复运行。
//   4. 只写目标插件目录内的文件，路径必须落在白名单前缀下。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PLUGIN_DIR as DEFAULT_PLUGIN_DIR, BACKUP_ROOT as DEFAULT_BACKUP_ROOT } from '../paths.mjs';

// 路径统一由 ../paths.mjs 解析（可用环境变量覆盖），这里再导出一次，
// 让调用方（apply.mjs / verify 脚本）不必关心它们从哪来。
export const PLUGIN_DIR = DEFAULT_PLUGIN_DIR;
export const BACKUP_ROOT = DEFAULT_BACKUP_ROOT;

/** 补丁只允许写插件目录内的文件；任何越界路径一律拒绝。 */
export function resolveTarget(rel, pluginDir = PLUGIN_DIR) {
  const abs = path.resolve(pluginDir, rel);
  const root = path.resolve(pluginDir) + path.sep;
  if (!abs.startsWith(root)) {
    throw new Error(`拒绝越界路径（不在插件目录内）：${rel}`);
  }
  return abs;
}

function countOccurrences(haystack, needle) {
  if (needle.length === 0) throw new Error("空锚点不被接受");
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    n += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return n;
}

/**
 * 分析一组改动（不改文件）。
 * @returns {{ rel, abs, text, applied: string[], pending: string[], failures: string[] }}
 */
export function analyze(rel, edits, pluginDir = PLUGIN_DIR) {
  const abs = resolveTarget(rel, pluginDir);
  const original = fs.readFileSync(abs, 'utf8');
  let text = original;
  const applied = [];
  const pending = [];
  const failures = [];
  const staged = [];

  for (const edit of edits) {
    // 幂等判据用「新文是否已在」而不是「原文是否消失」：
    // 本补丁有一类**插入式**改动（replace 里原样保留了 find 那段，只是多插了几行），
    // 对这类改动原文永远还在，用「原文消失」当判据会导致**重复插入**（实测踩到过：
    // 重放一次就把 sessionIdOf / createSessionJumper 各多定义一遍）。
    if (text.includes(edit.replace)) {
      applied.push(edit.id);
      continue;
    }
    const findInText = countOccurrences(text, edit.find);
    const findInOriginal = countOccurrences(original, edit.find);

    if (findInOriginal !== 1) {
      failures.push(
        `${edit.id}: 原文件锚点命中 ${findInOriginal} 次（期望恰好 1 次）` +
          (findInOriginal === 0 ? " —— 文件版本可能已变，请重放前先核对" : "")
      );
      continue;
    }
    if (findInText !== 1) {
      failures.push(`${edit.id}: 暂存文本锚点命中 ${findInText} 次（期望恰好 1 次；改动之间可能相互覆盖）`);
      continue;
    }
    // 在**暂存文本**上顺序应用：后一条改动看得见前一条的结果。
    text = text.replace(edit.find, edit.replace);
    staged.push(edit.id);
    pending.push(edit.id);
  }

  return { rel, abs, original, text, applied, pending, staged, failures };
}

/**
 * 应用补丁。任何失败都不写文件。
 * @param opts.dryRun 只分析不写盘
 * @param opts.timestamp 备份时间戳（默认当前时间）
 */
export function applyPatch(groups, opts = {}) {
  const pluginDir = opts.pluginDir ?? PLUGIN_DIR;
  const dryRun = opts.dryRun === true;
  const timestamp = opts.timestamp ?? stamp();
  const analyses = groups.map((g) => ({ ...analyze(g.rel, g.edits, pluginDir), edits: g.edits }));

  const failures = analyses.flatMap((a) => a.failures.map((f) => `${a.rel} → ${f}`));

  // 事后自检（防止「重复插入」这类静默损坏）：每条改动的新文在最终文本里必须**恰好出现 1 次**。
  // 少了说明没打上或被后续改动覆盖，多了说明被重复插入 —— 两种都不允许落盘。
  // 注意：这条自检只在「这条改动本该生效」时成立（已应用过的改动，其新文本来就该在文件里，
  // 也正好出现 1 次，所以对已应用项同样成立）。
  for (const a of analyses) {
    for (const edit of a.edits) {
      const n = countOccurrences(a.text, edit.replace);
      if (n !== 1) {
        failures.push(`${a.rel} → ${edit.id}: 新文在最终文本中出现 ${n} 次（期望恰好 1 次）`);
      }
    }
  }

  if (failures.length > 0) {
    return { ok: false, failures, analyses, wrote: [], backupRoot: null };
  }
  if (dryRun) {
    return { ok: true, failures: [], analyses, wrote: [], backupRoot: null, dryRun: true };
  }

  // 先备份（原路径层次 + 同目录 .bak），再写。
  const backupRoot = path.join(BACKUP_ROOT, timestamp);
  const wrote = [];
  const backup = [];
  for (const a of analyses) {
    if (a.pending.length === 0) continue; // 无需改动（已应用）
    const relToHome = path.relative(path.parse(os.homedir()).root, a.abs);
    const dest = path.join(backupRoot, relToHome);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(a.abs, dest);
    fs.copyFileSync(a.abs, `${a.abs}.bak-${timestamp}`);
    backup.push(dest);
    fs.writeFileSync(a.abs, a.text, 'utf8');
    wrote.push(a.rel);
  }

  return { ok: true, failures: [], analyses, wrote, backup, backupRoot, timestamp, dryRun: false };
}

export function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 只读复核：每条改动现在是「已应用 / 未应用 / 异常」。
 *
 * 判据取「新文是否在文件里」而不是「原文是否消失」——本补丁里有一类**插入式**改动
 * （replace 里原样保留了 find 那段，只是在它前面／里面多插了几行）。对这类改动，
 * 「原文仍在」是正常现象，拿它当判据会误报成异常（实测踩到过：4 条误报）。
 */
export function verifyPatch(groups, opts = {}) {
  const pluginDir = opts.pluginDir ?? PLUGIN_DIR;
  const rows = [];
  let allApplied = true;
  for (const g of groups) {
    const abs = resolveTarget(g.rel, pluginDir);
    const text = fs.readFileSync(abs, 'utf8');
    for (const edit of g.edits) {
      const findN = countOccurrences(text, edit.find);
      const hasNew = text.includes(edit.replace);
      let state;
      if (hasNew) state = "已应用";
      else if (findN === 1) state = "未应用";
      else if (findN === 0) state = "异常（锚点与新文都找不到）";
      else state = `异常（锚点命中 ${findN} 次且新文缺失）`;
      if (state !== "已应用") allApplied = false;
      rows.push({ file: g.rel, id: edit.id, state, findN, hasNew });
    }
  }
  return { allApplied, rows };
}

/**
 * 结构性复核：把当前文件与备份逐条对比，确认「改动集之外的差异数为 0」。
 * 这是比逐条锚点更硬的证据——它回答「除了我们想改的，还动了别的没有」。
 */
export function diffAgainstBackup(groups, backupFileOf, opts = {}) {
  const pluginDir = opts.pluginDir ?? PLUGIN_DIR;
  const rows = [];
  for (const g of groups) {
    const abs = resolveTarget(g.rel, pluginDir);
    const backupPath = backupFileOf(g.rel);
    if (backupPath === null) {
      rows.push({ file: g.rel, comparable: false, note: "无备份可比" });
      continue;
    }
    const before = fs.readFileSync(backupPath, 'utf8');
    const after = fs.readFileSync(abs, 'utf8');
    // 把每条改动的「新增文本」从 after 里抠掉，理论上应还原出 before。
    let reconstructed = after;
    const pending = [...g.edits];
    // 逐条反向还原：把 replace 换回 find（顺序逆向，保证嵌套安全）
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const edit = pending[i];
      const at = reconstructed.indexOf(edit.replace);
      if (at < 0) continue;
      reconstructed = reconstructed.slice(0, at) + edit.find + reconstructed.slice(at + edit.replace.length);
    }
    rows.push({
      file: g.rel,
      comparable: true,
      identicalAfterReverse: reconstructed === before,
      beforeBytes: before.length,
      afterBytes: after.length,
      deltaBytes: after.length - before.length,
    });
  }
  return rows;
}
