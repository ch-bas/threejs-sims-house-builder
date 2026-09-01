# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.8.3] - 2026-09-01

### Fixed
- Outdoor scatter (grass tufts, shrubs, flowers, road dashes, stepping stones) no longer blinks out of view when the camera pans — the instanced meshes now compute a bounding sphere covering their actual spread instead of culling at the world origin ([#104](https://github.com/ch-bas/threejs-sims-house-builder/issues/104))
- "Surprise me" asks for confirmation before replacing a furnished floor instead of silently wiping it ([#105](https://github.com/ch-bas/threejs-sims-house-builder/issues/105))
- Procedural texture caches (floor/wall patterns, roof shingles, item labels) are capped with a disposing LRU, so experimenting with colours no longer grows GPU memory for the whole session; redundant per-clone GPU re-uploads removed ([#106](https://github.com/ch-bas/threejs-sims-house-builder/issues/106))
- Logic roundup: floor duplication can no longer produce colliding item ids, generated furniture sets keep a wall-thickness inset from exterior walls, long library save names no longer collide after slug truncation, and the redeploy watchdog waits 20s before reloading on slow connections ([#107](https://github.com/ch-bas/threejs-sims-house-builder/issues/107))

## [1.8.2] - 2026-09-01

### Fixed
- The error boundary's "Reset saved layout" button now recovers instead of looping. After layout state moved into a module-level store (1.8.1), the soft reset kept the crash-causing layout in memory and re-crashed immediately; it now hard-reloads to re-baseline the store ([#102](https://github.com/ch-bas/threejs-sims-house-builder/issues/102))
- Ground shadows no longer go stale or missing after changing the roof or toggling the outdoor scenery. Both effects now refresh the (static) shadow map like the others do ([#103](https://github.com/ch-bas/threejs-sims-house-builder/issues/103))

## [1.8.1] - 2026-08-26

### Fixed
- Returning visitors no longer get stuck on a permanent "Loading the lot…" screen after a redeploy. The static export's hashed chunk URLs change each deploy, and a browser holding cached HTML (GitHub Pages caches it ~10 min) would 404 on the old chunks with no recovery; an inline head watchdog now reloads once to fetch fresh assets ([#100](https://github.com/ch-bas/threejs-sims-house-builder/issues/100))

### Added
- Landscape / short-viewport responsive layout — wide-but-short screens (landscape phones, short desktop windows) now compact the floating chrome instead of overflowing it off the bottom edge ([#98](https://github.com/ch-bas/threejs-sims-house-builder/issues/98))

### Changed
- Introduced a Zustand store for layout state as an incremental foundation: it reuses the existing reducer (so behavior is unchanged), and a few panels now subscribe to atomic slices via selectors. The remaining panels still read through React context and can migrate individually ([#3](https://github.com/ch-bas/threejs-sims-house-builder/issues/3))

## [1.8.0] - 2026-08-13

Three.js-focused audit: rendering-quality, GPU performance, and static-export hardening.

### Performance
- Render loop: the shadow map no longer recomputes every frame (only when a caster or the sun moves), the NPC animation loop only requests frames when an NPC actually moves, static room-shell meshes bake their matrix once, and hover/drag raycasts reuse a cached furniture list instead of rebuilding it per pointer move ([#95](https://github.com/ch-bas/threejs-sims-house-builder/issues/95))
- Draw calls: the outdoor lot's high-count scatter (220 grass tufts, shrubs, flowers, road dashes, stepping stones) renders through `InstancedMesh` (hundreds of meshes → a handful of draw calls); loop-invariant geometries are hoisted and shared; procedural floor/wall/label/roof textures are cached and reused across rebuilds ([#96](https://github.com/ch-bas/threejs-sims-house-builder/issues/96))

### Fixed
- Rendering color management: roof-shingle and birch-bark CanvasTextures are tagged sRGB (they were rendering washed-out), and the UI overlays (camera vision cones, WiFi/CCTV range rings, measurement markers) bypass ACES tone mapping so they hit their intended colors; transparent signal rings no longer punch holes in each other ([#94](https://github.com/ch-bas/threejs-sims-house-builder/issues/94))
- A stale-chunk 404 after a redeploy no longer dead-ends returning users — the error boundary reloads on `ChunkLoadError` instead of re-requesting the dead chunk in a loop ([#97](https://github.com/ch-bas/threejs-sims-house-builder/issues/97))
- Outdoor ground layers no longer z-fight (the 1 mm stack was widened) ([#96](https://github.com/ch-bas/threejs-sims-house-builder/issues/96))
- The WebGL context is recovered automatically after a GPU context loss instead of leaving a permanently blank canvas ([#95](https://github.com/ch-bas/threejs-sims-house-builder/issues/95))

### Security
- `floorPlanImage` is restricted to `data:image/` URLs, closing an outbound-fetch vector where a poisoned/imported layout could point it at an arbitrary URL ([#97](https://github.com/ch-bas/threejs-sims-house-builder/issues/97))

### Changed
- GLB export serializes only the furniture/structure subtree instead of the whole scene (lights, sky, grid, NPCs, and overlays are excluded); download object-URLs are revoked on a later tick to avoid truncating downloads ([#97](https://github.com/ch-bas/threejs-sims-house-builder/issues/97))
- CI installs with `npm ci` for reproducible builds; `next` bumped to 15.5.23 ([#97](https://github.com/ch-bas/threejs-sims-house-builder/issues/97))

## [1.7.0] - 2026-08-13

Second batch of the second-round audit: geometry/interaction correctness, walkthrough fixes, schema hardening, and the project's first automated test suite.

### Added
- Test framework: Vitest with 158 unit tests covering the layout reducer, schema migration/validation, geometry/OBB collision, the share-URL codec, wall snapping, alignment, and achievements — enforced in CI ([#6](https://github.com/ch-bas/threejs-sims-house-builder/issues/6))

### Fixed
- 2D top-down view renders at the container size and device-pixel-ratio instead of a fixed 800×600, so it's no longer stretched or blurry ([#66](https://github.com/ch-bas/threejs-sims-house-builder/issues/66))
- Selection outlines no longer go stale when toggling Show All Floors or editing the selected wall ([#75](https://github.com/ch-bas/threejs-sims-house-builder/issues/75))
- Wall cutouts: an opening near a junction cuts only its own wall, overlapping cutouts no longer corrupt the wall mesh, and oversized openings clamp to the wall segment ([#61](https://github.com/ch-bas/threejs-sims-house-builder/issues/61))
- Dragging a door or window to a different wall now re-orients it to that wall instead of keeping its old rotation ([#62](https://github.com/ch-bas/threejs-sims-house-builder/issues/62))
- Geometry polish: interior-wall cameras seat on the cursor's side of the wall, hipped-roof faces are wound outward, the 2D and 3D grids align to the actual snap grid, and rotated stairs cut a matching (non-inflated) floor hole ([#63](https://github.com/ch-bas/threejs-sims-house-builder/issues/63))
- Multi-select: group rotate orbits items about the selection centroid (rigidly) instead of spinning each in place, duplicate copies the whole selection, and the primary item can be Ctrl-deselected ([#69](https://github.com/ch-bas/threejs-sims-house-builder/issues/69))
- Keyboard: Shift+R fine-rotation works again, and AltGr layouts can reach the `[` / `]` time-of-day shortcuts ([#76](https://github.com/ch-bas/threejs-sims-house-builder/issues/76))
- Walkthrough mode: single-key shortcuts and canvas selection are suppressed while walking, floor-switching keeps pointer lock instead of teleporting, a second Escape exits, entering Live from 2D works, and the camera is clamped to the room footprint ([#67](https://github.com/ch-bas/threejs-sims-house-builder/issues/67))
- Furniture sets and Surprise no longer drop items outside small rooms, and outdoor items no longer float mid-air when an upper floor is active ([#73](https://github.com/ch-bas/threejs-sims-house-builder/issues/73))
- Roundup: JSON import clears the multi-selection, corrupt share links surface an error instead of silently loading the local layout, generated IDs no longer collide (and a room-shape stamp is a single undo), achievement thresholds/text/currency are corrected, the minimap no longer overlaps the corner pills, the welcome banner is a proper accessible dialog, and empty-name/PNG export edge cases are handled ([#78](https://github.com/ch-bas/threejs-sims-house-builder/issues/78))

### Security
- CSV inventory export now escapes leading formula characters (`=`, `+`, `-`, `@`), closing a spreadsheet formula-injection vector via item/floor names carried in shared layouts ([#72](https://github.com/ch-bas/threejs-sims-house-builder/issues/72))

### Changed
- Layout schema validation rejects non-positive room dimensions, unknown roof styles, floor counts over the limit, and non-boolean flag fields ([#77](https://github.com/ch-bas/threejs-sims-house-builder/issues/77))

## [1.6.0] - 2026-08-11

Correctness and robustness release from the second-round audit (issues [#58](https://github.com/ch-bas/threejs-sims-house-builder/issues/58)–[#74](https://github.com/ch-bas/threejs-sims-house-builder/issues/74)).

### Added
- Touch support: the canvas now uses pointer events, so tablets and phones can select and drag furniture; the touch mode toggle configures the correct one-/two-finger gestures ([#64](https://github.com/ch-bas/threejs-sims-house-builder/issues/64))
- Error boundaries with a "Reset saved layout" recovery button, so a corrupt saved layout can no longer permanently white-screen the app ([#70](https://github.com/ch-bas/threejs-sims-house-builder/issues/70))

### Fixed
- Collision detection and the 2D top-down view now match the 3D scene at every rotation; previously both mirrored the rendered footprint, so rotated items showed wrong collision flags and flipped orientation in 2D ([#58](https://github.com/ch-bas/threejs-sims-house-builder/issues/58))
- Doors and windows on the south and west walls no longer punch their cutout at the mirrored position ([#59](https://github.com/ch-bas/threejs-sims-house-builder/issues/59))
- Doors and windows are no longer permanently flagged as colliding (they live inside the wall by design) ([#60](https://github.com/ch-bas/threejs-sims-house-builder/issues/60))
- Clicking an item to select it no longer counts as a zero-distance drag — it no longer re-locks the item, blocks nudge/delete, or adds a spurious undo entry ([#65](https://github.com/ch-bas/threejs-sims-house-builder/issues/65))
- Camera-pad zoom slider is no longer direction-inverted ([#68](https://github.com/ch-bas/threejs-sims-house-builder/issues/68))
- Oversized floor-plan images are downscaled before saving, and failed saves (storage full) are reported honestly instead of showing "Saved" ([#71](https://github.com/ch-bas/threejs-sims-house-builder/issues/71))
- Redo within the auto-commit debounce window no longer destroys a freshly-made edit ([#74](https://github.com/ch-bas/threejs-sims-house-builder/issues/74))

## [1.5.0] - 2026-08-10

Performance and internal-quality release completing the August 2026 code audit (issues [#32](https://github.com/ch-bas/threejs-sims-house-builder/issues/32), [#34](https://github.com/ch-bas/threejs-sims-house-builder/issues/34)–[#38](https://github.com/ch-bas/threejs-sims-house-builder/issues/38)).

### Performance
- Scene rebuilds are granular: selecting an item swaps only its outline instead of rebuilding every furniture mesh; item edits no longer rebuild walls, floors, procedural textures, interior walls, or lighting; overlay toggles leave furniture untouched ([#32](https://github.com/ch-bas/threejs-sims-house-builder/issues/32))
- Camera-vision animation loop idles when no cones are in the scene; floor-plan images cache their decoded data instead of re-decoding per rebuild ([#32](https://github.com/ch-bas/threejs-sims-house-builder/issues/32))

### Changed
- ESLint now runs in CI with zero warnings tolerated; all 33 outstanding warnings resolved ([#34](https://github.com/ch-bas/threejs-sims-house-builder/issues/34))
- `noUnusedLocals`/`noUnusedParameters` enabled; 13 dead symbols removed ([#35](https://github.com/ch-bas/threejs-sims-house-builder/issues/35))
- Shared `material()` helper replaces ~135 repeated MeshStandardMaterial blocks in the mesh builders ([#36](https://github.com/ch-bas/threejs-sims-house-builder/issues/36))
- Orchestrator split along its seams: drag fast-path, placement/snapping, and import/export moved into dedicated hooks; canvas event handling and base lights moved into the `three/` layer ([#37](https://github.com/ch-bas/threejs-sims-house-builder/issues/37))
- Deduplicated UI widgets: shared colour-swatch picker, glass-inset token class, and slider-row component ([#38](https://github.com/ch-bas/threejs-sims-house-builder/issues/38))

## [1.4.0] - 2026-08-05

Bug-fix release resolving all twelve confirmed findings from the August 2026 code audit.

### Fixed
- Undo immediately after page load no longer reverts the house to the blank default and auto-saves the wipe ([#21](https://github.com/ch-bas/threejs-sims-house-builder/issues/21))
- Opening a share link no longer overwrites the locally saved house ([#22](https://github.com/ch-bas/threejs-sims-house-builder/issues/22))
- Achievements re-enabled — unlock detection had been silently disabled since the architecture refactor ([#23](https://github.com/ch-bas/threejs-sims-house-builder/issues/23))
- Layout schema validation hardened: corrupt share URLs or localStorage entries can no longer crash the app or produce NaN-corrupted items ([#24](https://github.com/ch-bas/threejs-sims-house-builder/issues/24))
- Single-key shortcuts no longer hijack browser shortcuts like Ctrl+R and Cmd+F; Delete and arrow-nudge respect locked items ([#25](https://github.com/ch-bas/threejs-sims-house-builder/issues/25))
- Removing or reordering floors keeps the same floor active instead of silently switching the edit target; undo no longer jumps to the ground floor ([#26](https://github.com/ch-bas/threejs-sims-house-builder/issues/26))
- Escape now cancels an in-progress interior wall draft ([#27](https://github.com/ch-bas/threejs-sims-house-builder/issues/27))
- Undo within the debounce window reverts the pending edit instead of discarding it; undo/redo stacks are StrictMode-safe ([#28](https://github.com/ch-bas/threejs-sims-house-builder/issues/28))
- Auto-organize leaves doors, windows, security cameras, and outdoor items anchored instead of tearing them off walls ([#29](https://github.com/ch-bas/threejs-sims-house-builder/issues/29))
- Pending auto-saves flush on tab close; library saves survive storage-quota errors with rollback and feedback; sidebar delete no longer leaves ghost ids in multi-select ([#30](https://github.com/ch-bas/threejs-sims-house-builder/issues/30))

### Performance
- Mousemove over the canvas no longer re-renders the whole React tree; editor context identity is stable ([#31](https://github.com/ch-bas/threejs-sims-house-builder/issues/31))
- One render per frame while orbiting instead of two ([#33](https://github.com/ch-bas/threejs-sims-house-builder/issues/33))

## [1.3.1] - 2026-06-10

### Added
- Fix eslint configuration.

## [1.3.0] - 2026-06-10

### Added
- CCTV vision cones detect objects: furniture or NPCs in the field of view turn the cone alert red, pulse the wedge, and flare the scan line as it sweeps over the target
- Gradient sky (zenith-to-horizon) driven by the time-of-day system
- Wall Visibility row (N/E/S/W) in the Paint panel to hide/restore exterior walls
- Click any wall in 3D to select it and auto-open the Paint panel; Delete removes interior walls or toggles exterior walls hidden
- Collapsible Build Tools panel and bottom catalog strip
- Outdoor items restricted to outside the building footprint; catalog drops default past the south wall
- Filmic rendering pipeline: ACES tone mapping, PCF soft shadows, image-based lighting, render-on-demand, drag fast-path, OBB collision, GPU resource disposal

### Fixed
- Fix selection of internal/external walls.
- Enable all mitems in build menu [sill height](https://github.com/ch-bas/threejs-sims-house-builder/issues/12).
- Elements should be locked after they were [positioned](https://github.com/ch-bas/threejs-sims-house-builder/issues/11).
- Correct window glass color and [sill height](https://github.com/ch-bas/threejs-sims-house-builder/issues/14).
- Vision-cone animation now runs while the mouse is idle (render-on-demand invalidation)
- Vision cones are no longer occluded by walls, furniture, or rugs

## [1.2.0] - 2026-06-01

### Added
- Mobile support and responsive layout
- 67 furniture items across 11 categories
- Multi-floor buildings (up to 4 levels) with floor switcher
- Walkthrough mode (first-person WASD + PointerLock)
- Interior walls with vertex and right-angle snapping
- Doors and windows that cut openings in walls
- 7 room templates including Two-Story Home
- 5 theme presets (Modern, Rustic, Minimalist, Cozy, Tropical)
- 5 furniture sets (Dining, Bedroom, Home Office, Kitchen, Lounge)
- Sun-arc time-of-day with dawn/noon/dusk/midnight presets
- Multi-select with align, distribute, group drag/rotate
- Undo/redo (snapshot-based, 50-entry stack)
- Auto-save to localStorage
- Saved-layouts library (name, save, list, load, delete)
- Export/import JSON, PNG screenshot, GLB/glTF export
- Shareable URLs (base64-encoded layout in hash)
- Inventory CSV export
- 15 achievements with toast notifications
- Walking NPCs with procedural animation
- Cost-density heatmap in 2D view
- Floating item labels, hover tooltips, minimap
- Roof styles (Flat, Gable, Hipped) with color picker
- Floor patterns (Wood, Tile, Carpet, Concrete) and wall patterns (Brick, Wallpaper, Wood Panel, Plaster)
- Floor plan image upload with opacity and 3D displacement
- 3D measurement tool
- Outdoor garden mode
- Web-Audio sound cues
- Keyboard shortcuts for all major actions
- Camera presets (Iso, Top-down, Front, Corner, Fit-to-room)

### Fixed
- Auto-save properly wires live state into localStorage
- requestAnimationFrame cancelled on unmount
- snapToGrid no longer tears down the scene
- Canvas snapshotted at top of init effect
- importLayout validates JSON before applying
- URL.revokeObjectURL called after downloads

## [1.0.1] - 2026-06-03

### Security
- Resolved critical vulnerability in next@15.0.3 (CVE-2025-66478): DoS, SSRF, cache poisoning
- Resolved moderate vulnerability in postcss <8.5.10: XSS via unescaped `</style>`

## [1.0.0] - 2026-05-30

### Added
- Initial release
- Grid-based room builder with Three.js
- Basic furniture placement and drag
- Next.js 15 + React 18 + Tailwind CSS setup
