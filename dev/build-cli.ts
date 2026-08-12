import { chmod } from "node:fs/promises";

const buildRuntime = "1.3.1";
if (Bun.version !== buildRuntime) {
  console.error(`stack bundles require Bun ${buildRuntime}; found ${Bun.version}`);
  process.exit(1);
}

const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  format: "esm",
  outdir: "dist",
  target: "node",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await chmod("dist/cli.js", 0o755);
