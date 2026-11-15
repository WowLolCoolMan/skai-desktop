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

As of 2026-11-15, this setup has not been completed: the Pages workflow fails
in **Configure Pages** because GitHub returns `404 Not Found` when it looks up
the repository's Pages site. After setting the source to **GitHub Actions**,
rerun **Deploy project site** from the Actions tab; future pushes to `main`
that change `docs/`, branding assets, or this workflow will deploy
automatically.

## Content maintenance

- Keep public feature claims aligned with [the capability matrix](CAPABILITY_MATRIX.md).
- Keep the [README](../README.md), [changelog](../CHANGELOG.md), and
  [documentation index](INDEX.md) aligned when project-facing docs change.
- State current behavior separately from proposals. In particular,
  [local image generation](LOCAL_IMAGE_GENERATION.md) distinguishes the current
  ComfyUI integration from the unimplemented bundled-runtime proposal.
- Optimize and place public images in `site-assets/`; Pages publishes this
  directory as-is and does not copy files from elsewhere in the repository.
