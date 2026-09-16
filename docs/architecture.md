# pi-plan-dsh · 架构（精简）

> **plan 是"该不该先计划并要审批"的软引导**（引导轴），不是安全边界；写面限制由 `pi-sandbox-dsh`（强制轴）承担，二者完全正交、互不读写。
> `plan:policy` 软引导段 + `/plan` 进入 + `exit_plan_mode` 审批退出。
> 单一参考源 = dsh `packages/plan/plan-mode`；锚点 `0d1f50007f`。行为约束见 `AGENTS.md`（本地文件、不入库）。

## pi 机制映射

| 需求 | pi 原生机制 |
|---|---|
| 模式状态 | `appendEntry('plan/mode')` + `getBranch()/getEntries()` 折叠（禁内存真源；resume/fork/compaction 靠折叠恢复） |
| 引导段 | `before_agent_start` 追加 `plan:policy`（≤ ~100 tok；未激活时字节不变） |
| 进入 / 退出 | `registerCommand('plan')`；`registerTool(exit_plan_mode)` |
| 审批 | `ctx.ui.select`（Approve / Keep planning）+ `ctx.ui.input`（反馈） |
| 计划呈现 | `appendEntry('plan/review')` + `registerEntryRenderer`（TUI-only，进消息区/会话日志、**不进 LLM 上下文**） |
| 切换告知 | `sendMessage(..., { deliverAs: 'steer', display: true })`（英文文案） |

## 结构

| 块 | 职责 | 实现 |
|---|---|---|
| core | 唯一 pi 扩展宿主：折叠、`plan:policy` 注入、`/plan`、`exit_plan_mode`、entry renderer | `packages/core/src/index.ts` |
| bridge | 纯函数/类型：`plan/mode` 折叠、`renderPlanPolicy`、`resolvePlanConfig`、`hasPlanHeading`/`firstPlanHeading`、`summarizePlan` | `packages/bridge/src/index.ts` |

无 capability seam（对齐 dsh"plan-mode 是一个产品包"）。

## 关键语义

- **`exit_plan_mode` 始终注册**：切换 plan 只改 `plan:policy` 段，**零工具目录 churn**。
- **只有用户能切模式**（`/plan`、`/plan off`、`/plan <message>`）；模型不能自行切换。
- **审批是协作决策**（Approve → 工具返回常量 `{approved:true}`），不是权限决策。
- **narration 只在 `/plan` 命令族**：`exit_plan_mode` 的三条路径（批准 / 继续规划 / dismissed）全静默，叙述由工具结果/错误文本承担；第二道闸 `lastInformedActive` 防重复（审批退出后也显式校正，避免"状态已变、gate 仍 true"）。
- **fail-closed**：无交互通道 / 服务重载中 / dismissed → `exit_plan_mode` 失败（留 `/plan off` 逃生）；继续规划路径 entry 保留、模式不翻转。

## 不变量（回退先改这里）

1. **plan 是软引导、非安全边界**——不限制工具、不设写面限额。
2. **状态 = 日志折叠**（`plan/mode`），禁内存真源。
3. **模型不能自行切换模式**——仅用户 `/plan`（用户决策点）。
4. **批准交互不进模型上下文**；计划本体走 `plan/review` entry（TUI-only）。
5. **fail-closed**——无通道 / dismissed → 失败。
6. **与 pi-sandbox-dsh 完全正交**——互不读写状态、无共享类型。

## 已知取舍 / 边界

- **boundary append 简化**：dsh 靠 `agent/pre-step` 回合封闭；pi 无 pre-step → `/plan` 立即 `appendEntry`，"引导覆盖当前 tool batch"由每轮 `before_agent_start` 近似。
- **同轮内提示段滞后**：pi 的 `before_agent_start` 每用户轮只跑一次，dsh 的 `plan:policy` 是每次 assembly 动态求值的 text 回调；本轮中途切换后提示段滞后一轮（模型方向不会被误导：切换有 notice、退出有工具结果）。未采用的补偿（`before_provider_request` 剥 payload）会破坏前缀缓存，暂不做。
- **审阅呈现 = entry（消息区）**，不用 `ui.custom`/`ui.editor`（占编辑器区域、关闭即消失、事后不可回看）；工具行 `renderCall` 紧凑化为 `exit_plan_mode · 标题 · N 行`。
- **`pending` 恒 false**（pi 立即落地，无 command/run 生命周期）；**命令身份 `definitionId` 不采纳**（发现元数据，pi 无对应字段）。

## 验证

- `npm run typecheck`（strict）
- `npm test`：bridge（折叠 / config / heading 校验 / `summarizePlan`）+ core（实例化、`/plan`、注入、`exit_plan_mode` 校验、notice 四项护栏：审批静默 / 继续规划静默 / `/plan off` 对照会发 / 批准后同轮 `/plan on` 会叙述、审批写 entry、继续规划 fail-closed、entry renderer 折叠态可渲染）
