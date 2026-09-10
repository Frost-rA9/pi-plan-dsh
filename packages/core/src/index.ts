/**
 * pi-plan-dsh-core · pi 扩展宿主（唯一 pi 扩展）。
 *
 * 单一参考源 = dsh：plan 协作状态（软引导轴），与 pi-sandbox-dsh（强制轴）完全正交。
 * 装配：session_start 用 `getEntries()` 折叠 `plan/mode`（不变量 2）→ `/plan` 命令（用户决策点）
 * → `before_agent_start` 注入 `plan:policy` 段（不改工具目录）→ `exit_plan_mode` 工具（始终注册，
 * `#`markdown 校验 + 计划进聊天记录 + 用户审批 + fail-closed）。
 *
 * 审阅形态（对齐 dsh `plan-review` 意图的 pi 化）：**计划本体走 TUI-only entry（消息区、可滚动、持久、
 * 不进 LLM 上下文），审批走底部小交互（select/input）**——不把长内容塞进编辑器区域。
 */
import { getMarkdownTheme, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  PLAN_MODE_ENTRY,
  PLAN_REVIEW_ENTRY,
  DEFAULT_PLAN_ACTIVE,
  DEFAULT_PLAN_SECTION,
  foldPlanMode,
  renderPlanPolicy,
  resolvePlanConfig,
  hasPlanHeading,
  summarizePlan,
  type PlanModeConfig,
  type PlanReviewData,
} from "pi-plan-dsh-bridge";

/** 徽标文案（常驻）：`[plan-mode:on]`=橙(256色208，对齐 sandbox read-only)；`[plan-mode:off]`=蓝(accent，对齐 sandbox workspace-write)。 */
function planBadge(theme: Theme, active: boolean): string {
  return active
    ? "\x1B[38;5;208m[plan-mode:on]\x1B[0m"
    : theme.fg("accent", "[plan-mode:off]");
}

