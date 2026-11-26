// Generates tests/fixtures/big.md (~2 MB, ~20 000+ lines) for the performance
// checks (S10). The file is gitignored.
// Usage: node tools/make-big.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
const base = readFileSync(join(fixtures, "showcase.md"), "utf8").replace(/^---[\s\S]*?---\r?\n/, "");
let out = "# Big document (generated)\n\n";
let i = 0;
while (out.length < 2_000_000) {
  i++;
  out += `\n# Part ${i}\n\n` + base.replace(/^(#{1,6}) /gm, "$1# ").replace(/```mermaid[\s\S]*?```/g, "");
}
writeFileSync(join(fixtures, "big.md"), out);
console.log(`big.md: ${(out.length / 1e6).toFixed(2)} MB, ${out.split("\n").length} lines, ${i} parts`);
