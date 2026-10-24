# Three.js Sims-like House Builder

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://ch-bas.github.io/threejs-sims-house-builder/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](tsconfig.json)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org)
 
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

Type-check and test:

```bash
npm run typecheck
npm run test         # Vitest unit suite (reducer, geometry, schema, share, …)
```

## Feature tour

### Building

- **69 furniture items** across 12 categories (Seating, Tables, Bedroom,
  Storage, Kitchen, Bathroom, Electronics, Security, Decor, Outdoor,
  People, Structure).
- **Multi-floor buildings** up to 4 levels — ground floor + up to three
  upper floors, with a FloorSwitcher to select, add, remove, rename
  (double-click), reorder, and **clone** the active floor. Each floor
  has its own items and finishes; per-floor stats break down cost and
  count in the sidebar.
- **Per-storey heights**: each floor has its own floor-to-floor height
  (1–6 m) in Room Settings — a 2.5 m basement, a 1.1 m loft knee wall —
  and everything stacks on it: walls, furniture, lamps, the roof,
  dragging, walkthrough and the camera.
- **Stairs** as a furniture type that bridges one floor to the next
  (14 steps, stringers, slanted handrails), climbing exactly to the
  storey above. **Winder Stairs** turn a half-turn dog-leg (up flight,
  winder fan, return flight) with a Straight/Winder switch and an
  up-flight lead-in. Stairwells are cut only where a tread comes within
  2.0 m headroom of the floor above — an L over a winder's turn.
- **Roof** on top of the highest floor: Flat, Gable, or Hipped, with a
  per-roof colour picker, and **dormers** on gable and hipped slopes —
  ribbon windows, casement pairs, or French doors with side lights and
  an optional Juliet balcony, each with frames, mullions, transoms,
  glass and a colour finish.
- **Real streets** (Site panel): a **sloped site** with street and
  garden ground levels (the road, paths and planting follow the slope
  and the lot is dug out around the house), **party-wall neighbours**
  either side built to your eaves, **pavement frontage** right up to
  the front wall, and a **recessed entrance** porch with steps up from
  the street and an ordinary door across its back.
- **A street of neighbours** (Site panel): switch on *Street* for a
  row of houses running along both sides, and *Across the road* for a
  facing row — each one its own width, storeys, roof, brick or render
  finish, windows, door, chimney, bay or dormer, standing on the ground
  under it on a sloped site. The street is seeded, so a design always
  shows the same one (through reloads and share links); *Shuffle
  street* re-rolls it.
- **Categorised catalog** with search, filter chips, and price tags ($).
- **A budget that pushes back**: purchases that would exceed the
  $25,000 budget ask for confirmation, Surprise-me spends only what the
  building has left, and the stats panels track your furniture value
  against the cap.
- **Security cameras with vision cones**: wall-mounted CCTV that mimics
  real-world camera models (`lib/cctv-models`), flush or bracket
  mounting, and a Desperados-style directional vision cone with
  configurable range and FOV — rendered as a coverage overlay alongside
  Wi-Fi signal rings in 3D, in the 2D plan view, and on the printed
  blueprint. The cone **detects objects**: furniture or NPCs
  inside the field of view flip it from cyan to alert red, the wedge
  pulses faster, and the sweeping scan line flares as it passes over the
  target. The overlay renders depth-test-free so walls and furniture
  never occlude it.
- **Placement ghost**: click or tap a catalog tile and a see-through copy
  follows the pointer (or your finger) in 3D and on the 2D plan, snapped
  like a drag and red where it would collide; click or tap to place it,
  Shift+click to place another, R to turn it, Esc or Cancel to put it
  down. Doors and windows ride the nearest wall.
- **Drag-from-catalog placement**: drag an item directly onto the 3D
  viewport to drop it where you release. Items **auto-lock** on placement
  and re-lock after every drag, so finished furniture can't be moved,
  rotated, or resized by accident; unlock from the item editor to edit it.
- **Outdoor items stay outdoors**: trees, fences, pools, BBQs, and other
  garden items flag a collision when any part of their footprint pokes
  into the building, and catalog drops default to just outside the south
  wall.
- **3D mesh builders** for every type — beds, sofas (standard/L/U-shape),
  fridges, stoves, sinks, toilets, bathtubs, showers, trees, fences,
  pools, stairs, pets, and more.
- **Animated people**: placed people and optional walkers ("Show walkers")
  are a rigged mannequin with motion-captured idle, talking and walk clips.
  The model (~420 KB) loads only once a layout has people in it; until then,
  or if it can't load, a procedural jointed figure stands in. Walkers
  route around furniture, partitions, the stairs and stairwells, go
  through doors, and stop to face the sofa or bookcase they came to see.
- **7 room templates**: Bedroom, Living Room, Home Office, Kitchen,
  Bathroom, Studio Apartment, plus a populated multi-floor **Two-Story Home**.
- **5 theme presets** (Modern, Rustic, Minimalist, Cozy, Tropical) that
  recolour walls, floor, and furniture by category across every floor.
- **5 furniture sets** that drop a curated combo (Dining, Bedroom,
  Home Office, Kitchen Line, Lounge) on the free spot nearest the room
  centre, clear of what's already there. Sets the room can't hold are
  greyed out with a "Room too small" hint.
- **Custom sets**: select an arrangement and **Save as set** on the
  selection chip to keep it — colours, sizes and groups included — beside
  the built-ins, ready to place in any layout (delete from the Sets panel).

### Editing

- **Drag** in 3D to reposition; arrow keys fine-tune (Shift = 1 m).
- **Multi-select** with Ctrl/⌘+click — bulk delete, **group-drag** (move
  the whole selection by the same delta), **group rotate** (R / Shift+R
  rotates every selected item), plus **Align**
  (left/centre/right/top/centre/bottom) and **Distribute** (X/Z) for 3+
  items.
- **Groups**: **Group** a multi-selection from the selection chip and it
  stays together — clicking any member selects the whole group in 3D and
  2D (Alt+click picks one member); **Ungroup** frees it. Locked members
  stay put during a group move, as in any multi-select.
- **Copy / paste** (Ctrl+C / Ctrl+V): copy any selection and paste it
  beside the original — or switch floors first to move a furnished
  corner upstairs. Pastes arrive unlocked, selected, and undo as one
  step.
- **Per-item editor**: dimension sliders, **precise X/Z numeric inputs**,
  rotation in degrees, mirror, lock, "Centre in room" shortcut, colour
  picker (with a persisted "Recent" strip) + 🎲 randomise.
  The floating item popover carries the type-specific controls too:
  Straight/Winder and the lead-in for stairs, the sill height for windows.
- **Bulk lock / unlock all** on the active floor.
- **Collision visibility**: colliding items get a red row + ⚠️ badge in
  the placed-items list, and a counter shows up in stats.
- **Snap-to-grid**, **snap-to-wall**, and **snap-to-items** toggles —
  stackable, rotation-aware.
- **Auto-organize** with three strategies: packed, by category, by size.
- **Surprise me** replaces the floor's furniture with a room-appropriate
  set + random decor, keeping the structure (doors, windows, cameras,
  stairs) and the garden, and fitting around them, the porch and the
  partitions.
- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y) — snapshot-based,
  debounced, 50-entry stack. Loading a template or a saved layout is one
  Ctrl+Z away from the design it replaced.

### Walls, floor & roof

- **Per-wall colours** (N/S/E/W) plus per-floor floor colour.
- **Floor patterns**: Solid, Wood Planks, Tile, Carpet, Concrete.
- **Wall patterns**: Solid, Brick, Wallpaper, Wood Panel, Plaster, Siding.
- All patterns are rendered procedurally to CanvasTextures — no asset
  files.
- **Floor plan image** upload (per building) with opacity, fit-mode
  (stretch/cover/contain), and optional 3D displacement.
- **Roof** picker (None / Flat / Gable / Hipped) with a colour.
- **Doors and windows** that cut openings in the nearest wall when
  dropped — both exterior and interior walls support the cutouts. Each
  window can set its own **sill height**.
- **Interior walls**: a chained draw-mode (click successive floor points
  to lay a polyline of thin wall segments) with **vertex snapping**
  (existing endpoints), **right-angle snapping** (perpendicular to the
  previous segment), and a live preview of the next segment. Doors and
  windows near an interior wall cut through it via ExtrudeGeometry with
  holes.
