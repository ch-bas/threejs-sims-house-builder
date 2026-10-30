# Design notes

Why the code is built the way it is: the invariants, trade-offs and fixes
behind the modules listed in [architecture.md](architecture.md). Add a note
here, in the same pull request, when a change sets a rule the next change has
to respect.

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
  Delete dispatch `sellItems`, which books the 20 % loss; Clear floor,
  Remove floor and Surprise replacing a floor book it the same way
  (`bookSale`, #534), and Surprise sizes its decor for what is left after
  that loss. Any non-load
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
  garden. Indoors only the walker's storey is drawn (the ceiling and the
  floor hide the rest), plus the ones directly above and below while it is
  on a flight or within 2.5 m of a stairwell or flight on its storey
  (released at 3 m, so the edge doesn't flicker; `seesNeighbourStoreys`).
  The rest are hidden, not rebuilt (shell and
  partition objects carry their storey in `userData.storey`, walls are
  flagged `offStorey` for `applyWallDisplay`). The roof shows with the
  top storey. Out on the lot the whole
  house and its roof show. Only the walker's storey is lit, since point
  lights cast no shadow. The #359 ceiling plate stays under the storey
  above (a floor plate is invisible from below); its stairwell shafts go.
  Under the roof the walker gets the attic ceiling (#487, `buildAtticCeiling`
  in `three/roof.ts`): a plaster plate just below the roof base, out to the
  eaves, instead of the roof's shingled underside, opening into a lined well
  under each dormer so its glazed face shows from inside. With wells, the
  roof's shingled body stops writing colour and depth (`setRoofShellHidden`)
  but still casts its shadow; its visibility stays with `applyWallDisplay`.
  Nothing outside the walkthrough changes, nor the GLB.
  Colliders carry their storey's height span and the walker is tested
  against its storey and the ones either side, so it passes over what
  stands below a landing; a flight shorter than its storey allows the
  taller last step. Walking pulls the camera's near plane in to 0.1 m so
  a wide screen can't see through a wall, and on exit the orbit camera
  moves with the target the floor change moved. Sitting eases the camera
  to the seat and back to where the walker stood; any step stands it up. A seat or a TV behind a wall
  doesn't count, and sitting never crosses the shell (#566); the seat height is the walkers' table
  (`lib/seat-surface`, #623). The orchestrator remembers the mode before
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
- **No native dialogs** (#649, #607). `window.confirm` and `alert` froze
  the render loop and the autosave. Questions go through `askConfirm()`
  (`lib/confirm-dialog.ts`), which queues them for one modal host and
  resolves with the answer; outcomes go through `notify()` or a panel's
  inline status. Callers await the answer, so anything that ran after a
  sync confirm (surprise, `confirmReplace`, the soft-budget buy) is now
  async. The host stops every key but Escape and Tab at the dialog, so the
  window shortcuts can't edit the house a question is about, and the
  placement ghost stands back while a question is open. A soft-budget buy
  returns '' at once and places through `onPlacedAfterConfirm` on a yes.
  A popup print opens its window before anything it awaits. For
  `CONFIRM_GRACE_MS` after opening the dialog ignores Enter, its buttons
  and its backdrop, a held Enter never answers, a destructive question
  starts on Cancel, and a backdrop click counts only when the press began
  there: the gesture that asked can't answer. Handlers read `layoutStore`
  again after the answer (remove a floor by id, not index). A keyboard add
  that asked starts its session through `adoptDeferredPlacement`.
- **A share link over your own house asks first** (#573). The stored
  house hydrates, then the in-app question asks; the link stays in the
  address bar until it is answered. A yes is an ordinary replacement
  (`onOpenShared`: restore point, history commit, `markLayoutLoaded`, a
  notice with Undo), so Ctrl+Z returns to the house it replaced. Keep
  mine starts focused and the backdrop is inert for that question; over nothing worth keeping the
  link hydrates unasked, as before. A link that doesn't open names the
  reason (too large, cut off, from a newer app: a payload version past
  `SHARE_FORMAT_VERSION`).
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
- On a desktop the walkthrough needs a click on the canvas to lock the
  pointer (touch screens drag to look instead).
- No "rooms from enclosed walls" detection — interior walls are just
  drawn segments, not space-bounding entities.
