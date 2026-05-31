# Threejs Sims House Builder

A lightweight, open-source Sims-like house builder built entirely in the browser using Three.js.

This repository provides a polished, grid-based architecture and interior design system featuring wall patterns, floor styles, modular stairs, and dynamic UI panels.

Built with Next.js 15, React 18, Three.js, and Tailwind CSS. No backend, no authentication — everything runs client-side.

**[Live Demo](https://ch-bas.github.io/threejs-sims-house-builder/)** 
## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Production build:

```bash
npm run build && npm start
```

Type-check only:

```bash
npm run typecheck
```

## Feature tour

### Building

- **67 furniture items** across 11 categories (Seating, Tables, Bedroom,
  Storage, Kitchen, Bathroom, Electronics, Decor, Outdoor, People,
  Structure).
- **Multi-floor buildings** up to 4 levels — ground floor + up to three
  upper floors, with a FloorSwitcher to select, add, remove, rename
  (double-click), reorder, and **clone** the active floor. Each floor
  has its own items and finishes; per-floor stats break down cost and
  count in the sidebar.
- **Stairs** as a furniture type that visually bridges one floor to the
  next (14 steps, stringers, slanted handrails).
- **Roof** on top of the highest floor: Flat, Gable, or Hipped, with a
  per-roof colour picker.
- **Categorised catalog** with search, filter chips, and price tags ($).
- **Drag-from-catalog placement**: drag an item directly onto the 3D
  viewport to drop it where you release.
- **3D mesh builders** for every type — beds, sofas (standard/L/U-shape),
  fridges, stoves, sinks, toilets, bathtubs, showers, trees, fences,
  pools, stairs, people / pets for scale, and more.
- **7 room templates**: Bedroom, Living Room, Home Office, Kitchen,
  Bathroom, Studio Apartment, plus a populated multi-floor **Two-Story Home**.
- **5 theme presets** (Modern, Rustic, Minimalist, Cozy, Tropical) that
  recolour walls, floor, and furniture by category across every floor.
- **5 furniture sets** that drop a curated combo (Dining, Bedroom,
  Home Office, Kitchen Line, Lounge) at the current cursor.

### Editing

- **Drag** in 3D to reposition; arrow keys fine-tune (Shift = 1 m).
- **Multi-select** with Ctrl/⌘+click — bulk delete, **group-drag** (move
  the whole selection by the same delta), **group rotate** (R / Shift+R
  rotates every selected item), plus **Align**
  (left/centre/right/top/centre/bottom) and **Distribute** (X/Z) for 3+
  items.
- **Per-item editor**: dimension sliders, **precise X/Z numeric inputs**,
  rotation in degrees, mirror, lock, "Centre in room" shortcut, colour
  picker (with a persisted "Recent" strip) + 🎲 randomise.
- **Bulk lock / unlock all** on the active floor.
- **Collision visibility**: colliding items get a red row + ⚠️ badge in
  the placed-items list, and a counter shows up in stats.
- **Snap-to-grid**, **snap-to-wall**, and **snap-to-items** toggles —
  stackable, rotation-aware.
- **Auto-organize** with three strategies: packed, by category, by size.
- **Surprise me** picks a room-appropriate furniture set + random decor.
- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z) — snapshot-based, debounced,
  50-entry stack.

### Walls, floor & roof

- **Per-wall colours** (N/S/E/W) plus per-floor floor colour.
- **Floor patterns**: Solid, Wood Planks, Tile, Carpet, Concrete.
- **Wall patterns**: Solid, Brick, Wallpaper, Wood Panel, Plaster.
- All patterns are rendered procedurally to CanvasTextures — no asset
  files.
- **Floor plan image** upload (per building) with opacity, fit-mode
  (stretch/cover/contain), and optional 3D displacement.
- **Roof** picker (None / Flat / Gable / Hipped) with a colour.
- **Doors and windows** that cut openings in the nearest wall when
  dropped — both exterior and interior walls support the cutouts.
- **Interior walls**: a chained draw-mode (click successive floor points
  to lay a polyline of thin wall segments) with **vertex snapping**
  (existing endpoints), **right-angle snapping** (perpendicular to the
  previous segment), and a live preview of the next segment. Doors and
  windows near an interior wall cut through it via ExtrudeGeometry with
  holes.

### View

- **3D / 2D top-down** toggle.
- **Walkthrough mode**: first-person WASD camera at the active floor's
  eye height (PointerLockControls + Shift sprint).
