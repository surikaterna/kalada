import { existsSync, lstatSync, readFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

// Only sessions listed in our published A raws identify legacy runner-owned files.
const raws = ["99-a-raw.json", "99-a-confirm-raw.json"];
for (const name of raws) {
  const raw = JSON.parse(readFileSync(new URL(`../../docs/performance/${name}`, import.meta.url)));
  for (const row of raw.observations) {
    if (!/^k99-\d+-\d+$/.test(row.session) || !row.session.endsWith(`-${row.batch}`)) continue;
    const path = join(os.tmpdir(), `kalada-99-${row.session.slice(4)}.js`);
    if (!existsSync(path)) continue;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid()) continue;
    const text = readFileSync(path, "utf8");
    if (
      !text.startsWith("async (page) => {") ||
      !text.includes(raw.manifest.fixtures[0].sha256.slice(0, 20))
    )
      continue;
    unlinkSync(path);
    console.log(`removed confirmed #99 legacy run-code file ${path}`);
  }
}
