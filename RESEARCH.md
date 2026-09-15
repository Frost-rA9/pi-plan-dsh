# pi-plan-dsh 交接文档（dsh plan-mode 调研 + 实现方案）

> 目的：为在 `pi-plan-dsh/` 目录搭建扩展提供**完整 dsh plan-mode 洞悉**与**详细实现方案**。
> 单一参考源 = dsh `packages/plan/plan-mode`（`@deepseek-ai/dsh-plan-mode`）。
> 正交分工：`pi-sandbox-dsh` = 强制轴（写面沙箱）；`pi-plan-dsh` = 引导轴（plan 协作状态）；二者互不读写。

---

## 一、dsh plan-mode 挖掘总结

### 1.1 定性
**按 agent 记录的"协作状态"（collaboration stance），软引导，不是安全边界。**

- 产品包 `@deepseek-ai/dsh-plan-mode`（`packages/plan/plan-mode/`）——**非 capability seam**（无可换后端），状态/引导/命令/退出工具同住一处。
- 持久立场：一个 **log-only whole-value-replace** 事件 `plan/mode: { active }`，永不是活体镜像；resume/fork/compaction 凭日志折叠恢复。
- 引导是软层：注册**一个 prompt 段 + 一个工具**，用文字约束，**不过滤任何工具**。

### 1.2 与 sandbox 的正交（核心结论）
- **三根独立轴：**
  - `plan-mode`（协作/引导，state=`plan/mode`）
  - `sandbox`（强制，`ctx.sandboxPolicy`，state=`sandbox/mode`）
  - `approval`（权限决策）
- **plan 既不读也不写 sandbox/approval**；sandbox 源码零 plan 引用；无共享 base type / registry / preset abstraction。
- 设计笔记（`.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md`）明确否决：
  - "折叠 sandbox 进 plan"：owner/lifecycle/consumer 不同；且 mode-owned sandbox cap 会**令用户的显式 sandbox 选择看似成功实则无效**。
  - "按 plan 过滤工具"：mutability 是每个工具的属性（含未来/MCP 工具）；**"plan mode is guidance, not a security boundary."**
- **→ `pi-plan-dsh` = 引导轴（软），`pi-sandbox-dsh` = 强制轴（硬），正交配对。** 这正对应 `pi-sandbox-dsh` AGENTS.md 那条"写面是全局档位、与是否处于计划阶段解耦"。

### 1.3 机制（源码锚点）
| 机制 | dsh 实现 | 源码（核对于 HEAD `0d1f50007f`） |
|---|---|---|
| **状态** | `plan/mode:{active}` log-only whole-value-replace；`plan` 投影（`stateVersion: 3`）折叠 `command/run`、`command/done`、`plan/mode`、`request/header` → 对外 `{active,pending}`；`PlanUnitState` = active/wanted/running/activeAtLastHeader | `plan-mode/src/index.ts:132-169` + `types.ts:21-38` |
| **引导** | `ctx.systemPrompt.section({name:'plan:policy', order:PLAN_POLICY(500), text:ctx=>active?section:''})` —— 只改 prompt，不改工具目录；text 读 `pending?.active ?? loggedActive` | `index.ts:212-219` |
| **命令** | `/plan [off|message]`：裸=`on`；`off`=`off`（带附件拒绝）；message/附件=`on`+`agent.steer()`；`definitionId` = 包名（发现元数据） | `index.ts:226-266`（`definitionId` `:227`） |
| **退出工具** | `exit_plan_mode` **始终注册**；参数 `plan:string`（须 `#` 标题）；输出 `{approved:true}`（const）；审核走 `userQuestions.ask`（`plan-review` intent，Approve/Keep planning + 反馈）；dismissed → 失败调用；无 channel / 重载中 → fail-closed | `index.ts:273-360` |
| **边界落地** | `agent/pre-step` waterfall：每步组装前先 `next()` 接受步骤、再 append pending `plan/mode`；开着回合 pending、下一 accepted pre-step 落地；append 失败不阻塞回合；pending 的 narration 追加进 `decision.messages` | `index.ts:192-206` + `agent-loop/src/agent.ts` `preStep()` |
| **通知（narration）** | 仅当上次 `request/header` 记录的状态存在且与目标不同才产出；无 open turn → `set()` 即时 `agent.inject()`；open turn → 下一步 accepted pre-step 投递 | `index.ts:452-463` · `:429-432` · `:374` |
| **校验** | `invariant.ts` 校验 `plan/mode` 载荷为 boolean | `invariant.ts:20` |

