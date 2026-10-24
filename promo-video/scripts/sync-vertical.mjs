// The 9:16 cut lives in vertical/ as its own HyperFrames project (one root composition per
// project). It shares the scenes and assets with the 16:9 cut: this copies them in before a
// check or render. The copies are gitignored; edit the originals at the project root.
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const dir of ["compositions", "assets"]) {
  rmSync(join(root, "vertical", dir), { recursive: true, force: true });
  cpSync(join(root, dir), join(root, "vertical", dir), { recursive: true });
}
console.log("synced compositions/ and assets/ into vertical/");
