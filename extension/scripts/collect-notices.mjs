import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

// Every package the lockfile marks as a production dependency may end up in the bundle.
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const production = Object.entries(lock.packages)
  .filter(([path, info]) => path.startsWith('node_modules/') && !info.dev && !info.devOptional)
  .map(([path]) => path.slice('node_modules/'.length))
  .filter((name) => !name.includes('/node_modules/'))
  .sort();
// WXT's runtime helpers are bundled too; its packages ship without a license file.
const names = [...new Set([...production, 'wxt', '@wxt-dev/browser'])];

let result =
  'Lensprout · bundled third-party notices\n\nNew extension source is independently authored. The dependencies below retain their own licenses.\n\n';
result += `===== shadcn/ui components (MIT) =====
Source: https://ui.shadcn.com/r/styles/base-maia/{name}.json, copied into src/components/ui and
adapted locally (icons, import paths, contrast). See src/components/ui/registry.json.
License: https://github.com/shadcn-ui/ui/blob/main/LICENSE.md (MIT, Copyright (c) 2023 shadcn)

===== Magic UI animated-theme-toggler (MIT) =====
Source: https://magicui.design/r/animated-theme-toggler.json, copied into
src/components/ui/animated-theme-toggler.tsx and adapted locally (see registry.json).
License: https://github.com/magicuidesign/magicui/blob/main/LICENSE.md (MIT, Copyright (c) 2023 Magic UI)
\n`;
for (const name of names) {
  const dir = `node_modules/${name}`;
  if (!existsSync(`${dir}/package.json`)) continue;
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  const filename = readdirSync(dir).find((file) => /^licen[cs]e(\.(md|txt))?$/i.test(file));
  const licensePath = filename
    ? `${dir}/${filename}`
    : ['wxt', '@wxt-dev/browser'].includes(name)
      ? 'node_modules/@wxt-dev/module-react/LICENSE'
      : undefined;
  const source = `Source package: https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${pkg.version}.tgz`;
  if (!licensePath) {
    // Some packages ship no license file; record the declared license and its repository.
    if (!pkg.license) throw new Error(`No license declared for ${name}`);
    const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
    result += `\n===== ${name} ${pkg.version} (${pkg.license}) =====\n${source}\nThe package ships no license file; package.json declares "${pkg.license}"${author ? ` by ${author}` : ''}${repository ? `; repository: ${repository}` : ''}.\n`;
    continue;
  }
  result += `\n===== ${name} ${pkg.version} (${pkg.license}) =====\n${source}\n${filename ? '' : 'License: WXT monorepo MIT license, matching installed @wxt-dev/module-react/LICENSE and https://github.com/wxt-dev/wxt/blob/main/LICENSE\n'}\n${readFileSync(licensePath, 'utf8')}\n`;
}
mkdirSync('public', { recursive: true });
writeFileSync('public/THIRD_PARTY_NOTICES.txt', result);