export default function planExtension(pi: ExtensionAPI): void {
  const config: PlanModeConfig = resolvePlanConfig({ section: DEFAULT_PLAN_SECTION });

  // 运行时镜像（非真源）：session_start 折叠回填；/plan 与 exit_plan_mode 写日志 + 更新镜像。
  // 对齐 pi-sandbox-dsh 的 store.mode 模式——真源始终是日志折叠。
  let active = DEFAULT_PLAN_ACTIVE;
  // 模型上次被告知的档位（对齐 dsh narration 的 `activeAtLastHeader`）——仅在切换与上次所见不同时叙述。
  let lastInformedActive = DEFAULT_PLAN_ACTIVE;

  const updatePlanBadge = (ui: { theme: Theme; setStatus: (k: string, t: string | undefined) => void } | undefined): void => {
    if (!ui) return;
    ui.setStatus("pi-plan-dsh", planBadge(ui.theme, active));
  };

  const setActive = (next: boolean): void => {
    active = next;
    pi.appendEntry(PLAN_MODE_ENTRY, { active: next });
  };

  // 用户切换的模型 notice（对齐 dsh plan-mode `narration()`，经 pi 的 steer 通道）：
  // 只在目标档与「模型上次所见」不同时叙述，避免冗余；exit_plan_mode 不经此（其工具结果已叙述）。
  const narratePlanSwitch = (newActive: boolean): void => {
    if (lastInformedActive === newActive) return;
    const text = newActive
      ? "The user switched this session to plan mode."
      : "The user switched this session back to the default mode.";
    pi.sendMessage(
      { customType: `${PLAN_MODE_ENTRY}:notice`, content: text, display: true },
      { deliverAs: "steer" },
    );
    lastInformedActive = newActive;
  };

  // session_start：从会话日志折叠当前 plan 状态（resume/fork/compaction 依赖折叠恢复）。
  pi.on("session_start", (_event, ctx) => {
    const entries = (ctx.sessionManager?.getEntries?.() ?? []) as never;
    active = foldPlanMode(entries).active;
    lastInformedActive = active;
    updatePlanBadge(ctx.ui);
  });

  // 引导段注入：只改 prompt，不改工具目录；未激活时 0 token（不追加）。
  pi.on("before_agent_start", (event) => {
    // 模型本次将看到的是当前 active 对应的 policy 段 → 记录「上次所见」。
    lastInformedActive = active;
    const policy = renderPlanPolicy(config.section, active);
    if (policy === "") return undefined;
    return { systemPrompt: event.systemPrompt + "\n\n" + policy };
  });

  // `/plan [off|message]`：裸=`on`；`off`=`off`；message=`on` + steer（对齐 dsh）。
  pi.registerCommand("plan", {
    description: "进入/离开计划模式（dsh plan-mode 软引导）。/plan [off|message]",
    handler: async (args, ctx) => {
      const input = (args ?? "").trim();

      const applyOff = (): void => {
        if (active) {
          setActive(false);
          narratePlanSwitch(false);
          ctx.ui.notify("计划模式已关闭。", "info");
        } else {
          ctx.ui.notify("计划模式已是关闭。", "info");
        }
        updatePlanBadge(ctx.ui);
      };
      const applyOn = (steerMessage?: string): void => {
        if (!active) {
          setActive(true);
          updatePlanBadge(ctx.ui);
          narratePlanSwitch(true);
        }
        if (steerMessage) pi.sendUserMessage(steerMessage, { deliverAs: "steer" });
        ctx.ui.notify(`计划模式已开启。${steerMessage ? " 提示：" + steerMessage : ""}`, "info");
      };

      // 空参数 → 交互选择 on/off（对齐 /sandbox、/model 的 picker，避免手输）。
      if (input === "") {
        if (ctx.ui?.select) {
          const picked = await ctx.ui.select(`计划模式（当前: ${active ? "on" : "off"}）。`, ["on", "off"]);
          if (!picked) return; // 取消/超时
          if (picked === "off") applyOff();
          else applyOn();
        } else {
          // 无交互 UI：保持「裸 /plan = on」语义
          applyOn();
        }
        return;
      }

      if (input === "off") {
        applyOff();
        return;
      }
      // 非空且非 off：on + steer（message 或显式 `on` 不携带消息）
      applyOn(input === "on" ? undefined : input);
    },
  });

  // 计划审阅 entry 的 TUI 渲染器（TUI-only，不进 LLM 上下文）：
  // 计划本体渲染在**聊天记录（消息区）**——跟随 transcript 滚动、可选中复制、resume 后仍在；
  // 展开/折叠沿用 pi 既有全局开关（ctrl+o / `app.tools.expand`，默认折叠 = 只预览前若干行）。
  pi.registerEntryRenderer<PlanReviewData>(PLAN_REVIEW_ENTRY, (entry, { expanded }, theme) => {
    const plan = entry.data?.plan ?? "";
    const summary = summarizePlan(plan);
    const title = summary.heading === undefined ? "计划待审批" : `计划待审批：${summary.heading}`;
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(theme.bold(theme.fg("accent", `${title} · ${summary.lineCount} 行`)), 0, 0));
    if (expanded) {
      box.addChild(new Markdown(plan, 0, 0, getMarkdownTheme()));
    } else {
      if (summary.preview !== "") box.addChild(new Text(summary.preview, 0, 0));
      if (summary.omitted > 0) {
        box.addChild(new Text(theme.fg("dim", `… 还有 ${summary.omitted} 行（ctrl+o 展开）`), 0, 0));
      }
    }
    return box;
  });

  // 退出工具：始终注册（零 tool-catalog churn）；`#`markdown 校验；审批走 ctx.ui；fail-closed。
  pi.registerTool({
    name: "exit_plan_mode",
    label: "exit_plan_mode",
    description:
      "Use only in plan mode. Present your plan for the user's review and, on approval, leave plan mode. " +
      "Send the COMPLETE plan as markdown, starting with a # heading that names it. " +
      "The user may approve (carry out the plan from your next step) or keep planning — their feedback " +
      "comes back in the tool result; revise and present again.",
    parameters: Type.Object({
      plan: Type.String({
        description: "The complete plan, as markdown, starting with a # heading that names it.",
      }),
    }),
    renderCall(args, theme) {
      // 调用行紧凑化：不铺计划正文（正文由 PLAN_REVIEW_ENTRY 渲染在消息区）。
      const summary = summarizePlan(args.plan ?? "");
      const name = summary.heading ?? "计划";
      return new Text(
        theme.fg("toolTitle", theme.bold("exit_plan_mode")) + theme.fg("dim", ` · ${name} · ${summary.lineCount} 行`),
        0,
        0,
      );
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!active) {
        throw new Error("exit_plan_mode is only available in plan mode");
      }
      if (!hasPlanHeading(params.plan)) {
        throw new Error("exit_plan_mode requires a non-empty markdown plan starting with a # heading");
      }
      if (!ctx.ui?.select) {
        throw new Error("no interactive review is available; ask the user to /plan off instead");
      }
      // 计划本体进聊天记录（TUI-only entry）：用户审阅的地方 = 消息区（可滚动/持久/不耗模型 token，
      // 不变量 4「批准交互不进模型上下文」）；底部 select 只做决策，不挤消息区、不替换编辑器。
      pi.appendEntry(PLAN_REVIEW_ENTRY, { plan: params.plan });
      const choice = await ctx.ui.select("批准该计划并退出计划模式？", ["批准", "继续规划"]);
      if (choice === "批准") {
        setActive(false);
        updatePlanBadge(ctx.ui);
        // gate 与模型认知对齐：工具结果已把「已退出」告知模型（dsh 靠每次 request/header
        // 刷新 activeAtLastHeader，不存在此窗口）。不校正的话，紧随其后的 `/plan on`
        // 会因 gate 仍停在 true 而被静默——用户看不到切回计划模式的叙述。
        lastInformedActive = false;
        return {
          content: [{ type: "text", text: "计划已批准 — 已退出计划模式；从下一步开始执行该计划。" }],
          details: undefined,
        };
      }
      if (choice === undefined) {
        throw new Error(
          "The user dismissed the plan review to speak instead; stay in plan mode, stop here, and wait for their message.",
        );
      }
      const feedback = await ctx.ui.input("继续规划。可附反馈（回车跳过）：");
      throw new Error(
        feedback?.trim()
          ? `用户选择继续规划；反馈：${feedback.trim()}`
          : "用户选择继续规划；修订计划后再次提交。",
      );
    },
  });
}