- **Click-to-select walls** in any mode: clicking a wall in 3D outlines
  it and auto-opens the Paint panel targeting it — exterior walls paint
  per-side, and a selected interior wall takes the colour itself. **Delete** removes a
  selected interior wall permanently, or toggles an exterior wall hidden
  (open side). The panel's **Wall Visibility** row (N/E/S/W) shows hidden
  walls crossed out and restores them with a click; hidden walls persist
  per floor.

### View

- **3D / 2D top-down** toggle.
- **Walkthrough mode**: first-person WASD camera at eye height
  (PointerLockControls + Shift sprint); slides around furniture and
  interior walls, passing through doorways. You start just inside the
  entrance door, looking in; climb the stairs (the floor switches at the
  landing), step out of an exterior door onto the lot and round the
  street, change floor with PgUp/PgDn (landing at the stairs) and the time
  of day with `[`/`]`. `E` sits on the chair, sofa or bed in reach, facing
  the TV. On a touch screen a drag looks around and a thumb stick walks.
- **Camera presets**: Iso, Top-down, Front, Corner, plus **Fit-to-room**.
- **Show all floors** toggle stacks every level at once with ghosted
  lower floors.
- **Sun-arc time-of-day** (continuous 0–24) drives ambient and sun
  colour, intensity, and position; walls, roof, and furniture all cast
  sun shadows. Lamps light up at night. Dawn / Noon /
  Dusk / Midnight presets plus a ▶ button advances time in real-time.
- **Gradient sky** — a vertical zenith-to-horizon gradient backdrop that
  follows the time of day: deep blue over pale at noon, lavender over
  warm orange at dawn/dusk, near-black over navy at night — with a
  starfield that fades in as night deepens and a moon that rises after
  dusk, crests at midnight, and sets before dawn.
- **Weather** (Clear / Rain / Snow, in the Time of Day panel): a field of
  thousands of streaks or drifting flakes falls over the whole lot but
  never indoors, and the sky overcasts to match — rain dims the sun and
  ambient and wets the grass darker, snow softens the sun and whites the
  ground. View-only: it's never saved into a layout or a share link.
- **Outdoor garden mode**: grass, stone path ring, scattered bushes.
- **Top-down minimap** overlay (active floor).
- **Hover tooltips** showing item icon, name, price ($), and dimensions.
- **View menu** (the eye button in the bottom-right panel): switches for
  the distance tool, item labels, the cost heatmap and outdoor scenery, and
  for snapping dragged items to walls or to neighbouring items.
- **3D distance tool**: pick two floor points to see the distance.
- **Catalog search highlights matching placed items** with an amber
  outline in the active floor.
- **Floating item labels**: a name sprite above each piece in 3D.
- **Cost-density heatmap** in the 2D view, with a min/max gradient legend.
- **Interactive 2D plan**: select, multi-select, and drag items on the
  top-down plan with the same snapping and settling as 3D; catalog items
  drop straight onto it.
- **Room zones**: drag named, coloured rectangles ("Bedroom", "Kitchen")
  onto the 2D plan from the Build tab's Zones panel; they tint the plan,
  the printed blueprint and the SVG export, and the Statistics panel
  reports each zone's item count, cost and area.
- **Walking people**: rigged, animated mannequins (CC0 Quaternius rig)
  that wander the active floor, pause to idle or chat at waypoints, and
  crossfade between clips — with a procedural jointed figure as the
  loading/offline fallback.
- **Collapsible sidebar** for full-viewport editing.
- **Responsive HUD**: explicit desktop, tablet and phone layouts. On a
  phone the HUD docks as a slim bottom bar — labelled build-tool chips, one
  scrolling row of named catalog tiles, and a one-row mode bar with Undo,
  Redo and a ⋯ tray for the other actions and the 2D/3D switch — under a
  single row of top pills, with touch camera buttons (Orbit, Pan, In, Out,
  Fit) down the left edge. Controls are at least 40 px and labels at least
  10 px; the safe-area insets keep it clear of a notch.
- **Walkthrough HUD**: before the pointer is locked it says to click and
  that a second Esc leaves; once locked, the walking keys; a sit prompt
  under the reticle; the floor and the clock at the top. Leaving returns
  to the mode EXPLORE was entered from.
- **Multi-select badge** floating at the top of the viewport when more
  than one item is selected.
