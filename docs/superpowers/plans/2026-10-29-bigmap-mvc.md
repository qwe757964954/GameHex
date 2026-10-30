# BigMap MVC Implementation Plan

> Execute inline using superpowers:executing-plans; fresh independent review at completion. No commits requested. Preserve existing dirty workspace.

**Goal:** network subscriptions and interaction orchestration belong to BigMapController; views receive snapshots and emit scoped intents only.

**Architecture:** BigMapModel reuses the existing pure domain/state implementation. Controller binds network pushes, repository/model changes and UI intents, owns polling and operation guards, then publishes immutable display snapshots and camera commands through EventMgr. Entry is the composition root; gateways remain request adapters. Former Presenter import is only a compatibility re-export, with no second implementation.

**Tech Stack:** Cocos 3.8, TypeScript, existing EventMgr/AssetService/ResourceScope, tsx tests, Cocos MCP.

- [x] Add failing MVC boundary and event/lifecycle regression tests.
- [x] Extract Model, remove gateway/repository self-subscriptions, add scoped event contracts, display snapshot and Controller.
- [x] Convert Page/World/Base/legacy target panel to snapshots and intents, compose Controller in Entry, keep Prefab UI intact.
- [x] Update affected fixtures, verify network races/cancellation/MVC guards, refresh scripts through Cocos MCP.
- [x] Fresh independent review and resolve actionable findings; record results.

Contract: the map page is single-instance. Closing it unbinds the controller before reopening; UI/presentation events carry only intent and presentation data. Disposed controllers emit nothing and accept no input; in-flight actions cannot mutate a later session. Timer and all subscriptions are released exactly once. Requests remain owned by the existing gateway until Controller disposes it via repositories.

Validation: MVC, bigmap behavior, UI event and callback owner suite: 415 tests, 414 pass; one pre-existing headquarters.png manifest hash mismatch. Cocos refreshed scripts and generated metadata, validated BigMapPage.prefab (63 nodes, no issues), console reported zero errors. Global tsc retains pre-existing project errors; no diagnostics under assets/script/app/bigmap. Independent reviewer found the scene-destroy lifecycle gap; scoped Disposed event now disposes Controller on that path. Reused repository polling constant.
