#! ts-node
const { build } = require("esbuild");

build({
  entryPoints: ["src/index.ts"],
  outdir: "build",
  sourcemap: true,
  bundle: false,
  minify: true,
  platform: "node",
  format: "cjs",
});
