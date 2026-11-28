# Architecture: module layout

A file-by-file map of the code. The
[Architecture](https://github.com/ch-bas/threejs-sims-house-builder/wiki/Architecture)
wiki page explains the layers and how state flows; the reasoning behind
individual decisions is in [design-notes.md](design-notes.md).

Keep this list current: a new module gets a line here in the same pull
request. `lib/docs-drift.test.ts` fails when a source file under
`components/room-organizer/`, `app/` or `scripts/`, or a root `*.config.*`
file, is missing from it, or when the furniture count here or in the README
differs from the catalogue.

```
./                                       Root config
├── next.config.mjs                      Static export; the Pages basePath when GITHUB_PAGES=true; Next's own lint pass off (CI lints)
├── eslint.config.mjs                    Flat ESLint config: next/core-web-vitals plus the project rules, type-aware for TypeScript
├── vitest.config.mts                    Vitest: node environment by default (jsdom per file), the `@/` alias, JSX transform
└── tailwind.config.ts, postcss.config.mjs
                                         Tailwind theme and the PostCSS pipeline (Tailwind, autoprefixer)
app/                                     Next.js shell
├── layout.tsx                           Root layout: metadata (title, preview, theme colour), fonts, the stale-chunk head script
├── page.tsx                             Loads the editor (client only) and prefetches the 3D engine
├── globals.css                          Tailwind layers, the design tokens and the app-wide styles
├── ambient.d.ts                         Next's ambient types for a bare `tsc`, and global stylesheet imports
├── error.tsx, global-error.tsx          Error boundaries: reload first, then offer to move the saved house aside (the reset loads on click, #584)
├── not-found.tsx                        Branded 404 (out/404.html), with a link back to the builder
├── manifest.ts                          Web app manifest (static at build time); opens .json house files in the installed app (#934)
├── fonts/                               Sora and Nunito woff2 subsets with their OFL licences (the build needs no network, #560)
│   └── fonts.ts                         Loads them with next/font/local, one call per subset; the root's font CSS variables
└── icon.svg, favicon.ico, apple-icon.png, opengraph-image.png
                                         Icons and link-preview image, served by Next under the basePath; rasters from scripts/build-icons.mjs
public/                                  icon-192.png, icon-512.png: the manifest's install icons (scripts/build-icons.mjs), copied to the site root
docs/                                    This file, the design notes, and the README screenshot
scripts/
├── add-preloads.d.mts                   Types for add-preloads.mjs, for the TypeScript test that imports it
├── add-preloads.mjs                     Post-build: preloads app/page.tsx's editor and engine chunks from out/index.html, read from the loadable manifest (#731)
├── add-csp.mjs                          Post-build: the Content-Security-Policy meta, hashing each page's inline scripts (#445); script files narrowed to the basePath (#579)
├── add-csp.d.mts                        Types of add-csp.mjs's exports, for its test
├── build-sw.mjs                         Post-build: out/sw.js, the offline service worker: precaches the page, the shell and _next/static/ with a SHA-256 per file, hashed files cache first, the page network first; NEXT_PUBLIC_SERVICE_WORKER=off writes a worker that removes itself (#933)
├── build-sw.d.mts                       Types of build-sw.mjs's exports, for its test
├── whats-new.mjs                        Build time (next.config.mjs): the What's new card's lines, the newest release's Added lines from CHANGELOG.md, five picked across the section, cut at a word; no changelog, no card (#931)
├── whats-new.d.mts                      Types of whats-new.mjs's exports, for its test
├── third-party-notices.mjs              Post-build: out/third-party-licenses.txt, the licences of the shipped packages and assets (#569)
├── third-party-notices.d.mts            Types of third-party-notices.mjs's exports, for its test
├── licenses/                            Licence texts of the libraries inside Next's polyfills chunk (core-js, whatwg-fetch, object-assign), for third-party-notices.mjs
├── check-bundle.mjs                     CI: gzip sizes of the export (first-load JS, largest chunk, CSS) against bundle-budget.json (#732)
├── check-bundle.d.mts                   Types for check-bundle.mjs, for its unit test
├── bundle-budget.json                   The gzip budgets check-bundle.mjs enforces; raised with `npm run check:bundle -- --update`
├── smoke-test.mjs                       CI: the export at its basePath in headless Chrome: errors, CSP, engine start, 404 page, chunk reload (#561)
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
    │   ├── constants.ts                 Catalog (78 items in 12 categories) with colour variants, templates, MAX_FLOORS
    │   ├── schema.ts                    Type guards, legacy migration, caps that repair (never refuse)
    │   ├── geometry.ts                  Collision (items, keep-out, partitions), bounds, snap, auto-organize
    │   ├── collision-reason.ts          The sentence for why an item shows red (rules live in geometry.ts)
    │   ├── cutout.ts                    The L-shaped footprint's rules: why a cut is refused, and bringing every storey inside it (#727)
    │   ├── footprint.ts                 Shared footprint primitives: rotatedHalfExtents, LOW_PROFILE_MAX_HEIGHT, clampToFootprint; the building's outline: the optional corner cut-out, footprintOutline, isInsideBuilding, clampToBuilding, shellWalls (a leaf, so walk-collision can import it)
    │   ├── html-escape.ts               escapeHtml for the blueprint and print popups and the SVG export
    │   ├── facade.ts                    The outer walls' outside finish: the facade's own pattern and colours, the inside finish for the rest; setting and clearing it (#918)
    │   ├── floor-holes.ts               The stairwell holes a floor is cut with: clamped, overlapping ones cut as the union of each stair's rectangles (#963), kept off the L's cut; 3D slab, shafts, rail and plan share them (#559)
    │   ├── floor-keep-out.ts            Per-storey keep-out: porch + stairwells cut by the floor below (#372)
    │   ├── grounds.ts                   Garden surfaces on the lot (#924): the fit rule (lot, house, porch steps, party-wall row), draw-gesture corners, the reducer's edits, schema repair, what is shown
    │   ├── mount-band.ts                Wall-hung decor family + an item's vertical mount band (#376)
    │   ├── furniture-scene.ts           Placed items + collision flags per rendered storey; furniture effect keys (#214); per-item build keys + diff (#404)
    │   ├── overlay-keys.ts              Label and Wi-Fi/vision-overlay effect keys: rebuild only when an overlay would change (#409)
    │   ├── app-version.ts               The build's version (stamped from package.json), the stored last-seen version (stamped once What's new has shown, or when there is nothing to tell), who is offered it and whether it is news (#931)
    │   ├── whats-new.ts                 What's new lines (#931): the build-stamped string read and checked; imports nothing, loaded on demand in a chunk of its own
    │   ├── alignment.ts                 Align/distribute pure functions
    │   ├── announce.ts                  The one screen-reader status line: `announce` (de-duped), `announceSettled` (held keys), the nudge/lock/undo wording (#929)
    │   ├── ar-view.ts                   AR view (#937): Quick Look detection (`relList.supports('ar')`), the USDZ blob (exporter loaded on the click), file name, failure wording, the AR link's image
    │   ├── achievements.ts              19 predicate-based achievements with count progress, four of them room goals read from `houseRoomScores` (#903); `achievementsEarned` (loaded / edit)
    │   ├── first-steps.ts               The Getting started card's five steps: progress from edits like achievements (loads do none), per-step tips, the stored record (card state, a boolean per step) (#721)
    │   ├── cctv-models.ts               Real-world CCTV model specs for cameras
    │   ├── camera-tween.ts              Eased camera moves for presets, Fit, Focus and floor switches: arc round the target, reduced motion cuts (#930)
    │   ├── camera-zoom.ts               Camera-pad zoom slider ↔ orbit distance (log scale) (#167)
    │   ├── scene-insets.ts              Visible canvas region beside the HUD + camera pose that fits the house in it
    │   ├── contact-shadow.ts            What a storey's baked floor contact map shows: item patches, wall bands, doors and holes wiped (#754)
    │   ├── shader-warmup.ts             The first frame's hold while the first scene's shaders compile in parallel: once, with a time limit (#730)
    │   ├── render-quality.ts            Pixel-ratio cap per device class (phones 1.5, else 2)
    │   ├── detail-patterns.ts           Tileable grey wood, fabric and leather images for furniture (#756)
    │   ├── reduced-motion.ts            prefers-reduced-motion query and a one-off read for non-React code
    │   ├── persistence.ts               Active-layout localStorage I/O, save-failure reasons, dated recovery copies (two kept)
    │   ├── saved-house.ts               The saved house's key, raw read and download, crash flag and reload marker: what the error screens load before hydration, without the schema (#584)
    │   ├── library.ts                   Named-layout library I/O: an index of entries (name, saved-at, item and floor counts) + one blob per house; unreadable entries kept verbatim (#348); ASCII names keep their historical slot, other names get a `u_` Unicode slot (#550); a copy that would leave autosave no room is refused (#565)
    │   ├── version-history.ts           Automatic restore-point ring (coarse autosave snapshots), stable entry ids, per-house cadence by house id; kept versions (`-versions-kept`, at most 5 and 512 KB; the ring never evicts them, the open house's save does as a last resort; keep, keep the house on screen, rename, unkeep back to the ring, backup import) (#935)
    │   ├── restore-point.ts             Forced restore point before a whole-layout replacement; "untouched" = equal to INITIAL_LAYOUT
    │   ├── initial-layout.ts            INITIAL_LAYOUT / INITIAL_GROUND_FLOOR, the house every session starts from
    │   ├── ids.ts                       Collision-resistant ids; withHouseId mints a house id (#342, #479)
    │   ├── share.ts                     Share-URL encode/decode (base64url); positions rounded to mm on encode
    │   ├── share-delivery.ts            Share-link delivery: share sheet on touch, clipboard inside the tap, copy field last; the house as a file when a link leaves part of it out (#934)
    │   ├── tour-session.ts              The shared-link tour's page phase (touring, kept, none), read from the hash on first use (#722)
    │   ├── chunk-reload.ts              Stale-chunk detection + the one-reload-per-window guard shared with the head script
    │   ├── service-worker.ts            The offline worker's registration: production only, after the first frame; NEXT_PUBLIC_SERVICE_WORKER=off removes this site's worker and caches; a newer worker takes over once installed when this is the only tab (#933)
    │   ├── saved-by.ts                  The version that last saved the house: an older build (an offline tab) asks before it saves over a newer one's, once a session (#933)
    │   ├── dev-diagnostics.ts           `?debug` flag + allocation-free renderer.info counters
    │   ├── pasteboard.ts                Gallery of houses received via share links (quota-safe)
    │   ├── blueprint.ts                 Print-friendly 2D blueprint HTML, canvas fitted to the plan content (#377)
    │   ├── catalog-drag.ts              HTML5 drag MIME + catalogue keys, tile blocked reasons
    │   ├── catalog-variants.ts          Colour variants (#621): the entry in a picked colour, drag keys, a placed item's colours
    │   ├── budget.ts                    Hard budget (#463e): the house's funds (#609), spend, funds left, 80 % sell-back, purchase refusal, over-budget tile reason, schema repair
    │   ├── challenges.ts                Challenge briefs (#909): six lots with funds and goals read from the room scores, spend, storeys and the walkers' needs per storey; the starting house, live progress, `layout.challenge` repair, each brief's completion badge (an achievement, earned on edits only and only within the brief's terms: hard budget on, its funds, its lot)
    │   ├── safe-storage.ts              localStorage get/set/remove that never throw (#396)
    │   ├── storage-errors.ts            Classifies a storage error: quota, blocked or unknown
    │   ├── storage-meter.ts             Characters per localStorage tenant (open house, library, restore points, recovery copies, sets, settings, other sites) for the Manage meter (#615)
    │   ├── backup.ts                    One-file backup of everything stored in this browser; versioned bundle, an add-only restore through the schema (#620); kept versions in a part of their own (#935)
    │   ├── backup-reminder.ts           Keeping the houses (#928): the browser's persist answer and the last backup time (one small record), the backup-reminder rule over dates
    │   ├── backup-file.ts               Restoring a backup file: the question, the add-only restore and the notice, for the Restore button and a dropped file (#934)
    │   ├── themes.ts                    Theme definitions + applyTheme
    │   ├── modes.ts                     Which Build Tools each game mode shows (DESIGN / FURNISH)
    │   ├── hud-layout.ts                Phone-dock and sheet media queries, catalog page size, scroll cue, touch welcome tips
    │   ├── top-bar-slot.ts              The top bar's free strip between the lot badge and the pills, for the touch row
    │   ├── furniture-sets.ts            Pre-built combos + snapshot-backed set placement; free-spot search (#456)
    │   ├── custom-sets.ts               User-saved furniture sets: localStorage I/O + parser (#302)
    │   ├── clipboard.ts                 In-memory copy/paste: the selection normalised around its centroid, pasted with fresh ids (#153); or a copied room (#925)
    │   ├── groups.ts                    Persistent group selection helpers (#154)
    │   ├── history-floor.ts             Which storey undo/redo lands on: same floor id, or the one other floor the swap changes (#578)
    │   ├── item-cycle.ts                Keyboard selection on the scene: the floor's items in plan order, Tab's next and previous, the status line (#650)
    │   ├── keymap.ts                    The one key table: the keys the shortcuts and the walker match, the sheet's rows by context, ⌘ on a Mac (#932)
    │   ├── history-label.ts             What an undo or redo step did, from the two snapshots, for the toolbar's tooltips
    │   ├── surprise.ts                  Random one-shot floor populate around the kept structure (#448)
    │   ├── placement-ghost.ts           Placement ghost maths: footprint corners, the plan's inverse mapping (#463 d)
    │   ├── item-run.ts                  Fence, hedge and stepping-stone runs: sections along a line, end snap, corner insets, round the lot (#915)
    │   ├── sounds.ts                    Web-Audio synth for UI cues (place, remove, rotate, success, refused); owns the page's one AudioContext
    │   ├── ambience.ts                  EXPLORE ambience (#911): rain gain by weather and indoors, footsteps by distance walked, birds and crickets by the hour, door creaks and knocks by distance: the pure mappings
    │   ├── ambience-engine.ts           The ambience's Web Audio graph on the shared context: rain loop, footsteps, calls, door creak and knock; loaded on demand (#911)
    │   ├── haptics.ts                   Touch buzz beside the cues (place, wall snap, refused): coarse pointer, reduced motion, per-device switch
    │   ├── wall-edit.ts                 Moving drawn walls: slide, end moves, corners that follow, what rides along (#718)
    │   ├── wall-snap.ts                 Wall endpoint snap: vertices, wall bodies, 15° steps, the 0.1 m grid; typed lengths (#723)
    │   ├── measure-snap.ts              The measure tool's snap (#921): corners, item centres and side middles, then item sides and wall faces; no clamp to the house
    │   ├── plan-dimensions.ts           Pinned dimensions (#921): validity, caps and clamps for the schema and reducer; ends on an outer wall follow a resize or a cut
    │   ├── plan-image-ref.ts            The light half of the plan image store (#936): ref checks, the images this tab confirmed stored, a save's compact form; loads the store on first use
    │   ├── plan-image-store.ts          Floor-plan images in IndexedDB keyed by SHA-256 (#936, loaded with import()): stored and read back before a save names one by ref, loads swap it back, files inline it; without IndexedDB it stays inline
    │   ├── opening-snap.ts              Door/window snap + shared wall-mount settle rule
    │   ├── walk-collision.ts            Walkthrough circle-vs-OBB slide against furniture, partitions, the shell (door gaps, porch) and the street; advanceWalker over walk-world; sightBlocked / buildSightWalls for line of sight
    │   ├── npc-bodies.ts                The player and the walkers as each other's obstacles: walker bodies for the player's resolve, the player's spot and seat for the walkers (#585)
    │   ├── npc-needs.ts                 Walkers' hunger, energy, fun and hygiene: decay, refill, what meets each (fridge/stove, bed/sofa, TV/computer/bookshelf, toilet/shower/bath/basin), the weighted destination pick and the chairs at a table where a fetched meal is eaten (`pickMealSpot`, #617, #904); what each storey lacks for the Statistics Household block (`householdLacks`, #906)
    │   ├── npc-schedule.ts              The hour the walkers keep: the sleep window (23:00 to 07:00) and how the hour tilts the needs (rest at night, hunger at mealtimes) (#907)
    │   ├── npc-garden.ts                The walkers' garden (#913): the ground storey's lot for the nav (doorways, porch, slope, fences, neighbours), the bench to rest on, barbecue, pool and picnic table for fun, closed in rain and at night
    │   ├── npc-path.ts                  Walker (NPC) free-space grid, regions, A* + string-pulled routes, destinations (#452); a coarser lot grid joined at outside doors (#913)
    │   ├── npc-seats.ts                 Where walkers sit: seat slots (the end of a bed too), facing, approach points (from the side or behind for a chair pushed in, #904)
    │   ├── walker-card.ts               What the walkers show (#906): the needs nothing a walker can reach meets (`strandedNeeds`), the thought bubble's need (`bubbleNeed`), and the card store the walk publishes to at 2 Hz
    │   ├── walker-card-text.ts          The walker card's words (#906): seeded first names (unique across the house), the activity line, bar labels and what is missing; loaded with the card
    │   ├── seat-surface.ts              Sitting-surface height per seat type, from the builders: one table for the walkers and the seated player (#623)
    │   ├── walk-input.ts                Walkthrough frame-time cap, which keydowns walk (no Ctrl/Cmd/Alt chords), E to interact, keys typed into a field ignored
    │   ├── walk-world.ts                What the walker stands on: floor plates, stair treads as a ramp, porch and steps, sloped lot
    │   ├── walk-spawn.ts                Walkthrough spawn (inside the entrance door) and arrival at the stairs on a floor change
    │   ├── walk-interact.ts             Seats, (at night) lamps and TVs in reach for `E` (#910), and the seated pose (facing the TV), never through a wall or across the shell (#566)
    │   ├── wall-sides.ts                The two faces of a partition: which one faces a point, painting one (#720)
    │   ├── walkthrough-view.ts          Walkthrough display: walls + roof up, ceiling above, stairwell pit below (#359); the mode to return to on exit
    │   ├── room-stamp.ts                The room stamp as a held placement: snapped position, drag to size, the walls a drop adds (#724)
    │   ├── room-detect.ts               Rooms closed by walls: planar faces of the footprint, partitions and keep-out, with areas (#719)
    │   ├── room-transfer.ts             A room moved, mirrored, copied or pasted with its walls, items and zones as one plan, refused on any overlap (#925)
    │   ├── room-shapes.ts               Predefined room shape presets
    │   ├── room-score.ts                Room types from a zone's furniture and a five-check score (decor, window, lamp, no collisions, space) for Statistics (#613), the room goals (#903), the plan's stars line and the zone chip's hint (#905)
    │   ├── storeys.ts                   Per-storey heights: elevations, eaves, stair rise
    │   ├── shortcut-overlay.ts          Whether the `?` shortcut overlay is open: toggled by `?` and the Help menu; the ghost and wall-length keys give way to it (#932)
    │   ├── site.ts                      Sloped ground (garden items stand on it, #665), neighbour flags, lot/road dimensions
    │   ├── street-row.ts                Seeded street generator: house specs + window rules
    │   ├── sun-shadow.ts                Shadow-caster box + sun shadow-camera fit (#282)
    │   ├── night-lights.ts              Which items light the night, bulb heights, candela; the lamp pool (#215, #393)
    │   ├── street.ts                    Window sills, recessed entrance, frontage
    │   ├── dormers.ts                   Dormer slope fitting + opening layout; dormers swapping across when a gable's ridge turns, the ones a pitch can't take (#916)
    │   ├── roof-shape.ts                The roof's shape: peak height, pitch, ridge axis, eave overhang, the party walls that rule out a north–south ridge; read by the roof, dormers, GLB, street and camera framing (#916)
    │   ├── door-clearance.ts            What stands in a door's swing: a soft warning for the plan and the popover, never a collision (#917)
    │   ├── door-swing.ts                How a door swings open in EXPLORE: openness by distance, eased angle, side away from the walker (#605)
    │   ├── opening-style.ts             Door and window types: single, double, sliding, arch; standard, tall, fixed; leaf spans and the arch head (#922)
    │   ├── stairs.ts                    Tread layout (straight / winder), headroom stairwells, plan symbol
    │   ├── stairwell-rail.ts            The guard rail round a stairwell on the floor above: runs along the hole, open at the arrival and along walls; scene, walker, plan and exports (#923)
    │   ├── zones.ts                     Room zones: rect and polygon validation, clamping, re-fit to detected rooms (#719), per-zone stats (porch left out, #582)
    │   ├── view-options.ts              View-menu switches and the view each one needs (#341); view invariants (zone drawing is 2D only, #439; wall or zone drawing parks the distance tool, #921)
    │   ├── plan-view-fit.ts             What the on-screen plan and minimap fit (room + outdoor items, far ones as edge markers) and where beside the desktop HUD (#381)
    │   ├── editor-notices.ts            notify() status messages, with an optional action button such as Undo (#651), notifyRefused(), zone-name requests (#374)
    │   ├── photo-mode.ts                Photo mode switch (enter/leave/subscribe) and the photo's size and file name (#626)
    │   ├── photo-album.ts               The photo album (#912, loaded with import()): per-house JPEG copies in IndexedDB (memory fallback), the 30-photo cap with oldest-out after asking, cross-tab notices, a photo as a file for the share sheet where it takes an image
    │   ├── photo-presets.ts             Photo mode's shot presets (#912): a camera preset with an hour and a weather, and the scene's "17:00 · Clear" label
    │   ├── confirm-dialog.ts            askConfirm(): the in-app question queue that replaces window.confirm (#649)
    │   ├── overlay-queue.ts             Small-screen overlay policy: compact queries, toast queue, stack placement
    │   ├── plan-order.ts                2D layer order: rugs → floor → tabletop → hung → wall (#286)
    │   ├── floor-plan-fit.ts            Floor-plan image placement per fit mode or calibration, the one rectangle the 2D plan, blueprint and 3D floor paint (#191, #726); two-point calibration maths; `planIsDrawing` (drawing vs underlay, #920)
    │   ├── file-io.ts                   JSON / image / PNG / CSV + schedule / GLB I/O
    │   ├── file-drop.ts                 A file dropped on the page: files in the drag, JSON or not, backup or house, why a drop is refused (#934)
    │   ├── format.ts                    The one length and age format: formatMetres ("2.00 m", or 8' 2" in feet and inches, #725), formatSize, formatArea (m² / sq ft), parseLength (12'6", 12.5 ft, 3.5 m), the display-unit mirror the view store sets; formatAge ("3 min ago", #438); money with one fixed grouping, formatMoney ("$1,200", compact "$100M", #609)
    │   └── plan-export/                 2D-plan exporters (#230); svg, dxf, print and the blueprint load on click (#589)
    │       ├── plan-geometry.ts         Shared plan-space maths (corners, grid, openings, stairs, coverage, dimensions and pinned dimensions, schedule, bounds)
    │       ├── svg.ts                   Vector SVG plan emitter, one floor or the whole building (pure)
    │       ├── dxf.ts                   AutoCAD 2000 DXF plan emitter, one floor or the whole building (pure)
    │       ├── download.ts              Blob download + the one filename rule, exportFileName (DOM)
    │       ├── print-scale.ts           Print-to-scale maths the options panel and the plan fit read: paper, scale pick, items a sheet keeps (#435)
    │       ├── print-popup.ts           The print popup: opened inside the click, filled by code loaded after it (#589); prints once loaded (#445)
    │       └── print.ts                 Print-to-scale document: paper, orientation, scale, outdoor and all-floors options (#435, #405); popup → Save-as-PDF
    ├── three/                           Three.js builders, no React
    │   ├── furniture-builders.ts        Registry + factory: furniture type → mesh builder
    │   ├── builder-utils.ts             Shared types + mesh()/material()/softBox() helpers (soft chamfered edges, #755), dispose helpers (disposeScene on unmount, #213)
    │   ├── three-runtime.ts             The named three.js symbols the app uses; the engine's only runtime import (#411)
    │   ├── collision-tint.ts            See-through tint over every part of a colliding item (#167)
    │   ├── placement-ghost.ts           The placement ghost's faded mesh + footprint pad (#463 d)
    │   ├── drag-handlers.ts             Canvas mouse events: select/drag/hover/wall-pick
    │   ├── door-leaves.ts               Finds the door leaves in the scene and swings each for the nearest person on its storey, the player or a walker (#605, #908), telling the ambience when one starts to open or shuts (#911); shuts them all
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
    │   ├── room-builder.ts              Floor + walls (yOffset, ghosting); an upper storey's slab under its floor (#653)
    │   ├── building-export.ts           The whole building as a named graph, for the GLB export
    │   ├── usdz-export.ts               The export building as a 1:50 USDZ for AR Quick Look (#937): rigged people baked into their pose, mirrors folded into geometry, two-sided parts given an inside copy, three's USDZExporter
    │   ├── wall-openings.ts             Door / window → exterior wall cutouts
    │   ├── reveals.ts                   Window and door reveals in the outer walls: linings, and the set-back of the frame (#758)
    │   ├── interior-walls.ts            Drawn-segment interior walls with cutouts
    │   ├── stairwell-rail.ts            The stairwell guard rail mesh: posts, handrail, bottom rail and balusters merged per storey; hides with the partitions (#923)
    │   ├── measurement.ts               Distance-tool spheres + line (3D; the plan draws its own, canvas-2d/plan-measure.ts)
    │   ├── item-labels.ts               Floating sprite labels above items
    │   ├── need-bubbles.ts              Walkers' thought bubbles: one canvas atlas (a cell per need, views marked shared) and a sprite per walker, toggled in the step (#906)
    │   ├── roof.ts                      Flat / gable / hipped roof at its pitch and ridge (lib/roof-shape.ts); walkthrough attic ceiling (#487)
    │   ├── ceiling.ts                   Walkthrough ceiling + stairwell shafts up and down (#359)
    │   ├── dormers.ts                   Dormer boxes, joinery, Juliet rails; attic wells (#487)
    │   ├── neighbours.ts                The street's houses from their specs (merged + instanced)
    │   ├── terrain.ts                   Sloped ground + excavation faces
    │   ├── entrance.ts                  Recessed porch reveals, soffit, steps
    │   ├── baseboard.ts                 Skirting profile + door-gap runs
    │   ├── contact-shadow.ts            Paints the contact plan to a canvas and shows it on one quad over the floor (#754)
    │   ├── furniture-materials.ts       Material classes (fabric, wood, metal, …) and shared wood/fabric/leather detail textures (#756)
    │   ├── floor-patterns.ts            Procedural CanvasTexture floors
    │   ├── wall-patterns.ts             Procedural CanvasTexture walls
    │   ├── surface-maps.ts              Normal and roughness maps from a pattern's height tile (#757)
    │   ├── texture-settings.ts          Renderer anisotropy captured at init, for the CanvasTexture builders
    │   ├── texture-lru.ts               LRU cache for texture masters (evict + dispose)
    │   ├── signal-overlay.ts            Wi-Fi / CCTV ring overlays
    │   ├── camera-vision.ts             Directional CCTV vision-cone overlays; no alert through walls (#590), depth-tested under another storey or while walking (#552)
    │   ├── lighting.ts                  Sun-arc continuous time of day (+ weather overcast)
    │   ├── weather.ts                   Rain / snow particle field (one InstancedMesh; the fall runs in the vertex shader, #669)
    │   ├── frame-budget.ts              One capped, focus-paused frame budget for the decorative loops (#671)
    │   ├── ground-surfaces.ts           Generated grass, paving, asphalt, gravel and deck tiles, laid by world position with a macro layer on grass (#761, #924)
    │   ├── ground-patches.ts            Garden surfaces as low slabs on the ground line, one merged mesh per kind, weather tint; the lot and the GLB build them (#924)
    │   ├── night-glow.ts                Night material values: lit window glass, lamp shades, the street's lit panes (#759)
    │   ├── tv-screens.ts                TV screens switched on in EXPLORE: emissive values on the marked screen material, no light, no recompile (#910)
    │   ├── outdoor-lamps.ts             Keeps indoor lamps off outdoor materials: shared per-slot mask, patched light chunk (#664); the roof, and the outside face of shell walls and dormers (#814)
    │   ├── outdoor.ts                   Garden / path / bush scenery; perimeter trees merged per part
    │   └── sky.ts                       World-space sky dome, clouds and sun disc, painted from the sky profile (#761)
    ├── canvas-2d/render.ts              Pure 2D top-down renderer
    ├── canvas-2d/ground-plan.ts         Garden surfaces on the ground floor's plan, minimap and blueprint, behind the house; the draw gesture's draft (#924)
    ├── canvas-2d/opening-symbol.ts      Door swings and window double lines on the plan, minimap and blueprint
    ├── canvas-2d/plan-edit.ts           What only the on-screen plan draws while editing: wall draft, selected wall, zone handles, and their hit tests and drag maths
    ├── canvas-2d/plan-measure.ts        The measure tool on the plan (#921): the points and the snapped tip (edit layer), the pinned dimensions (plan and blueprint) and their hit test
    ├── canvas-2d/plan-zoom.ts           The on-screen plan's view zoom and pan (pinch, wheel, double tap back to the fit): view state over the fit, kept per canvas
    ├── canvas-2d/stairs-symbol.ts       Stair treads + climb arrow, stairwell voids on the floor above
    ├── plotcraft/icon.tsx               PlotCraft SVG icon set for UI panels (no icon library)
    ├── plotcraft/tokens.css             PlotCraft design tokens (colours, type, spacing, glass) and HUD classes
    ├── assets/people.glb                Rigged mannequin + idle, talk and walk clips (CC0, see assets/README.md)
    ├── hooks/
    │   ├── layout-reducer.ts            Action union + reducer (withActiveFloor)
    │   ├── use-layout-store.ts          Zustand store (reuses the reducer) + selectors
    │   ├── editor-view-store.ts         Per-editor Zustand store: view settings, catalog search, game mode, time auto-cycle, the length unit (per browser, never in the house, #725), lamps and TVs switched in EXPLORE (session only, #910)
    │   ├── use-layout-state.ts          Adapter over the store (activeFloor, actions)
    │   ├── use-three-scene.ts           Renderer / controls / RAF lifecycle
    │   ├── use-scene-effects.ts         Keyed scene-rebuild effects
    │   ├── use-item-drag.ts             Drag fast-path + camera wall-seat on drop
    │   ├── use-item-commands.ts         Rotate, twist, remove, duplicate, copy/paste, nudge and lock on the selection, with their refusals and cues
    │   ├── use-floor-keep-out.ts        Porch + stairwell keep-out for collisions, memoised (#285, #372)
    │   ├── use-canvas-2d-interaction.ts 2D plan select/drag + zone-draw via the renderer's inverse transform
    │   ├── use-item-placement.ts        Snapping + wall-aware catalog placement
    │   ├── use-import-export.ts         Screenshot / GLB / share link / JSON import
    │   ├── use-usdz-export.ts           The USDZ button (#937): build, then a real `rel="ar"` link the player taps (blob URL revoked on rebuild, edit, unmount); one-tap download elsewhere
    │   ├── use-file-drop.ts             The page-wide drop target for house and backup files, and the installed app's launch queue (#934)
    │   ├── use-photo-mode.ts            Photo mode: html[data-photo], the key guard, and the 2x capture through renderer.render + toBlob, downloaded or kept in the album (#626, #912); shot presets, with the scene's hour, weather and clock put back as it ends
    │   ├── use-photo-album.ts           One house's album photos, newest first, kept current across saves and deletes (#912)
    │   ├── use-walkthrough.ts           Walkthrough: PointerLock + WASD, touch look + stick, stairs, doors, sitting, floor changes
    │   ├── use-people-model.ts          Loads people.glb the first time a person or a walker needs it
    │   ├── use-npcs.ts                  Animated walkers per storey (keyed by floor id, parked while not drawn): spawn, route-following step, re-route on floor edits; giving way, sitting, activities
    │   ├── use-weather.ts               Rain / snow clock on the frame budget
    │   ├── use-ambience.ts              Rain on the roof, footsteps, birds, crickets and doors in EXPLORE, the sound tile's third setting (#911): steps and calls on the frame budget, muted while hidden
    │   ├── use-camera-presets.ts        Iso/top/front/corner + fit + focus; frames the house on compact screens; the camera pad's orbit and zoom; the floor switch's eased slide to the new storey (#930)
    │   ├── plan-calibration.ts          The traced plan's calibration session (#726): points picked, length step, move step
    │   ├── ground-draw.ts               The garden-surface tool (#924): which kind a drag on the plan lays, or off
    │   ├── scene-occluders.ts           Reads the HUD occluder rects: the 3D free region, the 2D plan insets and padding, the plan-gesture flag
    │   ├── use-camera-vision.ts         Vision-cone sweep on the frame budget
    │   ├── use-scene-life.ts            What moves on its own: the walk and its exit back to the mode before EXPLORE, walkers and the people model, weather, camera cones; the clock ref the walkers read (#907); the door swinger, for the player and the walkers (#908)
    │   ├── use-history.ts               Snapshot undo/redo
    │   ├── use-achievements.ts          Unlock detection; `markLayoutLoaded()` after a whole-house load (#450)
    │   ├── use-storage-persist.ts       Asks `navigator.storage.persist()` after the first real edit of a session (not a load); a no is asked again, Firefox only after a week (#928)
    │   ├── use-load-template.ts         A template over the house through the whole-house load path (Templates panel, start chooser)
    │   ├── use-start-challenge.ts       A challenge brief's empty house through the whole-house load path (#909)
    │   ├── use-first-steps.ts           Getting started session: steps done (edits, `markFirstStep` for walk and share), stored with the offered/dismissed card (#721)
    │   ├── use-whats-new.ts             What's new session (#931): closed, offered once after an update, or asked for from Help; `whatsNewMounts` keeps it out of tours, EXPLORE and photo mode
    │   ├── use-set-game-mode.ts         DESIGN / FURNISH / EXPLORE switch with what it brings along (mode panel, First steps card)
    │   ├── use-recent-colors.ts         Persisted LRU colour palette
    │   ├── use-keyboard-shortcuts.ts    Centralised key handling
    │   ├── use-keyboard-placement.ts    Enter-on-tile placement session, tile click → ghost pick-up, roving tile focus
    │   ├── use-placement-ghost.ts       The ghost in hand: follows the pointer in 3D and 2D, click/tap places (#463 d), a drag lays a run (#915)
    │   ├── use-dialog-focus.ts          Overlay focus: move in, trap (with companions), Escape, restore
    │   ├── use-back-dismiss.ts          Android back closes the top surface (Escape dialogs, then drawer, then item sheet) via one CloseWatcher, in Escape order (#926)
    │   ├── use-shift-held.ts            Whether Shift is down, for tools that read it between pointer events (#723)
    │   ├── use-wall-edit.ts             The gesture of moving a selected wall, in both views: preview per move, one dispatch on release (#718)
    │   ├── use-room-stamp.ts            The room stamp in hand: ghost under the pointer, click to drop, drag to size (#724)
    │   ├── use-room-transfer.ts         The room transfer commands (#925): plan, hard budget, history step and the one cue per move, mirror, copy or paste
    │   ├── use-selection-actions.ts     The selection: primary, extras, selected wall; the ghost-selection guards, group expansion, custom sets (#117, #154, #224)
    │   ├── use-wall-draft.ts            The wall tool: draft anchor and snapped tip, typed length, room stamp in hand, resets on a tool or floor change (#723, #724)
    │   ├── use-measure-tool.ts          The distance tool's points and snapped tip, in both views; reset on a tool or floor change (#341, #921)
    │   ├── use-event.ts                 Stable-identity callback that runs the latest handler (memoised children)
    │   ├── use-exploring.ts             Whether the editor is in EXPLORE, and the hint on the house-editing controls it turns off (#643)
    │   ├── use-tour-phase.ts            The shared-link tour's phase as React state (#722)
    │   ├── use-service-worker.ts        Registers the offline worker once the first frame is on screen (#933)
    │   ├── roving-keys.ts               The arrow keys of a tablist or radio group: one tab stop, arrows activate (#434, #646)
    │   ├── use-refusal.ts               `refuse(message)` for store-reading panels: the refused cue (muted with the sounds) and an error notice (#588, #642)
    │   ├── use-media-query.ts           matchMedia as a hook (false on the server)
    │   ├── use-apple-keys.ts            Whether keys are written the Mac way (⌘, ⇧); false on the server (#932)
    │   ├── use-reduced-motion.ts        The OS reduce-motion setting as a hook (gates weather, walkers, cone sweep)
    │   ├── use-pausable-timeout.ts      Countdown that pauses and resumes with the time left (toasts)
    │   ├── use-scroll-cue.ts            data-scrollable / data-more-before / -after on a HUD scroller (#426)
    │   ├── use-edge-var.ts              Publishes an element's top or bottom edge as a CSS variable (#308); places the touch row in the top bar
    │   ├── use-sheet-inset.ts           --pc-sheet-height while the phone item sheet is open (mode bar rides above it)
    │   ├── use-house-loading.ts         The loads the editor makes on its own: the opening house (a share link's as a tour), a toured house kept (#722), another tab's save (#123), each by the load rules
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
        ├── variant-dots.tsx             Colour dots on a catalogue tile, and the per-tile colour picks (#621)
        ├── slider-row.tsx               Shared label + range + readout row
        ├── floor-switcher.tsx
        ├── walls-panel.tsx
        ├── zones-panel.tsx              Room zones: list, rename, recolour, delete, draw toggle, name a detected room
        ├── roof-panel.tsx
        ├── site-panel.tsx               Slope, neighbours + street, frontage, entrance
        ├── grounds-panel.tsx            Garden surfaces (#924): pick a kind to lay on the plan; list with kind, size, remove
        ├── room-settings-panel.tsx
        ├── furniture-catalog-panel.tsx
        ├── placed-items-panel.tsx
        ├── item-resize-panel.tsx
        ├── stair-headroom-note.tsx      Warning in the stairs controls when a flight is short of headroom
        ├── align-panel.tsx
        ├── templates-panel.tsx          Template select and the Challenges list (#909)
        ├── challenge-chip.tsx           The brief's checklist, pinned under the house card, ticking off live; none in a tour or on a walk, hidden under a top chip (#909)
        ├── themes-panel.tsx
        ├── library-panel.tsx
        ├── recovery-entry.tsx           History rows for kept recovery copies: restore, download, delete
        ├── sets-panel.tsx
        ├── statistics-panel.tsx
        ├── storage-panel.tsx            Manage card: storage meter, delete restore points / saved layouts, back up and restore everything, kept-by-browser and last-backup lines (#615, #620, #928)
        ├── file-drop-overlay.tsx        Shown while a file is dragged over the page: what dropping it does, or why it can't (#934)
        ├── header-stats.tsx
        ├── time-of-day-panel.tsx
        ├── camera-presets-panel.tsx
        ├── camera-pad.tsx
        ├── touch-mode-toggle.tsx        Touch camera buttons: orbit / pan, zoom, fit
        ├── floor-pill.tsx
        ├── room-shapes-panel.tsx
        ├── wall-draw-chip.tsx           The wall tool's status chip and its typed-length field (#723)
        ├── dock-fold.tsx                Fold toggle for the wall tool's panels in the phone dock
        ├── walk-hud.tsx                 Walkthrough HUD: lock-state hints, sit prompt, floor + clock; touch stick and buttons
        ├── walker-card.tsx              The walker card a tap on a walker opens beside the tap: name, what it is doing, a bar per need, what it can't find (#906); lazy, Escape in the capture phase, back above the item sheet
        ├── wall-display-pill.tsx
        ├── wall-paint-panel.tsx
        ├── actions-panel.tsx
        ├── print-options.tsx            Print / PDF button and its folding options (paper, orientation, scale, outdoor, every floor)
        ├── shortcuts-panel.tsx          Shortcut sheet, drawn from the key table (lib/keymap) by context, platform-aware (#932)
        ├── shortcuts-overlay.tsx        The `?` overlay's host (state in lib/shortcut-overlay); loads the dialog on first use (#932)
        ├── shortcuts-dialog.tsx         The `?` overlay: the key table in a focus-trapped modal, closed by ?, Escape, back or the backdrop (#932)
        ├── welcome-banner.tsx           First-run start chooser: start empty, a template (with its plan), or a random one (#721)
        ├── first-steps-card.tsx         Getting started checklist: each step arms its tool, the next one shows its tips; a thin occluding line on phones (#721)
        ├── whats-new-card.tsx           What's new card (#931): loads the lines when it opens and shows them in Getting started's place (which steps aside); closes quietly when nothing is news
        ├── hud-card.tsx                 The card frame Getting started and What's new share: heading, note, close button, a scene occluder
        ├── minimap.tsx
        ├── plan-thumb.tsx
        ├── achievements-panel.tsx
        ├── achievement-toast.tsx        Unlock toasts, one at a time: above the mode panel on desktop, the toast slot on small screens
        ├── announcer.tsx                The polite `role="status"` node `lib/announce` speaks through, rendered once by the orchestrator (#929)
        ├── overlay-stack.tsx            Shared small-screen column under the pills: save notices, then toasts
        ├── placement-hint.tsx           Key hint chip while a keyboard placement or a ghost is pending (Cancel for touch)
        ├── photo-bar.tsx                Photo mode's shutter: Presets, Take photo, Save to album, Album and Done, the one HUD left on screen (#626, #912)
        ├── photo-album.tsx              The album above the shutter: each photo's age, hour and weather, Share (where the sheet takes an image), Download and Delete (#912)
        ├── tour-banner.tsx              The shared-link tour's HUD: the house's name, Walk through, Keep a copy, Build your own (#722)
        ├── status-toast.tsx             Status chips for notify() — export / share outcomes
        ├── confirm-dialog.tsx           The askConfirm() modal: focus trap, Enter confirms, Escape cancels (#649)
        ├── room-transfer-row.tsx        The zone chip's room row: Select room, then move by arrows, mirror, copy and paste it with its walls (#925)
        ├── zone-name-chip.tsx           Zone tool chip: the draw-mode status and Done (#439), the selected room's stars and what it lacks (#905), then the inline name field
        ├── plan-calibration-chip.tsx    Floor plan calibration chip (#726): pick two points, type the length, drag into place
        ├── ground-draw-chip.tsx         The garden-surface tool's chip (#924): what a drag lays, Done; ends the tool off the ground floor's plan
        ├── dev-diagnostics.tsx          `?debug` overlay: draw calls, triangles, geometries, textures, programs, frames
        ├── chip-controls.tsx            Chip buttons + inline name field (no native prompts)
        └── viewport.tsx
```
