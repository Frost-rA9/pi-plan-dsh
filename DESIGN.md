# pi-plan-dsh 设计依据（是什么 / 为什么）

> 本文是**设计依据**（是什么 / 为什么）：定位、参考源锚点、判定门记录、设计决策、架构、不变量、已知取舍。
> **agent 在本目录工作的行为约束见 `AGENTS.md`（本地文件、不入库，故 clone 中不出现）**；本文件按需读：改语义 / 改不变量 / 改参考源语义前。
> 单一参考源 = **dsh plan-mode**（`@deepseek-ai/dsh-plan-mode`；锚点核对于 dsh HEAD `0d1f50007f` / `0.1.6-alpha.1`）。完整调研 + 实现方案见 `RESEARCH.md`。

---

## 〇、定位与核心命题

- 一个 pi 扩展，把 dsh 的 **plan 协作状态**移植到 pi：`/plan` 进入、`plan:policy` 引导、`exit_plan_mode` 审批退出。
- 一句话：**plan-mode 是"该不该先计划并要审批"的软引导；sandbox 是"允许写什么"的硬约束。二者完全正交、互不读写。**
- **本扩展只做引导轴（软），不做强制轴**——写面限制由 `pi-sandbox-dsh` 承担。

## 一、参考源锚点（dsh plan-mode 源码实证）

| dsh 概念 | 源码位置 | 语义要点 |
|---|---|---|
| `plan/mode` | `index.ts:414-432`（`set()` 即时）、`:437-448`（`onBoundary()` 在 pre-step 落地） | log-only whole-value-replace 事件；最后一条赢；无则 inactive |
| `plan` 投影 | `index.ts:132-169`（`stateVersion: 3`）、`types.ts:21-38` | 折叠 `command/run`（name=plan）、`command/done`（配对 commandId）、`plan/mode`、`request/header` → 对外 `{active,pending}`；host state = `{active, wanted, running, activeAtLastHeader}` |
| 引导段 | `index.ts:212-219` | `plan:policy`，order `PLAN_POLICY`(500)，text 回调读 `pending?.active ?? loggedActive(session)`；inactive / 无 agent → `''` |
| `/plan` 命令 | `index.ts:226-266` | 裸=on、`off`=off（带附件拒绝）、message/附件=on+`agent.steer()`；四种 `set()` 结果各有文案 |
| `exit_plan_mode` | `index.ts:273-360` | **始终注册**；参数 `plan:string`（须 `#` 标题）；输出 `{approved:true}`（const）；审核走 `userQuestions.ask`（`intent.kind='plan-review'`，Approve/Keep planning）；dismissed → 失败调用；无 channel / 服务重载 → fail-closed |
| 通知（narration） | `index.ts:452-463`（第二道闸 `:374`） | 仅当「上次 `request/header` 记录的状态」存在且与目标不同才产出；无 open turn → `set()` 即时 `agent.inject()`；open turn → 挂 `pendingIntents{narrate:true}`，下一步 accepted pre-step 投递进 `decision.messages` |
| 命令身份（本次新增） | `index.ts:227` | `definitionId` = 提供方包名（`@deepseek-ai/dsh-plan-mode`）的稳定标识；**发现元数据、非授权**；作用域遮蔽选择完整描述符、**不继承**被遮蔽定义的标识 —— pi `registerCommand` 无身份字段（记录，不采纳） |
| invariant | `plan-mode/src/invariant.ts:20` | 校验 `plan/mode` 载荷 boolean |
| 设计决策 | `.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md` | 正交：plan 既不读也不写 sandbox/approval；无共享类型 |

## 二、三段式判定门（每个改动必须过）

1. **pi 原生机制**——`pi.appendEntry`+`getBranch()` 折叠；`pi.on('before_agent_start')` 注入；`pi.registerCommand`；`pi.registerTool`；`ctx.ui.select/confirm/input/custom` 审批。
2. **dsh 语义**——`plan/mode` 日志折叠 `{active}`；`plan:policy` 段；`/plan [off|message]`；`exit_plan_mode` 始终注册 + `#`markdown 校验 + Approve/Keep planning；fail-closed。
3. **pi 裁剪**——核心小；不引 sandbox/approval；`exit_plan_mode` 始终注册（零目录 churn）；`plan:policy` 仅追加 prompt 段；不改工具面（dsh 同）。

## 三、设计决策（为什么这样）

