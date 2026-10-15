# DSH Desktop Documentation

[中文文档](README.md)

This directory is the product and developer documentation index for DSH Desktop. The root [`README.en.md`](../README.en.md) is the short product entry point; these pages explain why the project exists, how to use it, and how to build plugins for it. Want to contribute? See [Contributing](../CONTRIBUTING.en.md).

## Read by goal

Ordinary users can start with the [user guide](user-guide.en.md) and never need the developer documentation.

### User documentation

| Document | Covers |
| --- | --- |
| [User guide](user-guide.en.md) | Installation, profiles, modes, terminal, plugins, and updates |
| [FAQ](faq.en.md) | Direct answers about platforms, bundled runtime, project status, data, plugins, and updates |
| [Privacy Policy](../PRIVACY.md) | Official updates, downloads, local data, third-party services, and user choices |
| [Why Desktop](why-desktop.en.md) | The boundary with upstream Harness and the case for plugins |

### Developer and maintainer documentation

| Document | Covers |
| --- | --- |
| [Plugin ecosystem manifesto](plugin-ecosystem.en.md) | The vision of an open, composable, sustainable plugin ecosystem and its three principles |
| [Plugin development](plugin-development.en.md) | Ordinary DSH plugins, Desktop services, compatibility, and lifecycle |
| [Community Fabric Draft](../dsh-community-fabric/README.md) | Community interoperability drafts spanning manifest/capability foundations, Runtime/Presentation, service composition, and provenance diagnostics |
| [Fabric community-feedback disposition](../dsh-community-fabric/docs/research/community-issue-23-review.md) | Which Issue #23 proposals were adopted, split into focused RFCs, deferred, or kept out of portable core |
| [Fabric framework and plugin-needs research](../dsh-community-fabric/docs/research/mature-plugin-frameworks.md) | Mature Koishi, Chrome, and VS Code patterns plus requirements observed in real DSH plugins |
| [VS Code extension-model research](../dsh-community-fabric/docs/research/vscode-extension-model.md) | Implemented declaration, Provider, UI, placement, and lifecycle patterns, with concrete constraints for the Fabric RFC |
| [Community Market design](../dsh-community-market/README.md) | The proposed market shell, extensible catalog sources, user selection, install confirmation, and safety boundary |
| [Market catalog provider contract](../dsh-community-market/docs/catalog-provider-contract.md) | Schemas, query parameters, multi-source behavior, and adapter rules for the implementation team |
| [Upstream synchronization](<upstream-sync.en.md>) | Required patches, excluded content, artifact synchronization and regression checks |
| [Historical architecture reference](<architecture.en.md>) | Early Stable/Beta design context, not the current product support inventory |
| [NEXT package reference](<../dsh-desktop-next/README.md>) | Current Windows x64 build, runtime, release and limitations |

## How the README files are organized

The outer repository has two formal product READMEs plus one legacy compatibility entry:

- [`README.md`](../README.md): the Chinese product entry point.
- [`README.en.md`](../README.en.md): the English product entry point with the same product scope.
- [`README.zh.md`](../README.zh.md): a legacy Chinese-path compatibility page with no independent content.

The [README bilingual record](<../README.i18n.yaml>) tracks hashes for the product entry points; it is not a user guide. Current technical references are the [NEXT package reference](<../dsh-desktop-next/README.md>) and [upstream synchronization guide](<upstream-sync.en.md>). Removed packages and their service documents are not instructions to restore retired implementations. Maintainer decision records preserve historical rationale rather than replace current product documentation.

The Core submodule pins the maintained commit in the [source record](<../upstream.json>), preserving upstream structure and required project patches. Its documentation belongs to Core, not the Desktop product; equal npm versions do not identify an unmodified official release.

## Status convention

Documentation distinguishes implemented behavior, platform limits, unvalidated paths and roadmap items. The current product is Windows x64 NEXT; use the [NEXT package reference](<../dsh-desktop-next/README.md>) for its actual composition and acceptance commands. Early Stable/Beta platform, window-mode and API descriptions are historical context, not instructions to restore retired directories, channels or other platform support.