### 1.4 模型体验 / 语义细节
- inactive 0 token；active 注入 `section`（order 500）。
- `/plan`、`/plan off` 及其结果**不进模型历史**；`<message>` 经 steer 成为普通用户消息（附件保持选择顺序）。
- 工具 schema 两种状态都注册（切换只改 prompt，不改目录）。
- **审批结果：** approve → silent pending exit（当前 tool batch 的 plan 引导仍生效，下个边界才落地）；Keep planning → 失败调用携带用户反馈；dismissed(ASK_CANCELLED) → 失败调用"留在 plan、等用户消息"；无 `userQuestions` / 服务重载中 → fail-closed，靠 `/plan off` 手动逃生。
- 通知（narration）：仅上次 `request/header` 描述相反状态才产出——无 open turn 时 `set()` 即时 `agent.inject()` 一条“用户切到 plan/默认模式”用户消息；开着回合时挂 `{narrate:true}`，下一步 accepted pre-step 将同一条消息追加进 `decision.messages`。

### 1.5 设计笔记要点（决策依据）
- 曾引入通用 named-mode registry，因只 ship `plan` 而被砍——"mode"横跨不相关领域，统一抽象会**遮蔽独立所有权**。
- `plan/mode` 是 log-only、non-surface；spawn 的新 agent 初始 inactive（无 creation-time plan 选项）。
- 配置恰为 `{ section: string }`，未知键在 load 时拒绝。
- 审核走 user-questions seam（不是 approval seam，因为计划审核是协作决策、需要确切工件 + 修正性自由文本）。

---

## 二、pi-plan-dsh 完整详细实现方案

### 2.1 定位与命题
- pi 扩展：把 dsh 的 **plan 协作状态**移植到 pi——`/plan` 进入、`plan:policy` 引导、`exit_plan_mode` 审批退出。
- **只做引导轴，不做强制轴**——写面限制由 `pi-sandbox-dsh` 承担，二者**正交**。
- 一句话：**plan-mode 是"该不该先计划并要审批"的软引导；sandbox 是"允许写什么"的硬约束；两者互不读写。**

### 2.2 三段式判定门
1. **pi 原生机制**：
   - 状态折叠：`pi.appendEntry` + `session_start` 用 `getBranch()` 折叠（仿 `pi-sandbox-dsh/foldSandboxMode`）。
   - 引导注入：`pi.on('before_agent_start')` 追加 `plan:policy` 段。
   - 命令：`pi.registerCommand('plan', …)`。
   - 工具：`pi.registerTool`。
   - 审批：`ctx.ui.select/confirm/input`（富审可用 `ctx.ui.custom`）。
2. **dsh 语义**：`plan/mode` 日志折叠；`plan:policy` 段；`/plan [off|message]`；`exit_plan_mode` 始终注册 + `#`markdown 校验 + Approve/Keep planning；fail-closed。
3. **pi 裁剪**：核心小；不引 sandbox/approval；`exit_plan_mode` 始终注册（零目录 churn）；不改工具面（dsh 同）；`plan:policy` 仅追加 prompt 段。

### 2.3 架构（最小，非 seam）
```
pi-plan-dsh/
  index.ts                    包根 re-export → packages/core/src/index.ts（/config 显示名 pi-plan-dsh/index.ts）
  package.json  tsconfig.json  .gitignore
  AGENTS.md                   · 设计依据 ·（gitignored，本地设计说明）
  RESEARCH.md                 · 本文档 ·（dsh 调研 + 本实现方案）
  README.md
  packages/bridge             · 共享纯函数/类型 ·（plan/mode 折叠 + renderPlanPolicy + config 校验 + 标记）
  packages/core               · 唯一 pi 扩展宿主 ·
```
> 对齐 dsh"plan-mode 是一个产品包、非 capability seam"→ 不需要 sandbox/preview/question 能力库；bridge 仅放共享纯函数（版仿 `pi-sandbox-dsh-bridge`）。