- **Camera presets**: Iso, Top-down, Front, Corner, plus **Fit-to-room**.
- **Show all floors** toggle stacks every level at once with ghosted
  lower floors.
- **Sun-arc time-of-day** (continuous 0–24) drives ambient and sun
  colour, intensity, and position. Lamps light up at night. Dawn / Noon /
  Dusk / Midnight presets plus a ▶ button advances time in real-time.
- **Outdoor garden mode**: grass, stone path ring, scattered bushes.
- **Top-down minimap** overlay (active floor).
- **Hover tooltips** showing item icon, name, price ($), and dimensions.
- **3D measurement tool**: pick two floor points to see the distance.
- **Catalog search highlights matching placed items** with an amber
  outline in the active floor.
- **Floating item labels** sprite above each piece in 3D when enabled.
- **Cost-density heatmap** in the 2D view, with a min/max gradient legend.
- **Walking NPCs** that wander the active floor between random waypoints
  (procedural human meshes, leg-bob animation, RAF-driven motion).
- **Collapsible sidebar** for full-viewport editing.
- **Walkthrough HUD** with a centre reticle + WASD/Sprint/Esc help banner.
- **Multi-select badge** floating at the top of the viewport when more
  than one item is selected.
- **Optional Web-Audio sound cues** for placement, removal, rotation,
  and achievement unlocks.

### UI / chrome

- **Floating glass panels** overlaid on the viewport: `BuildToolsPanel`
  (bottom-left, category picker + wall-draw + 2D/walkthrough toggles),
  `CatalogStrip` (bottom-centre, drag-source tile row), `ModePanel`
  (bottom-right, LIVE / BUILD / BUY mode and stats).
- **Sidebar tabs** for the optional expanded sidebar: **Build / Buy /
  Style / Manage**. Sidebar is **collapsed by default** for full-viewport
  editing; toggled from the header's "◀ Show panels" button.
- **Floating item-context popover** appears next to the selected piece
  with dimension/colour/rotation controls, replacing a fixed sidebar panel.
- **Themed dark-slate header** with chip-strip stats (items, floors, room
  dimensions, cost vs budget).

### Project management

- **Auto-save** to `localStorage` (1.5s debounce). Legacy single-floor
  saves continue to load thanks to the schema migration.
- **Saved-layouts library**: name, save, list, load, delete; entry stores
  item and floor counts.
- **Export / import layout** as JSON (with structural validation).
- **Inventory CSV** with a Floor column.
- **PNG screenshot** of the current viewport.
- **GLB / glTF export** of the live Three.js scene — opens in any viewer.
- **Shareable URLs**: the layout is base64-url encoded into the hash; the
  app hydrates from it if present on load. Floor-plan images are stripped
  to keep URLs compact.

### Game-y

- **15 achievements** ("First Steps", "Furnished", "Overstuffed",
  "Big Spender", "WiFi Everywhere", "Sky High", "Penthouse", "Going Up",
  "Roof It", "Green Thumb", "Door Installer", "Window Watcher",
  "Wall Whisperer", "Decorator", "Open Plan") with toast pop-ups when
  unlocked and a sidebar gallery panel showing locked / unlocked progress.

### Stats

- **Header chip strip**: items / floors / room dimensions / cost-vs-budget.
- **Statistics panel**: items, floors, floor area, total area, footprint
  coverage %, cost vs. budget, breakdown by category.

### Welcome

- **First-run welcome banner** with quick-start tips.

## Keyboard shortcuts

| Action            | Key                |
| ----------------- | ------------------ |
| Undo / Redo       | Ctrl+Z / Ctrl+Shift+Z |
| Delete item       | Delete             |
| Duplicate         | Ctrl+D             |
| Rotate            | R (Shift+R = 15°)  |
| Move              | Arrow keys (Shift = 1 m) |
| Deselect          | Esc                |
| Focus on item     | F                  |
| Multi-select      | Ctrl/⌘+click       |
| Group-drag        | Drag any selected  |
| Switch floor      | PgUp / PgDn        |
| Time of day       | [ / ]              |
| Toggle 2D         | 2                  |
| Measurements      | M                  |
| Snap to grid      | G                  |
| Signals/Coverage  | W                  |

## Module layout

