# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.3.0] - 2026-06-08

### Fixed
- Elements should be locked after they were [positioned](https://github.com/ch-bas/threejs-sims-house-builder/issues/11).
- Correct window glass color and [sill height](https://github.com/ch-bas/threejs-sims-house-builder/issues/14).

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