### 2.4 bridge 契约（`packages/bridge/src/index.ts`，纯函数）
```ts
export const PLAN_MODE_ENTRY = 'plan/mode';
export interface PlanModeConfig { section: string }        // 必填非空，未知键拒绝
export interface PlanView { active: boolean; pending: boolean }
export interface PlanModeData { active: boolean }

export const DEFAULT_PLAN_ACTIVE = false;
export function resolvePlanConfig(config): PlanModeConfig   // section 校验，同 dsh
export function foldPlanMode(entries, defaultActive=false): PlanView   // last plan/mode wins
export function renderPlanPolicy(section, active): string  // active ? section : ''
export function hasPlanHeading(plan): boolean              // /^#{1,6}\s+\S/
export function firstPlanHeading(plan): string | undefined // 首个 # 标题
```

### 2.5 core 宿主（`packages/core/src/index.ts`）
```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  PLAN_MODE_ENTRY, DEFAULT_PLAN_ACTIVE, foldPlanMode, renderPlanPolicy,
  resolvePlanConfig, hasPlanHeading,
  type PlanModeConfig,
} from "pi-plan-dsh-bridge";

const DEFAULT_SECTION =
  "You are in plan mode. Explore and design before presenting the complete plan through exit_plan_mode.";

export default function planExtension(pi: ExtensionAPI): void {
  const config: PlanModeConfig = resolvePlanConfig({ section: DEFAULT_SECTION });
  let active = DEFAULT_PLAN_ACTIVE;

  const setActive = (ctx: ExtensionContext, next: boolean): void => {
    active = next;
    pi.appendEntry(PLAN_MODE_ENTRY, { active: next });
  };

  pi.on("session_start", (_e, ctx) => {
    const entries = (ctx.sessionManager?.getEntries?.() ?? []) as readonly unknown[];
    active = foldPlanMode(entries, DEFAULT_PLAN_ACTIVE).active;
  });

  pi.on("before_agent_start", (event) => {          // plan:policy 注入
    const policy = renderPlanPolicy(config.section, active);
    return policy ? { systemPrompt: event.systemPrompt + "\n\n" + policy } : undefined;
  });

  pi.registerCommand("plan", {                       // /plan [off|message]
    description: "进入/离开计划模式（dsh plan-mode）。/plan [off|message]",
    handler: async (args, ctx) => {
      const input = (args ?? "").trim();
      if (input === "off") { setActive(ctx, false); ctx.ui.notify("计划模式已关闭。", "info"); return; }
      setActive(ctx, true);
      if (input !== "") pi.sendUserMessage(input, { deliverAs: "steer" });  // 对齐 dsh steer
      ctx.ui.notify(`计划模式已开启。${input ? " 提示：" + input : ""}`, "info");
    },
  });

  pi.registerTool({
    name: "exit_plan_mode", label: "exit_plan_mode",
    description:
      "Use only in plan mode. Present your plan for the user's review and, on approval, leave plan mode. " +
      "Send the COMPLETE plan as markdown, starting with a # heading that names it. " +
      "The user may approve (carry out the plan from your next step) or keep planning — their feedback comes back in the tool result; revise and present again.",
    parameters: Type.Object({
      plan: Type.String({ description: "The complete plan, as markdown, starting with a # heading that names it." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!active) throw new Error("exit_plan_mode is only available in plan mode");
      if (!hasPlanHeading(params.plan)) throw new Error("exit_plan_mode requires a non-empty markdown plan starting with a # heading");
      if (!ctx.ui?.select) throw new Error("no interactive review available; ask the user to /plan off instead");
      ctx.ui.notify("计划待审批：\n" + params.plan, "info");   // 让用户看到完整计划
      const choice = await ctx.ui.select("批准该计划并退出计划模式？", ["批准", "继续规划"]);
      if (choice === "批准") {
        setActive(ctx, false);
        return { content: [{ type: "text", text: "计划已批准 — 已退出计划模式；从下一步开始执行该计划。" }], details: {} };
      }
      if (choice === undefined) {
        throw new Error("The user dismissed the plan review to speak instead; stay in plan mode, stop here, and wait for their message.");
      }
      const feedback = await ctx.ui.input("继续规划。可附反馈：");
      throw new Error(feedback?.trim() ? `用户选择继续规划；反馈：${feedback.trim()}` : "用户选择继续规划；修订计划后再次提交。");
    },
  });
}
```