```
app/                                     Next.js entry, no auth wrapper
components/
├── ui/                                  shadcn-style primitives
└── room-organizer/
    ├── room-organizer.tsx               Orchestrator (~1030 lines)
    ├── index.ts                         Barrel export
    ├── contexts/                        React Context (eliminates prop drilling)
    │   ├── room-editor-context.tsx      Layout, actions, view, history, game state
    │   ├── selection-context.tsx        Selected item(s), multi-select
    │   └── index.ts                    Barrel
    ├── lib/                             Pure domain code, no React/Three
    │   ├── types.ts                     RoomLayout / FloorLayout / ViewSettings / etc.
    │   ├── constants.ts                 Catalog (67 items), templates, MAX_FLOORS
    │   ├── schema.ts                    Type guards + legacy migration
    │   ├── geometry.ts                  Collision, bounds, snap, auto-organize
    │   ├── alignment.ts                 Align/distribute pure functions
    │   ├── achievements.ts              15 predicate-based achievements
    │   ├── persistence.ts               Active-layout localStorage I/O
    │   ├── library.ts                   Named-layout library I/O
    │   ├── share.ts                     Share-URL encode/decode (base64url)
    │   ├── blueprint.ts                 Print-friendly 2D blueprint HTML
    │   ├── catalog-drag.ts              HTML5 drag MIME constants
    │   ├── themes.ts                    Theme definitions + applyTheme
    │   ├── furniture-sets.ts            Pre-built combos
    │   ├── surprise.ts                  Random one-shot floor populate
    │   ├── sounds.ts                    Web-Audio synth for UI cues
    │   ├── wall-snap.ts                 Vertex + right-angle snap for interior walls
    │   ├── opening-snap.ts              Door/window snap to wall segments
    │   ├── room-shapes.ts               Predefined room shape presets
    │   └── file-io.ts                   JSON / image / PNG / CSV / GLB I/O
    ├── three/                           Three.js builders, no React
    │   ├── furniture-builders.ts        Registry + factory (~110 lines)
    │   ├── builder-utils.ts             Shared types + helpers
    │   ├── builders/                    Per-category builder functions
    │   │   ├── builders-seating.ts      Chair, armchair, bench, sofa
    │   │   ├── builders-bedroom.ts      Bed, nightstand, dresser
    │   │   ├── builders-tables.ts       Table, desk, coffee/side/dining
    │   │   ├── builders-storage.ts      Bookshelf, cabinet
    │   │   ├── builders-kitchen.ts      Fridge, stove, sink, counter
    │   │   ├── builders-bathroom.ts     Toilet, bathtub, shower
    │   │   ├── builders-electronics.ts  TV, computer, WiFi, router, CCTV
    │   │   ├── builders-lighting.ts     Lamp, pendant, lamppost
    │   │   ├── builders-decor.ts        Rug, painting, vase, mirror, etc.
    │   │   ├── builders-plants.ts       Plant, tree, flowers, hedge, etc.
    │   │   ├── builders-outdoor.ts      Fence, pool, BBQ, mailbox, etc.
    │   │   ├── builders-people.ts       Person, pet
    │   │   └── builders-structure.ts    Door, window, stairs
    │   ├── room-builder.ts              Floor + walls (yOffset, ghosting)
    │   ├── wall-openings.ts             Door / window → exterior wall cutouts
    │   ├── interior-walls.ts            Drawn-segment interior walls with cutouts
    │   ├── measurement.ts               Distance-tool spheres + line
    │   ├── item-labels.ts               Floating sprite labels above items
    │   ├── roof.ts                      Flat / gable / hipped roof
    │   ├── floor-patterns.ts            Procedural CanvasTexture floors
    │   ├── wall-patterns.ts             Procedural CanvasTexture walls
    │   ├── signal-overlay.ts            Wi-Fi / CCTV ring overlays
    │   ├── lighting.ts                  Sun-arc continuous time of day
    │   └── outdoor.ts                   Garden / path / bush scenery
    ├── canvas-2d/render.ts              Pure 2D top-down renderer
    ├── plotcraft/icon.tsx                Lucide-react icon wrapper for UI panels
    ├── hooks/
    │   ├── use-layout-state.ts          useReducer + activeFloorIndex
    │   ├── use-three-scene.ts           Renderer / controls / RAF / drag / hover
    │   ├── use-scene-effects.ts         13 useEffects for scene rebuilds
    │   ├── use-walkthrough.ts           PointerLock + WASD movement
    │   ├── use-npcs.ts                  Animated wandering pedestrians
    │   ├── use-camera-presets.ts        Iso/top/front/corner + fit + focus
    │   ├── use-history.ts               Snapshot undo/redo
    │   ├── use-achievements.ts          Diffed unlock detection
    │   ├── use-recent-colors.ts         Persisted LRU colour palette
    │   ├── use-keyboard-shortcuts.ts    Centralised key handling
    │   └── use-layout-persistence.ts    Hydrate (share → local) + auto-save
    └── panels/                          Presentation (most use context)
        ├── lot-badge.tsx                Top-left lot name + sidebar toggle
        ├── sidebar-drawer.tsx           Full sidebar with 4-tab panel layout
        ├── sidebar-tabs.tsx             Build / Buy / Style / Manage tabs
        ├── build-tools-panel.tsx        Bottom-left glass panel (categories + mode)
        ├── catalog-strip.tsx            Bottom-centre drag-source tile row
        ├── mode-panel.tsx               Bottom-right LIVE / BUILD / BUY + stats
        ├── item-context-popover.tsx     Floating per-item editor on selection
        ├── floor-switcher.tsx
        ├── walls-panel.tsx
        ├── roof-panel.tsx
        ├── room-settings-panel.tsx
        ├── furniture-catalog-panel.tsx
        ├── placed-items-panel.tsx
        ├── item-resize-panel.tsx
        ├── align-panel.tsx
        ├── templates-panel.tsx
        ├── themes-panel.tsx
        ├── library-panel.tsx
        ├── sets-panel.tsx
        ├── statistics-panel.tsx
        ├── header-stats.tsx
        ├── time-of-day-panel.tsx
        ├── camera-presets-panel.tsx
        ├── camera-pad.tsx
        ├── floor-pill.tsx
        ├── room-shapes-panel.tsx
        ├── wall-display-pill.tsx
        ├── wall-paint-panel.tsx
        ├── actions-panel.tsx
        ├── shortcuts-panel.tsx
        ├── welcome-banner.tsx
        ├── minimap.tsx
        ├── achievements-panel.tsx
        ├── achievement-toast.tsx
        └── viewport.tsx
```

