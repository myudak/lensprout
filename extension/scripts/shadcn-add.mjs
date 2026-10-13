#!/usr/bin/env node
/**
 * Fetches shadcn/ui (MIT) Base UI components in the "base-maia" style into src/components/ui.
 *
 *   node scripts/shadcn-add.mjs select menubar toggle-group
 *
 * Why not `npx shadcn add`: the CLI package's dependency tree fails `npm audit` and it rewrites
 * project files beyond the components. This script does the two transforms the CLI would:
 *   - icon placeholders become Hugeicons (`<HugeiconsIcon icon={Name} />`, free MIT set);
 *   - registry/"cn" imports become this project's paths.
 * Registry dependencies are fetched recursively. npm dependencies are only reported. Provenance is
 * recorded in src/components/ui/registry.json; re-apply any listed local changes after a re-fetch.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const style = 'base-maia';
const base = `https://ui.shadcn.com/r/styles/${style}`;
const ledgerPath = join(root, 'src/components/ui/registry.json');
const ledger = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
  : { items: {}, localChanges: {} };

/** `<IconPlaceholder lucide="…" hugeicons="Name" className="…" />` → `<HugeiconsIcon icon={Name} … />`. */
function icons(code) {
  const used = new Set();
  code = code.replace(/<IconPlaceholder\b([\s\S]*?)\/>/g, (_m, attrs) => {
    const name = /hugeicons="([^"]+)"/.exec(attrs)?.[1];
    if (!name) throw new Error(`Icon placeholder without a hugeicons name: ${attrs}`);
    used.add(name);
    const rest = attrs
      .replace(/\s*(lucide|tabler|hugeicons|phosphor|remixicon)="[^"]*"/g, '')
      .trim();
    return `<HugeiconsIcon icon={${name}} strokeWidth={2}${rest ? ` ${rest}` : ''} />`;
  });
  code = code.replace(/^import \{ IconPlaceholder \} from ".*"\n/m, '');
  if (used.size) {
    const imports =
      `import { HugeiconsIcon } from '@hugeicons/react';\n` +
      `import { ${[...used].sort().join(', ')} } from '@hugeicons/core-free-icons';\n`;
    // After the last import statement.
    const last = [...code.matchAll(/^import [\s\S]*?from ["'][^"']+["'];?\n/gm)].at(-1);
    const at = last ? last.index + last[0].length : 0;
    code = code.slice(0, at) + imports + code.slice(at);
  }
  return code;
}

const rewrite = (code) =>
  icons(
    code
      .replace(/^"use client"\s*\n+/m, '')
      .replace(/from "cn"/g, `from '@/src/lib/utils'`)
      .replace(new RegExp(`from "@/registry/${style}/ui/`, 'g'), `from "@/src/components/ui/`)
      .replace(new RegExp(`from "@/registry/${style}/lib/utils"`, 'g'), `from '@/src/lib/utils'`)
      .replace(new RegExp(`from "@/registry/${style}/hooks/`, 'g'), `from "@/src/hooks/`)
      .replace(new RegExp(`from "@/registry/${style}/lib/`, 'g'), `from "@/src/lib/`),
  );

const target = (path) =>
  path
    .replace(new RegExp(`^registry/${style}/ui/`), 'src/components/ui/')
    .replace(new RegExp(`^registry/${style}/hooks/`), 'src/hooks/')
    .replace(new RegExp(`^registry/${style}/lib/`), 'src/lib/');

const seen = new Set(),
  npm = new Set();
async function add(name) {
  name = name.replace(/^.*\/r\/styles\/[^/]+\//, '').replace(/\.json$/, '');
  if (seen.has(name) || name === 'utils') return;
  seen.add(name);
  const response = await fetch(`${base}/${name}.json`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const item = await response.json();
  for (const dep of item.registryDependencies ?? []) await add(dep);
  for (const dep of item.dependencies ?? []) if (dep !== 'cn') npm.add(dep);
  for (const file of item.files ?? []) {
    const out = target(file.path);
    if (out.startsWith('src/lib/utils')) continue;
    mkdirSync(dirname(join(root, out)), { recursive: true });
    writeFileSync(join(root, out), rewrite(file.content));
    console.log(`  wrote ${out}`);
  }
  ledger.items[name] = {
    source: `${base}/${name}.json`,
    files: (item.files ?? []).map((f) => target(f.path)),
  };
}

for (const name of process.argv.slice(2)) await add(name);
writeFileSync(
  ledgerPath,
  `${JSON.stringify({ license: 'MIT (shadcn/ui, Copyright (c) 2023 shadcn)', style, ...ledger }, null, 2)}\n`,
);
console.log(`npm dependencies referenced: ${[...npm].sort().join(' ') || '(none)'}`);
