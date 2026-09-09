/**
 * pi-plan-dsh · 包根入口（pi.extensions 指向此处）。
 *
 * 仅 re-export 宿主（packages/core/src/index.ts）。包根入口保证 pi 的 /config
 * 资源选择器按「父目录/文件名」推导显示名 `pi-plan-dsh/index.ts`（与 pi-sandbox-dsh 同构）。
 */
export { default } from "./packages/core/src/index.ts";
