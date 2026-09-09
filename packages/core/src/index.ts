/**
 * pi-plan-dsh-core · pi 扩展宿主（唯一 pi 扩展）。
 *
 * 单一参考源 = dsh：plan 协作状态（软引导轴），与 pi-sandbox-dsh（强制轴）完全正交。
 * 装配：session_start 用 `getEntries()` 折叠 `plan/mode`（不变量 2）→ `/plan` 命令（用户决策点）
 * → `before_agent_start` 注入 `plan:policy` 段（不改工具目录）→ `exit_plan_mode` 工具（始终注册，
 * `#`markdown 校验 + 用户审批 + fail-closed）。
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  PLAN_MODE_ENTRY,
  DEFAULT_PLAN_ACTIVE,
  DEFAULT_PLAN_SECTION,
  foldPlanMode,
  renderPlanPolicy,
  resolvePlanConfig,
  hasPlanHeading,
  type PlanModeConfig,
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

  const updatePlanBadge = (ui: { theme: Theme; setStatus: (k: string, t: string | undefined) => void } | undefined): void => {
    if (!ui) return;
    ui.setStatus("pi-plan-dsh", planBadge(ui.theme, active));
  };

  const setActive = (next: boolean): void => {
    active = next;
    pi.appendEntry(PLAN_MODE_ENTRY, { active: next });
  };

  // session_start：从会话日志折叠当前 plan 状态（resume/fork/compaction 依赖折叠恢复）。
  pi.on("session_start", (_event, ctx) => {
    const entries = (ctx.sessionManager?.getEntries?.() ?? []) as never;
    active = foldPlanMode(entries).active;
    updatePlanBadge(ctx.ui);
  });

  // 引导段注入：只改 prompt，不改工具目录；未激活时 0 token（不追加）。
  pi.on("before_agent_start", (event) => {
    const policy = renderPlanPolicy(config.section, active);
    if (policy === "") return undefined;
    return { systemPrompt: event.systemPrompt + "\n\n" + policy };
  });

  // `/plan [off|message]`：裸=`on`；`off`=`off`；message=`on` + steer（对齐 dsh）。
  pi.registerCommand("plan", {
    description: "进入/离开计划模式（dsh plan-mode 软引导）。/plan [off|message]",
    handler: async (args, ctx) => {
      const input = (args ?? "").trim();
      if (input === "off") {
        if (active) {
          setActive(false);
          ctx.ui.notify("计划模式已关闭。", "info");
        } else {
          ctx.ui.notify("计划模式已是关闭。", "info");
        }
        updatePlanBadge(ctx.ui);
        return;
      }
      if (!active) {
        setActive(true);
        updatePlanBadge(ctx.ui);
      }
      if (input !== "") pi.sendUserMessage(input, { deliverAs: "steer" });
      ctx.ui.notify(`计划模式已开启。${input !== "" ? " 提示：" + input : ""}`, "info");
    },
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
      // 让用户看到完整计划（骨架版；后续可升级为 ctx.ui.custom 富审）。
      ctx.ui.notify("计划待审批：\n" + params.plan, "info");
      const choice = await ctx.ui.select("批准该计划并退出计划模式？", ["批准", "继续规划"]);
      if (choice === "批准") {
        setActive(false);
        updatePlanBadge(ctx.ui);
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
