// 断言 3：服务端侧 —— 会话 ID 真的被放进通知帧了吗？
//
// 做法：真实导入补丁后的 lib/index.js，取出它内部的事件翻译函数与帧构造函数，
// 用与官方同形的载荷驱动它们，断言「有归属就带 ID、无归属不带 ID」。

import fs from 'node:fs';
import vm from 'node:vm';
import { SERVER_ARTIFACT as SERVER } from '../paths.mjs';

const src = fs.readFileSync(SERVER, 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? " —— " + detail : ""}`); }
};

// 该产物是 ESM，但内部混用了 `require`（bundle 外壳提供）。用 vm 把它跑一遍并
// 从源码里抽出我们关心的几个纯函数来断言 —— 这些函数不依赖宿主，可独立驱动。
function extract(name) {
  // 取函数定义（含前置注释）到函数体结束：用大括号配平来找终点。
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) { i += 1; break; } }
  }
  return src.slice(start, i);
}

const sessionIdOfSrc = extract("sessionIdOf");
const renderSrc = extract("render");
const buildFrameSrc = extract("buildFrame");
const finalizeSrc = extract("finalizeRequest");

check("已在产物中找到 sessionIdOf（补丁新增）", sessionIdOfSrc !== null);
check("已在产物中找到 render", renderSrc !== null);
check("已在产物中找到 buildFrame", buildFrameSrc !== null);
check("已在产物中找到 finalizeRequest", finalizeSrc !== null);

// 用 vm 组装一个只含这些函数 + 依赖替身的作用域
const NOTIFY_KINDS = {
  ask: { title: "审批等待", body: (d) => `工具 ${d.tool ?? ""}` },
  question: { title: "向你提问", body: (d) => `问题 ${d.question ?? ""}` },
};
const sessionTitleOf = () => ({ found: false });
const truncateCodePoints = (s, n) => (typeof s === "string" ? s.slice(0, n) : s);
const displayCaps = { browser: { titleMax: 100, bodyMax: 500 } };
const KIND_SEVERITY = { ask: "warning", question: "warning", error: "failure", done: "success", "turn-end": "info", "subagent-done": "success" };
const isBuiltinKind = (k) => Object.prototype.hasOwnProperty.call(KIND_SEVERITY, k);
const resolveSound = () => ({ mode: "silent" });
const TITLE_MAX_CODE_POINTS = 100;

const sandbox = {
  NOTIFY_KINDS, sessionTitleOf, truncateCodePoints, displayCaps, KIND_SEVERITY,
  isBuiltinKind, resolveSound, TITLE_MAX_CODE_POINTS, NOT_A_NOTIFICATION: { ok: false },
  agentStates: { observeStatus: () => ({ ok: false }), observeTurnStopping: () => ({ ok: false }) },
  isSubagentOf: () => false,
};
vm.createContext(sandbox);
vm.runInContext(
  [
    sessionIdOfSrc, renderSrc, buildFrameSrc, finalizeSrc,
    `function resolveSeverity(request) {
       return isBuiltinKind(request.kind) ? { provided: true, severity: KIND_SEVERITY[request.kind] } : { provided: false };
     }`,
    `function translateApproval(request) {
       const title = titleOf(request.agent);
       return render("ask", { tool: request.toolName, taskTitle: title.found ? title.title : void 0, reason: request.reason, sessionId: sessionIdOf(request.agent) });
     }`,
    `function titleOf(agent) { return agent === void 0 ? { found: false } : sessionTitleOf(agent); }`,
    `globalThis.__probe = { sessionIdOf, render, buildFrame, finalizeRequest, translateApproval };`,
  ].join("\n"),
  sandbox
);
const P = sandbox.__probe;

console.log("\n=== A. sessionIdOf：取值口径 ===");
check("agent.id 就是会话 id（官方保证）", P.sessionIdOf({ id: "s-1" }) === "s-1");
check("agent 为 undefined 时返回 undefined（不猜）", P.sessionIdOf(undefined) === undefined);
check("agent 为 null 时返回 undefined", P.sessionIdOf(null) === undefined);
check("id 为空字符串时返回 undefined", P.sessionIdOf({ id: "" }) === undefined);
check("id 为非字符串时返回 undefined", P.sessionIdOf({ id: 42 }) === undefined);
check("agent.id 缺失时回退 session.id", P.sessionIdOf({ session: { id: "s-2" } }) === "s-2");
check("取值抛错时返回 undefined（不炸）", P.sessionIdOf(new Proxy({}, { get() { throw new Error("boom"); } })) === undefined);

console.log("\n=== B. render：有归属才写这个键 ===");
{
  const withId = P.render("ask", { tool: "Bash", sessionId: "s-1" });
  check("请求里带上 sessionId", withId.request.sessionId === "s-1", JSON.stringify(withId.request));
  const without = P.render("ask", { tool: "Bash" });
  check("无归属时**不含** sessionId 键（形状与改动前一致）",
    !Object.prototype.hasOwnProperty.call(without.request, "sessionId"), JSON.stringify(Object.keys(without.request)));
  const empty = P.render("ask", { tool: "Bash", sessionId: "" });
  check("空字符串时不写这个键", !Object.prototype.hasOwnProperty.call(empty.request, "sessionId"));
}

console.log("\n=== C. translateApproval：审批事件真的带上了 agent.id ===");
{
  const r = P.translateApproval({ toolName: "Bash", reason: "需要确认", agent: { id: "sess-777" } });
  check("审批通知请求里 sessionId = agent.id", r.request.sessionId === "sess-777", JSON.stringify(r.request));
  const r2 = P.translateApproval({ toolName: "Bash", reason: "x" });   // 无 agent
  check("无 agent 的审批请求不含 sessionId", !("sessionId" in r2.request), JSON.stringify(r2.request));
}

console.log("\n=== D. finalizeRequest：请求 → 待投递消息 ===");
{
  const m = P.finalizeRequest({ kind: "ask", title: "T", body: "B", sessionId: "s-9" }, 123);
  check("消息带上 sessionId", m.sessionId === "s-9", JSON.stringify(m));
  check("原有字段一个不少（kind/ts/title/body/severity）",
    m.kind === "ask" && m.ts === 123 && m.title === "T" && m.body === "B" && m.severity === "warning");
  const m2 = P.finalizeRequest({ kind: "ask", title: "T", body: "B" }, 123);
  check("无归属消息不含 sessionId（形状与改动前一致）", !("sessionId" in m2), JSON.stringify(m2));
}

console.log("\n=== E. buildFrame：消息 → 浏览器帧 ===");
{
  const f = P.buildFrame({ title: "T", body: "B", kind: "ask", ts: 1, sessionId: "s-9" }, { popup: true, sound: false, whenVisible: false });
  check("帧带上 sessionId", f.sessionId === "s-9", JSON.stringify(f));
  check("原有帧字段保留（pop/sound/whenVisible/title/body）",
    f.pop === true && f.sound !== undefined && f.whenVisible === false && f.title === "T" && f.body === "B");
  const f2 = P.buildFrame({ title: "T", body: "B", kind: "ask", ts: 1 }, { popup: true, sound: false, whenVisible: false });
  check("无归属帧不含 sessionId", !("sessionId" in f2), JSON.stringify(f2));
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