## Design notes

- **Building, not room.** `RoomLayout` owns `floors[]`, `roof?`, and the
  building footprint; `FloorLayout` owns items, floor colour, and per-wall
  colours. All item-scoped operations implicitly target the active floor
  via the reducer's `withActiveFloor` helper.
- **Snapshot-based undo/redo** works at the layout level, so floor adds,
  alignments, theme application, and individual moves are all reversible
  without bespoke code per action.
- **Schema migrations** are non-destructive. `parseStoredLayout` accepts
  both the current multi-floor shape and the legacy single-floor shape,
  upgrading the latter into a one-floor building. Used everywhere
  external data crosses the boundary (localStorage hydrate, JSON import,
  library load, share URL decode).
- **Three.js init / teardown is encapsulated.** `useThreeScene` owns the
  renderer, camera, controls, animation loop, resize listener, drag,
  hover, and the parameterised drag-plane Y. It always returns a
  cleanup, cancels the RAF, and turns on `preserveDrawingBuffer` so PNG
  and GLB exports work. Scene rebuilds live in `useSceneEffects`.
- **Context over props.** `RoomEditorContext` and `SelectionContext`
  distribute state to panels — ~90 drilled props eliminated. Props are
  reserved for one-off callbacks with side effects (scene-ref closures,
  selection clearing).
- **Pure helpers** wherever possible. Snap-to-wall, snap-to-neighbours,
  collisions, bounds, alignment, distribution, achievements predicates,
  theme application, and share-URL codec are all React-free pure
  functions — easy to test, easy to reason about.

## Original bug fixes still in effect

1. Auto-save actually wires live state into `localStorage` (debounced).
2. `requestAnimationFrame` is cancelled on unmount — no orphan loop.
3. `snapToGrid` no longer tears down the scene on toggle.
4. Init effect always returns a cleanup, even on partial failure.
5. Canvas snapshotted at the top of the init effect.
6. No `window.THREE` / `window.OrbitControls` globals.
7. `importLayout` structurally validates JSON before applying it.
8. Floor-plan fit-mode select is exposed in the UI.
9. `URL.revokeObjectURL` after JSON / GLB / PNG / CSV download.

## Known limitations

- Collision still uses bounding-circle approximation.
- A large floor-plan image stored as base64 can exhaust the ~5 MB
  `localStorage` quota; the save call catches and warns instead of crashing.
- Walkthrough requires a click on the canvas to engage pointer lock.
- The bottom glass panels can overlap on viewports narrower than ~1100 px;
  there is no dedicated mobile layout.
- No "rooms from enclosed walls" detection — interior walls are just
  drawn segments, not space-bounding entities.

## License

[MIT](LICENSE)
