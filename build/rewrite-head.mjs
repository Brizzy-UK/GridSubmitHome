/**
 * Rewrites every page's <head> to remove render-blocking third-party scripts:
 *   - cdn.tailwindcss.com (124 KiB of JS that compiled CSS in the browser)
 *     -> /assets/site.css, a prebuilt + minified stylesheet
 *   - code.iconify.design (blocking JS + one API request per icon)
 *     -> inline <symbol> sprites, see inline-icons.mjs
 * Also guarantees a doctype and defers the Meta Pixel off the critical path.
 *
 * Run: node build/rewrite-head.mjs
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

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

const css = await readFile(path.join(ROOT, 'assets', 'site.css'), 'utf8');
const v = createHash('sha256').update(css).digest('hex').slice(0, 8);
const STYLESHEET = `<link rel="stylesheet" href="/assets/site.css?v=${v}">`;

const PIXEL_ID = '1566376114909873';
const DEFERRED_PIXEL = `  <!-- Meta Pixel Code -->
  <script>
  // The fbq stub queues calls immediately; fbevents.js itself (~230 KiB) is
  // only fetched on first interaction, or 1.5s after load, so it stays off the
  // critical path. Queued events replay once it arrives.
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];
  var done=0,load=function(){if(done)return;done=1;
  t=b.createElement(e);t.async=!0;t.src=v;
  s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)};
  ['pointerdown','keydown','scroll','touchstart'].forEach(function(ev){
  f.addEventListener(ev,load,{once:!0,passive:!0})});
  f.addEventListener('load',function(){setTimeout(load,1500)})}
  (window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '${PIXEL_ID}');
  fbq('track', 'PageView');
  </script>
  <noscript><img height="1" width="1" style="display:none" alt=""
  src="https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1"
  /></noscript>
  <!-- End Meta Pixel Code -->`;

const OLD_PIXEL =
  /[ \t]*<!-- Meta Pixel Code -->\s*<script>\s*!function\(f,b,e,v,n,t,s\)[\s\S]*?<!-- End Meta Pixel Code -->/;

for (const file of await htmlFiles(ROOT)) {
  const original = await readFile(file, 'utf8');
  let html = original;

  // Tailwind: runtime compiler -> prebuilt stylesheet.
  html = html.replace(
    /[ \t]*<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\n?/g,
    `    ${STYLESHEET}\n`
  );
  // Keep the href hash current on re-runs.
  html = html.replace(
    /<link rel="stylesheet" href="\/assets\/site\.css\?v=[0-9a-f]+">/g,
    STYLESHEET
  );

  // Iconify runtime + its per-icon styling are no longer needed.
  html = html.replace(
    /[ \t]*<script src="https:\/\/code\.iconify\.design\/[^"]*"><\/script>\n?/g,
    ''
  );
  html = html.replace(
    /iconify-icon\s*\{[^}]*\}\s*iconify-icon svg path,\s*iconify-icon svg circle,\s*iconify-icon svg rect,\s*iconify-icon svg polyline,\s*iconify-icon svg line\s*\{[^}]*\}\s*/g,
    ''
  );
  // Drop <style> blocks left empty by the rule above.
  html = html.replace(/[ \t]*<style>\s*<\/style>\n?/g, '');

  // Quirks mode: several pages were missing a doctype entirely.
  if (!/^\s*<!doctype html>/i.test(html)) {
    html = '<!doctype html>\n' + html.replace(/^\s+/, '');
  }

  html = html.replace(OLD_PIXEL, DEFERRED_PIXEL);

  if (html !== original) {
    await writeFile(file, html);
    console.log(`rewrote ${path.relative(ROOT, file)}`);
  }
}