- **不采用"计划阶段限权"**：plan 是软引导、非安全边界。写面限制交给 `pi-sandbox-dsh`（强制轴），二者正交——正是 dsh 拒绝"折叠 sandbox 进 plan"、拒绝"按 plan 过滤工具"所坚持的独立性。
- **`exit_plan_mode` 始终注册**：切换 plan 只改 `plan:policy` prompt 段，不改工具目录（零 tool-catalog churn，对模型稳定）。
- **审批是协作决策，不是权限决策**：走交互审批（Approve/Keep planning + 反馈），不是 approval 批准流。

### narration（切换告知）边界

**唯一触发源 = `/plan` 命令族**（裸 `/plan`、`/plan <message>`、`/plan off`）：

- dsh 实证：`set()` 是全仓唯一 `narrate: true` 来源（`plan-mode/src/index.ts:420`），而 `set()` 只被 `/plan` 命令处理器调用（`:237` / `:253`）；`exit_plan_mode` **不经 `set()`**，直接 `pendingIntents.set(session, { active: false, narrate: false })`（`:347`，注释在 `:178-182`：“`narrate` is true for user selections and false for the exit tool, whose result already narrates the transition”）。
- pi 版对齐：`narratePlanSwitch()` 只在 `/plan` handler 内调用（`applyOn`/`applyOff`）；`exit_plan_mode` 三条路径（批准 / 继续规划 / dismissed）全静默，叙述由**工具结果/错误文本**承担。
- **第二道闸**：dsh `narration()`（`:452-463`）在 `told === undefined || told === target` 时返回 undefined（`told` 取自 `PlanUnitState.activeAtLastHeader`，访问器 `loggedActiveAtLastHeader` `:374`，由每条 `request/header` 刷新）；pi 版对应 `lastInformedActive`（`if (lastInformedActive === newActive) return;`）。
- **投递时机差异**：dsh 有两条——无 open turn → `set()` 即时 `session.append('plan/mode')` + `agent.inject(narration)`（`:429` / `:432`）；有 open turn → 挂 `{narrate:true}`（`:420`），下一步 accepted in-turn pre-step 由 `agent/pre-step` 监听器（`:192-206`）把 narration 追加进 `decision.messages`。pi 只有“立即”一条（无 command/run 生命周期）——见 §六「boundary append 简化」。
- **gate 同步点（含审批路径）**：`lastInformedActive` 由 `before_agent_start`（每用户轮）与 notice 成功后更新；**审批退出也要显式校正为 `false`**（工具结果已把"已退出"告知模型）——否则会出现"状态已变、gate 仍停在 `true`"的错配，使紧随其后的 `/plan on` 被静默（dsh 靠每次 `request/header` 刷新 `activeAtLastHeader`，不存在该窗口）。回归护栏见 §七（含该路径的"会叙述"断言）。

## 四、架构（当前实现，packages/*）

| 块 | 职责 | 实现 |
|---|---|---|
| **bridge** | 共享纯函数/类型：`plan/mode` 折叠、`renderPlanPolicy`、`resolvePlanConfig`、`hasPlanHeading`/`firstPlanHeading`、`summarizePlan`（计划摘要） | `packages/bridge/src/index.ts` |
| **core** | 唯一 pi 扩展宿主：状态折叠、`before_agent_start` 注入 `plan:policy`、`/plan` 命令、`exit_plan_mode` 工具、`plan/review` entry renderer（TUI-only 审阅视图） | `packages/core/src/index.ts` |

- 非 capability seam（对齐 dsh"plan-mode 是一个产品包"）：无 sandbox/preview/question 能力库。

## 五、设计不变量（回退需先改本节）

1. **plan 是软引导、非安全边界**——不限制工具、不设写面限额。
2. **状态 = 日志折叠**（`plan/mode`），禁内存真源；resume/fork/compaction 靠折叠恢复。
3. **模型不能自行切换模式**——仅用户 `/plan`（用户决策点）。
4. **批准交互不进模型上下文**；审批结果以工具结果 / 失败调用返回。计划本体走 `plan/review` entry（`pi.appendEntry`，TUI-only）——进会话日志与消息区，**不进 LLM 上下文**。
5. **fail-closed**——无交互通道 / 重载中 / dismissed → `exit_plan_mode` 失败，留 `/plan off` 逃生。
6. **与 pi-sandbox-dsh 完全正交**——互不读写状态、无共享类型。

## 六、已知取舍（接受并文档化）

