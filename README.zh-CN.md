# pi-plan-dsh

一个 pi 扩展，把 dsh 的**plan 协作状态**作为**软引导**（引导轴）移植到 pi——是「plan/强制」二分中的**引导轴**。仅以单一参考源建模：[dsh](https://github.com/deepseek-ai/deepseek-harness)。

## 模型

**仅引导轴——不是安全边界。**

- `/plan` 进入 plan 模式；`/plan off` 退出；`/plan <message>` 进入并把消息带进去引导。
- 激活期间，每次 agent 启动都注入一段 `plan:policy` 提示——只改变提示，从不改变工具目录。该段**按用户轮**组装一次：同一轮内的切换要到下一轮提示才生效（当轮由切换 notice 即时告知；批准退出则由工具结果告知）。
- `exit_plan_mode` 无论 plan 模式是否激活都保持注册，因此进入/退出只改变提示段。以 `#` 标题开头的完整 markdown 计划，以**对话记录中可折叠的块**呈现给用户审阅——可滚动、可选中、resume 后仍在、**从不进入 LLM 上下文**，用 pi 统一的工具输出展开键（`ctrl+o`）展开为完整 Markdown；审批本身只是底部三行的对话，审阅不会把消息区挤出视野。批准即退出 plan 模式，「keep planning」把反馈发回模型。
- 状态是仅追加的整值替换事件 `plan/mode: { active }`——最后者胜；resume/fork/compaction 经 fold 恢复。它**永远不是**内存中的真源。

## 正交性

「plan/强制」二分镜像 dsh 且完全正交：

| 轴 | 扩展 | 状态 | 角色 |
|---|---|---|---|
| 引导 | `pi-plan-dsh` | `plan/mode` | 软提示引导 |
| 强制 | `pi-sandbox-dsh` | `sandbox/mode` | 写入边界的 OS 沙箱 |

`plan` 从不读写 `sandbox` 状态（反之亦然）；二者独立、各自配置。镜像 dsh 自身的拆分：*"Plan mode is soft guidance. Sandbox mode and approval policy enforce restrictions independently; neither reads nor writes plan state."* 这一对共同**替代已弃用的 `pi-plan-mode`**。

## 设计规则

1. Plan 模式是引导——不做工具过滤、不设写入上限。
2. 状态是 `plan/mode` 的日志 fold——绝不是内存真源。
3. 模型不能自行切换模式；只有用户的 `/plan` 决定。
4. 批准交互从不进入模型上下文；结果经工具结果/一次失败调用返回。被审阅的计划是 TUI-only 的对话记录块——持久、可回看，但从不发给模型。
5. **失败即关闭**：无交互通道、审阅期间重载、或已驳回的审阅 → `exit_plan_mode` 失败，`/plan off` 作为逃生出口。
6. 与 `pi-sandbox-dsh` 完全正交——无共享状态或类型。

## 后端

无——这是纯引导扩展（无 OS 沙箱、无 preview/question 能力 seam）。设计依据与已知取舍见 [DESIGN.md](DESIGN.md)。

## 许可证

MIT
