/**
 * pi-plan-dsh-bridge 纯函数测试。
 * 覆盖：plan/mode 折叠（last-wins/默认/非法载荷跳过）/ 配置校验 / plan:policy 渲染 / markdown 计划头校验。
 */
import {
  PLAN_MODE_ENTRY,
  PLAN_REVIEW_ENTRY,
  PLAN_PREVIEW_LINES,
  DEFAULT_PLAN_ACTIVE,
  DEFAULT_PLAN_SECTION,
  resolvePlanConfig,
  foldPlanMode,
  renderPlanPolicy,
  hasPlanHeading,
  firstPlanHeading,
  summarizePlan,
  type AppendEntry,
} from "../src/index.ts";

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string): void {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${name}`); }
}
function throws(fn: () => void, name: string): void {
  try { fn(); failed++; console.error(`  ✗ ${name} (no throw)`); }
  catch { passed++; }
}

console.log("=== 1) foldPlanMode：plan/mode 折叠 ===");
const entries: AppendEntry[] = [
  { customType: "message", data: {} },
  { customType: PLAN_MODE_ENTRY, data: { active: true } },
  { customType: PLAN_MODE_ENTRY, data: { active: false } },
];
assert(foldPlanMode(entries).active === false, "last plan/mode wins (false)");
assert(foldPlanMode(entries).pending === false, "pending always false in pi");
assert(foldPlanMode([{ customType: PLAN_MODE_ENTRY, data: { active: true } }, { customType: "msg", data: {} }]).active === true, "true wins when last plan/mode is true");
assert(foldPlanMode([]).active === DEFAULT_PLAN_ACTIVE, "no plan/mode → default (false)");

console.log("=== 2) foldPlanMode：非法载荷跳过 ===");
const bad: AppendEntry[] = [
  { customType: PLAN_MODE_ENTRY, data: { active: "yes" } },
  { customType: PLAN_MODE_ENTRY, data: { active: true } },
];
assert(foldPlanMode(bad).active === true, "invalid payload skipped, earlier valid wins");
const allBad: AppendEntry[] = [{ customType: PLAN_MODE_ENTRY, data: { active: "nope" } }];
assert(foldPlanMode(allBad).active === DEFAULT_PLAN_ACTIVE, "all invalid → default");

console.log("=== 3) resolvePlanConfig 校验 ===");
assert(resolvePlanConfig({ section: "guide" }).section === "guide", "valid section passes");
throws(() => resolvePlanConfig({ section: "" }), "empty section throws");
throws(() => resolvePlanConfig({ section: "  " }), "blank section throws");
throws(() => resolvePlanConfig({ section: "guide", extra: 1 } as never), "unknown key throws");

console.log("=== 4) renderPlanPolicy ===");
assert(renderPlanPolicy("GUIDE", true) === "GUIDE", "active → section");
assert(renderPlanPolicy("GUIDE", false) === "", "inactive → empty (0 token)");
assert(DEFAULT_PLAN_SECTION.length > 0, "default section non-empty");

console.log("=== 5) hasPlanHeading / firstPlanHeading ===");
assert(hasPlanHeading("# Title\nbody"), "h1 heading ok");
assert(hasPlanHeading("## 子标题"), "h2 heading ok");
assert(hasPlanHeading("No heading\nbody") === false, "no heading rejected");
assert(firstPlanHeading("# Name\nbody") === "Name", "first heading text = Name");
assert(firstPlanHeading("## S.Name\nbody") === "S.Name", "first heading text = S.Name");
assert(firstPlanHeading("no heading") === undefined, "no heading → undefined");

console.log("=== 6) summarizePlan（折叠态摘要 / entry renderer 共用） ===");
assert(PLAN_REVIEW_ENTRY === "plan/review", "plan/review entry customType");
const longPlan = `# 重构计划\n${Array.from({ length: 30 }, (_, i) => `- 步骤 ${i + 1}`).join("\n")}`;
const s = summarizePlan(longPlan);
assert(s.heading === "重构计划", "summary.heading = 首个标题");
assert(s.lineCount === 31, "summary.lineCount 计全部行");
assert(s.preview.split("\n").length === PLAN_PREVIEW_LINES, "preview 截到 PLAN_PREVIEW_LINES 行");
assert(s.omitted === 31 - PLAN_PREVIEW_LINES, "omitted = 行数 - 预览行数");
const short = summarizePlan("# 短计划\n- 一步");
assert(short.omitted === 0, "短计划 omitted = 0");
const empty = summarizePlan("");
assert(empty.lineCount === 0 && empty.preview === "" && empty.heading === undefined, "空输入不抛错：0 行 / 空预览 / 无标题");
const partial = summarizePlan("# 流式未完成");
assert(partial.lineCount === 1 && partial.heading === "流式未完成", "流式片段（单行标题）也成摘要");
const trailing = summarizePlan("# T\nbody\n\n\n");
assert(trailing.lineCount === 2, "尾部空行不计入行数");
assert(summarizePlan("# T\n- a\n- b", 1).preview === "# T", "previewLines 可覆写");

console.log(`\n结果是: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
