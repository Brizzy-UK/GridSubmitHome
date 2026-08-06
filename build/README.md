# Build step

The site used to pull Tailwind and Iconify from CDNs at runtime. Both were
render-blocking, and Iconify additionally fired one request per icon, which put
a ~1.7 s dependency chain in front of first paint. Both are now build-time.

**After editing any HTML — especially adding Tailwind classes or icons — run:**

```sh
npm run build:site
```

Commit the resulting `assets/site.css` along with your HTML changes. If you skip
this, new utility classes simply won't have any CSS behind them.

> **Never name a script `build` or `vercel-build`.** Vercel auto-runs either one
> and then looks for a `public/` output directory, which this repo doesn't have —
> the deploy fails with *"No Output Directory named public found"*. With no such
> script, Vercel serves the repo root statically and picks up `/api` as functions,
> which is what we want. That also means **the build only ever runs locally**, so
> `assets/site.css` has to be committed.

## What each script does

| Script | Does |
| --- | --- |
| `npm run build:icons` | Replaces `<iconify-icon icon="…">` tags with inline `<svg><use>` refs and injects a per-page `<symbol>` sprite. Icon bodies come from the Iconify API and are cached in `build/icons.json`, so repeat builds work offline. |
| `npm run build:css` | Compiles `build/tailwind.src.css` → `assets/site.css` (minified), then refreshes the `?v=` cache-busting hash in every page's `<link>`. |
| `npm run watch:css` | Rebuilds the stylesheet on change while developing. |

Both scripts are idempotent — running them repeatedly is safe.

## Adding an icon

Write it the old way, as `<iconify-icon icon="solar:name-linear" class="…">`,
then run `npm run build`. The build resolves it and swaps in the inline SVG.
Icon names must exist in the Iconify set; the build fails loudly if one doesn't.

## Notes

- `assets/*` is served with `Cache-Control: immutable` (see `vercel.json`), which
  is why the stylesheet URL carries a content hash.
- `.text-brand-ink` in `build/tailwind.src.css` is the darkened lime for lime
  text on light backgrounds — the brand `#84CC16` only clears WCAG AA on dark
  surfaces.
- The Meta Pixel loads on first interaction, or 1.5 s after `load`, whichever
  comes first. The `fbq` stub still queues events immediately, so nothing is
  lost; it just stops ~230 KiB of third-party JS from blocking the main thread.
