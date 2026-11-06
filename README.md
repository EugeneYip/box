# Worldseed

An original god-simulation sandbox for the browser, built with Three.js. Shape continents, paint biomes, seed life, watch civilizations rise, and unleash the elements.

**Play:** https://eugeneyip.github.io/box/

## Deployment (GitHub Pages)

The workflow in `.github/workflows/pages.yml` builds the game on every push and publishes it to GitHub Pages whenever the repository's default branch is updated. One-time setup in the repository settings:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Environments → `github-pages` → Deployment branches and tags:** allow the default branch (currently `claude/zen-sagan-1c54ib`), or choose "No restriction". Without this, the deploy job fails with "Branch … is not allowed to deploy to github-pages due to environment protection rules".

After that, every push to the default branch redeploys automatically; a failed run can be retried from the Actions tab ("Re-run failed jobs"), and a fresh one started with "Run workflow".

The build uses relative asset paths (`base: './'` in `vite.config.js`), so it works under the `/box/` project-page path or any other subpath without changes.

## Local development

```bash
npm install
npm run dev        # http://127.0.0.1:5173/
npm run build      # static build in dist/
npm run preview    # serve the built dist/
```

Useful URL parameters: `?seed=42`, `?preset=archipelago`, `?quality=low|medium|high|ultra`, `?title=0` (skip the title screen), `?ui=0` (hide the interface).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the engine layout, module contracts and tooling.
