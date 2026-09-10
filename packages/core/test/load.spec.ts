/**
 * pi-plan-dsh-core · 扩展加载冒烟（mock pi API）。
 *
 * 验证：实例化不崩、注册了 /plan 命令 + exit_plan_mode 工具、session_start 折叠 plan/mode、
 * before_agent_start 按 active 注入 plan:policy、exit_plan_mode fail-closed（未激活 → 拒绝）、
 * 审批路径把计划写进 TUI-only entry（而非 notify 原文）。
 */
import planExtension from "../src/index.ts";
import { PLAN_REVIEW_ENTRY } from "pi-plan-dsh-bridge";

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}`); }
}

// mock pi
const tools: Record<string, unknown>[] = [];
const commands: Record<string, unknown> = {};
const handlers: Record<string, (...a: unknown[]) => unknown> = {};
const messages: unknown[] = [];
const entries: unknown[] = [];
const entryRenderers: Record<string, (...a: unknown[]) => unknown> = {};

const pi = {
  registerTool: (t: unknown) => { tools.push(t as Record<string, unknown>); },
  registerCommand: (name: string, spec: unknown) => { commands[name] = spec; },
  registerFlag: () => {},
  registerEntryRenderer: (type: string, renderer: (...a: unknown[]) => unknown) => { entryRenderers[type] = renderer; },
  on: (name: string, h: (...a: unknown[]) => unknown) => { handlers[name] = h; },
  sendMessage: (m: unknown) => { messages.push(m); },
  sendUserMessage: (m: unknown) => { messages.push(m); },
  appendEntry: (type: string, data: unknown) => { entries.push({ customType: type, data }); },
  setActiveTools: () => {},
  getActiveTools: () => [] as string[],
  getFlag: () => undefined,
} as never;

let lastBadge: string | undefined;
const notifications: string[] = [];
// 可切换的交互队列：空 → 默认「批准」/ 空反馈（各分支测试按需 push，用完即回默认）。
const selectResults: (string | undefined)[] = [];
const inputResults: string[] = [];
const ui = {
  theme: { fg: (_c: string, t: string) => t },
  setStatus: (_k: string, t: string | undefined) => { lastBadge = t; },
  notify: (m: string) => { notifications.push(m); },
  select: async () => (selectResults.length > 0 ? selectResults.shift() : "批准"),
  input: async () => (inputResults.length > 0 ? inputResults.shift()! : ""),
};

console.log("=== 实例化扩展 ===");
try {
  planExtension(pi);
  passed++;
  console.log("  ✅ 扩展实例化无异常");
} catch (e) {
  failed++;
  console.error(`  ✗ 实例化抛异常: ${e instanceof Error ? e.message : String(e)}`);
}

console.log("=== 注册了 /plan 命令? ===");
assert(!!commands["plan"], "/plan command registered");

console.log("=== 注册了 exit_plan_mode 工具（始终注册）? ===");
const exitTool = tools.find((t) => (t as { name?: string }).name === "exit_plan_mode");
assert(!!exitTool, "exit_plan_mode tool registered");
assert(typeof (exitTool as { execute?: unknown }).execute === "function", "exit_plan_mode has execute");

console.log("=== 初始（未激活）before_agent_start 不注入? ===");
try {
  const r = handlers["before_agent_start"]!({ systemPrompt: "base" }) as { systemPrompt?: string } | undefined;
  assert(r === undefined, "inactive → no plan:policy injection");
  passed++;
} catch (e) {
  failed++;
  console.error(`  ✗ before_agent_start 初始注入异常: ${e instanceof Error ? e.message : String(e)}`);
}

console.log("=== 初始 exit_plan_mode fail-closed? ===");
try {
  const ex = exitTool as { execute: (id: string, params: { plan: string }, s: unknown, u: unknown, c: unknown) => Promise<unknown> };
  await ex.execute("1", { plan: "# My Plan\nsteps" }, undefined, undefined, { ui });
  failed++;
  console.error("  ✗ exit_plan_mode 未激活时未抛异常");
} catch (e) {
  assert(String(e).includes("only available in plan mode"), "未激活 → 拒绝：only available in plan mode");
  passed++;
}

console.log("=== 注册了 plan/review entry renderer（TUI-only 审阅）? ===");
assert(typeof entryRenderers[PLAN_REVIEW_ENTRY] === "function", "plan/review entry renderer registered");

console.log("=== session_start 折叠 plan/mode(active=true)? ===");
const sessionCtx = { sessionManager: { getEntries: () => [{ customType: "plan/mode", data: { active: true } }] }, ui };
try {
  handlers["session_start"]!({}, sessionCtx);
  passed++;
} catch (e) {
  failed++;
  console.error(`  ✗ session_start 异常: ${e instanceof Error ? e.message : String(e)}`);
}
console.log("=== 徽标常驻：激活 → [plan-mode:on]（橙）? ===");
assert(typeof lastBadge === "string" && lastBadge!.includes("[plan-mode:on]"), "active → badge [plan-mode:on]");

console.log("=== 激活后 before_agent_start 注入 plan:policy? ===");
try {
  const r = handlers["before_agent_start"]!({ systemPrompt: "base" }) as { systemPrompt: string } | undefined;
  assert(typeof r?.systemPrompt === "string" && r.systemPrompt.includes("plan mode"), "active → systemPrompt contains plan guidance");
  passed++;
} catch (e) {
  failed++;
  console.error(`  ✗ before_agent_start 激活注入异常: ${e instanceof Error ? e.message : String(e)}`);
}

console.log("=== /plan off → 回到未激活? ===");
try {
  const h = (commands["plan"] as { handler: (args: string, ctx: unknown) => Promise<void> }).handler;
  await h("off", { ui });
  const r = handlers["before_agent_start"]!({ systemPrompt: "base" }) as { systemPrompt?: string } | undefined;
  assert(r === undefined, "/plan off → no plan:policy injection");
  assert(entries.some((e) => (e as { customType?: string }).customType === "plan/mode"), "/plan off appends plan/mode");
  assert(lastBadge === "[plan-mode:off]", "/plan off → badge [plan-mode:off]（蓝）");
  passed++;
} catch (e) {
  failed++;
  console.error(`  ✗ /plan off 异常: ${e instanceof Error ? e.message : String(e)}`);
}

console.log("=== 激活后 exit_plan_mode 审批：计划进 entry、不进 notify 原文? ===");
try {
  const planHandler = (commands["plan"] as { handler: (args: string, ctx: unknown) => Promise<void> }).handler;
  await planHandler("on", { ui }); // 上一步已 /plan off，这里重新激活
  const ex = exitTool as { execute: (id: string, params: { plan: string }, s: unknown, u: unknown, c: unknown) => Promise<unknown> };
  const plan = "# 审阅计划\n\n- 步骤一\n- 步骤二";
  notifications.length = 0;
  const before = entries.length;
  await ex.execute("2", { plan }, undefined, undefined, { ui });
  const appended = entries.slice(before).some((e) => {
    const entry = e as { customType?: string; data?: { plan?: string } };
    return entry.customType === PLAN_REVIEW_ENTRY && entry.data?.plan === plan;
  });
  assert(appended, "审批路径 appendEntry(plan/review, { plan })");
  assert(!notifications.some((n) => n.includes(plan)), "notify 不再铺计划原文（不再撑爆状态行）");
  assert(
    entries.some(
      (e) =>
        (e as { customType?: string }).customType === "plan/mode" &&
        (e as { data?: { active?: boolean } }).data?.active === false,
    ),
    "批准后 appendEntry(plan/mode, { active: false })",
  );
  assert(lastBadge === "[plan-mode:off]", "批准后徽标回到 [plan-mode:off]");
} catch (e) {
  failed++;
  console.error(`  ✗ exit_plan_mode 审批路径异常: ${e instanceof Error ? e.message : String(e)}`);
}

console.log("=== 继续规划路径：fail-closed + entry 保留 + 模式不翻转? ===");
try {
  const planHandler = (commands["plan"] as { handler: (args: string, ctx: unknown) => Promise<void> }).handler;
  await planHandler("on", { ui }); // 上一段已批准退出，这里重新激活
  const ex = exitTool as { execute: (id: string, params: { plan: string }, s: unknown, u: unknown, c: unknown) => Promise<unknown> };
  const revised = "# 修订计划\n\n- 再补一条";
  notifications.length = 0;

  // (a) 无反馈：仅「继续规划」
  selectResults.push("继续规划");
  let message = "";
  try {
    await ex.execute("3", { plan: revised }, undefined, undefined, { ui });
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  assert(message.includes("继续规划"), "继续规划 → 抛错（fail-closed，不是工具成功）");
  assert(
    entries.some((e) => {
      const entry = e as { customType?: string; data?: { plan?: string } };
      return entry.customType === PLAN_REVIEW_ENTRY && entry.data?.plan === revised;
    }),
    "继续规划 → plan/review entry 仍写入（审阅记录留在消息区）",
  );
  assert(typeof lastBadge === "string" && lastBadge.includes("[plan-mode:on]"), "继续规划 → 仍处 plan 模式（徽标不变）");
  const planModes = entries.filter((e) => (e as { customType?: string }).customType === "plan/mode");
  assert(
    (planModes[planModes.length - 1] as { data?: { active?: boolean } }).data?.active === true,
    "继续规划 → 不追加 plan/mode{active:false}（最后一条仍为 true）",
  );
  assert(!notifications.some((n) => n.includes(revised)), "继续规划 → notify 同样不铺计划原文");

  // (b) 带反馈：反馈进入错误消息（回给模型）
  selectResults.push("继续规划");
  inputResults.push("请补充回滚步骤");
  message = "";
  try {
    await ex.execute("4", { plan: revised }, undefined, undefined, { ui });
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  assert(message.includes("请补充回滚步骤"), "反馈文本随错误返回模型");
} catch (e) {
  failed++;
  console.error(`  ✗ 继续规划路径异常: ${e instanceof Error ? e.message : String(e)}`);
}

console.log("=== entry renderer 折叠态可渲染（不依赖 TUI 主题初始化）? ===");
try {
  const renderer = entryRenderers[PLAN_REVIEW_ENTRY]!;
  const theme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t, bold: (t: string) => t };
  const comp = renderer(
    { customType: PLAN_REVIEW_ENTRY, data: { plan: `# 折叠计划\n${Array.from({ length: 20 }, (_, i) => `- ${i}`).join("\n")}` } },
    { expanded: false },
    theme,
  ) as { render: (w: number) => string[] };
  const lines = comp.render(80).join("\n");
  assert(lines.includes("折叠计划") && lines.includes("21 行"), "折叠态渲染标题 + 行数");
  assert(lines.includes("ctrl+o 展开"), "折叠态带展开提示");
} catch (e) {
  failed++;
  console.error(`  ✗ entry renderer 折叠态异常: ${e instanceof Error ? e.message : String(e)}`);
}

console.log(`\n结果是: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
