// 断言 4：最后一环 —— SSE publish() 真的把会话 ID 写进线协议了吗？
//
// 前三组断言覆盖了 render → finalize → buildFrame；但浏览器真正读到的是 publish()
// 产出的那只 SSE 事件。这一组把它单独驱动一遍，补上链路里最后一段没被证明的地方。
import fs from 'node:fs';
import vm from 'node:vm';
import { SERVER_ARTIFACT as SERVER } from '../paths.mjs';

const src = fs.readFileSync(SERVER, 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? " —— " + detail : ""}`); }
};

// 抽出 publish 方法体所在的 class 片段（FrameBus 之后的 StreamHub），在沙箱里复活它。
const clsStart = src.indexOf("var StreamHub = class");
check("已定位 StreamHub 类", clsStart > 0);

// 取整个 class 定义（大括号配平）
let i = src.indexOf("{", clsStart);
let depth = 0, end = i;
for (; end < src.length; end += 1) {
  const c = src[end];
  if (c === "{") depth += 1;
  else if (c === "}") { depth -= 1; if (depth === 0) { end += 1; break; } }
}
const classSrc = src.slice(clsStart, end);

const published = [];
const written = [];
const sandbox = {
  REPLAY_LIMIT: 200,
  writeTextAtomic: async (file, text) => { written.push({ file, text }); },
};
// SSE 编码函数（产物里就在 publish 旁边，这里按原文复刻一份，保证台架与被测代码同一口径）
sandbox.encode = (event) => `data: ${JSON.stringify(event)}\n\n`;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  [
    classSrc,
    // 用一个只记录不发送的 hub 替身替换真实 hub 的用法
    `globalThis.__mkHub = () => {
       const p = [];
       return { published: p, hub: { broadcast: (line) => p.push(line), register() {} } };
     };`,
    `globalThis.__StreamHub = StreamHub;`,
  ].join("\n"),
  sandbox
);

// 用真实类构造一个实例（绕过 constructor 里对文件/端口的依赖，直接造对象再补字段）
function makeHub() {
  const inst = Object.create(sandbox.__StreamHub.prototype);
  inst.seq = 0;
  inst.replay = [];
  inst.installed = true;
  inst.file = "（台架不落盘）";
  const lines = [];
  inst.hub = { broadcast: (l) => lines.push(l), register() {} };
  return { inst, lines };
}

console.log("\n=== A. 有会话 ID 的帧 → 线协议带上 sessionId ===");
{
  const { inst, lines } = makeHub();
  inst.publish({
    kind: "question",
    frame: { pop: true, sound: { mode: "silent" }, whenVisible: false, title: "标题", body: "正文", sessionId: "session-xyz" },
  });
  const event = inst.replay[inst.replay.length - 1];
  check("replay 缓冲里的事件带 sessionId", event.sessionId === "session-xyz", JSON.stringify(event));
  check("广播出去的原文里含 sessionId（浏览器读到的那份）",
    lines.length === 1 && lines[0].includes('"sessionId":"session-xyz"'), lines[0]);
  check("原有线协议字段一个不少（type/seq/kind/title/message/ts/sound/whenVisible）",
    event.type === "notify" && typeof event.seq === "number" && event.kind === "question" &&
    event.title === "标题" && event.message === "正文" && typeof event.ts === "number" &&
    event.sound !== undefined && event.whenVisible === false, JSON.stringify(event));
}

console.log("\n=== B. 无会话 ID 的帧 → 线协议形状与改动前一致（不带该键） ===");
{
  const { inst, lines } = makeHub();
  inst.publish({
    kind: "test",
    frame: { pop: true, sound: { mode: "silent" }, whenVisible: false, title: "T", body: "B" },
  });
  const event = inst.replay[inst.replay.length - 1];
  check("不含 sessionId 键", !Object.prototype.hasOwnProperty.call(event, "sessionId"), JSON.stringify(event));
  check("广播原文里也不含 sessionId", !lines[0].includes("sessionId"), lines[0]);
}

console.log("\n=== C. playOnly 语义未变（弹窗关闭时只响不弹） ===");
{
  const { inst } = makeHub();
  inst.publish({
    kind: "done",
    frame: { pop: false, sound: { mode: "selfplay", tone: "ding" }, whenVisible: true, title: "T", body: "B", sessionId: "s-1" },
  });
  const event = inst.replay[inst.replay.length - 1];
  check("pop=false 时仍写 playOnly=true", event.playOnly === true);
  check("同时保留了 sessionId", event.sessionId === "s-1");
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
