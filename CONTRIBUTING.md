# Contributing to Skai Desktop

Thanks for helping improve Skai Desktop. Read this guide before opening an
issue or pull request.

## Before you start

- Check [To Do Next](docs/TO_DO_NEXT.md), the [capability
  matrix](docs/CAPABILITY_MATRIX.md), and [future features](docs/FUTURE_FEATURES.md)
  to see current plans and avoid duplicate work.
- For substantial changes, open an issue first to agree on scope and approach.
- Keep Skai local-first. Current releases use local model inference. The
  approved provider-gateway plan adds optional user-connected remote routes;
  any implementation must disclose remote data, protect credentials with the
  OS, honor offline-only mode, and never silently switch providers. Do not add
  unreviewed data collection.
- Keep the Electron + React UI, isolated preload bridge, .NET Agent Host, and
  headless Core architecture. Do not introduce a second desktop UI stack.
- Do not submit copied code, assets, model weights, or documentation unless you
  have the rights to contribute them and have documented their source and
  license.

## Source and contribution terms

The Skai-owned source is published for reference under the
[Skai Desktop Source Reference License](LICENSE). It is not an open-source
license and does not permit reusing or incorporating Skai code into another
project. Third-party components retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Before a pull request can be merged, each contributor must agree to the
[Contributor License Agreement](CONTRIBUTOR_LICENSE_AGREEMENT.md) by checking
the confirmation in the pull request template. This lets Skai Desktop accept,
maintain, and distribute contributions under the project's licensing terms.

## Development

1. Install Node.js LTS and the .NET SDK version specified by the project files.
2. Clone the repository and install dependencies with `npm ci`.
3. Follow the local development instructions in the README.
4. Make a focused change and add or update targeted automated coverage where it
   materially protects behavior.

Run the checks relevant to your change. Common checks include:

```powershell
npm run check:syntax
npm run desktop:typecheck
npm run desktop:build
```

For native Core changes, run:

```powershell
dotnet run --project native/SkaiDesktop.Core.Tests/SkaiDesktop.Core.Tests.csproj
```

Do not claim a check passed unless you ran it. If a required runtime, device,
or platform is unavailable, report that limitation.

## Pull requests

- Keep each pull request focused and explain the user-visible result.
- Link the issue or roadmap entry and summarize the agreed implementation
  approach.
- List checks run and their results. Include screenshots for visual changes.
- Call out changes to local data, permissions, security boundaries, third-party
  notices, or supported platforms.
- Do not include secrets, private user data, generated build output, or unrelated
  changes.
- Maintainers may request revisions or close work that falls outside the
  project's product boundary or license.

## Reporting security issues

Please do not report a suspected vulnerability in a public issue. Follow
[SECURITY.md](SECURITY.md) instead.