### 2.6 与 pi-sandbox-dsh 正交契约（写进两扩展 AGENTS.md）
- `pi-plan-dsh` 只读写 `plan/mode`；`pi-sandbox-dsh` 只读写 `sandbox/mode`；互不 import、各自 fail-closed。
- `pi-sandbox-dsh` 已知取舍"计划性工作流不在本扩展内" → 明确由 `pi-plan-dsh` 承担（引导轴）。

### 2.7 设计不变量（回退先改）
1. **plan 是软引导、非安全边界**——不限制工具、不设写面限额。
2. **状态 = 日志折叠**（`plan/mode`），禁内存真源；resume/fork/compaction 靠折叠恢复。
3. **模型不能自行切换模式**——仅用户 `/plan`。
4. **批准交互不进模型上下文**；审批结果以工具结果/失败调用返回。
5. **fail-closed**：无交互通道 / 重载中 / dismissed → `exit_plan_mode` 失败，留 `/plan off` 逃生。
6. **与 pi-sandbox-dsh 完全正交**——互不读写状态、无共享类型。

### 2.8 已知取舍 / divergence（pi 对位）
1. **boundary append**：dsh 靠 `agent/pre-step` 回合封闭实现"选择在边界落地、引导覆盖当前 tool batch"。pi 无 pre-step → **`/plan` 立即 `appendEntry`**；"覆盖当前批"由 `before_agent_start` 每轮注入自然近似。**记录这条取舍。**
2. **审核 UI**：dsh 用 `userQuestions.ask` + `plan-review` intent 富呈现。pi 骨架先用 `ctx.ui.notify`(计划)+`ctx.ui.select`(批准/继续规划)+`ctx.ui.input`(反馈)；后续可升级为 `ctx.ui.custom` 富 plan-review 组件。
3. **pending 语义**：dsh `{active,pending}`（command/run 生命周期）。pi 立即落地 → `pending` 恒 false（保留字段备将来扩展）。
4. **附件随 /plan off 拒绝**：pi 命令参数是字符串、无附件机制（可省该项）。

### 2.9 验证与规模
- `npm run typecheck`（strict，bridge/core）。
- `npm test`：bridge `foldPlanMode`/`resolvePlanConfig`/`hasPlanHeading`/`renderPlanPolicy`；core 实例化 + `/plan` 命令 + `before_agent_start` 注入 + `exit_plan_mode` 校验（仿 `pi-sandbox-dsh` load.spec，用 mock pi）。
- 规模参考：2 个包，src 控制在 ~800 行内（核心小，贴合 dsh 单包哲学）。

### 2.10 源码锚点（移植对照；核对于 dsh HEAD `0d1f50007f` / `0.1.6-alpha.1`）
- `~/projects/deepseek-harness/packages/plan/plan-mode/src/index.ts`
- `.../plan-mode/src/types.ts` · `.../plan-mode/src/invariant.ts`
- `.../plan-mode/README.md`（模型体验/限制）
- `~/projects/deepseek-harness/docs/subsystems/plan.md`（子系统）
- `~/.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md`（正交设计决策）
- `~/projects/deepseek-harness/packages/core/agent-loop/src/agent.ts`（pre-step 边界）
- `~/projects/deepseek-harness/docs/subsystems/sandbox.md`（sandbox 强制轴，正交对照）
