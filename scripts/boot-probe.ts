// Cold-start import timing (herm-amh). Run: bun scripts/boot-probe.ts
//
// Step timings are incremental — each row is the Δ from the previous.
// gpt-tokenizer is NOT imported here; tokens.ts lazies it, so a large
// `app` figure means something in the app graph is pulling it eagerly.
const t0 = Bun.nanoseconds()
const ms = () => (Bun.nanoseconds() - t0) / 1e6
let prev = 0
const step = async (label: string, p: () => Promise<unknown>) => {
  await p()
  const now = ms()
  console.error(`${label.padEnd(22)} ${(now - prev).toFixed(1).padStart(7)}ms  (${now.toFixed(1)})`)
  prev = now
}
await step("react",          () => import("react"))
await step("@opentui/core",  () => import("@opentui/core"))
await step("@opentui/react", () => import("@opentui/react"))
await step("yaml",           () => import("yaml"))
await step("utils/tokens",   () => import("../src/utils/tokens"))
await step("hermes-home",    () => import("../src/service/hermes-home"))
await step("home/store",     () => import("../src/home/store"))
await step("app",            () => import("../src/app"))
console.error(`${"TOTAL".padEnd(22)} ${ms().toFixed(1).padStart(7)}ms`)
