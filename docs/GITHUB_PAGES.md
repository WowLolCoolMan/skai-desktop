# GitHub Pages site

The project overview site is a static page served from this directory. Its
source lives in `index.html`, its responsive styles in `site.css`, and its
optimized brand images in `site-assets/`. It has no JavaScript runtime,
third-party font requests, or build-time package dependencies.

## Deployment

`.github/workflows/pages.yml` publishes the contents of `docs/` to GitHub Pages
when files under `docs/`, the workflow, or branding assets change on `main`. A
manual run is also available from the Actions tab. The deployment uses the
`github-pages` environment and GitHub's Pages artifact workflow.

The repository's **Settings → Pages** publishing source is **GitHub Actions**.
This owner-level repository setting cannot be changed by the workflow token.
The public site is
`https://wowlolcoolman.github.io/skai-desktop/`; on 2026-11-15, a live check
returned HTTP 200 and the custom title **Skai Desktop — Your local AI
workspace**, confirming that `docs/index.html` is being served. A manually
requested **Deploy project site** run for commit `101cd2bf` is also in progress
after the source was corrected. Pushes to `main` that change `docs/`, branding
assets, or this workflow should deploy automatically.

## Content maintenance

- Keep public feature claims aligned with [the capability matrix](CAPABILITY_MATRIX.md).
- Keep the [README](../README.md), [changelog](../CHANGELOG.md), and
  [documentation index](INDEX.md) aligned when project-facing docs change.
- State current behavior separately from proposals. In particular,
  [local image generation](LOCAL_IMAGE_GENERATION.md) distinguishes the managed
  Diffusers runtime and ComfyUI integration from their remaining live acceptance.
- Optimize and place public images in `site-assets/`; Pages publishes this
  directory as-is and does not copy files from elsewhere in the repository.