- **Optional Web-Audio sound cues** for placement, removal, rotation,
  and achievement unlocks. The cues play in the shared action helpers
  (`placeDiscrete`, `removeItem` / `removeSelected`, `duplicateSelected`,
  `rotateItemHandler`), so every entry point (tile click, drag-drop,
  keyboard, shortcut, popover, multi-selection) sounds the same (#460).
  A refused action (a locked rotate, an add or copy on a full floor) plays
  the `refused` cue instead of the success one.

### UI / chrome

- **Floating glass panels** overlaid on the viewport: `BuildToolsPanel`
  (bottom-left, category picker + wall-draw toggle), `CatalogStrip`
  (bottom-centre, drag-source tile row), `ModePanel` (bottom-right,
  EXPLORE / DESIGN / FURNISH mode and stats).
- **Three real modes**: **DESIGN** shows the structure tools (walls,
  doors/windows/stairs) and opens the sidebar's Build tab; **FURNISH**
  shows the furniture categories and opens the Buy tab; **EXPLORE** is
  the first-person walkthrough with the build HUD hidden. Switching mode
  is how you reach the other half of the tools; a tab you pick afterwards
  stays until the next mode change.
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
- **Saved-layouts library**: name, save, list, load (undoable), delete;
  entry stores item and floor counts. Library, paste-board and History
  rows carry a small top-down **plan thumbnail**, drawn on demand by the
  2D renderer as each row scrolls into view — nothing is stored.
- **Share-URL paste-board**: paste a share link a friend sent to keep
  their house in a local gallery (name, floors, cost, thumbnail) instead
  of replacing your own; load any of them (undoable) or remove them. Bad
  or truncated links get an inline message.
- **Export / import layout** as JSON (with structural validation).
- **Inventory CSV**: one row per item with floor, size, price, position,
  rotation, mirrored and locked state and zone, plus a grouped **schedule
  CSV** with quantities and totals. Both carry a UTF-8 BOM for Excel.
- **PNG screenshot** of the current viewport, 3D or the 2D plan.
- **GLB / glTF export** of the whole building — every storey, the roof and
  dormers, every wall, named nodes — whatever the view shows. Opens in any
  viewer.
- **Plan export**: scalable SVG and CAD-ready layered DXF (dimensions, a
  north arrow and the Wi-Fi/CCTV coverage layer included; the SVG lists the
  floor's items in a schedule under the plan). A house with more than one
  floor also gets whole-building downloads: every floor stacked down one
  SVG, or side by side in one DXF. The print-to-scale PDF has a title
  block. Its options choose the paper (A4,
  A3, Letter), the orientation and the scale (1:20–1:1000, or the largest
  that fits), whether items outside the walls are drawn, whether each page
  lists its items, and whether every
  floor prints, one per page at one shared scale. The sheet follows the
  content, so garden items outside the walls are on the plan too, in the
  raster blueprint as well.
- **Version history**: automatic restore points every few minutes of
  editing, on page close, and before anything replaces the whole house
  (share link, template, saved layout, import). Restorable — and
  undoable — from the library's History section, which names the house
  each one belongs to, and says what each one changed (items and floors
  added or removed) relative to the one before. Restore points give way
  to saves when browser storage runs short.

### Game-y

- **15 achievements** ("First Steps", "Furnished", "Overstuffed",
  "Big Spender", "WiFi Everywhere", "Sky High", "Penthouse", "Going Up",
  "Roof It", "Green Thumb", "Door Installer", "Window Watcher",
  "Wall Whisperer", "Decorator", "Open Plan") with toast pop-ups when
  unlocked and a sidebar gallery panel showing locked / unlocked progress.
  They are earned by building: the house a session opens on (saved or
  shared), a template, library house, import, restore point, cross-tab
  adopt or undo/redo unlocks nothing (#450). An edit earns a goal it made
  true, or a count goal (items, access points, doors, floors, …) whose
  count it raised, so a goal that came with a loaded house is earned by
  doing it again. Toasts play one at a time, each with its own timer:
  bottom-right just above the mode panel on desktop, stepping left of the
  item popover when it reaches down that far, and above the drawer's
  scrim (#461).
- **Hard budget** (the switch under the funds in the mode panel, off by
  default): catalogue tiles that cost more than what's left grey out (on
  touch they say "Over budget"), nothing can be bought past the budget by
  any route, and Demolish sells back at 80 %. A refused copy, paste or set
  says why in a toast. The mode panel shows the funds left — on a phone
  they stay on the docked bar — and each purchase or sale floats past them.

### Stats

- **Header chip strip**: items / floors / room dimensions / cost-vs-budget.
- **Statistics panel**: items, floors, floor area, total area, footprint
  coverage % (what stands on the floor: no outdoor items, doors, windows,
  cameras or hung decor, and a tabletop item on a surface counts once,
  #462), cost vs. budget, breakdown by category.

### Welcome

- **First-run welcome banner** with quick-start tips — touch tips on a
  touch device; the tips scroll and the button stays in view on a short
  screen.

## Keyboard shortcuts

| Action            | Key                |
| ----------------- | ------------------ |
| Undo / Redo       | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y |
| Delete item / wall | Delete / Backspace |
| Duplicate         | Ctrl+D             |
| Copy / Paste      | Ctrl+C / Ctrl+V    |
| Rotate            | R (Shift+R = 15°)  |
| Move              | Arrow keys (Shift = 1 m) |
| Deselect          | Esc                |
| Place from catalog | Enter on a focused tile, then arrows / R · Enter confirm · Esc cancel |
| Place with the ghost | Click a tile, then click to place · Shift+click another · R rotate · Esc cancel |
| Focus on item     | F                  |
| Multi-select      | Ctrl/⌘+click       |
| Select one of a group | Alt+click      |
| Group-drag        | Drag any selected  |
| Switch floor      | PgUp / PgDn        |
| Time of day       | [ / ]              |
| Toggle 2D         | 2                  |
| Dimension labels  | M                  |
| Snap to grid      | G                  |
| Signals/Coverage  | W                  |
| Show / hide panels | P                 |

## Module layout

```
app/                                     Next.js entry (+ error / global-error boundaries)
components/
├── ui/                                  shadcn-style primitives
└── room-organizer/
    ├── room-organizer.tsx               Orchestrator (~850 lines)
    ├── index.ts                         Barrel export
    ├── contexts/                        React Context (eliminates prop drilling)
    │   ├── room-editor-context.tsx      Layout, actions, history, collisions, engine state
    │   ├── editor-view-context.tsx      Carries the editor view store; useViewSettings / useEditorView selectors
    │   ├── held-editor-contexts.tsx     Re-provides editor + selection frozen while hidden (the closed drawer)
    │   ├── selection-context.tsx        Selected item(s), multi-select, selectOnly()
    │   └── index.ts                    Barrel
    ├── lib/                             Pure domain code, no React/Three
    │   ├── types.ts                     RoomLayout / FloorLayout / ViewSettings / etc.
    │   ├── constants.ts                 Catalog (69 items), templates, MAX_FLOORS
    │   ├── schema.ts                    Type guards, legacy migration, caps that repair (never refuse)
    │   ├── geometry.ts                  Collision (items, keep-out, partitions), bounds, snap, auto-organize
    │   ├── floor-keep-out.ts            Per-storey keep-out: porch + stairwells cut by the floor below (#372)
    │   ├── mount-band.ts                Wall-hung decor family + an item's vertical mount band (#376)
    │   ├── furniture-scene.ts           Placed items + collision flags per rendered storey; furniture effect keys (#214); per-item build keys + diff (#404)
    │   ├── overlay-keys.ts              Label and Wi-Fi/vision-overlay effect keys: rebuild only when an overlay would change (#409)
    │   ├── alignment.ts                 Align/distribute pure functions
    │   ├── achievements.ts              15 predicate-based achievements with count progress; `achievementsEarned` (loaded / edit)
    │   ├── cctv-models.ts               Real-world CCTV model specs for cameras
    │   ├── camera-zoom.ts               Camera-pad zoom slider ↔ orbit distance (log scale) (#167)
    │   ├── scene-insets.ts              Visible canvas region beside the HUD + camera pose that fits the house in it
    │   ├── render-quality.ts            Pixel-ratio cap per device class (phones 1.5, else 2)
    │   ├── persistence.ts               Active-layout localStorage I/O, save-failure reasons, dated recovery copies (two kept)
    │   ├── library.ts                   Named-layout library I/O
    │   ├── version-history.ts           Automatic restore-point ring (coarse autosave snapshots), stable entry ids, per-house cadence by house id
    │   ├── restore-point.ts             Forced restore point before a whole-layout replacement; "untouched" = equal to INITIAL_LAYOUT
    │   ├── initial-layout.ts            INITIAL_LAYOUT / INITIAL_GROUND_FLOOR, the house every session starts from
    │   ├── share.ts                     Share-URL encode/decode (base64url); positions rounded to mm on encode
    │   ├── chunk-reload.ts              Stale-chunk detection + the one-reload-per-window guard shared with the head script
    │   ├── dev-diagnostics.ts           `?debug` flag + allocation-free renderer.info counters
    │   ├── pasteboard.ts                Gallery of houses received via share links (quota-safe)
    │   ├── blueprint.ts                 Print-friendly 2D blueprint HTML, canvas fitted to the plan content (#377)
    │   ├── catalog-drag.ts              HTML5 drag MIME + catalogue keys, tile blocked reasons
    │   ├── budget.ts                    Hard budget (#463e): spend, funds left, 80 % sell-back, purchase refusal, over-budget tile reason, schema repair
    │   ├── safe-storage.ts              localStorage get/set/remove that never throw (#396)
    │   ├── storage-errors.ts            Classifies a storage error: quota, blocked or unknown
    │   ├── themes.ts                    Theme definitions + applyTheme
    │   ├── modes.ts                     Which Build Tools each game mode shows (DESIGN / FURNISH)
    │   ├── hud-layout.ts                Phone-dock and sheet media queries, catalog page size, scroll cue, touch welcome tips
    │   ├── top-bar-slot.ts              The top bar's free strip between the lot badge and the pills, for the touch row
    │   ├── furniture-sets.ts            Pre-built combos + snapshot-backed set placement; free-spot search (#456)
    │   ├── custom-sets.ts               User-saved furniture sets: localStorage I/O + parser (#302)
    │   ├── groups.ts                    Persistent group selection helpers (#154)
    │   ├── surprise.ts                  Random one-shot floor populate around the kept structure (#448)
    │   ├── placement-ghost.ts           Placement ghost maths: footprint corners, the plan's inverse mapping (#463 d)
    │   ├── sounds.ts                    Web-Audio synth for UI cues (place, remove, rotate, success, refused)
    │   ├── wall-snap.ts                 Vertex + right-angle snap for interior walls
    │   ├── opening-snap.ts              Door/window snap + shared wall-mount settle rule
    │   ├── walk-collision.ts            Walkthrough circle-vs-OBB slide against furniture, partitions, the shell (door gaps, porch) and the street; advanceWalker over walk-world
    │   ├── npc-path.ts                  Walker (NPC) free-space grid, regions, A* + string-pulled routes, destinations (#452)
    │   ├── walk-input.ts                Walkthrough frame-time cap, which keydowns walk (no Ctrl/Cmd/Alt chords), E to interact
    │   ├── walk-world.ts                What the walker stands on: floor plates, stair treads as a ramp, porch and steps, sloped lot
    │   ├── walk-spawn.ts                Walkthrough spawn (inside the entrance door) and arrival at the stairs on a floor change
    │   ├── walk-interact.ts             Seats in reach and the seated pose (facing the TV)
    │   ├── walkthrough-view.ts          Walkthrough display: walls + roof up, ceiling above, stairwell pit below (#359); the mode to return to on exit
    │   ├── room-shapes.ts               Predefined room shape presets
    │   ├── storeys.ts                   Per-storey heights: elevations, eaves, stair rise
    │   ├── site.ts                      Sloped ground, neighbour flags, lot/road dimensions
    │   ├── street-row.ts                Seeded street generator: house specs + window rules
    │   ├── sun-shadow.ts                Shadow-caster box + sun shadow-camera fit (#282)
    │   ├── night-lights.ts              Which items light the night, bulb heights, candela; the lamp pool (#215, #393)
    │   ├── street.ts                    Window sills, recessed entrance, frontage
    │   ├── dormers.ts                   Dormer slope fitting + opening layout
    │   ├── stairs.ts                    Tread layout (straight / winder), headroom stairwells, plan symbol
    │   ├── zones.ts                     Room zones: rect validation / clamping, per-zone stats
    │   ├── view-options.ts              View-menu switches and the view each one needs (#341); view invariants (zone drawing is 2D only, #439)
    │   ├── plan-view-fit.ts             What the on-screen plan and minimap fit (room + outdoor items, far ones as edge markers) and where beside the desktop HUD (#381)
    │   ├── editor-notices.ts            notify() status messages + zone-name requests (#374)
    │   ├── overlay-queue.ts             Small-screen overlay policy: compact queries, toast queue, stack placement
    │   ├── plan-order.ts                2D layer order: rugs → floor → tabletop → hung → wall (#286)
    │   ├── floor-plan-fit.ts            Floor-plan image placement per fit mode, shared by the 2D plan and the 3D floor canvas (#191)
    │   ├── file-io.ts                   JSON / image / PNG / CSV + schedule / GLB I/O
    │   └── plan-export/                 2D-plan exporters (#230)
    │       ├── plan-geometry.ts         Shared plan-space maths (corners, grid, openings, stairs, coverage, dimensions, schedule, bounds)
    │       ├── svg.ts                   Vector SVG plan emitter, one floor or the whole building (pure)
    │       ├── dxf.ts                   AutoCAD 2000 DXF plan emitter, one floor or the whole building (pure)
    │       ├── download.ts              Blob download + the one filename rule, exportFileName (DOM)
    │       └── print.ts                 Print-to-scale document: paper, orientation, scale, outdoor and all-floors options (#435, #405); popup → Save-as-PDF
    ├── three/                           Three.js builders, no React
    │   ├── furniture-builders.ts        Registry + factory (~110 lines)
    │   ├── builder-utils.ts             Shared types + mesh()/material() helpers, dispose helpers (disposeScene on unmount, #213)
    │   ├── three-runtime.ts             The named three.js symbols the app uses; the engine's only runtime import (#411)
    │   ├── collision-tint.ts            See-through tint over every part of a colliding item (#167)
    │   ├── placement-ghost.ts           The placement ghost's faded mesh + footprint pad (#463 d)
    │   ├── drag-handlers.ts             Canvas mouse events: select/drag/hover/wall-pick
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
    │   │   ├── builders-people.ts       Person (rigged, else procedural), pet
    │   │   ├── human-figure.ts          Procedural jointed figure + walk pose
    │   │   └── builders-structure.ts    Door, window, stairs
    │   ├── people-model.ts              people.glb loader, cloning (shared geometry), box picking, clip names
    │   ├── room-builder.ts              Floor + walls (yOffset, ghosting)
    │   ├── building-export.ts           The whole building as a named graph, for the GLB export
    │   ├── wall-openings.ts             Door / window → exterior wall cutouts
    │   ├── interior-walls.ts            Drawn-segment interior walls with cutouts
    │   ├── measurement.ts               Distance-tool spheres + line
    │   ├── item-labels.ts               Floating sprite labels above items
    │   ├── roof.ts                      Flat / gable / hipped roof
    │   ├── ceiling.ts                   Walkthrough ceiling + stairwell shafts up and down (#359)
    │   ├── dormers.ts                   Dormer boxes, joinery, Juliet rails
    │   ├── neighbours.ts                The street's houses from their specs (merged + instanced)
    │   ├── terrain.ts                   Sloped ground + excavation faces
    │   ├── entrance.ts                  Recessed porch reveals, soffit, steps
    │   ├── baseboard.ts                 Skirting profile + door-gap runs
    │   ├── floor-patterns.ts            Procedural CanvasTexture floors
    │   ├── wall-patterns.ts             Procedural CanvasTexture walls
    │   ├── texture-lru.ts               LRU cache for texture masters (evict + dispose)
    │   ├── signal-overlay.ts            Wi-Fi / CCTV ring overlays
    │   ├── camera-vision.ts             Directional CCTV vision-cone overlays
    │   ├── lighting.ts                  Sun-arc continuous time of day (+ weather overcast)
    │   ├── weather.ts                   Rain / snow particle field (one InstancedMesh)
    │   └── outdoor.ts                   Garden / path / bush scenery; perimeter trees merged per part
    ├── canvas-2d/render.ts              Pure 2D top-down renderer
    ├── canvas-2d/stairs-symbol.ts       Stair treads + climb arrow, stairwell voids on the floor above
    ├── plotcraft/icon.tsx                PlotCraft SVG icon set for UI panels (no icon library)
    ├── hooks/
    │   ├── layout-reducer.ts            Action union + reducer (withActiveFloor)
    │   ├── use-layout-store.ts          Zustand store (reuses the reducer) + selectors
    │   ├── editor-view-store.ts         Per-editor Zustand store: view settings, catalog search, game mode, time auto-cycle
    │   ├── use-layout-state.ts          Adapter over the store (activeFloor, actions)
    │   ├── use-three-scene.ts           Renderer / controls / RAF lifecycle
    │   ├── use-scene-effects.ts         Keyed scene-rebuild effects
    │   ├── use-item-drag.ts             Drag fast-path + camera wall-seat on drop
    │   ├── use-floor-keep-out.ts        Porch + stairwell keep-out for collisions, memoised (#285, #372)
    │   ├── use-canvas-2d-interaction.ts 2D plan select/drag + zone-draw via the renderer's inverse transform
    │   ├── use-item-placement.ts        Snapping + wall-aware catalog placement
    │   ├── use-import-export.ts         Screenshot / GLB / share link / JSON import
    │   ├── use-walkthrough.ts           Walkthrough: PointerLock + WASD, touch look + stick, stairs, doors, sitting, floor changes
    │   ├── use-npcs.ts                  Animated walkers: spawn, route-following step, re-route on floor edits
    │   ├── use-weather.ts               Self-invalidating rain / snow loop
    │   ├── use-camera-presets.ts        Iso/top/front/corner + fit + focus; frames the house on compact screens
    │   ├── scene-occluders.ts           Reads the HUD occluder rects: the 3D free region, the 2D plan insets and padding, the plan-gesture flag
    │   ├── use-camera-vision.ts         Vision-cone sweep animation loop
    │   ├── use-history.ts               Snapshot undo/redo
    │   ├── use-achievements.ts          Unlock detection; `markLayoutLoaded()` after a whole-house load (#450)
    │   ├── use-recent-colors.ts         Persisted LRU colour palette
    │   ├── use-keyboard-shortcuts.ts    Centralised key handling
    │   ├── use-keyboard-placement.ts    Enter-on-tile placement session, tile click → ghost pick-up, roving tile focus
    │   ├── use-placement-ghost.ts       The ghost in hand: follows the pointer in 3D and 2D, click/tap places (#463 d)
    │   ├── use-dialog-focus.ts          Overlay focus: move in, trap, Escape, restore
    │   ├── use-event.ts                 Stable-identity callback that runs the latest handler (memoised children)
    │   ├── use-media-query.ts           matchMedia as a hook (false on the server)
    │   ├── use-pausable-timeout.ts      Countdown that pauses and resumes with the time left (toasts)
    │   ├── use-scroll-cue.ts            data-scrollable / data-more-before / -after on a HUD scroller (#426)
    │   ├── use-edge-var.ts              Publishes an element's top or bottom edge as a CSS variable (#308); places the touch row in the top bar
    │   ├── use-sheet-inset.ts           --pc-sheet-height while the phone item sheet is open (mode bar rides above it)
    │   └── use-layout-persistence.ts    Hydrate (share → local) + auto-save + cross-tab notice; save status in its own store
    └── panels/                          Presentation (most use context)
        ├── lot-badge.tsx                Top-left lot name + sidebar toggle
        ├── sidebar-drawer.tsx           Full sidebar with 4-tab panel layout
        ├── sidebar-tabs.tsx             Build / Buy / Style / Manage tabs
        ├── build-tools-panel.tsx        Bottom-left glass panel (mode's categories + wall tool)
        ├── catalog-strip.tsx            Bottom-centre drag-source tile row
        ├── mode-panel.tsx               Bottom-right EXPLORE / DESIGN / FURNISH + stats
        ├── view-options.tsx             View menu: distance tool, labels, heatmap, outdoor, snapping
        ├── item-context-popover.tsx     Floating per-item editor on selection; a bottom sheet on small screens
        ├── color-swatch-picker.tsx      Shared swatch + recent-colours picker
        ├── slider-row.tsx               Shared label + range + readout row
        ├── floor-switcher.tsx
        ├── walls-panel.tsx
        ├── zones-panel.tsx              Room zones: list, rename, recolour, delete, draw toggle
        ├── roof-panel.tsx
        ├── site-panel.tsx               Slope, neighbours + street, frontage, entrance
        ├── room-settings-panel.tsx
        ├── furniture-catalog-panel.tsx
        ├── placed-items-panel.tsx
        ├── item-resize-panel.tsx
        ├── align-panel.tsx
        ├── templates-panel.tsx
        ├── themes-panel.tsx
        ├── library-panel.tsx
        ├── recovery-entry.tsx           History rows for kept recovery copies: restore, download, delete
        ├── sets-panel.tsx
        ├── statistics-panel.tsx
        ├── header-stats.tsx
        ├── time-of-day-panel.tsx
        ├── camera-presets-panel.tsx
        ├── camera-pad.tsx
        ├── floor-pill.tsx
        ├── room-shapes-panel.tsx
        ├── dock-fold.tsx                Fold toggle for the wall tool's panels in the phone dock
        ├── walk-hud.tsx                 Walkthrough HUD: lock-state hints, sit prompt, floor + clock; touch stick and buttons
        ├── wall-display-pill.tsx
        ├── wall-paint-panel.tsx
        ├── actions-panel.tsx
        ├── print-options.tsx            Print / PDF button and its folding options (paper, orientation, scale, outdoor, every floor)
        ├── shortcuts-panel.tsx
        ├── welcome-banner.tsx
        ├── minimap.tsx
        ├── plan-thumb.tsx
        ├── achievements-panel.tsx
        ├── achievement-toast.tsx        Unlock toasts, one at a time: above the mode panel on desktop, the toast slot on small screens
        ├── overlay-stack.tsx            Shared small-screen column under the pills: save notices, then toasts
        ├── placement-hint.tsx           Key hint chip while a keyboard placement or a ghost is pending (Cancel for touch)
        ├── status-toast.tsx             Status chips for notify() — export / share outcomes
        ├── zone-name-chip.tsx           Zone tool chip: the draw-mode status and Done (#439), then the inline name field
        ├── dev-diagnostics.tsx          `?debug` overlay: draw calls, triangles, geometries, textures, programs, frames
        ├── chip-controls.tsx            Chip buttons + inline name field (no native prompts)
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
- **Every house has an id.** Every new house is "My Home", so the name
  can't tell two apart. The store gives each layout it takes in a random
  `layout.id` when it has none (`withHouseId`), and the house keeps it
  through edits, undo, saves, exports and share links. The restore-point
  ring's 5-minute cadence and its dedupe are scoped by that id, falling back
  to the name only for points saved before ids existed. Entries are looked
  up by a stable entry `id` written once, never by `savedAt`, which may be
  clamped.
- **Framing beside the HUD on small screens.** Below 1101×701 the HUD
  covers much of the canvas, so on load and on FIT the camera fits the
  house inside the largest rectangle no `[data-scene-occluder]` panel
  covers (plus the item sheet while `<html data-sheet-open>` is set),
  computed in `lib/scene-insets.ts`. A container tagged
  `data-scene-occluder="children"` counts its visible children instead of
  its own box. The framed box is the footprint up to the eaves, plus the
  roof's rise and eave overhang whenever the roof shows (walls up, on the
  top storey or with every storey shown). Only a sliver of a free
  rectangle (under 64 px on a side) falls back to the whole canvas; a
  small but real band, such as the strip a landscape phone leaves above an
  unfolded Paint panel, frames the house small rather than under the
  panels. The one other fallback is a safety net for a mis-measured
  occluder: a footprint framed under 48 px on its long side, when the whole
  canvas would frame it at least twice as large. The orbit target stays the house centre;
  `camera.setViewOffset` shifts the projection so that centre sits in the
  middle of the free rectangle. Resizes, rotations, HUD changes and a
  change in the framed shape re-frame only while the camera still sits at
  the last framed pose; a moved camera keeps its pose and a resize only
  re-centres the shift on the new free rectangle. Nothing re-frames while
  any pointer is down (tracked by id, released on blur and lost capture).
  A window that stops being compact drops the shift at once, and the
  walkthrough drops it while it runs. Desktop-sized windows keep the
  classic poses untouched. Phones (coarse pointer, screen short side
  ≤ 500 px) also cap the pixel ratio at 1.5 instead of 2: in software-GL
  emulation of a 3× phone an orbit frame took 57 ms at 2 and 37 ms at 1.5.
  A PNG export on a phone therefore comes out at the canvas's backing size
  (585×996 on a 390×664 phone). The shadow map stays 2048²: 1024²
  measured no faster.
- **A press on an item never moves the camera.** The drag handlers take
  `pointerdown` in the capture phase, ahead of OrbitControls, and switch
  the controls off as soon as a drag is armed; a tap hands them back. On
  touch, the moves under the drag threshold used to orbit, and the damping
  glide kept turning the camera through the drag.
- **A pinch that starts on furniture zooms.** A second finger while the
  first one has armed or started an item drag cancels the drag (the item
  goes back, nothing is committed) and hands both fingers to OrbitControls:
  the first press, which the controls never saw, is replayed to them from
  where that finger is now. A later finger of a gesture the camera already
  owns (`isPrimary === false`) never selects or arms a drag. The 2D plan
  has no pinch, but a second finger there cancels the drag the same way.
- **A drag over the HUD holds the item.** In 3D and 2D a captured drag keeps
  getting moves over the panels; `pointerOnCanvas` (inside the canvas box
  and `elementFromPoint` is the canvas) gates them, so the item holds its
  last place on the floor, and a release over a panel or off the canvas
  cancels the drag: the item goes back, with no commit and no undo entry.
  It used to land behind the panel, or far off the lot near the horizon.
- **The 2D plan fits beside the HUD on compact screens.**
  `get2DViewTransform` takes optional occluder insets (`planInsets`, the
  same `[data-scene-occluder]` free rectangle the 3D framing uses) and fits the
  plan in that area, with the margin shrunk to at most 12% of its short
  side. The paint effect and the pointer handlers pass the same insets, so
  `canvasToWorld` stays the plan's only inverse. The insets freeze while
  the phone item sheet is open: the first press on an item opens it and
  hides the catalog and the build tools, and re-fitting to what is left
  would rescale the plan under the finger. The sheet itself is never an
  inset either. The minimap, the blueprint and the thumbnails pass none.
- **Print sheets fit the content, and the person picks the page.** The
  raster blueprint sizes its canvas from `planContentBounds` and paints
  through `render2DTopDown`'s `fitBounds`, the same bounds fit the on-screen
  plan uses (`get2DViewTransform`; `get2DBoundsTransform` is a thin wrapper), so a tree past the walls is
  drawn rather than cut off by the canvas edge (#377). Outdoor items may
  shrink the house to half its room-only size; past that the furthest are
  left off one at a time and listed under "Off the plan" with their
  distance, so one far tree can't turn the house into a thumbnail. The print-to-scale
  route keeps one SVG px at 0.25 mm of paper at every scale and picks the
  finest standard scale whose sheet fits the chosen paper's printable area;
  a fixed scale or orientation is honoured, and a sheet that overflows is
  shrunk in both directions and labelled not to scale (#435). Leaving
  outdoor items off drops the items whose centre is outside the walls
  (wall-mounted ones stay), so a far tree can't force 1:500. Printing every
  floor picks one scale for the union of the floors' content and puts each
  storey on its own page (#405). The opt-in item schedule is an HTML table
  under the title block, not part of the SVG, so it never changes the
  plan's scale and may run onto the next page (#424). The title block is a fixed-layout table whose cells wrap
  anywhere: a long unbroken name would otherwise widen the table past the
  page and the browser would shrink the whole sheet off its scale.
- **The plan fits the whole lot, clear of the desktop HUD (#381).** The
  on-screen plan and the minimap fit `planViewFit` (`lib/plan-view-fit.ts`):
  the room plus every placed item's footprint, the sheet the vector exports
  use, with overhangs under 5 cm snapped back to the walls. A tree a few
  metres from the house is on the plan and can be clicked; an indoor-only
  plan fits exactly as before. Like the blueprint, the house stays at least
  half its room-only size: the outdoor items may widen the fit to twice the
  room on each axis, and on an axis that overflows the items sticking out
  furthest along it (`distanceOutsideWalls` decides what is outside) are
  left out and drawn as edge markers, an icon, the distance and an arrow
  towards the item. Markers on the same bearing fan apart along the edge,
  so each one can be pressed; a press selects the item, whose popover's
  Centre brings it back; Placed Items lists it too. `get2DViewTransform`
  still maps the room's corner, so only its offsets move. On a desktop
  window the plan keeps the classic whole-canvas fit, pixel for pixel, until
  a HUD panel would cover it; then it fits the free rectangle
  (`[data-scene-occluder]` panels plus the header stats, tagged
  `data-plan-occluder` because the 3D framing never needed to clear them;
  not the zone tool's chip, which only grazes the band above the plan) that
  draws it biggest for its shape. Its 20 px margin sits
  under a panel on the right and bottom (a 4 px gap stays), and only the top
  and left keep it, for the room dimensions; a region up to 10% smaller wins
  when it is markedly more central, so a side column can't park the house in
  a corner. Nothing on the plan sits under the catalog strip, the mode panel
  or the header stats, which costs a desktop plan about a quarter to a third
  of its old size on 768–900 px tall windows. The fit is measured once per press and frozen while the
  gesture lasts (`<html data-plan-gesture>`), so dragging an item past the
  walls never rescales the plan under the pointer; the committed drop
  refits it. A panel that moves without resizing (the left column when the
  drawer folds) fires no ResizeObserver, so the observer also re-measures
  after any CSS transition or animation ends, and on the frame after a
  relevant DOM mutation. The library thumbnails still fit the room alone.
- **A plan drag never selects page text (#442).** While a press on the
  plan is armed (an item or a zone), `<html data-plan-gesture>` turns
  `user-select` off page-wide (`app/globals.css`, "2D plan"), so dragging
  across the HUD no longer highlights its labels.
- **3D-only controls say so in 2D (#444).** The wall display pill, both
  floor "All" toggles, and the minimap, walkers and camera-cone buttons are
  disabled on the plan with a "— switch back to 3D view" title, like the
  time controls (#220). Zone drawing is the reverse: the editor's view store
  applies `withViewInvariants` on every change, so leaving the plan by any
  route ends the draw mode, a chip on the plan says it is on (with Done for
  touch), and Escape leaves it like the wall and distance tools (#439).
  Zone names are left off when wider than their zone, and on the minimap
  and thumbnails (`thumbnail`) also below 25 px per metre (#433). A lost
  window or pointer capture mid-drag undoes the drag and clears the
  gesture flag.
- **Schema migrations** are non-destructive. `parseStoredLayout` accepts
  both the current multi-floor shape and the legacy single-floor shape,
  upgrading the latter into a one-floor building. Used everywhere
  external data crosses the boundary (localStorage hydrate, JSON import,
  library load, share URL decode). A stored blob that exists but fails to
  load is copied to a dated `-recovery-<savedAt>-<random>` key before the
  fallback layout's autosave can overwrite it, so validation failures
  never destroy a save. The copy outranks restore points (they yield
  first); when it still can't be written, autosave stays suspended so
  the unreadable save is never overwritten. Untouched houses are never
  kept, and copies are deduplicated by content without the id.
- **Three.js init / teardown is encapsulated.** `useThreeScene` owns the
  renderer, camera, controls, animation loop, resize listener, drag,
  hover, and the parameterised drag-plane Y. It always returns a
  cleanup and cancels the RAF. PNG capture renders a fresh frame
  synchronously before reading the canvas, so `preserveDrawingBuffer`
  stays off and the renderer keeps its buffer optimisations. Scene rebuilds live in `useSceneEffects`.
- **Show or hide before you rebuild.** The roof is built while it is on
  screen and kept, hidden, below the top storey (`setRoofOnStorey`, which
  `applyWallDisplay` honours), so a floor switch flips visibility instead of
  rebuilding every dormer; a roof edit made down there rebuilds it on the way
  back up. Labels and the Wi-Fi/vision overlays key on `lib/overlay-keys.ts`,
  not on every item edit, and the wall-draw preview re-poses one unit box per
  pointer move (#283, #409).
- **Filmic rendering pipeline.** ACES tone mapping, explicit sRGB output,
  device-pixel-ratio-aware rendering (capped at 2×), PCF shadows softened
  by the sun's `shadow.radius`, and
  image-based lighting from a PMREM-filtered `RoomEnvironment`. The
  environment, hemisphere, and ambient intensities are driven by the
  time-of-day system and fade through twilight, so nights stay dark. The
  sun's shadow camera is fitted to a box around every shadow caster (house,
  roof, trees, the street). Lamps share a fixed pool of eight point
  lights, given to the lamps on the drawn storeys nearest the viewer (the
  orbit target, or the walker); the pool is drawn only while a lamp is lit,
  so days carry no point lights at all, and its shaders are compiled in the
  hours before dusk, so stepping through dusk and editing lamps don't
  recompile them (a direct jump from day to night compiles once). Procedural CanvasTextures get max anisotropy + sRGB tagging so
  floors and walls don't shimmer at grazing angles in walkthrough mode.
- **Loading.** Nothing is fetched from a third party at runtime: Sora and
  Nunito come from `next/font` (downloaded at build time, served from
  `_next/static/media` with preload links). The page starts the Three.js
  chunks together with the editor chunk rather than after it, so first load
  is two hops, not three; `prefetchEngine` imports exactly the modules
  `use-three-scene` does, so the two share one request per chunk. The UI's dropdowns are native `<select>`s
  (`components/ui/select.tsx`), with no popper or icon library in the
  editor bundle. A chunk that 404s or hangs (stale HTML after a deploy)
  gets one automatic reload per ten minutes from a sessionStorage stamp
  that the head script and `lib/chunk-reload.ts` share; a success never
  re-arms it, so a chunk that keeps failing ends on "Couldn't load the
  app" with a Retry button instead of reloading forever (#499). The head
  watchdog's ready signal comes from the engine import, not the editor
  chunk.
- **Diagnostics.** `?debug` on the URL shows the renderer's counters
  (draw calls, triangles, live geometries, textures, programs, frames
  rendered). It updates from the scene's `onAfterRender`, so it has no loop
  of its own and an idle editor's frame count stands still; without the
  flag nothing is installed.
- **Three.js is imported by name.** Nothing imports the `'three'` namespace
  at runtime: the engine loads `three/three-runtime.ts`, which re-exports
  only the symbols the app uses, and every builder takes that module as its
  `THREE` parameter (`typeof import('…/three-runtime')`). webpack then drops
  the rest of three.js (audio, VR, most loaders and geometries), which cut
  the three.js chunks by about 109 KB raw / 28 KB gz (#411). To use a new
  symbol, add it to the sorted list in `three-runtime.ts`; typecheck reports
  a missing one. Type-only references (`import type * as ThreeNS`,
  `import('three').Foo`) stay on `'three'`, since they cost nothing. The
  addons (OrbitControls, GLTFLoader, GLTFExporter, …) import their own
  symbols by name, so they keep only what they use.
- **Render-on-demand.** The animation loop only renders when OrbitControls
  report movement or something marks the scene dirty (`invalidate()` is
  threaded through the scene-effect, walkthrough, NPC, and camera-preset
  hooks). During walkthrough the loop skips `OrbitControls.update()`
  entirely — the update has no `enabled` guard and would fight the
  pointer-lock camera — and the walkthrough hook invalidates its own
  frames. An idle editor draws zero frames. The shadow map (`autoUpdate`
  off) and the NPC loop only refresh when a caster actually moves, and the
  WebGL context is restored automatically if the GPU drops it. The weather
  loop is the same shape: it runs only while rain or snow is on, and its
  particles never cast shadows, so the static shadow map stays static.
- **Instanced outdoor scenery.** The suburban lot's high-count scatter
  (grass tufts, shrubs, flowers, road dashes, stepping stones) renders
  through `InstancedMesh` — hundreds of elements collapse to a handful of
  draw calls — and static meshes bake their matrix once (`matrixAutoUpdate`
  off). The 14 perimeter trees are baked into world space and merged into
  one mesh per kind, part and shade (13 meshes, not ~134), which keeps each
  tree's seeded leaf jitter that instancing would lose (#407).
- **Rigged people are cheap to rebuild and to hover.** Every clone draws the
  cached people.glb geometry (`markSharedGeometry`, a WeakSet that
  `disposeObject` skips; not userData, which GLB export would write) with
  its own skeleton and materials, so a furniture rebuild doesn't re-upload
  7.8k skinned vertices per person; the editor's unmount frees it with
  `releasePeopleGeometry`. A placed person is picked by its item box
  instead of CPU-skinned triangles (#284).
  Idle walkers repaint every frame for their breathing but recompute the
  shadow map only while moving, plus the 0.35 s settle after a stop (#400).
- **Walkers path on a grid, not by steering (#452).** `lib/npc-path.ts`
  rasterises the active storey into 0.2 m cells a walker (radius 0.22 m)
  can stand in: the walkthrough's colliders (furniture, partitions with
  their door gaps) block, and so do the stairs and the storey's keep-out
  (porch, stairwell holes), each collider marking only the cells in its
  reach, so a 150-item floor builds in well under a millisecond. Cells are
  flood-filled into regions, so a walker only targets somewhere it can
  reach; A* (8-connected, no corner cutting) and a line-of-sight
  string-pull give a few straight legs, and every step still runs through
  `resolveWalkerStep`. Destinations favour free cells beside furniture,
  which carry the heading that faces it, and skip spots another walker
  has claimed. The nav is keyed on `npcNavSignature`, the item, partition
  and keep-out geometry it reads, because the arrays themselves get a new
  identity on a recolour or a lock; it is built only while walkers are
  shown. A geometry edit re-routes the walkers in place and steps any it
  landed on to the nearest free cell, without a respawn. Routes live in
  per-walker typed arrays of 32 waypoints; a longer route is continued
  from its last waypoint toward the destination it set out for. The
  search reuses the nav's scratch, so the frame loop allocates nothing.
- **The GLB is the building, not the view.** The live scene holds only what
  the view shows: the active storey, the walls the cutaway left up, the
  roof in "Up" mode, ghosts in "All floors". `buildExportBuilding`
  (`three/building-export.ts`) builds every storey, interior wall, item and
  the roof from the layout with the scene's own builders, solid and
  untinted, into a throwaway graph that is exported and then disposed; the
  live scene is never touched. Nodes are named after the house, the floor,
  the item or the part (`Wall north`, `Dormer d1`) (#373).
- **One filename rule.** Every download — JSON, CSV, PNG, GLB, SVG, DXF —
  is named by `exportFileName` (`lib/plan-export/download.ts`): the house
  name and any parts slugified to lowercase letters, digits and dashes in
  any script (`дом-мечты.glb`, `東京の家.json`; Latin accents fold), capped
  in UTF-8 bytes, with Windows-reserved names such as `con` suffixed. Quotes,
  `&`, `%`, emoji, path separators, control and bidi characters never reach
  the `download` attribute (#427).
- **The GLB waits for the floor plan.** The decoded plan lives in a
  one-entry cache that only fills while the ground floor is on screen, so
  the export decodes it first (`prepareExportBuilding`). A decode that lands
  after its floor was disposed no longer paints into the dead textures.
- **The floor plan arrives in a fresh texture.** Until the plan decodes,
  the 3D floor shows a 1×1 canvas in the floor colour, so it never flashes
  black. Once that placeholder is drawn, three.js has given the texture
  immutable 1×1 storage, and a larger image can't be written into it.
  A decode that lands after the floor was built therefore swaps in a new
  texture on its own `TextureSource` and disposes the placeholder one (#521).
- **The hard budget derives "spent".** With `layout.budget` absent the
  budget only advises, as before. Switched on, it holds one number,
  `writeOff`: what selling back at 80 % has lost. Spent is the price of
  the furniture standing (porch door excluded) plus that number while the
  budget is on (`lib/budget.ts`); the header and the library cards show
  it. A house that gains furniture by any route — a tile, paste,
  duplicate, a set, Surprise me — is charged without that route knowing
  about budgets. Loading another house (a template, the library, a share
  link) brings that house's own setting. The field is layout state: undo,
  autosave, the library, restore points and share links carry it, and
  `parseStoredLayout` repairs a broken one (dropped, or clamped) rather
  than refusing the house. Enforcement is in the reducer: Demolish and
  Delete dispatch `sellItems`, which books the 20 % loss, and any non-load
  action that would raise spending past the budget returns the same
  state; `applyLayout` is exempt, so undo and loads restore verbatim. The
  copy, paste and set call sites check `purchaseRefusal` first, so a
  refused buy keeps the selection and explains itself. Switching off keeps
  a non-zero write-off as `{ writeOff, enabled: false }`, so off-and-on
  can't wipe the loss; a budget that never sold anything leaves no field,
  and a house that never used it stays byte-identical.
- **Drag fast-path.** While dragging, meshes are moved directly and the
  single state dispatch is deferred to drag end — no per-mousemove scene
  rebuild. Collision feedback stays live via an emissive tint on the dragged
  group, and each drag gesture lands as one undo entry. A drag aborted
  under a held button (the furniture changed mid-drag) keeps OrbitControls
  off until that pointer lifts, so the rest of the gesture doesn't orbit.
- **Per-item furniture diff.** The furniture effect keeps one group per
  item and storey and compares each item's build key (everything its
  builder reads, plus the collision tint and the ghost fade, which are baked
  into the materials). A move, turn, mirror or lock re-places the existing
  group; only an item whose build key changed is disposed and rebuilt. A
  rotate or nudge creates no GL objects, so selection outlines that still
  match are kept too, which keeps their line shader alive. Because a kept
  group survives a state change, a 3D drag aborts when the furniture
  revision moves under it, not only when its group is detached.
- **OBB collision.** Item overlap uses a separating-axis test on rotated
  footprints, with the old bounding-circle check kept as a broad phase — no
  more false positives on long thin items placed diagonally. The pair test
  is layer-aware: wall-plane items (doors/windows/cameras) collide only
  with each other, low-profile items (rugs) go under furniture, and
  type-based stacking families cover tabletop-items-on-surfaces and
  seats-under-tables.
- **Context over props.** `RoomEditorContext` and `SelectionContext`
  distribute state to panels — ~90 drilled props eliminated. Props are
  reserved for one-off callbacks with side effects (scene-ref closures,
  selection clearing).
- **Fast-changing state in stores with selectors.** The layout lives in
  `layoutStore`; view settings, the catalog search, the game mode and the
  time auto-cycle live in a per-editor view store whose context carries only
  the store, so it never re-renders anyone by itself. Components select the
  fields they show (`useViewSettings('view2D')`), never the whole `view`:
  the time of day changes four times a second while auto-cycling. The
  orchestrator reads every view field but the hour, and the scene effects
  run in a `SceneEffects` child that also reads the hour and the search, so
  a tick or a keystroke re-renders that child and the panels showing it, not
  the tree (#148, #3).
- **Memo boundaries around the drawer and the HUD.** The orchestrator
  re-renders on every layout edit, so `SidebarDrawer` and `BottomHud` are
  memoised and receive stable callbacks: handlers that close over the layout
  go through `useEvent`, which keeps one identity and calls the latest
  closure. The closed drawer's panels read the editor and selection through
  `HeldEditorContexts`, which freezes both while the drawer is hidden, so a
  drag, a nudge or a colour change skips the ~70 catalog tiles and catches
  up in one render when the drawer opens. The save status (`saving`,
  `lastSavedAt`, `saveError`) lives in a small store that only the header
  subscribes to, so the autosave's flips re-render the header alone (#3).
- **Small-screen overlays.** Below 769 px wide or 501 px tall
  (`COMPACT_OVERLAY_QUERY`) the item popover is a bottom sheet: collapsed to
  its header and action row, so the selected item stays in view, with a
  handle that expands it. While it is open `<html data-sheet-open>` is set
  (`collapsed` / `expanded`), which the phone HUD and the camera framing
  read. Toasts share a single slot there: a status notice first, then
  queued achievements one at a time. Wherever the header stats are hidden
  (`HEADER_HIDDEN_QUERY`) the save-failed and changed-in-another-tab
  notices move out of them into the overlay stack, so a failing autosave
  is never silent (#385). The stack is placed under whatever chrome sits
  above its column (pills, touch row, minimap, tool chips), measured on DOM
  changes rather than at a fixed offset, so it follows HUD layout changes.
  It never overlaps the open sheet: short of room it puts the notices on
  one line, then holds the toasts back, then rises over the chrome to sit
  on the sheet; the save-failed label stays in view throughout. Toast
  timers pause while a toast is off screen and resume with the time left
  (`usePausableTimeout`); the queue never drops the toast on screen, and
  achievements already shown are not replayed after a rotation across the
  breakpoint. An achievement also waits while the dock's ⋯ tray is open,
  whose value rows reach the slot in landscape. On touch screens the save-failed notice opens its advice in
  place, and the notice buttons get 44px tap areas.
  On desktop the minimap steps left of the open popover instead of hiding
  under it (#390).
- **The walker (#446, #454, #463).** `lib/walk-world` is what the walker
  stands on, rebuilt only when the building changes: every storey's floor
  plate, each stair's treads (from `lib/stairs`, so the ramp matches the
  mesh) solid down to their floor, the stairwell holes as the cut treads,
  the porch and its steps, and the lot's slope. A move goes to the highest
  surface under the walker's centre within one step (a riser, or 1.2 m
  across a threshold onto the lot), so it climbs tread by tread, can't
  board a flight from the side or walk off a landing, and can't step out
  of an upper-floor door. `advanceWalker` (walk-collision) resolves each
  axis substep against the colliders, then the surface, allocation-free.
  A tread belongs to its stair's storey and a plate to its own, so the
  active floor switches at the landings; the hook reports it and ignores
  React's echo, and any other floor change (PgUp/PgDn, the pills) lands
  the walker at that storey's stairs (`walkArrival`). The exterior walls
  are 0.1 m colliders with gaps at exterior doors and the porch, which
  keeps the old 0.35 m wall margin. While walking every storey is built
  solid with the roof, as ALL floors does with the walls up (the scene
  effects key on `allFloors`): the flight climbs into the real storey
  above, the stairs show from the landing, and the house is whole from the
  garden. The #359 ceiling plate stays under the storey above (a floor
  plate is invisible from below); its stairwell shafts go. Sitting eases the camera to the seat and back to where the walker
  stood; any step stands it up. The orchestrator remembers the mode before
  EXPLORE (a store subscription, no re-render) and leaving returns to it.
- **The phone dock.** At ≤768 px wide, and at ≤1100 × ≤500 px (landscape
  phones), the HUD docks on the bottom edge (#395, #307). The media queries
  live in `lib/hud-layout.ts` and must match `app/globals.css`: the catalog
  strip and the wall tool's panels read them through `useMediaQuery` to
  render one scrolling row and folded headers, and the CSS does the rest.
  The mode panel's action buttons sit in two `display: contents` groups, so
  desktop keeps one grid while the dock lays out Undo/Redo and the ⋯ tray
  apart. The dock's panels, the top-right pills and the lot badge carry
  `data-scene-occluder` for camera framing — the painted panels, never a
  wider transparent container. While the phone item sheet is open
  (`html[data-sheet-open]`, under the sheet's own query) the catalog and
  build tools step aside and the mode bar rides above the sheet
  (`--pc-sheet-height`), so Undo and Redo stay in reach; in landscape,
  where the sheet takes the right half, Undo and Redo move to the left. Measured edges
  place the rest: top-centre chips under `--pc-top-pills-bottom` (#308),
  the touch buttons above `--pc-dock-top` (wrapping into a second column
  when the dock grows; it is re-measured when the sheet lifts the dock),
  the View menu below `--pc-mode-top`. On short screens the touch buttons
  ride in the top bar's measured free strip instead (`useTopBarSlot`:
  `--pc-top-slot-start` / `-end`, between the lot badge and the pills,
  whatever the house name or floor count), and drop below the pills
  (`--pc-top-slot-top`) when the strip is too narrow for the row, so they
  never cover a floor button. The wall tool's panels fold to their
  headers, one unfolds at a time and scrolls on its own, so the Walls chip
  that ends the tool never scrolls away; a wall tap always unfolds Paint,
  and closing the panels forgets the fold. In landscape an unfolded panel
  folds the catalog row away and becomes a narrow left column
  (`min(300px, 42vw)`) from under the top bar to the bottom edge, beside
  the mode bar, with the folded panel and the chips stacked under it; its
  controls wrap to the column at 40 px or more, it scrolls on its own, and
  the rest of the screen stays scene, so the framing puts the house there.
  Desktop (≥1101 × ≥701) is untouched where nothing overflows.
- **Vector plan exports** (`lib/plan-export/`). The SVG and DXF emitters
  are pure string builders drawing from floor data, with shared maths in
  `plan-geometry.ts`: footprint corners, opening axes, stairs, the
  coverage rings and camera wedges (the 2D view's maths, with the 3D
  cone's range/FOV fallbacks, `DEFAULT_VISION_RANGE_M` and
  `DEFAULT_VISION_FOV_DEG`, which the 2D plan and the blueprint use too,
  #420, #401), dimension runs, and the item
  schedule (#424). Wall-mounted items (openings, cameras) stay out of the
  content bounds unless mounted outside the walls. Coverage frames the
  sheet: `planFrameBounds` grows the content to take in the rings and
  wedges, at most `COVERAGE_MARGIN_M` (5 m) past it (`coverage: 'full'`
  for all of it); the SVG clips to that rectangle and the DXF trims its
  circles, arcs and lines to it, so both show the same coverage and a
  30 m lens can't blow up the DXF extents. `buildingFrameBounds` unions
  every floor so a whole-building SVG (`buildingToSvg`, floors stacked),
  the whole-building DXF and the every-floor print line their sheets up,
  through the SVG's `bounds` option (#405); `idPrefix` keeps ids unique
  when the print inlines several sheets in one page. Interior-wall
  dimensions take one world-space side, chosen clear of item footprints,
  in both formats. The Export panel's SVG always carries the schedule (a
  floor with nothing placed gets no table), and a multi-storey house adds
  "all floors" SVG and DXF buttons for `buildingToSvg` / `buildingToDxf`.
  The SVG's sheet furniture (title, room size, dimensions, north arrow,
  scale bar) lives in the margin band, so it never changes the sheet
  size; the title block stacks and then ellipsizes on narrow sheets. A
  mirrored door hinges on the other jamb, as in 3D (#386). The DXF is a
  complete AutoCAD 2000 document (#397) — handles on every record,
  owners, subclass markers, `$HANDSEED`, `$EXTMIN`/`$EXTMAX`, all nine
  tables, the layout blocks and the OBJECTS dictionaries — checked by a
  structural validator in `dxf.test.ts` and, during development, by
  ezdxf's audit (zero fixes). Its layers: WALLS, INTERIOR, OPENINGS,
  FURNITURE, LABELS, STAIRWELL, COVERAGE, DIMENSIONS; `buildingToDxf`
  lays the floors out side by side on those same layers.
- **Placement ghost** (#463 d). A click or tap on a catalog tile arms a
  one-shot flag (`armGhostPlacement`, the pointer twin of the keyboard
  placement's), and the wrapped `placeCatalogItem` picks the entry up
  instead of placing it. Nothing enters the layout while it is in hand:
  `use-placement-ghost` moves a faded copy of the item's mesh in 3D
  (`three/placement-ghost.ts`, no shadow, its own userData tag so
  raycasts and the furniture diff ignore it) or an SVG outline over the
  plan, mapped through `clientToWorld2D`'s own inverse — no dispatch per
  move. Presses on the visible canvas are taken in the document's
  capture phase, so the camera controls and selection never see them
  while other document listeners (an open popover's outside click) still
  do; right and middle drags still orbit and pan, and a second finger
  cancels the press, so a pinch places nothing. While held, the ghost
  owns R, Enter, Space and Escape ahead of a focused tile and the window
  shortcuts. The release places through `placeDiscrete` (the snapped spot
  and the ghost's turn), so it is one undo entry with one `place` cue, a
  hard-budget refusal gets its toast and the `refused` cue, and a cancel
  leaves no trace. The collision tint is re-checked when the floor's
  items change; a mode switch or the wall, distance or zone tool puts the
  ghost down. `snapCatalogPlacement` previews openings and cameras on
  their wall and everything else through the drag's snaps. Picking a
  ghost from the drawer folds it away, as zone drawing does. The pad's
  material is shared and kept, so a pick compiles no shader.
- **Free space for sets and Surprise** (#456, #448).
  `placeSetInFreeSpace` probes the preferred centre, then a grid over the
  room nearest-first (0.25 m, coarser past a 10 m room), and accepts the
  first spot where no piece `hasCollisions` with the floor's items, the
  porch and stairwells, or a partition. Surprise keeps
  `keptBySurprise` items (wall-mounted, stairs, outdoor), places its set
  through the same search, rejects decor spots that fail
  `hasCollisions`, and hangs no art across the recess's span of the
  north wall.
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
10. Every scene-removal path disposes GPU resources (geometries,
    materials, textures, light shadow maps) via a shared
    `disposeObject` helper — scene rebuilds no longer leak GPU memory.

## Known limitations

- A large floor-plan image stored as base64 can exhaust the ~5 MB
  `localStorage` quota; the save call catches and warns instead of crashing.
- Walkthrough requires a click on the canvas to engage pointer lock.
- The UI is responsive down to phone sizes — the HUD docks at the bottom,
  the item editor becomes a bottom sheet, the sidebar goes full-screen —
  and the walkthrough walks by touch (drag to look, a thumb stick).
- No "rooms from enclosed walls" detection — interior walls are just
  drawn segments, not space-bounding entities.

## License

[MIT](LICENSE)

### Third-party assets

- `components/room-organizer/assets/people.glb` — mannequin and animations
  from Quaternius' [Universal Animation Library](https://quaternius.itch.io/universal-animation-library),
  CC0 1.0. Thank you, Quaternius. Details in
  [`assets/README.md`](components/room-organizer/assets/README.md).
