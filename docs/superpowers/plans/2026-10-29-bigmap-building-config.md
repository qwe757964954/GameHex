# BigMap building config integration

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline.

**Goal:** Consume updated DM building types and artwork for all 23 configured IDs.

**Architecture:** Config parser keeps the configured icon and initial map cell ID. Art loader receives building configs through Presenter/Page, prefers each configured icon, shares a same-kind icon when blank, and uses existing concept art by kind if unavailable. No grid-ID conversion without the corresponding base map contract.

**Tech Stack:** Cocos Creator 3.8, TypeScript, node:test via tsx.

**Spec:** docs/bigmap-系统实现说明.md §5.10; docs/AI架构与代码规范.md §2/3/7.3.

## Constraints and review focus

- Preserve unrelated work; never hand-edit generated config.
- Blank icons, missing assets, duplicate paths, all 8 building kinds and all 23 IDs must work.
- World marker art remains separate from base building art.
- Initial cell IDs 1001–1023 require a base-map definition; do not reinterpret as 0–24.

## Task: config-to-art integration

- [x] Add failing config/art tests using actual remoteRef tables, checking path precedence, shared art, fallback and deduplication.
- [x] Extend BigMapTypes/BigMapConfig, update BigMapArtCatalog/BigMapArtLoader and pass buildings through BigMapPresenter/BigMapPage.
- [x] Run affected config/art/base/presenter tests, type checks and asset reference guard.
- [x] Document current resource and base-map limitations.

Results: 65 affected tests pass, changed-chain TypeScript compilation and pvp_card_check pass. Source Excel and runtime table match across all 23 rows. Broader existing art asset checks still reference the old resources directory; resource item icon tests conflict with preexisting bigmapResource changes.

## Follow-up: city configuration

User clarified that DM-城池配置 is the intended integration and positions should use existing placement.

- [x] Parse all camp parameters and load campIcon through existing art loader.
- [x] Make the formal loader use all 81 camp identities, preserving offline simulator fixtures.
- [x] Retain valid layout anchors; reuse ring/BFS placement for missing camps and reserve existing entities.
- [x] Repartition territories with deterministic multi-source BFS and actual geometric adjacency.
- [x] Validate loading, placement, connectivity, icons, protocol and view regressions; document server-owned rule boundaries.

Files: BigMapCampWorld.ts (pure projection/layout completion), BigMapConfig.ts/Types.ts (contracts), ConfigLoader/LayoutLoader (formal wiring), World.ts (reuse placement), ArtLoader/Presenter/Page/WorldView (rendering), tests/bigmap-latest-camp-config.test.ts and bigmap-art-loading.test.ts.

Validation: 152 focused tests and changed-chain TypeScript compilation pass. Broader BigMap run: 368/370 pass; two existing world-prefab tests still point to old resources paths. Source/runtime camp tables match; no generated table or layout edits. Cocos refreshed the feature folder and generated the new script meta.
