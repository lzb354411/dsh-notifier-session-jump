// dsh-notifier 会话跳转补丁 · 服务端改动（lib/index.js）
//
// 设计约束：
//  - 每条改动是「把一段唯一原文换成一段新文」，命中次数 ≠ 1 立即中止（由补丁引擎保证）。
//  - 所有新增字段都是**可选**的：没有会话 ID 的通知（test 类、无 agent 的事件）
//    行为与改动前逐字一致 —— 这是 SPEC F3「不可跳错」与 F5「原始行为保留」的实现基础。
//  - 锚点只用 ASCII，避免中文编码差异导致的失配。
//  - 会话 ID 一律在**调用点**注入（translate* 系列直接拿得到 payload.agent），
//    不穿越 agentStates 状态机的返回值 —— 少动结构，少一处出错面。

export const SERVER_EDITS = [
  {
    id: "S2a-render",
    why: "让 render() 能把会话 ID 放进通知请求（缺省时不写这个键）",
    find: `function render(kind, detail) {
  const text = NOTIFY_KINDS[kind];
  return { ok: true, request: { kind, title: text.title, body: text.body(detail) } };
}`,
    replace: `function render(kind, detail) {
  const text = NOTIFY_KINDS[kind];
  const request = { kind, title: text.title, body: text.body(detail) };
  // 会话跳转扩展：detail.sessionId 有值才写这个键，缺省时请求形状与改动前逐字一致。
  if (typeof detail.sessionId === "string" && detail.sessionId.length > 0)
    request.sessionId = detail.sessionId;
  return { ok: true, request };
}`,
  },
  {
    id: "S3f-helper",
    why: "会话 ID 的唯一取值口径：官方强制 agent.id === agent.session.id，取不到就不跳",
    find: `function titleOf(agent) {
  return agent === void 0 ? { found: false } : sessionTitleOf(agent);
}`,
    replace: `function titleOf(agent) {
  return agent === void 0 ? { found: false } : sessionTitleOf(agent);
}
/**
 * 通知所属会话 ID。官方在 dsh-agent 的 enter() 里强制 agent.id === agent.session.id，
 * 故 agent.id 就是会话 ID；取不到（无 agent、形状意外、取值抛错）一律返回 void 0 —
 * 调用侧据此不发 sessionId，客户端就不跳转（宁可不动，不可跳错）。
 */
function sessionIdOf(agent) {
  try {
    if (agent === void 0 || agent === null) return void 0;
    const id = agent.id ?? agent.session?.id;
    return typeof id === "string" && id.length > 0 ? id : void 0;
  } catch {
    return void 0;
  }
}`,
  },
  {
    id: "S3a-approval",
    why: "审批通知带上所属会话 ID",
    find: `function translateApproval(request) {
  const title = titleOf(request.agent);
  return render("ask", {
    tool: request.toolName,
    taskTitle: title.found ? title.title : void 0,
    reason: request.reason
  });
}`,
    replace: `function translateApproval(request) {
  const title = titleOf(request.agent);
  return render("ask", {
    tool: request.toolName,
    taskTitle: title.found ? title.title : void 0,
    reason: request.reason,
    sessionId: sessionIdOf(request.agent)
  });
}`,
  },
  {
    id: "S3b-question",
    why: "提问通知带上所属会话 ID",
    find: `function translateUserQuestion(request) {
  const first = request.questions[0];
  const title = titleOf(request.agent);
  return render("question", {
    taskTitle: title.found ? title.title : void 0,
    question: first !== void 0 && first.question.length > 0 ? first.question : void 0
  });
}`,
    replace: `function translateUserQuestion(request) {
  const first = request.questions[0];
  const title = titleOf(request.agent);
  return render("question", {
    taskTitle: title.found ? title.title : void 0,
    question: first !== void 0 && first.question.length > 0 ? first.question : void 0,
    sessionId: sessionIdOf(request.agent)
  });
}`,
  },
  {
    id: "S3c-agent-status",
    why: "任务完成 / 子任务完成通知带上所属会话 ID（在调用点注入，不动状态机返回结构）",
    find: `function translateAgentStatus(payload) {
  const outcome = agentStates.observeStatus(payload);
  if (!outcome.ok)
    return NOT_A_NOTIFICATION;
  return render(outcome.kind, { taskTitle: outcome.taskTitle, durationMs: outcome.durationMs });
}`,
    replace: `function translateAgentStatus(payload) {
  const outcome = agentStates.observeStatus(payload);
  if (!outcome.ok)
    return NOT_A_NOTIFICATION;
  return render(outcome.kind, {
    taskTitle: outcome.taskTitle,
    durationMs: outcome.durationMs,
    sessionId: sessionIdOf(payload.agent)
  });
}`,
  },
  {
    id: "S3d-turn-stopping",
    why: "轮次完成通知带上所属会话 ID（同样在调用点注入）",
    find: `function translateTurnStopping(payload) {
  const outcome = agentStates.observeTurnStopping(payload);
  if (!outcome.ok)
    return NOT_A_NOTIFICATION;
  return render("turn-end", { turn: outcome.turn, taskTitle: outcome.taskTitle });
}`,
    replace: `function translateTurnStopping(payload) {
  const outcome = agentStates.observeTurnStopping(payload);
  if (!outcome.ok)
    return NOT_A_NOTIFICATION;
  return render("turn-end", {
    turn: outcome.turn,
    taskTitle: outcome.taskTitle,
    sessionId: sessionIdOf(payload.agent)
  });
}`,
  },
  {
    id: "S3e-error",
    why: "出错通知带上所属会话 ID",
    find: `function translateAgentError(payload) {
  const title = titleOf(payload.agent);
  return render("error", {
    message: payload.error,
    taskTitle: title.found ? title.title : void 0,
    turn: payload.turn,
    step: payload.step
  });
}`,
    replace: `function translateAgentError(payload) {
  const title = titleOf(payload.agent);
  return render("error", {
    message: payload.error,
    taskTitle: title.found ? title.title : void 0,
    turn: payload.turn,
    step: payload.step,
    sessionId: sessionIdOf(payload.agent)
  });
}`,
  },
  {
    id: "S2b-finalize",
    why: "定稿时把会话 ID 从请求带进待投递消息（消息是投递层的输入）",
    find: `function finalizeRequest(request, ts) {
  const base = {
    kind: request.kind,
    ts,
    title: truncateCodePoints(request.title, TITLE_MAX_CODE_POINTS),
    body: request.body
  };
  const severity = resolveSeverity(request);
  return severity.provided ? { ...base, severity: severity.severity } : base;
}`,
    replace: `function finalizeRequest(request, ts) {
  const base = {
    kind: request.kind,
    ts,
    title: truncateCodePoints(request.title, TITLE_MAX_CODE_POINTS),
    body: request.body
  };
  // 会话跳转扩展：有会话 ID 才写这个键。
  if (typeof request.sessionId === "string" && request.sessionId.length > 0)
    base.sessionId = request.sessionId;
  const severity = resolveSeverity(request);
  return severity.provided ? { ...base, severity: severity.severity } : base;
}`,
  },
  {
    id: "S2c-buildFrame",
    why: "浏览器帧带上会话 ID（帧是管线 → SSE 的输入）",
    find: `function buildFrame(message, target) {
  const frame = {
    pop: target.popup,
    sound: resolveSound(target.popup, target.sound),
    whenVisible: target.whenVisible,
    title: truncateCodePoints(message.title, displayCaps.browser.titleMax),
    body: truncateCodePoints(message.body, displayCaps.browser.bodyMax)
  };
  if (message.severity !== void 0)
    frame.severity = message.severity;
  return frame;
}`,
    replace: `function buildFrame(message, target) {
  const frame = {
    pop: target.popup,
    sound: resolveSound(target.popup, target.sound),
    whenVisible: target.whenVisible,
    title: truncateCodePoints(message.title, displayCaps.browser.titleMax),
    body: truncateCodePoints(message.body, displayCaps.browser.bodyMax)
  };
  if (message.severity !== void 0)
    frame.severity = message.severity;
  // 会话跳转扩展：会话 ID 随帧下发（缺省时不写这个键，帧形状与改动前逐字一致）。
  if (typeof message.sessionId === "string" && message.sessionId.length > 0)
    frame.sessionId = message.sessionId;
  return frame;
}`,
  },
  {
    id: "S2d-publish",
    why: "SSE 帧带上会话 ID —— 这是浏览器端唯一能拿到它的地方",
    find: `    const { frame } = payload;
    const event = {
      type: "notify",
      seq: this.seq,
      kind: payload.kind,
      title: frame.title,
      message: frame.body,
      ts: Date.now(),
      sound: frame.sound,
      // 可见性判定归浏览器出口，帧自描述：客户端拿到就能执行，不必回查自己那份可能已过期的配置快照。
      whenVisible: frame.whenVisible
    };
    if (!frame.pop)
      event.playOnly = true;`,
    replace: `    const { frame } = payload;
    const event = {
      type: "notify",
      seq: this.seq,
      kind: payload.kind,
      title: frame.title,
      message: frame.body,
      ts: Date.now(),
      sound: frame.sound,
      // 可见性判定归浏览器出口，帧自描述：客户端拿到就能执行，不必回查自己那份可能已过期的配置快照。
      whenVisible: frame.whenVisible
    };
    // 会话跳转扩展：会话 ID 随线协议下发；缺省时线协议形状与改动前逐字一致。
    if (typeof frame.sessionId === "string" && frame.sessionId.length > 0)
      event.sessionId = frame.sessionId;
    if (!frame.pop)
      event.playOnly = true;`,
  },

  // ---- .d.ts 类型文档（不参与运行，只让补丁自解释）----
  {
    id: "T1-notify-request",
    file: "lib/server/pipeline/impl/service/type.d.ts",
    why: "NotifyRequest 增加可选 sessionId",
    find: `    /** 只把裁决结果收窄到这一个频道实例；省略 = 按路由裁决（只有单频道测试会填）。 */
    onlyChannel?: string;
}`,
    replace: `    /** 只把裁决结果收敛到这一个频道实例；省略 = 按路由裁决（只有单频道测试会填）。 */
    onlyChannel?: string;
    /**
     * 会话跳转扩展（本地补丁）：本条通知所属的会话 id。
     * 由 events 域从 agent.id 取得（官方强制 agent.id === agent.session.id）；
     * 取不到就不写这个键 —— 客户端据此不跳转，宁可不动不可跳错。
     */
    sessionId?: string;
}`,
  },
  {
    id: "T2-notify-message",
    file: "lib/server/channels/impl/deliver/type.d.ts",
    why: "NotifyMessage 增加可选 sessionId",
    find: `export interface NotifyMessage {
    title: string;
    body: string;
    severity?: NotifySeverity;
    kind: string;
    ts: number;
}`,
    replace: `export interface NotifyMessage {
    title: string;
    body: string;
    severity?: NotifySeverity;
    kind: string;
    ts: number;
    /** 会话跳转扩展（本地补丁）：本条通知所属的会话 id；无归属时不写这个键。 */
    sessionId?: string;
}`,
  },
  {
    id: "T3-notify-frame",
    file: "lib/server/channels/impl/browser/type.d.ts",
    why: "NotifyFrame 增加可选 sessionId",
    find: `export interface NotifyFrame {
    pop: boolean;
    sound: BrowserSound;`,
    replace: `export interface NotifyFrame {
    pop: boolean;
    sound: BrowserSound;
    /** 会话跳转扩展（本地补丁）：随帧下发的会话 id；无归属时不写这个键。 */
    sessionId?: string;`,
  },
  {
    id: "T4-stream-event",
    file: "lib/server/api/impl/stream/type.d.ts",
    why: "StreamEvent 增加可选 sessionId",
    find: `    /** 页面可见时是否也弹：可见性只有页面自己知道，故随帧下发，渲染端不必回查可能已变的配置。
     *  0.2.3 的帧没有这个字段，不读它的旧客户端不受影响。 */
    whenVisible: boolean;
} | {
    type: "ping";
};`,
    replace: `    /** 页面可见时是否也弹：可见性只有页面自己知道，故随帧下发，渲染端不必回查可能已变的配置。
     *  0.2.3 的帧没有这个字段，不读它的旧客户端不受影响。 */
    whenVisible: boolean;
    /** 会话跳转扩展（本地补丁）：本条通知所属的会话 id；无归属时不写这个键（老客户端忽略它）。 */
    sessionId?: string;
} | {
    type: "ping";
};`,
  },
];

// 没写 file 的改动一律落在 lib/index.js
export const DEFAULT_FILE = "lib/index.js";
