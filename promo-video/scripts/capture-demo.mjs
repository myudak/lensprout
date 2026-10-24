// Captures the landing site's fictional demo dashboard (landing/src/demo, served at /demo/dashboard/)
// in the states the promo animates through, plus the boxes of the controls the cursor clicks.
// Serves the landing build (landing/dist, from `npm run build` in landing/) read-only on a local
// port and uses landing's Playwright. Usage: node scripts/capture-demo.mjs [baseUrl]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "landing", "package.json"));
const { chromium } = require("@playwright/test");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".json": "application/json" };
const dist = join(here, "..", "..", "landing", "dist");
let server;
let base = process.argv[2];
if (!base) {
  server = createServer((req, res) => {
    let p = normalize(join(dist, decodeURIComponent(req.url.split("?")[0])));
    if (!p.startsWith(dist)) return res.writeHead(403).end();
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
    if (!existsSync(p)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }).end(readFileSync(p));
  }).listen(0);
  base = "http://localhost:" + server.address().port;
}
const out = join(here, "..", "assets", "demo");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: "light" });
await page.goto(`${base}/demo/dashboard/`, { waitUntil: "networkidle" });
// Wait for React to hydrate, and hide the Astro dev toolbar if the dev server injected it.
await page.waitForSelector("astro-island:not([ssr])", { state: "attached", timeout: 60000 });
await page.addStyleTag({ content: "astro-dev-toolbar{display:none!important}" });
await page.mouse.move(1270, 790);
const shot = (name) => page.screenshot({ path: join(out, name + ".png") });
const box = async (loc) => {
  const b = await loc.boundingBox();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
};

const tab = page.getByRole("tab", { name: "3 months" });
const add = page.getByRole("button", { name: "New invoice" });
const targets = { width: 1280, height: 800, tab: await box(tab), add: await box(add), chart: await box(page.getByRole("img", { name: /Revenue over/ })) };
await shot("base");

// Switch the revenue chart to 3 months.
await tab.click();
await page.mouse.move(1270, 790);
await page.waitForTimeout(300);
await shot("range");

// Open the New invoice dialog and type a name, one state per letter.
await add.click();
await page.waitForSelector("[role=dialog]");
await page.mouse.move(1270, 790);
const name = page.getByLabel("Customer name");
targets.dialog = await box(page.locator("[role=dialog]"));
targets.name = await box(name);
await shot("dialog-0");
const word = "Jane Cooper";
for (let i = 1; i <= word.length; i++) {
  await name.fill(word.slice(0, i));
  await page.waitForTimeout(60);
  await shot("dialog-" + i);
}
writeFileSync(join(out, "targets.json"), JSON.stringify(targets, null, 2));
await browser.close();
server?.close();
console.log("wrote", out, targets);
