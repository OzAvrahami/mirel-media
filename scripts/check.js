import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';

const codeFiles = ['server.js', ...['src', 'scripts', 'test', 'public'].flatMap(dir =>
  readdirSync(dir).filter(name => name.endsWith('.js')).map(name => path.join(dir, name)))];
for (const file of codeFiles) execFileSync(process.execPath, ['--check', file]);
const html = readFileSync('public/index.html', 'utf8');
const js = readFileSync('public/app.js', 'utf8') + readFileSync('public/contact.js', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML IDs');
assert.equal((html.match(/<h1\b/g) || []).length, 1, 'Expected one H1');
assert.match(html, /<html lang="en">/);
assert.doesNotMatch(html, /[\u0590-\u05ff]/);
for (const [, target] of html.matchAll(/(?:href="#|aria-controls="|aria-labelledby=")([^"]+)"/g))
  for (const id of target.split(' ')) assert.ok(ids.includes(id), `Missing anchor/ARIA target: ${id}`);
for (const [, id] of js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) assert.ok(ids.includes(id), `Missing JS target: ${id}`);
for (const [, asset] of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g))
  if (!/^(https?:|mailto:|tel:|data:)/.test(asset)) assert.ok(existsSync(path.join('public', asset)), `Missing asset: ${asset}`);
for (const file of ['public/styles.css', 'public/light.css', 'public/contact.css', 'public/brand.css']) {
  const css = readFileSync(file, 'utf8');
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, `Unbalanced CSS: ${file}`);
  // Consume quoted data URLs as a whole, including SVG's nested url(#filter).
  for (const [, doubleQuoted, singleQuoted, unquoted] of css.matchAll(/url\((?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\)/g)) {
    const asset = doubleQuoted ?? singleQuoted ?? unquoted;
    if (!asset.startsWith('data:') && !asset.startsWith('#'))
      assert.ok(existsSync(path.join('public', asset)), `Missing CSS asset: ${asset}`);
  }
}
assert.doesNotMatch(html, /Design preview|Website concept|nothing is sent|Preview your inquiry|Interactive design concept|inquiry-summary|copy-inquiry/);
console.log('Syntax, assets, anchors, form hooks, language and document structure passed.');
