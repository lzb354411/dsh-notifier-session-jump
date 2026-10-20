// 断言 1：补丁后的 client.js 能被模块加载器接受，导出契约未变，
// 且「官方会话导航服务不存在」时插件装载不报错（这是 F4 的核心前提）。
import { makeEnv } from './env.mjs';
import { CLIENT_ARTIFACT } from '../paths.mjs';
import fs from 'node:fs';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? " —— " + detail : ""}`); }
};

const env = makeEnv({ workspace: "ok" });
const m = env.moduleExports;

console.log("=== A. 装载与导出契约 ===");
check("模块注册成功（__ModuleLoader__.load 被调用）", env.entry !== undefined);
check("注册 id 仍是 @wingsky-1/dsh-notifier", env.entry.id === "@wingsky-1/dsh-notifier", String(env.entry?.id));
check("导出 apply 是函数", typeof m.apply === "function");
check("导出 inject 仍是 ['slots','locale']（未新增依赖 → 服务缺失不会导致装载失败）",
  JSON.stringify(m.inject) === JSON.stringify(["slots", "locale"]), JSON.stringify(m.inject));

console.log("\n=== B. uiWorkspace 完全不存在时，apply 装载不得抛错 ===");
{
  const envAbsent = makeEnv({ workspace: "absent" });
  let threw = null;
  try { envAbsent.moduleExports.apply(envAbsent.ctx); } catch (e) { threw = e; }
  check("装载不抛错（通知功能照常工作）", threw === null, threw && threw.message);
  check("注册了清理回调", envAbsent.effects.length >= 1, `effects=${envAbsent.effects.length}`);
  let cleanThrew = null;
  try { for (const e of envAbsent.effects) e(); } catch (e) { cleanThrew = e; }
  check("清理回调执行不抛错", cleanThrew === null, cleanThrew && cleanThrew.message);

  // 装载后仍能正常弹通知（F4：跳转服务缺失绝不连累通知）
  envAbsent.deliver({ kind: "question", title: "t", message: "m", sessionId: "s-1" });
  check("服务缺失时通知照常弹出", envAbsent.notifications.length === 1, `实际 ${envAbsent.notifications.length}`);
}

console.log("\n=== C. 产物外壳契约：仍是单文件、无新增外部依赖 ===");
{
  const code = fs.readFileSync(CLIENT_ARTIFACT, 'utf8');
  check("仍是 __ModuleLoader__ 注册形态（前端产物契约未破坏）",
    code.includes("window.__ModuleLoader__.load({"), "找不到注册外壳");
  const requires = [...code.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((x) => x[1]);
  const unique = [...new Set(requires)].sort();
  console.log(`    产物内 require 到的模块：${unique.length === 0 ? "（无）" : unique.join(", ")}`);
  check("未引入新的外部依赖（只可能出现 react 这类基座模块）",
    unique.every((r) => r === "react" || r.startsWith(".")), unique.join(", "));
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
