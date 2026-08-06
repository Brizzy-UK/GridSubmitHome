/**
 * Replaces <iconify-icon icon="solar:x"> web components with inline SVGs that
 * reference a per-page <symbol> sprite. Removes the runtime Iconify script and
 * the 9+ blocking requests it made to api.iconify.design on every page load.
 *
 * Run: node build/inline-icons.mjs
 * Icon bodies are cached in build/icons.json so the build works offline.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'build', 'icons.json');

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const ICON_TAG = /<iconify-icon\b([^>]*)><\/iconify-icon>/g;
const ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;

function parseAttrs(raw) {
  const attrs = {};
  for (const m of raw.matchAll(ATTR)) attrs[m[1]] = m[2];
  return attrs;
}

const files = await htmlFiles(ROOT);

// Collect every icon name used across the site.
const used = new Set();
const sources = new Map();
for (const file of files) {
  const html = await readFile(file, 'utf8');
  sources.set(file, html);
  for (const m of html.matchAll(ICON_TAG)) {
    const name = parseAttrs(m[1]).icon;
    if (name) used.add(name);
  }
}

// Fetch icon bodies from the Iconify API, reusing the on-disk cache.
const cache = existsSync(CACHE) ? JSON.parse(await readFile(CACHE, 'utf8')) : {};
const missing = [...used].filter((n) => !cache[n]);

if (missing.length) {
  const bySet = new Map();
  for (const full of missing) {
    const [prefix, name] = full.split(':');
    if (!bySet.has(prefix)) bySet.set(prefix, []);
    bySet.get(prefix).push(name);
  }
  for (const [prefix, names] of bySet) {
    const url = `https://api.iconify.design/${prefix}.json?icons=${names.join(',')}`;
    const data = await res_json(url);
    const w = data.width ?? 24;
    const h = data.height ?? 24;
    for (const [name, icon] of Object.entries(data.icons ?? {})) {
      cache[`${prefix}:${name}`] = {
        body: icon.body,
        width: icon.width ?? w,
        height: icon.height ?? h,
      };
    }
  }
  await writeFile(CACHE, JSON.stringify(cache, null, 2) + '\n');
}

async function res_json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.json();
}

const unresolved = [...used].filter((n) => !cache[n]);
if (unresolved.length) throw new Error(`No icon data for: ${unresolved.join(', ')}`);

const symbolId = (name) => 'i-' + name.replace(/[^a-z0-9]+/gi, '-');

// Rewrite each page: swap the tags, then inject a sprite of just its own icons.
for (const [file, original] of sources) {
  const pageIcons = new Set();

  let html = original.replace(ICON_TAG, (whole, rawAttrs) => {
    const attrs = parseAttrs(rawAttrs);
    const name = attrs.icon;
    if (!name || !cache[name]) return whole;
    pageIcons.add(name);

    const classes = ['gs-icon', ...(attrs.class ? attrs.class.split(/\s+/) : [])]
      .filter(Boolean)
      .join(' ');
    const extra = Object.entries(attrs)
      .filter(([k]) => !['icon', 'class', 'width', 'height', 'aria-hidden'].includes(k))
      .map(([k, v]) => ` ${k}="${v}"`)
      .join('');

    return `<svg class="${classes}" aria-hidden="true" focusable="false"${extra}><use href="#${symbolId(name)}"></use></svg>`;
  });

  if (!pageIcons.size) {
    if (html !== original) await writeFile(file, html);
    continue;
  }

  const symbols = [...pageIcons]
    .sort()
    .map((name) => {
      const { body, width, height } = cache[name];
      return `<symbol id="${symbolId(name)}" viewBox="0 0 ${width} ${height}">${body}</symbol>`;
    })
    .join('');

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols}</svg>`;

  // Drop any previously injected sprite before adding the current one.
  html = html.replace(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" style="display:none" aria-hidden="true">.*?<\/svg>\n?/s, '');
  html = html.replace(/(<body\b[^>]*>)/i, `$1\n${sprite}`);

  await writeFile(file, html);
  console.log(`${path.relative(ROOT, file)}: ${pageIcons.size} icons inlined`);
}
