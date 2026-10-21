# design-tools

A small toolkit of browser-based design tools for early-stage architectural work. Every tool is a single HTML file with no build step. Three.js is loaded from a public CDN (jsDelivr).

## Tools

| Tool | Path | Status |
|---|---|---|
| Menu page | `index.html` | Links to each tool |
| Tower Generator | `tower/index.html` | Version 1: all form controls, site envelope, live metrics, presets, saved options, compare view, screenshots |

## Folders

| Folder | Contents |
|---|---|
| `tower/` | The finished tool. Do not edit `index.html` by hand. |
| `build/tower/` | Source parts. Edit these, then run `python3 build.py` to rebuild `tower/index.html`. |
| `src/` | Tested modules (geometry, envelope, storage, screenshot, presets, test cases). |
| `test/` | Module tests. Run `npm install`, then `npm test`. |
| `docs/` | Concept, technical plan, module contracts, integration notes. |

Open `tower/index.html?test` to run the in-page test suite.

## Host on GitHub Pages

1. Push this repository to GitHub (for example `design-tools`).
2. Open the repository on GitHub: Settings, then Pages.
3. Under "Build and deployment", set Source to "Deploy from a branch", choose the `main` branch and the `/ (root)` folder, then Save.
4. After a minute the site is live at `https://<your-user>.github.io/design-tools/`. The tower generator is at `https://<your-user>.github.io/design-tools/tower/`.

On an iPad, open the tower URL in Safari, tap Share, then "Add to Home Screen" to use it like an app.

## Run locally

Browsers block ES modules from `file://` in some cases. Serve the folder instead:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.
