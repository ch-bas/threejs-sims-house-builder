# Architecture: module layout

A file-by-file map of the code. The
[Architecture](https://github.com/ch-bas/threejs-sims-house-builder/wiki/Architecture)
wiki page explains the layers and how state flows; the reasoning behind
individual decisions is in [design-notes.md](design-notes.md).

Keep this list current: a new module gets a line here in the same pull
request. `lib/docs-drift.test.ts` fails when a source file under
`components/room-organizer/` is missing from it, or when the furniture count
here or in the README differs from the catalogue.

```
app/                                     Next.js shell
├── layout.tsx                           Root layout: metadata (title, preview, theme colour), fonts, the stale-chunk head script
├── page.tsx                             Loads the editor (client only) and prefetches the 3D engine
├── error.tsx, global-error.tsx          Error boundaries: reload first, then offer to move the saved house aside
├── not-found.tsx                        Branded 404 (out/404.html), with a link back to the builder
├── manifest.ts                          Web app manifest (static at build time)
└── icon.svg, favicon.ico, apple-icon.png, opengraph-image.png
                                         Icons and link-preview image, served by Next under the basePath; rasters from scripts/build-icons.mjs
docs/                                    This file, the design notes, and the README screenshot
scripts/
├── build-icons.mjs                      Renders the app/ icon rasters and the preview image from SVG (Playwright, not part of the build)
└── build-people-glb.mjs                 Rebuilds assets/people.glb from the Universal Animation Library
components/
├── ui/                                  shadcn-style primitives
└── room-organizer/
    ├── room-organizer.tsx               Orchestrator: wires the hooks into the contexts and composes the panels
    ├── index.ts                         Barrel export
    ├── contexts/                        React Context (eliminates prop drilling)
    │   ├── room-editor-context.tsx      Layout, actions, history, collisions, engine state
    │   ├── editor-view-context.tsx      Carries the editor view store; useViewSettings / useEditorView selectors
    │   ├── held-editor-contexts.tsx     Re-provides editor + selection frozen while hidden (the closed drawer)
    │   ├── selection-context.tsx        Selected item(s), multi-select, selectOnly()
    │   └── index.ts                    Barrel
    ├── lib/                             Pure domain code, no React/Three
    │   ├── types.ts                     RoomLayout / FloorLayout / ViewSettings / etc.
    │   ├── constants.ts                 Catalog (69 items in 12 categories), templates, MAX_FLOORS
    │   ├── schema.ts                    Type guards, legacy migration, caps that repair (never refuse)
    │   ├── geometry.ts                  Collision (items, keep-out, partitions), bounds, snap, auto-organize
    │   ├── collision-reason.ts          The sentence for why an item shows red (rules live in geometry.ts)
    │   ├── footprint.ts                 Shared footprint primitives: rotatedHalfExtents, LOW_PROFILE_MAX_HEIGHT, clampToFootprint (a leaf, so walk-collision can import it)
    │   ├── html-escape.ts               escapeHtml for the blueprint and print popups and the SVG export
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
    │   ├── reduced-motion.ts            prefers-reduced-motion query and a one-off read for non-React code
    │   ├── persistence.ts               Active-layout localStorage I/O, save-failure reasons, dated recovery copies (two kept)
    │   ├── library.ts                   Named-layout library I/O: an index of entries (name, saved-at, item and floor counts) + one blob per house; unreadable entries kept verbatim (#348); ASCII names keep their historical slot, other names get a `u_` Unicode slot (#550); a copy that would leave autosave no room is refused (#565)
    │   ├── version-history.ts           Automatic restore-point ring (coarse autosave snapshots), stable entry ids, per-house cadence by house id
    │   ├── restore-point.ts             Forced restore point before a whole-layout replacement; "untouched" = equal to INITIAL_LAYOUT
    │   ├── initial-layout.ts            INITIAL_LAYOUT / INITIAL_GROUND_FLOOR, the house every session starts from
    │   ├── ids.ts                       Collision-resistant ids; withHouseId mints a house id (#342, #479)
    │   ├── share.ts                     Share-URL encode/decode (base64url); positions rounded to mm on encode
    │   ├── share-delivery.ts            Share-link delivery: share sheet on touch, clipboard inside the tap, copy field last
    │   ├── chunk-reload.ts              Stale-chunk detection + the one-reload-per-window guard shared with the head script
    │   ├── dev-diagnostics.ts           `?debug` flag + allocation-free renderer.info counters
    │   ├── pasteboard.ts                Gallery of houses received via share links (quota-safe)
    │   ├── blueprint.ts                 Print-friendly 2D blueprint HTML, canvas fitted to the plan content (#377)
    │   ├── catalog-drag.ts              HTML5 drag MIME + catalogue keys, tile blocked reasons
    │   ├── budget.ts                    Hard budget (#463e): spend, funds left, 80 % sell-back, purchase refusal, over-budget tile reason, schema repair
    │   ├── safe-storage.ts              localStorage get/set/remove that never throw (#396)
    │   ├── storage-errors.ts            Classifies a storage error: quota, blocked or unknown
    │   ├── storage-meter.ts             Characters per localStorage tenant (open house, library, restore points, recovery copies, sets, settings, other sites) for the Manage meter (#615)
    │   ├── backup.ts                    One-file backup of everything stored in this browser; versioned bundle, an add-only restore through the schema (#620)
    │   ├── themes.ts                    Theme definitions + applyTheme
    │   ├── modes.ts                     Which Build Tools each game mode shows (DESIGN / FURNISH)
    │   ├── hud-layout.ts                Phone-dock and sheet media queries, catalog page size, scroll cue, touch welcome tips
    │   ├── top-bar-slot.ts              The top bar's free strip between the lot badge and the pills, for the touch row
    │   ├── furniture-sets.ts            Pre-built combos + snapshot-backed set placement; free-spot search (#456)
    │   ├── custom-sets.ts               User-saved furniture sets: localStorage I/O + parser (#302)
    │   ├── clipboard.ts                 In-memory copy/paste: the selection normalised around its centroid, pasted with fresh ids (#153)
    │   ├── groups.ts                    Persistent group selection helpers (#154)
    │   ├── history-floor.ts             Which storey undo/redo lands on: same floor id, or the one other floor the swap changes (#578)
    │   ├── history-label.ts             What an undo or redo step did, from the two snapshots, for the toolbar's tooltips
    │   ├── surprise.ts                  Random one-shot floor populate around the kept structure (#448)
    │   ├── placement-ghost.ts           Placement ghost maths: footprint corners, the plan's inverse mapping (#463 d)
    │   ├── sounds.ts                    Web-Audio synth for UI cues (place, remove, rotate, success, refused)
    │   ├── wall-snap.ts                 Vertex + right-angle snap for interior walls
    │   ├── opening-snap.ts              Door/window snap + shared wall-mount settle rule
    │   ├── walk-collision.ts            Walkthrough circle-vs-OBB slide against furniture, partitions, the shell (door gaps, porch) and the street; advanceWalker over walk-world; sightBlocked / buildSightWalls for line of sight
    │   ├── npc-path.ts                  Walker (NPC) free-space grid, regions, A* + string-pulled routes, destinations (#452)
    │   ├── npc-seats.ts                 Where walkers sit: seat slots, facing, approach points
    │   ├── seat-surface.ts              Sitting-surface height per seat type, from the builders: one table for the walkers and the seated player (#623)
    │   ├── walk-input.ts                Walkthrough frame-time cap, which keydowns walk (no Ctrl/Cmd/Alt chords), E to interact, keys typed into a field ignored
    │   ├── walk-world.ts                What the walker stands on: floor plates, stair treads as a ramp, porch and steps, sloped lot
    │   ├── walk-spawn.ts                Walkthrough spawn (inside the entrance door) and arrival at the stairs on a floor change
    │   ├── walk-interact.ts             Seats in reach and the seated pose (facing the TV), never through a wall or across the shell (#566)
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
    │   ├── zones.ts                     Room zones: rect validation / clamping, per-zone stats (porch left out, #582)
    │   ├── view-options.ts              View-menu switches and the view each one needs (#341); view invariants (zone drawing is 2D only, #439)
    │   ├── plan-view-fit.ts             What the on-screen plan and minimap fit (room + outdoor items, far ones as edge markers) and where beside the desktop HUD (#381)
    │   ├── editor-notices.ts            notify() status messages, with an optional action button such as Undo (#651), notifyRefused(), zone-name requests (#374)
    │   ├── confirm-dialog.ts            askConfirm(): the in-app question queue that replaces window.confirm (#649)
    │   ├── overlay-queue.ts             Small-screen overlay policy: compact queries, toast queue, stack placement
    │   ├── plan-order.ts                2D layer order: rugs → floor → tabletop → hung → wall (#286)
    │   ├── floor-plan-fit.ts            Floor-plan image placement per fit mode, shared by the 2D plan and the 3D floor canvas (#191)
    │   ├── file-io.ts                   JSON / image / PNG / CSV + schedule / GLB I/O
    │   ├── format.ts                    The one length and age format: formatMetres ("2.00 m"), formatSize, formatAge ("3 min ago", #438)
    │   └── plan-export/                 2D-plan exporters (#230)
    │       ├── plan-geometry.ts         Shared plan-space maths (corners, grid, openings, stairs, coverage, dimensions, schedule, bounds)
    │       ├── svg.ts                   Vector SVG plan emitter, one floor or the whole building (pure)
    │       ├── dxf.ts                   AutoCAD 2000 DXF plan emitter, one floor or the whole building (pure)
    │       ├── download.ts              Blob download + the one filename rule, exportFileName (DOM)
    │       └── print.ts                 Print-to-scale document: paper, orientation, scale, outdoor and all-floors options (#435, #405); popup → Save-as-PDF
    ├── three/                           Three.js builders, no React
    │   ├── furniture-builders.ts        Registry + factory: furniture type → mesh builder
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
    │   ├── people-outfits.ts            Body regions from skin weights, outfits, hair on the head bone
    │   ├── room-builder.ts              Floor + walls (yOffset, ghosting)
    │   ├── building-export.ts           The whole building as a named graph, for the GLB export
    │   ├── wall-openings.ts             Door / window → exterior wall cutouts
    │   ├── interior-walls.ts            Drawn-segment interior walls with cutouts
    │   ├── measurement.ts               Distance-tool spheres + line
    │   ├── item-labels.ts               Floating sprite labels above items
    │   ├── roof.ts                      Flat / gable / hipped roof; walkthrough attic ceiling (#487)
    │   ├── ceiling.ts                   Walkthrough ceiling + stairwell shafts up and down (#359)
    │   ├── dormers.ts                   Dormer boxes, joinery, Juliet rails; attic wells (#487)
    │   ├── neighbours.ts                The street's houses from their specs (merged + instanced)
    │   ├── terrain.ts                   Sloped ground + excavation faces
    │   ├── entrance.ts                  Recessed porch reveals, soffit, steps
    │   ├── baseboard.ts                 Skirting profile + door-gap runs
    │   ├── floor-patterns.ts            Procedural CanvasTexture floors
    │   ├── wall-patterns.ts             Procedural CanvasTexture walls
    │   ├── texture-settings.ts          Renderer anisotropy captured at init, for the CanvasTexture builders
    │   ├── texture-lru.ts               LRU cache for texture masters (evict + dispose)
    │   ├── signal-overlay.ts            Wi-Fi / CCTV ring overlays
    │   ├── camera-vision.ts             Directional CCTV vision-cone overlays; no alert through walls (#590), depth-tested under another storey or while walking (#552)
    │   ├── lighting.ts                  Sun-arc continuous time of day (+ weather overcast)
    │   ├── weather.ts                   Rain / snow particle field (one InstancedMesh)
    │   └── outdoor.ts                   Garden / path / bush scenery; perimeter trees merged per part
    ├── canvas-2d/render.ts              Pure 2D top-down renderer
    ├── canvas-2d/stairs-symbol.ts       Stair treads + climb arrow, stairwell voids on the floor above
    ├── plotcraft/icon.tsx               PlotCraft SVG icon set for UI panels (no icon library)
    ├── plotcraft/tokens.css             PlotCraft design tokens (colours, type, spacing, glass) and HUD classes
    ├── assets/people.glb                Rigged mannequin + idle, talk and walk clips (CC0, see assets/README.md)
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
    │   ├── use-people-model.ts          Loads people.glb the first time a person or a walker needs it
    │   ├── use-npcs.ts                  Animated walkers: spawn, route-following step, re-route on floor edits; giving way, sitting, activities
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
    │   ├── use-dialog-focus.ts          Overlay focus: move in, trap (with companions), Escape, restore
    │   ├── use-event.ts                 Stable-identity callback that runs the latest handler (memoised children)
    │   ├── use-exploring.ts             Whether the editor is in EXPLORE, and the hint on the house-editing controls it turns off (#643)
    │   ├── roving-keys.ts               The arrow keys of a tablist or radio group: one tab stop, arrows activate (#434, #646)
    │   ├── use-refusal.ts               `refuse(message)` for store-reading panels: the refused cue (muted with the sounds) and an error notice (#588, #642)
    │   ├── use-media-query.ts           matchMedia as a hook (false on the server)
    │   ├── use-reduced-motion.ts        The OS reduce-motion setting as a hook (gates weather, walkers, cone sweep)
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
        ├── bottom-hud.tsx               The bottom HUD row: build tools, camera pad, catalog strip, the wall tool's panels
        ├── catalog-strip.tsx            Bottom-centre drag-source tile row
        ├── cctv-menu.tsx                Camera-type picker (five types) for the catalog strip and the Buy tab
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
        ├── storage-panel.tsx            Manage card: storage meter, delete restore points / saved layouts, back up and restore everything (#615, #620)
        ├── header-stats.tsx
        ├── time-of-day-panel.tsx
        ├── camera-presets-panel.tsx
        ├── camera-pad.tsx
        ├── touch-mode-toggle.tsx        Touch camera buttons: orbit / pan, zoom, fit
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
        ├── confirm-dialog.tsx           The askConfirm() modal: focus trap, Enter confirms, Escape cancels (#649)
        ├── zone-name-chip.tsx           Zone tool chip: the draw-mode status and Done (#439), then the inline name field
        ├── dev-diagnostics.tsx          `?debug` overlay: draw calls, triangles, geometries, textures, programs, frames
        ├── chip-controls.tsx            Chip buttons + inline name field (no native prompts)
        └── viewport.tsx
```
