# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
