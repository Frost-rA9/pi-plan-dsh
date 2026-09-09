/**
 * pi-plan-dsh-bridge 纯函数测试。
 * 覆盖：plan/mode 折叠（last-wins/默认/非法载荷跳过）/ 配置校验 / plan:policy 渲染 / markdown 计划头校验。
 */
import {
  PLAN_MODE_ENTRY,
  DEFAULT_PLAN_ACTIVE,
  DEFAULT_PLAN_SECTION,
  resolvePlanConfig,
  foldPlanMode,
  renderPlanPolicy,
  hasPlanHeading,
  firstPlanHeading,
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

console.log(`\n结果是: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
