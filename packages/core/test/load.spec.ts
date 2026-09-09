/**
 * pi-plan-dsh-core · 扩展加载冒烟（mock pi API）。
 *
 * 验证：实例化不崩、注册了 /plan 命令 + exit_plan_mode 工具、session_start 折叠 plan/mode、
 * before_agent_start 按 active 注入 plan:policy、exit_plan_mode fail-closed（未激活 → 拒绝）。
 */
import planExtension from "../src/index.ts";

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

const pi = {
  registerTool: (t: unknown) => { tools.push(t as Record<string, unknown>); },
  registerCommand: (name: string, spec: unknown) => { commands[name] = spec; },
  registerFlag: () => {},
  on: (name: string, h: (...a: unknown[]) => unknown) => { handlers[name] = h; },
  sendMessage: (m: unknown) => { messages.push(m); },
  sendUserMessage: (m: unknown) => { messages.push(m); },
  appendEntry: (type: string, data: unknown) => { entries.push({ customType: type, data }); },
  setActiveTools: () => {},
  getActiveTools: () => [] as string[],
  getFlag: () => undefined,
} as never;

let lastBadge: string | undefined;
const ui = {
  theme: { fg: (_c: string, t: string) => t },
  setStatus: (_k: string, t: string | undefined) => { lastBadge = t; },
  notify: () => {},
  select: async () => "批准",
  input: async () => "",
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

console.log(`\n结果是: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
