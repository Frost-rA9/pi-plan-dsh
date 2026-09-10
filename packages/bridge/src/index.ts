/**
 * pi-plan-dsh-bridge · 共享契约 + 纯函数。
 *
 * 单一参考源 = dsh `packages/plan/plan-mode`。这里是"plan 协作状态"的**核心词表**：
 * 一条 log-only whole-value-replace 事件 `plan/mode: { active }`、plan:policy prompt 段、
 * 配置校验（`{ section }`，未知键拒绝）、markdown 计划头校验、计划审阅 entry（`plan/review`，TUI-only）
 * 与其折叠摘要 `summarizePlan`。
 * 全部为纯函数（无副作用），供 core（唯一 pi 扩展宿主）与测试共享。
 *
 * 对齐 dsh：`plan-mode/src/{index,types,invariant}.ts` + `planProjectionDefinition`；
 * 但按 pi 哲学裁剪（核心小、最小暴露面、无 command/run 生命周期 → `pending` 恒 false）。
 */

/* ------------------------------ 状态事件（plan/mode） ------------------------------ */

/** Pi appendEntry 事件条目（简化为我们关心的 shape）。 */
export interface AppendEntry {
  type?: string;
  customType?: string;
  data?: unknown;
}

/** 状态事件 customType。dsh：`plan/mode`，log-only whole-value-replace，最后一条赢。 */
export const PLAN_MODE_ENTRY = 'plan/mode';

/** 事件载荷：`{ active }`，日志真源。 */
export interface PlanModeData {
  active: boolean;
}

/**
 * 计划审阅 entry 的 customType。**TUI-only**：`pi.appendEntry` 进会话日志但**不进 LLM 上下文**
 * （`docs/extensions.md`：custom entries do NOT participate in LLM context），配合
 * `pi.registerEntryRenderer` 渲染进聊天记录（消息区），作为"用户审阅计划"的持久载体。
 */
export const PLAN_REVIEW_ENTRY = 'plan/review';

/** 计划审阅 entry 的载荷：计划全文（markdown）。 */
export interface PlanReviewData {
  plan: string;
}

/** 投影视图：`{ active, pending }`。pi 立即落地 → `pending` 恒 false（备将来扩展）。 */
export interface PlanView {
  active: boolean;
  pending: boolean;
}

/** 默认（无任何 `plan/mode` 事件时的折叠态）：未激活。 */
export const DEFAULT_PLAN_ACTIVE = false;

/** 部署归属的 plan 引导文案（无配置时的默认段）。 */
export const DEFAULT_PLAN_SECTION =
  'You are in plan mode. Explore and design before presenting the complete plan through exit_plan_mode.';

/* ------------------------------ 配置（PlanModeConfig） ------------------------------ */

/** 部署归属的 plan 引导。仅 `section` 一个键，未知键在 load 时拒绝（对齐 dsh `resolveConfig`）。 */
export interface PlanModeConfig {
  /** 当 plan 激活时，作为 `plan:policy` prompt 段注入的文案。 */
  section: string;
}

/**
 * 校验部署归属的 plan 引导：section 必须为字符串且非空，未知键拒绝。
 * 对齐 dsh `plan-mode/src/index.ts` `resolveConfig()`。
 *
 * @param config 原始配置（可能来自默认值）。
 * @returns 校验后的独立配置。
 */
export function resolvePlanConfig(config: PlanModeConfig): PlanModeConfig {
  const section = (config as Partial<PlanModeConfig>).section;
  if (typeof section !== 'string') {
    throw new Error('PlanModeConfig needs a string `section`');
  }
  if (section.trim() === '') {
    throw new Error('PlanModeConfig needs a non-empty `section`');
  }
  const unknown = Object.keys(config).filter((key) => key !== 'section');
  if (unknown.length > 0) {
    throw new Error(`PlanModeConfig has unknown key(s) ${unknown.join(', ')} — config is { section }`);
  }
  return { section };
}

/* ------------------------------ 折叠（foldPlanMode） ------------------------------ */

/**
 * 纯折叠：从会话日志取最近一条 `plan/mode` 事件，无则返回默认（未激活）。
 * 对齐 dsh `planProjectionDefinition` 的 `plan/mode` 分支：last-wins whole-value-replace。
 * pi 无 command/run 生命周期 → pending 恒 false；
 * 若 payload 非法（非 boolean），跳过该条继续向前翻（对齐 dsh `invariant.ts` 的校验语义）。
 */
export function foldPlanMode(entries: readonly AppendEntry[], defaultActive: boolean = DEFAULT_PLAN_ACTIVE): PlanView {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.customType !== PLAN_MODE_ENTRY) continue;
    const active = (e.data as { active?: unknown } | undefined)?.active;
    if (typeof active === 'boolean') return { active, pending: false };
  }
  return { active: defaultActive, pending: false };
}

/* ------------------------------ 引导段（renderPlanPolicy） ------------------------------ */

/**
 * 渲染当前 plan 引导段：激活时返回 section，否则空串（0 token）。
 * 对齐 dsh `systemPrompt.section({name:'plan:policy', text: active ? section : ''})`。
 */
export function renderPlanPolicy(section: string, active: boolean): string {
  return active ? section : '';
}

/* ------------------------------ markdown 计划头校验 ------------------------------ */

/** 计划是否以 markdown 标题开头（`#{1,6}` + 空白 + 非空白），用于 exit_plan_mode 校验。 */
export function hasPlanHeading(plan: string): boolean {
  return /^#{1,6}\s+\S/.test(plan.trim());
}

/** 计划的首个 markdown 标题文本（任意层级），无则 undefined。对齐 dsh `firstHeading`。 */
export function firstPlanHeading(plan: string): string | undefined {
  for (const line of plan.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

/* ------------------------------ 计划审阅 entry 的折叠摘要 ------------------------------ */

/** 折叠态预览行数（展开态由 pi 的 ctrl+o / `app.tools.expand` 统一控制）。 */
export const PLAN_PREVIEW_LINES = 8;

/** 计划正文的行数 + 折叠态预览（entry renderer 与 renderCall 共用，纯函数）。 */
export interface PlanSummary {
  /** 首个 markdown 标题文本，无标题则无该键。 */
  heading?: string;
  /** 计划正文行数（忽略尾部空行）。 */
  lineCount: number;
  /** 折叠态预览（前 `PLAN_PREVIEW_LINES` 行）。 */
  preview: string;
  /** 预览之外被省略的行数（0 = 预览即全文）。 */
  omitted: number;
}

/**
 * 折叠一份计划：标题 / 行数 / 前 N 行预览 / 省略行数。
 * 输入允许为空或流式未完成（args 可能只有片段），不抛错。
 */
export function summarizePlan(plan: string, previewLines: number = PLAN_PREVIEW_LINES): PlanSummary {
  const body = plan.replace(/\s+$/, '');
  const lines = body === '' ? [] : body.split('\n');
  const limit = Math.max(0, previewLines);
  const heading = firstPlanHeading(body);
  const summary: PlanSummary = {
    lineCount: lines.length,
    preview: lines.slice(0, limit).join('\n'),
    omitted: Math.max(0, lines.length - limit),
  };
  return heading === undefined ? summary : { ...summary, heading };
}
