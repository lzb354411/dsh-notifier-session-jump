// dsh-notifier 会话跳转补丁 · 客户端改动（lib/client.js）
//
// 客户端这半边跑在浏览器里（产物形态：window.__ModuleLoader__ 注册的 factory）。
// 三条硬约束：
//   ① 只走官方公开入口 ctx.uiWorkspace.openSession(会话ID) —— 见 REFERENCES.md S1/S2/S3；
//   ② 服务与接口全部**惰性获取 + 全链路容错**：取不到就不跳，绝不连累通知本身（F4）；
//   ③ 会话 ID 为空一律不跳（F3：宁可不动，不可跳错）。

export const CLIENT_EDITS = [
  {
    id: "C1-jumper",
    why: "新增「会话跳转」模块：惰性取 uiWorkspace，容错调用 openSession",
    find: `    // src/client/notify/lease.ts
    var MASTER_KEY = "dsh-notifier:master";`,
    replace: `    // src/client/notify/session-jump.ts（本地补丁新增）
    /**
     * 会话跳转：把「通知所属的会话 id」变成「界面切到那个会话」。
     *
     * 为什么是惰性取服务：uiWorkspace 由官方 ui-workspace 包在自己的 apply 里构造，
     * 取用时机早于它就会拿到 undefined；而且它在别的 DSH 版本里可能改名或缺失。
     * 因此这里每次点击都重新探测一次（ctx 已是闭包中的稳定引用），
     * 取不到就**什么都不做** —— 通知照常工作，只是不跳转（不把跳转写进插件依赖声明，
     * 否则服务缺失会让整个通知插件装载失败，那是远比「不跳转」更重的故障）。
     */
    function createSessionJumper(ports) {
      return {
        /**
         * @param sessionId 通知所属会话 id；空值 / 非字符串一律不跳（宁可不动，不可跳错）。
         * @returns 是否真的发起了跳转（给台架与诊断用）。
         */
        jump(sessionId, kind) {
          if (typeof sessionId !== "string" || sessionId.length === 0) return false;
          try {
            const workspace = ports.workspace();
            const openSession = workspace === void 0 || workspace === null ? void 0 : workspace.openSession;
            if (typeof openSession !== "function") {
              ports.warn("未找到会话导航服务（uiWorkspace.openSession），本次不跳转", sessionId);
              return false;
            }
            openSession.call(workspace, sessionId);
            return true;
          } catch (error) {
            // 会话已归档 / 已删除 / 服务中途卸载都会落到这里：只记日志，不改其它行为。
            ports.warn("跳转会话失败（通知本身不受影响）", error);
            return false;
          }
        }
      };
    }
    /** 客户端 ctx 的稳定持有：apply 时挂上，拆卸时清掉。 */
    var clientContext = { current: null };
    var sessionJumper = createSessionJumper({
      workspace: () => {
        const ctx = clientContext.current;
        if (ctx === null) return void 0;
        // 只做只读获取，且不抛错：ctx.get 找不到时返回 undefined。
        return typeof ctx.get === "function" ? ctx.get("uiWorkspace") : void 0;
      },
      warn: (message, cause) => {
        console.warn("[dsh-notifier] " + message + "：", cause);
      }
    });

    // src/client/notify/lease.ts
    var MASTER_KEY = "dsh-notifier:master";`,
  },
  {
    id: "C2-notification-click",
    why: "系统通知点击：先跳转到所属会话，再保持原有「聚焦 + 关闭」行为",
    find: `          notification.onclick = () => {
            window.focus();
            notification.close();
          };`,
    replace: `          notification.onclick = () => {
            // 本地补丁：先把界面切到这条通知所属的会话，其余行为（聚焦 / 关闭）保持原样。
            if (sessionId !== void 0) sessionJumper.jump(sessionId, kind);
            window.focus();
            notification.close();
          };`,
  },
  {
    id: "C3-showNotification-signature",
    why: "showNotification 接受会话 ID（缺省 = 不跳，老行为逐字保留）",
    find: `    function showNotification(kind, title, message, opts, owner) {
      const playOnly = opts.playOnly === true;`,
    replace: `    function showNotification(kind, title, message, opts, owner, sessionId) {
      const playOnly = opts.playOnly === true;`,
  },
  {
    id: "C4-banner-call",
    why: "横幅通道把会话 ID 传下去",
    find: `      if (fallback === "banner") showBanner(kind, title, message);`,
    replace: `      if (fallback === "banner") showBanner(kind, title, message, sessionId);`,
  },
  {
    id: "C5-banner-click",
    why: "横幅点击：先跳转到所属会话，再保持原有「聚焦 + 移除」行为",
    find: `    function showBanner(kind, title, message) {`,
    replace: `    function showBanner(kind, title, message, sessionId) {`,
  },
  {
    id: "C6-banner-click-handler",
    why: "横幅的点击处理接上跳转",
    find: `      banner.addEventListener("click", () => {
        window.focus();
        banner.remove();
      });`,
    replace: `      banner.addEventListener("click", () => {
        // 本地补丁：先把界面切到这条横幅所属的会话，其余行为（聚焦 / 移除）保持原样。
        if (sessionId !== void 0) sessionJumper.jump(sessionId, kind);
        window.focus();
        banner.remove();
      });`,
  },
  {
    id: "C7-frame-passthrough",
    why: "从 SSE 帧里取出会话 ID 并传到 showNotification",
    find: `      showNotification(
        kind,
        title,
        message,
        {
          sound: payload.sound,
          playOnly: payload.playOnly === true
        },
        owner
      );`,
    replace: `      showNotification(
        kind,
        title,
        message,
        {
          sound: payload.sound,
          playOnly: payload.playOnly === true
        },
        owner,
        // 本地补丁：帧里的会话 id（字段缺失 = 不跳，老服务端帧照常工作）。
        typeof payload.sessionId === "string" && payload.sessionId.length > 0 ? payload.sessionId : void 0
      );`,
  },
  {
    id: "C8-apply-context",
    why: "apply 时把 ctx 挂到稳定持有上，并在卸载时清掉（不留悬挂引用）",
    find: `    function apply(ctx) {
      const stack = createDisposerStack();`,
    replace: `    function apply(ctx) {
      const stack = createDisposerStack();
      // 本地补丁：会话跳转要在点击时惰性取 uiWorkspace，这里留下 ctx 的稳定引用；
      // 拆卸时清掉，避免插件卸载后仍持有客户端上下文。
      clientContext.current = ctx;
      stack.own(function() {
        if (clientContext.current === ctx) clientContext.current = null;
      });`,
  },
];
