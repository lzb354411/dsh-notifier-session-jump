// 断言 2：点击行为（对应 SPEC 的 F1–F5）
import { makeEnv } from './env.mjs';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? " —— " + detail : ""}`); }
};

const SID = "session-abc-123";

function boot(opts) {
  const env = makeEnv(opts);
  env.moduleExports.apply(env.ctx);
  return env;
}

// ---------- F1：系统通知点击跳转 ----------
console.log("=== F1 系统通知：带上会话 ID 点击后跳转 ===");
{
  const env = boot({ workspace: "ok", visibility: "hidden" });
  env.deliver({ kind: "question", title: "向你提问", message: "要继续吗？", sessionId: SID });
  check("弹出了 1 条系统通知", env.notifications.length === 1, `实际 ${env.notifications.length}`);
  const n = env.notifications[0];
  check("通知上有 onclick 处理", typeof n.onclick === "function");
  n.onclick();
  check("点击后调用了 uiWorkspace.openSession 且参数正好是通知里的会话 ID",
    env.opened.length === 1 && env.opened[0] === SID, JSON.stringify(env.opened));
  check("原有行为保留：window.focus 仍被调用", env.focusCalls.n === 1, String(env.focusCalls.n));
  check("原有行为保留：通知仍被 close", n.closed === true);
}

// ---------- F2：横幅点击跳转 ----------
// 横幅是「系统通知不可用」时的降级通道（非安全上下文 / 未授权）。用 permission 未授予
// 来触发它，与真实降级条件一致。
console.log("\n=== F2 页面横幅：带上会话 ID 点击后跳转 ===");
{
  const env = boot({ workspace: "ok", visibility: "visible", permission: "denied" });
  env.deliver({ kind: "done", title: "任务完成", message: "已完成", sessionId: SID });
  const banner = env.banners.find((b) => !b.removed);
  check("系统通知不可用时走横幅通道（未弹系统通知）", env.notifications.length === 0, `通知数 ${env.notifications.length}`);
  check("生成了横幅节点", banner !== undefined);
  if (banner) {
    banner.click();
    check("点击横幅后调用了 openSession 且参数正确",
      env.opened.length === 1 && env.opened[0] === SID, JSON.stringify(env.opened));
    check("原有行为保留：横幅仍被移除", banner.removed === true);
    check("原有行为保留：window.focus 仍被调用", env.focusCalls.n === 1);
  }
}

// ---------- F3：没有会话 ID → 不跳（宁可不动，不可跳错） ----------
console.log("\n=== F3 无归属：不得跳转（绝不跳错） ===");
{
  const env = boot({ workspace: "ok", visibility: "hidden" });
  env.deliver({ kind: "test", title: "测试通知", message: "这是一条测试" });   // 无 sessionId
  check("测试通知照常弹出", env.notifications.length === 1);
  env.notifications[0].onclick();
  check("点击后**没有**调用 openSession（不跳错）", env.opened.length === 0, JSON.stringify(env.opened));
  check("原有行为仍在：focus 被调用", env.focusCalls.n === 1);

  // 空字符串 / 非字符串也必须不跳
  const env2 = boot({ workspace: "ok", visibility: "hidden" });
  env2.deliver({ kind: "question", title: "t", message: "m", sessionId: "" });
  env2.notifications[0].onclick();
  check("sessionId 为空字符串时不跳", env2.opened.length === 0);

  const env3 = boot({ workspace: "ok", visibility: "hidden" });
  env3.deliver({ kind: "question", title: "t", message: "m", sessionId: 12345 });
  env3.notifications[0].onclick();
  check("sessionId 是非字符串时不跳（不猜）", env3.opened.length === 0);
}

// ---------- F4：服务缺失 / 抛错 → 通知照常，只是不跳 ----------
console.log("\n=== F4 跳转失败不得连累通知 ===");
{
  const env = boot({ workspace: "absent", visibility: "hidden" });
  env.deliver({ kind: "question", title: "t", message: "m", sessionId: SID });
  check("uiWorkspace 缺失时通知照常弹出", env.notifications.length === 1);
  check("点击不抛异常", (() => { try { env.notifications[0].onclick(); return true; } catch { return false; } })());
  check("未发生跳转", env.opened.length === 0);
  check("留下了可诊断的告警日志", env.warnings.some((w) => w.includes("未找到会话导航服务")), JSON.stringify(env.warnings));
  check("原有行为仍在：focus 被调用", env.focusCalls.n === 1);
  check("原有行为仍在：通知被关闭", env.notifications[0].closed === true);
}
{
  const env = boot({ workspace: "no-method", visibility: "hidden" });
  env.deliver({ kind: "question", title: "t", message: "m", sessionId: SID });
  env.notifications[0].onclick();
  check("服务在但缺 openSession 时不跳、不抛", env.opened.length === 0 && env.warnings.length > 0);
}
{
  const env = boot({ workspace: "throws", visibility: "hidden" });
  env.deliver({ kind: "question", title: "t", message: "m", sessionId: SID });
  check("openSession 抛错时点击不抛异常",
    (() => { try { env.notifications[0].onclick(); return true; } catch { return false; } })());
  check("抛错被记录为告警（可诊断）", env.warnings.some((w) => w.includes("跳转会话失败")), JSON.stringify(env.warnings));
  check("抛错后仍保留原有行为：聚焦 + 关闭",
    env.focusCalls.n === 1 && env.notifications[0].closed === true);
}

// ---------- F5：老服务端帧（完全没有 sessionId 字段）行为与改动前一致 ----------
console.log("\n=== F5 向后兼容：老帧 / 老服务端 ===");
{
  const env = boot({ workspace: "ok", visibility: "hidden" });
  env.deliver({ kind: "ask", title: "审批", message: "请确认" });   // 老帧：无 sessionId 键
  env.notifications[0].onclick();
  check("无 sessionId 字段的帧：照常弹、点击不跳、只聚焦", env.opened.length === 0 && env.focusCalls.n === 1);
}
{
  const env = boot({ workspace: "ok", visibility: "hidden" });
  env.deliver({ kind: "question", title: "第一帧", message: "m", sessionId: SID });
  env.deliver({ kind: "done", title: "第二帧", message: "m", sessionId: SID });
  check("连推两帧：两条通知都在（通知分发行为未变）", env.notifications.length === 2, `实际 ${env.notifications.length}`);
}

// ---------- 卸载后不得残留引用 ----------
console.log("\n=== 卸载：清理后不再持有 ctx ===");
{
  const env = boot({ workspace: "ok", visibility: "hidden" });
  for (const e of env.effects) e();
  env.deliver({ kind: "question", title: "t", message: "m", sessionId: SID });
  const n = env.notifications[env.notifications.length - 1];
  let threw = false;
  try { n.onclick(); } catch { threw = true; }
  check("卸载后点击不抛错（引用已清）", threw === false);
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
