# sehn.ai website

Static site, no build step. Everything that gets deployed is in `public/`.

- Run locally: `cd public && python -m http.server 8080`, then open http://localhost:8080
- Deploy: every push to `main` publishes `public/` to GitHub Pages (see `.github/workflows/pages.yml`).
- `assets-source/`, `public/img/`, `screenshots/` and `archive/` stay local (see `.gitignore`).

## Files
- `public/index.html`, `styles.css`, `main.js`: the one-page site
- `public/imprint.html`: imprint & privacy (placeholders marked in pink, still to fill in)
- `public/assets/brand/`: `logo.svg`, `sehn-magic-eye.png` (generated with `python tools/make_stereo.py public/assets/brand/sehn-magic-eye.png`)
- `public/assets/photos/`: founder photos, cropped to 300×300 for the 150px circles
- `public/favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `og-image.png`
- `assets-source/`: the full asset library from the deck. **Not deployed**, because it contains images with unclear licenses (see its README)
- `tools/og.html`: source of the Open Graph image (screenshot at 1200×630)
- `lab/`: experiments, not deployed. `lab/dive/` is the multiplane prototype: the eye, a fall through the retina's layers, a cut in the canopy, and a watercolour forest of retinal cells, with the site's sections (copied from `public/index.html`, using its `styles.css` and `main.js`) scrolling over the forest as paper panels. Open `lab/dive/index.html` and scroll. Its API key form never sends anything.
  - `?p=0.66` holds the camera at a point of the scroll, `?px=&py=` holds the pointer (-1..1), `?flat` flattens the layers, `?debug` shows timings, `?skip=slices,planes,veil,rays,river,trunks,boat` leaves parts out
  - in the console: `__dive.bench(p)` times a frame at a point, `__dive.seek(p, px, py)` moves the camera, `__dive.pause()` and `__dive.frameAt(p, px, py, ms, flat)` draw frames on a fixed clock, for recording
- `tools/make_keyframe_template.py`: writes the blank keyframe sheet `lab/dive/keyframes/keyframe-sheet.ora` (layered, opens in Krita) and a PNG preview
- `tools/artcraft.sh`: starts PhotoCraft, VectorCraft, DesignCraft and EffectCraft with their control servers, for the MCP bridges in `.mcp.json` (`stop` and `status` too)
- `screenshots/`: desktop and phone previews (of the first version)
- `archive/v1-deck-style/`: the first, slide-like version of the page, kept for comparison

## Open TODOs
- Fill in Mindsprings LLC's legal details in `imprint.html`.
- Decide whether to self-host the fonts (avoids sending visitor IPs to Google; relevant under GDPR).
