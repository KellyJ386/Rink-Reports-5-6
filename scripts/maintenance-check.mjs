import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const expectedNodeMajor = Number(manifest.engines.node.match(/\d+/)?.[0]);
const expectedPnpm = manifest.packageManager.split("@")[1];
let failed = false;

function run(command, args, { informational = false } = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) {
    console.error(result.error.message);
    failed = true;
  } else if (result.status !== 0 && !informational) {
    failed = true;
  }
}

console.log(`Required Node: ${manifest.engines.node}`);
console.log(`Current Node:  ${process.version}`);
if (Number(process.versions.node.split(".")[0]) !== expectedNodeMajor) {
  console.error(`Node ${expectedNodeMajor}.x is required.`);
  failed = true;
}

const pnpmVersion = spawnSync("pnpm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
const currentPnpm = pnpmVersion.stdout?.trim() ?? "";
console.log(`Required pnpm: ${expectedPnpm}`);
console.log(`Current pnpm:  ${currentPnpm || "unavailable"}`);
if (pnpmVersion.status !== 0 || currentPnpm !== expectedPnpm) {
  console.error(`pnpm ${expectedPnpm} is required (Corepack reads packageManager automatically).`);
  failed = true;
}

// `outdated` is an inventory: available updates are expected and must not stop
// the security check from running. Audit and runtime mismatches remain blocking.
run("pnpm", ["outdated"], { informational: true });
run("pnpm", ["audit", "--prod", "--audit-level", "high"]);

process.exitCode = failed ? 1 : 0;
