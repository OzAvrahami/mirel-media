import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';

for (const file of ['server.mjs', 'src/contact.mjs', 'public/app.js']) execFileSync(process.execPath, ['--check', file]);
const html = readFileSync('public/index.html', 'utf8');
const js = readFileSync('public/app.js', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML IDs');
assert.equal((html.match(/<h1\b/g) || []).length, 1, 'Expected one H1');
assert.match(html, /<html lang="en">/);
assert.doesNotMatch(html, /[\u0590-\u05ff]/);
for (const [, target] of html.matchAll(/(?:href="#|aria-controls="|aria-labelledby=")([^"]+)"/g))
  for (const id of target.split(' ')) assert.ok(ids.includes(id), `Missing anchor/ARIA target: ${id}`);
for (const [, id] of js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) assert.ok(ids.includes(id), `Missing JS target: ${id}`);
for (const [, asset] of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g))
  if (!/^(https?:|mailto:|data:)/.test(asset)) assert.ok(existsSync(path.join('public', asset)), `Missing asset: ${asset}`);
for (const file of ['public/styles.css', 'public/brand.css']) {
  const css = readFileSync(file, 'utf8');
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, `Unbalanced CSS: ${file}`);
  for (const [, asset] of css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g))
    if (!asset.startsWith('data:')) assert.ok(existsSync(path.join('public', asset)), `Missing CSS asset: ${asset}`);
}
assert.doesNotMatch(html, /Design preview|Website concept|nothing is sent/);
console.log('Syntax, assets, anchors, form hooks, language and document structure passed.');
