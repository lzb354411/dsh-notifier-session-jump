// 台架：在 Node 里搭一个最小浏览器环境，**真实加载补丁后的 client.js**，
// 走完整条链路「SSE 帧 → 弹通知/横幅 → 点击 → 是否切会话」，并断言行为。
//
// 这是本补丁最硬的证据：跑的是装在你 DSH 里的那份产物本身，不是复刻品。

import fs from 'node:fs';
import vm from 'node:vm';
import { CLIENT_ARTIFACT as CLIENT } from '../paths.mjs';

const code = fs.readFileSync(CLIENT, 'utf8');

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: "",
    textContent: "",
    dataset: {},
    style: { cssText: "" },
    children: [],
    handlers: {},
    removed: false,
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    removeEventListener() {},
    remove() { this.removed = true; },
    click() { for (const fn of this.handlers.click ?? []) fn({}); },
  };
  return node;
}

function makeEnv({ workspace, visibility = "hidden", permission = "granted", secure = true }) {
  const notifications = [];
  const warnings = [];
  const banners = [];
  const opened = [];
  const focusCalls = { n: 0 };
  const sources = [];

  const body = makeNode("body");
  const documentStub = {
    visibilityState: visibility,
    title: "DSH · 某会话",
    body,
    documentElement: {},
    getElementById: () => null,
    querySelectorAll: (sel) => (sel === ".dn-banner" ? banners.filter((b) => !b.removed) : []),
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: (tag) => {
      const n = makeNode(tag);
      if (String(tag).toLowerCase() === "div" && banners.length >= 0) banners.push(n);
      return n;
    },
  };

  function FakeNotification(title, opts) {
    const n = {
      title, opts, onclick: null, closed: false,
      close() { this.closed = true; },
    };
    notifications.push(n);
    return n;
  }
  FakeNotification.permission = permission;

  class FakeEventSource {
    constructor(url) { this.url = url; this.onmessage = null; this.onerror = null; sources.push(this); }
    close() { this.closed = true; }
  }

  const win = {
    isSecureContext: secure,
    Notification: FakeNotification,
    focus: () => { focusCalls.n += 1; },
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (fn) => 0,
    clearTimeout: () => {},
    AudioContext: undefined,
    webkitAudioContext: undefined,
  };

  const sandbox = {
    window: win,
    // 浏览器里 `Notification` 是全局构造器（不是只在 window 上），产物用的是裸标识符，
    // 所以沙箱必须把它挂在全局，否则 `new Notification(...)` 会 ReferenceError 并被
    // 插件自己的 try/catch 当成「浏览器通知失败」而降级 —— 台架就测不到真实路径了。
    Notification: FakeNotification,
    document: documentStub,
    console: { warn: (...a) => warnings.push(a.map(String).join(" ")), log: () => {} },
    setTimeout: (fn) => 0,
    clearTimeout: () => {},
    EventSource: FakeEventSource,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { userAgent: "node-harness" },
  };
  sandbox.globalThis = sandbox;

  const registrations = [];
  win.__ModuleLoader__ = { load: (e) => registrations.push(e) };

  const context = vm.createContext(sandbox);
  vm.runInContext(code, context, { filename: "client.js" });
  const entry = registrations[0];
  if (!entry) throw new Error("client.js 没有注册模块");
  const moduleExports = entry.factory((id) => (id === "react" ? makeReactStub() : {}));

  // ctx 替身：get('uiWorkspace') 由 workspace 参数决定
  const effects = [];
  let seq = 0;
  const uiWorkspace =
    workspace === "absent"
      ? undefined
      : workspace === "no-method"
        ? {}
        : {
            openSession(id) {
              opened.push(id);
              if (workspace === "throws") throw new Error("会话已归档（台架模拟）");
            },
          };
  const ctx = {
    get: (name) => (name === "uiWorkspace" ? uiWorkspace : undefined),
    on: () => {},
    effect(cb) { effects.push(() => { const r = cb(); if (typeof r === "function") r(); }); },
    slots: { inject() {}, register() {}, provideRoot() {} },
    locale: { register: () => (() => {}), bind: () => (k) => k, subscribe: () => (() => {}) },
  };

  return {
    entry, moduleExports, ctx, notifications, warnings, banners, opened, focusCalls, sources, effects, body,
    /** 模拟服务端经 SSE 推来一帧（seq 必须递增：客户端按 seq 去重，写死会丢帧） */
    deliver(payload) {
      const src = sources[sources.length - 1];
      if (!src || !src.onmessage) throw new Error("没有活动的 EventSource");
      seq += 1;
      src.onmessage({ data: JSON.stringify({ type: "notify", seq, ts: Date.now(), sound: { mode: "silent" }, whenVisible: true, ...payload }) });
    },
  };
}

function makeReactStub() {
  return {
    createElement: () => null,
    memo: (c) => c,
    useCallback: (f) => f,
    useEffect: () => {},
    useMemo: (f) => f(),
    useRef: (v) => ({ current: v }),
    useState: (v) => [typeof v === "function" ? v() : v, () => {}],
    useSyncExternalStore: () => undefined,
    Fragment: "Fragment",
  };
}

export { makeEnv };
