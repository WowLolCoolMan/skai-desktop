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

For the first deployment, open the repository's **Settings → Pages** and set
the publishing source to **GitHub Actions**. This owner-level repository
setting cannot be changed by the workflow token. Successful workflow runs
publish the site at
`https://wowlolcoolman.github.io/skai-desktop/`.

On 2026-11-15, **Deploy project site** completed successfully for commit
`77f766f9` and the public URL returned HTTP 200. However, a live content check
still returned GitHub's Jekyll-rendered repository README instead of the custom
`docs/index.html` artifact. The workflow run is green, but the custom landing
page is not yet verified as the live page. Check the repository's **Settings →
Pages** publishing source and the latest deployment before treating the design
in `docs/index.html` as published. Once corrected, pushes to `main` that change
`docs/`, branding assets, or this workflow should deploy automatically.

## Content maintenance

- Keep public feature claims aligned with [the capability matrix](CAPABILITY_MATRIX.md).
- Keep the [README](../README.md), [changelog](../CHANGELOG.md), and
  [documentation index](INDEX.md) aligned when project-facing docs change.
- State current behavior separately from proposals. In particular,
  [local image generation](LOCAL_IMAGE_GENERATION.md) distinguishes the managed
  Diffusers runtime and ComfyUI integration from their remaining live acceptance.
- Optimize and place public images in `site-assets/`; Pages publishes this
  directory as-is and does not copy files from elsewhere in the repository.