- **boundary append 简化**：dsh 靠 `agent/pre-step` 回合封闭；pi 无 pre-step → `/plan` 立即 `appendEntry`；"引导覆盖当前 tool batch"由 `before_agent_start` 每轮注入近似（记录为取舍）。
- **同轮内提示段滞后（与 dsh 的已知差异；决定 = 记录，不改架构）**：
  - **证据**：pi 的 `before_agent_start` 每个用户轮只触发一次（`agent-session.js:914-938`，`agent.state.systemPrompt` 本轮固定）；dsh 的 `plan:policy` 段是 `systemPrompt.section` 的 **text 回调**、每次 assembly 动态求值（`plan-mode/src/index.ts:212-219`，读 `pending?.active ?? loggedActive`）——dsh 的"pending 塑造下一次 assembly"正来自这一点，不是额外机制。
  - **影响**：本轮中途切换（含批准退出）后，模型本轮剩余请求仍看到旧的 `plan:policy` 文案；`exit_plan_mode` 已用工具结果即时叙述，用户切换已用 notice 即时叙述，模型不会被误导方向，只是提示段滞后一轮。
  - **未采用的方案（备将来）**：给该段加哨兵，在 `before_provider_request` 里按当前 `active` 剥离 payload（语义等价 dsh），代价是 payload 改写 + 前缀缓存可能失效，需实测后再定；当前不实现。
- **审阅呈现 = entry（消息区），不是交互层**：计划本体由 `pi.appendEntry(PLAN_REVIEW_ENTRY, { plan })` + `pi.registerEntryRenderer` 渲染进聊天记录（可滚动/可选中/持久/resume 可见/不耗模型 token），展开折叠沿用 pi 全局 `ctrl+o`（默认折叠为前 8 行 + 省略行数）；审批只留底部 `ctx.ui.select`（3 行）+ `ctx.ui.input` 反馈。
  - **为何不放 `ctx.ui.custom`/`ctx.ui.editor`**：两者都占编辑器区域（`showExtensionCustom` 非 overlay 时替换 `editorContainer`），高度与消息区 1:1 互换——撑大则看不到消息区，缩小则难以审阅；且视图关闭即消失、工具调用行又不渲染正文，事后无法回看。
  - dsh 的对应语义是 `userQuestions.ask({ detail, intent: { kind: 'plan-review' } })`（把渲染交给 UI 家族）；pi 侧以 entry renderer 承接该意图，不引入自定义交互组件。
  - 工具调用行由 `renderCall` 紧凑化为 `exit_plan_mode · 标题 · N 行`（不铺正文）。
- **pending 恒 false**：pi 立即落地，无 command/run 生命周期；保留 `pending` 字段备将来扩展。
- **命令身份（`definitionId`）不采纳**：dsh 本轮给命令定义加了品牌 `CommandDefinitionId`（`plan-mode/src/index.ts:227` = 提供方包名），语义是**发现元数据**（非授权、不进命令生命周期事件、作用域遮蔽不继承）。pi 的 `pi.registerCommand(name, {description, handler})` 没有身份字段，且本扩展只注册一个 `/plan`、无遮蔽场景 → **记录即可**，不为对齐而自造身份概念。
- **本轮参考源刷新结论**：dsh `plan-mode` 的**语义未变**（`plan/mode`/投影/`plan:policy`/`/plan`/`exit_plan_mode`/narration 边界均与移植时一致），只有行号漂移与新增 `definitionId`；已按 `0d1f50007f` 重核锚点。PTC 词汇重命名（`CodeRuntime`→`PtcRuntime`）只影响 dsh 自己的测试假件，与本扩展无关。

## 七、验证与规模

- `npm run typecheck`（strict，全部 workspace）。
- `npm test`：bridge 折叠 / config / heading 校验 / `summarizePlan`（标题、行数、预览、省略、空与流式片段）；core 实例化 + `/plan` 命令 + `before_agent_start` 注入 + `exit_plan_mode` 校验 + notice 语义四项护栏（审批静默 / 继续规划静默 / `/plan off` 对照会发且 `deliverAs: steer`+`display: true` / 批准后同轮 `/plan on` 会叙述（审批路径已同步 gate））+ 审批路径写 `plan/review` entry（且 notify 不再铺原文）+ 继续规划路径（fail-closed、entry 保留、模式不翻转、反馈随错误返回）+ entry renderer 折叠态可渲染（mock pi，不依赖 TUI 主题初始化）。
- 规模参考：约 2 个包，src 控制在 ~800 行内（核心小）。
