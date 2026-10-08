# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.16.0] - 2026-10-08

The **Rendering & lighting polish** milestone: real nights, a walkthrough you can stand inside, and furniture that looks like what it is.

### Added
- **Walkthrough feels like a house:** every wall and the roof stay up while you walk (your Up/Cut/Down choice comes back when you leave), lower storeys have a ceiling, and stairwells are lined up and down instead of opening onto the sky or the garden ([#359](https://github.com/ch-bas/threejs-sims-house-builder/issues/359))
- **Lamps light the room at night** — floor lamps, table lamps, pendants and lampposts cast warm light, using a small fixed set of lights given to the lamps nearest you, so it stays fast with many lamps ([#215](https://github.com/ch-bas/threejs-sims-house-builder/issues/215), [#393](https://github.com/ch-bas/threejs-sims-house-builder/issues/393))

### Fixed
- Nights are actually dark: the sky fill, ambient and environment fade through a smooth dusk instead of switching at 06:00 and 18:00, and weather darkens the night too ([#215](https://github.com/ch-bas/threejs-sims-house-builder/issues/215), [#375](https://github.com/ch-bas/threejs-sims-house-builder/issues/375))
- Shadows: the sun's shadow now covers the whole lot, including tall houses and the street, and uses soft shadows that still exist in the current Three.js (the console warning on every load is gone) ([#282](https://github.com/ch-bas/threejs-sims-house-builder/issues/282), [#379](https://github.com/ch-bas/threejs-sims-house-builder/issues/379))
- No stall at the first dusk with lamps placed ([#393](https://github.com/ch-bas/threejs-sims-house-builder/issues/393))
- The traced floor plan in 3D now matches the 2D plan: correct colours, no smeared edges in "contain" fit, and the 3D relief lines up with the image ([#191](https://github.com/ch-bas/threejs-sims-house-builder/issues/191), [#227](https://github.com/ch-bas/threejs-sims-house-builder/issues/227), [#383](https://github.com/ch-bas/threejs-sims-house-builder/issues/383))
- Every roof style is shingled properly — the hipped roof had none — at the same scale on any house size ([#211](https://github.com/ch-bas/threejs-sims-house-builder/issues/211))
- The snap grid no longer flickers through the floor ([#371](https://github.com/ch-bas/threejs-sims-house-builder/issues/371))
- Pools, bathtubs and ponds show their water; dormers are glazed from the street; the grey slab under windows is gone; paintings, lamp shades, bushes, stair rails, the TV, the pet and the Wi-Fi antennas fit their size ([#365](https://github.com/ch-bas/threejs-sims-house-builder/issues/365), [#369](https://github.com/ch-bas/threejs-sims-house-builder/issues/369), [#362](https://github.com/ch-bas/threejs-sims-house-builder/issues/362), [#388](https://github.com/ch-bas/threejs-sims-house-builder/issues/388), [#167](https://github.com/ch-bas/threejs-sims-house-builder/issues/167))
- The pendant light hangs from the ceiling of its storey, whatever its height ([#470](https://github.com/ch-bas/threejs-sims-house-builder/issues/470), [#471](https://github.com/ch-bas/threejs-sims-house-builder/issues/471))
- Painting a wall or drawing a partition no longer rebuilds every piece of furniture; closing the editor frees the whole 3D scene from GPU memory ([#214](https://github.com/ch-bas/threejs-sims-house-builder/issues/214), [#213](https://github.com/ch-bas/threejs-sims-house-builder/issues/213))
- The zoom slider follows the real zoom (wheel included) and works with the arrow keys; dropping an item from the catalog plays its sound; colliding items fade completely; pages can be pinch-zoomed again on phones ([#167](https://github.com/ch-bas/threejs-sims-house-builder/issues/167))

Mornings and afternoons are slightly darker than before (about 2–3 %), and a floor plan at low opacity now shows the floor colour instead of the lawn through the floor — both deliberate, to match the 2D plan and the time of day.

## [1.15.0] - 2026-10-01

The **Data safety & history** milestone: a house that can't be opened, a full or blocked browser storage, a crafted link or an old save can no longer cost you your work.

### Added
- **Recovered copies.** When a saved house can't be opened, or you start fresh from the error screen, a copy is kept and listed in Manage → Saved Layouts → History with Restore, Download and Delete. Two copies are kept; a blank lot is never kept; the error screen offers Reload first and only offers to start fresh if the crash comes back ([#336](https://github.com/ch-bas/threejs-sims-house-builder/issues/336))
- Every house now has its own id, so two houses both called "My Home" keep separate restore points ([#342](https://github.com/ch-bas/threejs-sims-house-builder/issues/342))

### Fixed
- **A tiny share link could unpack to hundreds of megabytes**, and the failed save then deleted every restore point. Oversized links and JSON files are refused up front, and restore points are only ever given up for a real lack of space ([#332](https://github.com/ch-bas/threejs-sims-house-builder/issues/332))
- Saved houses are repaired, not rejected: names, ids and colours are trimmed, far-away items are pulled in, and over-full floors are cut down (always keeping the porch door and wall), with the original kept aside — a house over the limits used to be replaced by a blank one on reload. Duplicate ids are fixed on load ([#332](https://github.com/ch-bas/threejs-sims-house-builder/issues/332), [#338](https://github.com/ch-bas/threejs-sims-house-builder/issues/338), [#350](https://github.com/ch-bas/threejs-sims-house-builder/issues/350))
- When storage is full or blocked, the editor never writes over a saved house it couldn't back up, and the header says which it is: "Storage full" or "Saving is blocked in this browser" ([#472](https://github.com/ch-bas/threejs-sims-house-builder/issues/472), [#336](https://github.com/ch-bas/threejs-sims-house-builder/issues/336))
- "Changed in another tab" no longer appears for the same house, and no longer bounces between tabs ([#334](https://github.com/ch-bas/threejs-sims-house-builder/issues/334))
- Restore points: stable ids (a future-dated point could become "failed to restore"), houses with only zones, colours, size or roof changes are protected, and each load takes one restore point instead of two ([#344](https://github.com/ch-bas/threejs-sims-house-builder/issues/344), [#346](https://github.com/ch-bas/threejs-sims-house-builder/issues/346), [#352](https://github.com/ch-bas/threejs-sims-house-builder/issues/352))
- Received houses, custom sets and saved-layout entries that can't be read are kept and counted instead of silently deleted; a corrupt library entry no longer crashes the Library panel; the received-houses board keeps 30 and says which one it dropped ([#340](https://github.com/ch-bas/threejs-sims-house-builder/issues/340), [#348](https://github.com/ch-bas/threejs-sims-house-builder/issues/348), [#355](https://github.com/ch-bas/threejs-sims-house-builder/issues/355))
- The welcome dialog says "Welcome to the game"

## [1.14.0] - 2026-10-01

The **Editor integrity** milestone: 53 fixes from the September audit, so that what you see, undo, collide with and save is what you meant.

### Added
- A **View options** menu (eye icon in the mode panel) for the distance tool, item labels, the 2D cost heatmap, outdoor scenery, and snap to walls / snap to items — all of which existed but had no control ([#341](https://github.com/ch-bas/threejs-sims-house-builder/issues/341))
- Wall drawing snaps onto an existing wall or the building edge for clean T-junctions ([#412](https://github.com/ch-bas/threejs-sims-house-builder/issues/412))
- Loading a template, a saved house, a received house, a restore point or a JSON file asks before replacing a house with work in it, and says what it loaded ([#364](https://github.com/ch-bas/threejs-sims-house-builder/issues/364))
- Inline naming and status messages instead of browser pop-ups for zones, furniture sets, share links and export failures ([#374](https://github.com/ch-bas/threejs-sims-house-builder/issues/374))

### Fixed
- **Undo right after reloading no longer replaces your house with the blank default** ([#354](https://github.com/ch-bas/threejs-sims-house-builder/issues/354)); each delete, duplicate, paste or placement is its own undo step ([#425](https://github.com/ch-bas/threejs-sims-house-builder/issues/425)), and cancelling a keyboard placement can't be undone back into existence ([#356](https://github.com/ch-bas/threejs-sims-house-builder/issues/356))
- The Buy-tab catalog in the side panel was collapsed to a sliver ([#360](https://github.com/ch-bas/threejs-sims-house-builder/issues/360)); dragging "Winder Stairs" from it placed straight stairs ([#370](https://github.com/ch-bas/threejs-sims-house-builder/issues/370))
- Resizing the window or rotating a phone while in 2D left the 3D view blank ([#363](https://github.com/ch-bas/threejs-sims-house-builder/issues/363))
- Resizing the room moves doors, windows and cameras with their walls and keeps zones inside the house; typed sizes apply on Enter ([#431](https://github.com/ch-bas/threejs-sims-house-builder/issues/431))
- The recessed entrance's back wall can't be deleted and its door can't wander off the porch ([#357](https://github.com/ch-bas/threejs-sims-house-builder/issues/357)); windows and doors settle on the walls either side of the porch opening ([#394](https://github.com/ch-bas/threejs-sims-house-builder/issues/394)); the porch shell appears exactly where its wall does ([#392](https://github.com/ch-bas/threejs-sims-house-builder/issues/392))
- Furniture collides with interior walls ([#368](https://github.com/ch-bas/threejs-sims-house-builder/issues/368)) and with the stairwell hole on the floor above ([#372](https://github.com/ch-bas/threejs-sims-house-builder/issues/372)); pictures, mirrors and shelves hung over a sofa no longer read as collisions, and their selection outline frames the piece ([#376](https://github.com/ch-bas/threejs-sims-house-builder/issues/376)); outdoor items are allowed in the porch ([#406](https://github.com/ch-bas/threejs-sims-house-builder/issues/406)); lamps on side tables and armchairs at tables stack ([#403](https://github.com/ch-bas/threejs-sims-house-builder/issues/403))
- A shortened staircase no longer cuts a bigger hole in the floor above ([#366](https://github.com/ch-bas/threejs-sims-house-builder/issues/366)); the walker and the walls agree about door gaps ([#399](https://github.com/ch-bas/threejs-sims-house-builder/issues/399))
- Group drag works in both views ([#291](https://github.com/ch-bas/threejs-sims-house-builder/issues/291)); a cancelled touch drag puts items back instead of dropping them ([#292](https://github.com/ch-bas/threejs-sims-house-builder/issues/292)); items keep their grab point while dragged ([#292](https://github.com/ch-bas/threejs-sims-house-builder/issues/292))
- Locks pin position, not existence: Delete, Demolish and the Placed Items ✕ all remove locked items ([#358](https://github.com/ch-bas/threejs-sims-house-builder/issues/358)); auto-organize leaves locked items where they are ([#389](https://github.com/ch-bas/threejs-sims-house-builder/issues/389)); resize and mirror respect locks ([#408](https://github.com/ch-bas/threejs-sims-house-builder/issues/408)); duplicates start unlocked ([#353](https://github.com/ch-bas/threejs-sims-house-builder/issues/353))
- The selection outline no longer has a metre-wide click halo ([#333](https://github.com/ch-bas/threejs-sims-house-builder/issues/333)) or disappears after changing wall display ([#335](https://github.com/ch-bas/threejs-sims-house-builder/issues/335))
- Wall-draw mode: clicks on furniture place wall points, Escape twice leaves the mode, and its hint is no longer hidden under the floor pill ([#349](https://github.com/ch-bas/threejs-sims-house-builder/issues/349), [#473](https://github.com/ch-bas/threejs-sims-house-builder/issues/473))
- EXPLORE clears the selection and ignores edit shortcuts ([#339](https://github.com/ch-bas/threejs-sims-house-builder/issues/339)); a refused pointer lock says "Click again to look around" ([#351](https://github.com/ch-bas/threejs-sims-house-builder/issues/351)); Caps Lock no longer disables the F, M, G, W and P shortcuts ([#294](https://github.com/ch-bas/threejs-sims-house-builder/issues/294))
- Cloning a floor no longer floats the garden in the sky ([#345](https://github.com/ch-bas/threejs-sims-house-builder/issues/345)); garden items can't be placed or pasted upstairs, with a reason on the tile ([#347](https://github.com/ch-bas/threejs-sims-house-builder/issues/347), [#293](https://github.com/ch-bas/threejs-sims-house-builder/issues/293)); custom furniture sets put doors on walls and garden pieces outdoors ([#384](https://github.com/ch-bas/threejs-sims-house-builder/issues/384)); snap-to-wall no longer pulls garden items into the house ([#380](https://github.com/ch-bas/threejs-sims-house-builder/issues/380))
- The porch door no longer counts as furniture in items, cost or achievements ([#382](https://github.com/ch-bas/threejs-sims-house-builder/issues/382))
- The item popover works with the side panel open ([#361](https://github.com/ch-bas/threejs-sims-house-builder/issues/361)); tabs open at the top ([#378](https://github.com/ch-bas/threejs-sims-house-builder/issues/378)); the Two-Story Home template is listed ([#343](https://github.com/ch-bas/threejs-sims-house-builder/issues/343)); rotation shows 0–359° ([#387](https://github.com/ch-bas/threejs-sims-house-builder/issues/387)); the hexagon room stamp fills its size ([#414](https://github.com/ch-bas/threejs-sims-house-builder/issues/414)); a roof colour no longer adds a roof ([#428](https://github.com/ch-bas/threejs-sims-house-builder/issues/428)); the History list refreshes in place ([#367](https://github.com/ch-bas/threejs-sims-house-builder/issues/367))
- The editor no longer crashes where the browser blocks storage ([#396](https://github.com/ch-bas/threejs-sims-house-builder/issues/396))
- No-op edits no longer create undo entries or autosaves ([#416](https://github.com/ch-bas/threejs-sims-house-builder/issues/416)); out-of-range values can no longer produce a save that fails to load ([#418](https://github.com/ch-bas/threejs-sims-house-builder/issues/418))

### Internal
- Shared helpers: `lib/safe-storage.ts`, `lib/mount-band.ts`, `lib/floor-keep-out.ts`, `lib/view-options.ts`, `lib/editor-notices.ts`; `hasCollisions` takes a `{ keepOut, interiorWalls }` context; one door-gap rule for walls and walker; `stairsDirection` retired (old saves still load) ([#410](https://github.com/ch-bas/threejs-sims-house-builder/issues/410), [#337](https://github.com/ch-bas/threejs-sims-house-builder/issues/337), [#422](https://github.com/ch-bas/threejs-sims-house-builder/issues/422))
- Test suite: 820 → 1014 tests

## [1.13.0] - 2026-09-30

The **2D plan & export** milestone: the plan, minimap, blueprint, SVG and DXF now show what the 3D house is made of, and the exports fit their page.

### Added
- Stairs on the plan draw their treads and a climb arrow instead of a ladder icon, and the floor above shows the stairwell as a dashed "open below" void — the same hole the 3D slab cuts — on the plan, minimap, blueprint, SVG and DXF (new `STAIRWELL` layer) ([#290](https://github.com/ch-bas/threejs-sims-house-builder/issues/290))
- The recessed entrance appears on the plan: the front wall breaks across the opening, the porch cheeks run back to its wall, the recess is outside (grass on screen, paper on the blueprint), the blueprint's floor area excludes it, and furniture dragged into the porch is flagged like furniture through a wall ([#285](https://github.com/ch-bas/threejs-sims-house-builder/issues/285))
- The floor switcher shows each storey's height and the building's height to the eaves; the Site and Roof panels say they are shown in 3D only while the plan is up ([#289](https://github.com/ch-bas/threejs-sims-house-builder/issues/289))

### Fixed
- Wall-mounted items and low items no longer hide under the furniture around them on the plan: doors, windows, rugs and tabletop items draw and hit-test in a layer-aware order, with a little slack for thin wall marks ([#286](https://github.com/ch-bas/threejs-sims-house-builder/issues/286))
- The SVG and print sheet now follow the plan's content: a tree or pool outside the walls is inside the sheet with the title, dimensions and scale bar clear of it ([#287](https://github.com/ch-bas/threejs-sims-house-builder/issues/287))
- Print to scale picks portrait or landscape and goes up to 1:1000 so a whole lot fits an A4 page, keeps labels and line weights readable at every scale, and says "Not to scale" instead of claiming a scale it can't honour; DXF text with accents, symbols or percent signs opens correctly in CAD; the first blueprint print carries the tracing image ([#288](https://github.com/ch-bas/threejs-sims-house-builder/issues/288))
- Starting to draw a zone or wall with the side panels open no longer closes the panels instead of drawing: the drawer steps out of the way while a draw mode is on ([#323](https://github.com/ch-bas/threejs-sims-house-builder/issues/323))

### Internal
- TypeScript `exactOptionalPropertyTypes` and `verbatimModuleSyntax` are on, and lint adds type-aware checks (floating promises, exhaustive switches, type-only imports) using the plugin the Next config already ships ([#162](https://github.com/ch-bas/threejs-sims-house-builder/issues/162))

## [1.12.0] - 2026-09-30

The **Gameplay & delight** milestone.

### Added
- DESIGN and FURNISH are real modes: DESIGN shows the structure tools (openings, walls) and the structure catalog and switches the sidebar to Build; FURNISH shows the furniture categories and switches to Buy. The tab only follows a mode change, so your own tab choice sticks ([#151](https://github.com/ch-bas/threejs-sims-house-builder/issues/151))
- Persistent furniture groups: Group a selection and clicking any member selects the whole group in both views; Alt-click picks one member; drag, rotate, align, copy and delete all act on the group. Ungroup from the same chip ([#154](https://github.com/ch-bas/threejs-sims-house-builder/issues/154))
- Room zones: draw a named, coloured rectangle on the 2D plan and the plan, blueprint, SVG export and Statistics panel report that room's cost, item count and area ([#155](https://github.com/ch-bas/threejs-sims-house-builder/issues/155))
- Walkthrough collides with furniture and interior walls — sliding along sofas and partitions instead of walking through them, and passing through doorways ([#156](https://github.com/ch-bas/threejs-sims-house-builder/issues/156))
- Keyboard placement: Tab to a catalog tile, Enter to place it at the room centre, arrows and R to position, Enter to confirm, Esc to cancel — with an on-screen hint ([#168](https://github.com/ch-bas/threejs-sims-house-builder/issues/168))
- Weather: Clear, Rain or Snow over the lot from the Time of Day panel, with overcast lighting and a snow-white or rain-dark ground; nothing falls indoors ([#189](https://github.com/ch-bas/threejs-sims-house-builder/issues/189))
- Paste-board: paste a friend's share link into the library to keep their house without replacing your own, with a thumbnail, and load it later (undoable) ([#190](https://github.com/ch-bas/threejs-sims-house-builder/issues/190))
- Save a selection as a reusable custom furniture set, with its colours and sizes, placed from the Furniture Sets panel like the built-ins ([#302](https://github.com/ch-bas/threejs-sims-house-builder/issues/302))
- Plan thumbnails on Library, Paste-board and History rows, plus a "what changed" line on restore points ([#303](https://github.com/ch-bas/threejs-sims-house-builder/issues/303))

### Fixed
- The multi-select chip and the placement hint no longer hide behind the header stats at narrow desktop widths

## [1.11.0] - 2026-09-30

The **Real Streets hardening** milestone: a street of neighbours, and the recessed entrance, low storeys and winder stairs made solid.

### Added
- A street of neighbours. *Street* continues the row of houses along the street in both directions; *Across the road* adds a facing row. Every house is different — width, storeys, roof style and colour, brick or render, windows, bays, dormers, doors, chimneys — but the street is seeded, so a design always shows the same one, and *Shuffle street* rolls a new one (undoable). Houses sit on the ground under them on a sloped site, and the immediate neighbours still match the house's eaves so a terrace reads as one ([#310](https://github.com/ch-bas/threejs-sims-house-builder/issues/310))
- The Site panel says why a recessed entrance can't be built ("No storey at street level…") instead of showing it as on with nothing rendered, and the entrance and dormer Offset and Width fields clamp to what actually fits ([#281](https://github.com/ch-bas/threejs-sims-house-builder/issues/281))

### Fixed
- The entrance door no longer vanishes for good when the recess is momentarily unbuildable (typing a storey height passes through values too low for it) or its storey is removed; duplicating a floor no longer clones a stray porch wall and door onto the copy; "Clear floor" and "Surprise me" keep the door ([#273](https://github.com/ch-bas/threejs-sims-house-builder/issues/273))
- A recessed entrance is no longer built underground when no storey is at street level — the default sloped-site preset used to bury the porch behind the earth face ([#274](https://github.com/ch-bas/threejs-sims-house-builder/issues/274))
- The porch back wall reaches the soffit on every storey height; on storeys under 2.8 m there was an open slot from the street into the house ([#275](https://github.com/ch-bas/threejs-sims-house-builder/issues/275))
- Porch reveals and soffit no longer flicker against the front wall, and the top step no longer sits in the plinth ([#276](https://github.com/ch-bas/threejs-sims-house-builder/issues/276))
- On low storeys, doors, windows and cameras fit inside the wall like their holes do, and the walkthrough eye stays under the ceiling — on a 2 m storey the door used to poke through it ([#277](https://github.com/ch-bas/threejs-sims-house-builder/issues/277))
- Winder stairs stay valid at any size: a stair too shallow for its fan lays out straight instead of producing floating or backwards treads and a broken hole in the floor above ([#278](https://github.com/ch-bas/threejs-sims-house-builder/issues/278))
- Retyping the same terrain or entrance value no longer adds an undo entry, and an entrance keystroke no longer rebuilds every floor's furniture ([#279](https://github.com/ch-bas/threejs-sims-house-builder/issues/279))
- Neighbour windows are sized to each facade and skip rows below the ground line ([#280](https://github.com/ch-bas/threejs-sims-house-builder/issues/280))

## [1.10.1] - 2026-09-30

The **Data safety & history** and **Responsive & mobile** milestones.

### Added
- A restore point is taken of the design on screen before anything replaces the whole house: opening a share link, loading a template or a saved layout, restoring from History, importing JSON, or adopting another tab's version. Opening a share link used to overwrite the stored house with no way back ([#298](https://github.com/ch-bas/threejs-sims-house-builder/issues/298))
- A Redo button beside Undo — Redo previously had a shortcut but no button ([#301](https://github.com/ch-bas/threejs-sims-house-builder/issues/301))

### Fixed
- Restore points can no longer fill browser storage and stop autosave: a save that doesn't fit now drops the oldest restore points and retries, and the history has its own size limit ([#295](https://github.com/ch-bas/threejs-sims-house-builder/issues/295))
- History rows show which house each restore point belongs to, and restoring puts the floor-plan image back only when it is the image that restore point was taken with — restoring one house while another's plan was loaded used to graft the wrong plan under it ([#296](https://github.com/ch-bas/threejs-sims-house-builder/issues/296))
- Restore points keep being taken after the system clock is corrected backwards, unchanged designs no longer use up slots, and the history is no longer read in full after every autosave ([#297](https://github.com/ch-bas/threejs-sims-house-builder/issues/297))
- Tablet widths (769–1100 px): the bottom panels no longer wrap, so the catalog stays on the bottom edge and the build tools no longer slide under the title ([#299](https://github.com/ch-bas/threejs-sims-house-builder/issues/299))
- Mobile: the touch camera buttons no longer cover the catalog's next-page arrow ([#300](https://github.com/ch-bas/threejs-sims-house-builder/issues/300))
- Mobile: Undo, Redo, snap, minimap, sounds, camera cones and walkers are reachable again — the whole row was hidden on phones. On desktop the same buttons are no longer squeezed below a comfortable size ([#301](https://github.com/ch-bas/threejs-sims-house-builder/issues/301))

## [1.10.0] - 2026-09-29

The **2D plan & export** milestone, animated people, and a round of robustness fixes.

### Added
- The 2D plan is fully interactive: click to select (Ctrl-click for multi-select), drag items with the same snapping, wall settling, lock-on-release and single undo entry as 3D, and drop catalog items straight onto the plan ([#219](https://github.com/ch-bas/threejs-sims-house-builder/issues/219), [#166](https://github.com/ch-bas/threejs-sims-house-builder/issues/166))
- Export the plan as a scalable **SVG**, a CAD-ready **DXF** (layers for walls, openings, furniture and labels; opens in AutoCAD/LibreCAD/QCAD), or a **print-to-scale PDF** with a title block and a declared scale like 1:75 on A4 ([#230](https://github.com/ch-bas/threejs-sims-house-builder/issues/230))
- Version history: automatic restore points (at most one per 5 minutes, plus one when the page closes) in a History section of the saved-layouts library. Restoring is undoable and keeps the current floor-plan image ([#231](https://github.com/ch-bas/threejs-sims-house-builder/issues/231))
- People are a rigged, animated mannequin: placed people hold a relaxed idle stance, and walkers stroll, stop at each waypoint to idle or talk, and walk on, with the walk cycle matched to their speed. The model (Quaternius' Universal Animation Library, CC0, ~420 KB) is only downloaded once a layout contains a person or the walkers are on
- A "Show walkers" toggle in the mode panel — the walking people existed but had no control to switch them on

### Fixed
- The 2D plan and printed blueprint draw the floor-plan tracing image like 3D does: 50% default opacity, the chosen cover/contain fit, and only on the ground floor ([#218](https://github.com/ch-bas/threejs-sims-house-builder/issues/218))
- The camera pad and the auto-cycle time button no longer pretend to work in 2D view, the minimap renders sharply on retina displays, and the 2D view stays crisp after moving the window between monitors with different pixel densities ([#220](https://github.com/ch-bas/threejs-sims-house-builder/issues/220), [#226](https://github.com/ch-bas/threejs-sims-house-builder/issues/226))
- Switching floors during walkthrough no longer snaps the first-person camera to an orbit pose, and movement keys no longer stick after Alt-Tabbing away mid-walk ([#216](https://github.com/ch-bas/threejs-sims-house-builder/issues/216))
- A drag whose item was rebuilt mid-gesture (a cross-tab load, for example) aborts cleanly instead of committing stale positions ([#207](https://github.com/ch-bas/threejs-sims-house-builder/issues/207) follow-up)
- Exporting a GLB with rigged people in the scene produces a valid file with the posed skeleton — it previously failed to open at all

### Changed
- The procedural person, now the fallback while the model loads or if it can't, is a jointed scale figure with a neck, shaped chest, hands and feet that swings its limbs to walk, instead of a floating ball over a tube with legs that slid up and down
- A person's colour paints their body instead of their skin, and resizing a person scales it evenly

## [1.9.1] - 2026-09-28

### Fixed
- Surprise me no longer stands paintings and mirrors loose in the room, where the thin raised panels looked like a second wall beside the real one; it hangs them flush on a wall, facing into the room ([#261](https://github.com/ch-bas/threejs-sims-house-builder/pull/261))

## [1.9.0] - 2026-09-28

Completes the **v1.9 — Real Streets** milestone: the realism track from [#195](https://github.com/ch-bas/threejs-sims-house-builder/issues/195).

### Added
- Per-storey heights: each floor can have its own floor-to-floor height (1–6 m) — a 2.5 m basement, a 1.1 m loft knee wall — set in Room Settings. Floors, walls, furniture, lamps, the roof, dragging, walkthrough, the camera and stairs all follow it; layouts without heights stack exactly as before ([#202](https://github.com/ch-bas/threejs-sims-house-builder/issues/202))
- Sloped sites: street and garden ground levels in the new Site panel. The road, pavement, path and planting follow the slope, the lot is dug out around the house with earth faces over the buried facade, and the plinth reaches down to falling ground ([#202](https://github.com/ch-bas/threejs-sims-house-builder/issues/202))
- Party-wall neighbours: terrace houses either side, sized off your eaves and roofed in your style, visible in every wall-display mode ([#202](https://github.com/ch-bas/threejs-sims-house-builder/issues/202), [#201](https://github.com/ch-bas/threejs-sims-house-builder/issues/201))
- Roof dormers on gable and hipped slopes, with real openings — ribbon windows, casement pairs, French doors with side lights — frames, mullions, transoms, glass, head trim, an optional Juliet balcony, and a colour finish, managed from the Roof panel ([#203](https://github.com/ch-bas/threejs-sims-house-builder/issues/203))
- A recessed entrance porch in the front wall on the storey at street level, with reveals, a soffit, steps up from the street, and an ordinary door on the wall across the back that follows the recess ([#204](https://github.com/ch-bas/threejs-sims-house-builder/issues/204))
- Pavement frontage: the pavement and road run right up to the front wall, town-terrace style ([#204](https://github.com/ch-bas/threejs-sims-house-builder/issues/204))
- Per-window sill height in the item panel; the wall cut and the window always agree ([#204](https://github.com/ch-bas/threejs-sims-house-builder/issues/204))
- Winder stairs: a half-turn dog-leg (up flight, winder fan, return flight) with a Straight/Winder switch and an up-flight lead-in in the item panel, and a "Winder Stairs" catalogue entry ([#205](https://github.com/ch-bas/threejs-sims-house-builder/issues/205))

### Changed
- Stairwells are sized for 2.0 m headroom (UK Approved Document K) instead of cutting the stair's whole footprint out of the floor above; a winder's stairwell is an L over its turn and return flight ([#205](https://github.com/ch-bas/threejs-sims-house-builder/issues/205))

### Fixed
- With "Show all floors" and all walls up, the house renders solid instead of the other storeys turning see-through ([#201](https://github.com/ch-bas/threejs-sims-house-builder/issues/201))
- Skirting boards stop at doorways, meet cleanly at the corners, and no longer flicker through the facade as a dark band ([#201](https://github.com/ch-bas/threejs-sims-house-builder/issues/201))
- Dragging a catalogue tile always drops that exact item, even when two entries share a type ([#205](https://github.com/ch-bas/threejs-sims-house-builder/issues/205))

## [1.8.15] - 2026-09-28

Completes the **Editor integrity** milestone.

### Fixed
- Loading a layout from Saved Layouts can be undone with Ctrl+Z, like a template load — it used to wipe the undo history, so one click on an old entry lost the current design for good ([#222](https://github.com/ch-bas/threejs-sims-house-builder/issues/222))
- Room Width/Depth inputs no longer resize the room mid-typing: clearing the field no longer snaps it to 5 m (which turned "12" into a 51 m, then 100 m room), values are kept within the fields' 2–20 m range, and blur/Enter restores or clamps ([#217](https://github.com/ch-bas/threejs-sims-house-builder/issues/217))
- Undo, delete, rotate, nudge, duplicate, paste, floor-switch and 2D shortcuts pressed mid-drag wait for the drop instead of corrupting the drag and overwriting the undo ([#207](https://github.com/ch-bas/threejs-sims-house-builder/issues/207))
- A wall removed by undo no longer stays "selected" in the paint panel, and imports, loads and floor switches clear stale wall selections and measurement points ([#224](https://github.com/ch-bas/threejs-sims-house-builder/issues/224))
- The Coverage stat (and the blueprint's footprint) no longer counts outdoor items, which must sit outside the room ([#164](https://github.com/ch-bas/threejs-sims-house-builder/issues/164))
- The wall paint panel no longer shows "All" as the target while an interior wall is selected, and only highlights a colour all four exterior walls actually share ([#221](https://github.com/ch-bas/threejs-sims-house-builder/issues/221))
- "Roof It" can actually be earned — it unlocked on its own for every new profile; it now takes a roof of your own (a new style or colour), and the roof builder, Roof panel and achievement agree on what a colourless roof looks like ([#165](https://github.com/ch-bas/threejs-sims-house-builder/issues/165))
- The shortcuts card, welcome tips and README match the real key bindings (P, Ctrl+C/V, Ctrl+Y, Backspace, Shift for 1 m nudges, EXPLORE mode, grid snap) ([#225](https://github.com/ch-bas/threejs-sims-house-builder/issues/225))
- Keyboard and screen-reader users: the side panels drawer behaves as a modal dialog (focus moves in, Tab stays inside, Escape closes it and returns focus), the item popover takes focus when it opens and hands it back when it closes, stacked overlays never both react to one keypress, the game-mode switcher is announced as toggle buttons, and the smallest labels are larger ([#152](https://github.com/ch-bas/threejs-sims-house-builder/issues/152))

### Changed
- "Clear floor" and "Clear interior walls" ask for confirmation first, like "Surprise me"; "Clear interior walls" is disabled when there are none ([#223](https://github.com/ch-bas/threejs-sims-house-builder/issues/223))
- "Open Plan" has its own achievement icon (🏷️) instead of sharing Window Watcher's

## [1.8.14] - 2026-09-27

### Fixed
- Locks actually lock: every panel, the Placed Items list, and group rotate now refuse to move, rotate, or resize a locked item — enforced in the reducer so no caller can bypass it — and the affected controls grey out with an "unlock to…" hint instead of silently doing nothing (the Rotate chime no longer plays for a no-op) ([#209](https://github.com/ch-bas/threejs-sims-house-builder/issues/209))
- Doors, windows, and cameras can no longer be stranded off their walls by typed X/Z coordinates, Align/Distribute, or a group rotate — they re-snap to the nearest wall like a drag does ([#210](https://github.com/ch-bas/threejs-sims-house-builder/issues/210))
- A saved layout that loads but fails to apply is backed up before autosave can overwrite it, and a shared link that fails to apply falls back to your local save instead of the default layout ([#206](https://github.com/ch-bas/threejs-sims-house-builder/issues/206))
- Saves from older versions, or with an unknown floor/wall pattern, no longer fail validation on the next load and lose the house ([#208](https://github.com/ch-bas/threejs-sims-house-builder/issues/208))
- The 10 cm see-through slit above every default window is gone — the wall cut and the window now share one sill height ([#212](https://github.com/ch-bas/threejs-sims-house-builder/issues/212))
- Wall Clock and Wall Shelf hang at wall height instead of sitting on the floor ([#163](https://github.com/ch-bas/threejs-sims-house-builder/issues/163))

### Changed
- Dependency updates: Next.js 15.5.26 (upstream security hardening), eslint-config-next 15.5.26, lucide-react 1.48, autoprefixer 10.6.1, @types/node 26.6.2

## [1.8.13] - 2026-09-18

### Added
- Furniture clipboard: Ctrl+C copies the selection, Ctrl+V pastes it beside the original or onto another floor — arrangement preserved, wall items re-seated, pastes unlocked/selected and undoable in one step, with a Copy button on the multi-select badge ([#153](https://github.com/ch-bas/threejs-sims-house-builder/issues/153))
- Share links compress with native deflate: a fully furnished 100-item house now encodes ~8× smaller and fits comfortably where it previously failed with "too large"; existing links keep working ([#147](https://github.com/ch-bas/threejs-sims-house-builder/issues/147))

### Fixed
- The item popover's "Centre" button no longer bypasses locks or strands doors/windows/cameras mid-room — it's disabled with an explanatory hint for locked and wall-mounted items ([#149](https://github.com/ch-bas/threejs-sims-house-builder/issues/149))
- The cost heatmap weights cells by actual overlap instead of counting boundary-straddling items up to 4×, and its legend uses the same currency symbol as the rest of the app ([#150](https://github.com/ch-bas/threejs-sims-house-builder/issues/150))

### Changed
- The renderer uses a reversed depth buffer where the browser supports it, removing residual grazing-angle z-fighting on thin geometry ([#187](https://github.com/ch-bas/threejs-sims-house-builder/issues/187))

## [1.8.12] - 2026-09-18

### Fixed
- The night sky's stars and moon are now real world-space objects instead of pixels in the stretched screen backdrop: stars render pixel-crisp at any resolution with true parallax when orbiting (and surround you in walkthrough mode), and the moon is a proper glowing disc with craters riding a low arc over the treeline ([#182](https://github.com/ch-bas/threejs-sims-house-builder/issues/182))

## [1.8.11] - 2026-09-18

### Added
- The night sky has stars and a moon: a seeded starfield fades in as darkness deepens (twinkling gently while time auto-advances), and a glowing moon rises after dusk, crests at midnight, and sets before dawn ([#182](https://github.com/ch-bas/threejs-sims-house-builder/issues/182))

## [1.8.10] - 2026-09-18

### Fixed
- A persistently broken deploy no longer reloads the tab forever: the error boundaries honor the one-shot reload guard and fall through to a recovery screen with a plain Reload button — never offering to reset your saved house for a deploy problem ([#143](https://github.com/ch-bas/threejs-sims-house-builder/issues/143))
- Flush cameras flipped to face outside (and 180°-flipped doors) survive nudges, drag releases, and duplication instead of being reset to face inward ([#144](https://github.com/ch-bas/threejs-sims-house-builder/issues/144))
- The night sky now darkens after dusk, is darkest around midnight, and lifts toward dawn — previously midnight was the brightest point of the night and dusk snapped to black ([#145](https://github.com/ch-bas/threejs-sims-house-builder/issues/145))
- Small-bug roundup: stairwell floor holes are clamped inside the floor outline (no more corrupted geometry from edge-placed stairs), declining the over-budget confirmation no longer chimes or wipes the selection, oversized transparent floor plans no longer turn black, loading a saved or shared house no longer fires a burst of achievement toasts (while a returning player's first real achievement still toasts), a camera mounted above a door is no longer flagged as a collision, and upper-floor lamp glow sits at the right height ([#146](https://github.com/ch-bas/threejs-sims-house-builder/issues/146))

### Changed
- Dependencies refreshed: Three.js 0.169 → 0.186 (verified against the render-on-demand and walkthrough camera contracts), Next.js 15.5.25 clearing all `npm audit` advisories, and the GitHub Actions runtime majors ([#160](https://github.com/ch-bas/threejs-sims-house-builder/issues/160))

### Infrastructure
- Every pull request now runs the full quality gate (typecheck, lint, 267-test suite, production build) and `main` is protected — nothing merges without a green check ([#159](https://github.com/ch-bas/threejs-sims-house-builder/issues/159))
- Supply-chain hardening: all workflow actions pinned to commit SHAs, the release job serialized with a working tag check, and weekly grouped Dependabot updates for npm and the actions themselves ([#161](https://github.com/ch-bas/threejs-sims-house-builder/issues/161))

## [1.8.9] - 2026-09-14

### Added
- Security-camera coverage is now visible everywhere you plan it: the FOV wedge draws in the 2D plan view, and the printed blueprint includes camera wedges and Wi-Fi rings by default ([#134](https://github.com/ch-bas/threejs-sims-house-builder/issues/134))
- The budget pushes back: purchases that would exceed it ask for confirmation before placing, and Surprise-me spends only what the building has left ([#136](https://github.com/ch-bas/threejs-sims-house-builder/issues/136))

### Fixed
- Exterior walls now cast and receive sun shadows like the roof and interior walls — dawn light no longer falls on furniture straight through the shell, and the house finally shadows its lawn. Cutaway wall flips refresh the static shadow map exactly once per flip, so orbiting stays cheap ([#132](https://github.com/ch-bas/threejs-sims-house-builder/issues/132))
- A wall hidden by cutaway or walls-down takes its glowing selection outline with it instead of leaving a ghost rectangle floating over the open room ([#133](https://github.com/ch-bas/threejs-sims-house-builder/issues/133))
- Furniture-set tiles the room can't hold are greyed out with a "Room too small" hint instead of silently doing nothing ([#135](https://github.com/ch-bas/threejs-sims-house-builder/issues/135))

### Changed
- Honest money labels: the mode panel shows "Furniture Value" (the number always was the current value, not cumulative spend), and the Big Spender achievement reads "Own over $10,000 of furniture" to match ([#136](https://github.com/ch-bas/threejs-sims-house-builder/issues/136))

## [1.8.8] - 2026-09-03

### Added
- Editing the same house in two tabs is no longer a silent race: when another tab saves, a "Changed in another tab" notice appears with a one-click Load (undoable with Ctrl+Z) or dismiss ([#123](https://github.com/ch-bas/threejs-sims-house-builder/issues/123))

### Changed
- Test suite grew from 223 to 251: the door/window/camera snapping math, the Surprise-me generator, and every stamped room shape now have dedicated coverage ([#123](https://github.com/ch-bas/threejs-sims-house-builder/issues/123))

## [1.8.7] - 2026-09-03

### Fixed
- Painting with an interior wall selected now colours that wall instead of silently repainting all four exterior walls; the precise X/Z inputs no longer fight your typing; the Templates select can re-apply the same template; the sidebar wall-pattern select gained the missing Siding option; the stamped hexagon is flat-top at full width; walls-down mode keeps the snap grid; the pet's collision box matches its mesh; ghosted furniture on inactive floors no longer steals clicks; library saves/deletes are quota-safe; plus assorted hygiene (sky-texture disposal, reducer purity, icon lookups) ([#122](https://github.com/ch-bas/threejs-sims-house-builder/issues/122))
- Schema hardening round 3: imported/shared layouts can no longer smuggle absurd item dimensions, unknown sofa/stairs variants, out-of-range floor-plan opacity, or negative signal/vision ranges into the app ([#121](https://github.com/ch-bas/threejs-sims-house-builder/issues/121))

## [1.8.6] - 2026-09-03

### Fixed
- The 2D plan view and printed blueprint now draw interior walls, show hidden exterior walls as dashed boundaries, and outline multi-select extras; the minimap renders at a usable scale instead of a ~10px blob and repaints when an uploaded floor plan finishes decoding; a broken floor-plan image can no longer abort the whole 2D paint ([#118](https://github.com/ch-bas/threejs-sims-house-builder/issues/118))
- Collision flags are layer-aware: rugs under furniture, sofas flush beneath windows or cameras, tabletop items on desks, and chairs tucked under tables no longer read as collisions — while overlapping doors/windows on one wall still do. The shipped Living Room template no longer loads with items flagged red, and the Bedroom template's floor lamp no longer stands inside the wardrobe ([#120](https://github.com/ch-bas/threejs-sims-house-builder/issues/120))

## [1.8.5] - 2026-09-02

### Fixed
- Item locks are now enforced everywhere: multi-select Delete spares locked items (and a locked primary no longer blocks deleting unlocked extras), group drag and align/distribute leave locked items in place, rotation skips them, and a real drag locks every dragged item instead of only the primary ([#115](https://github.com/ch-bas/threejs-sims-house-builder/issues/115))
- Doors, windows, and cameras can no longer be torn off their walls: group-drag commits, arrow-key nudges, and Ctrl+D duplication all settle wall-mounted items back onto the nearest wall (duplicates of other items are clamped inside the room) ([#116](https://github.com/ch-bas/threejs-sims-house-builder/issues/116))
- Ghost multi-selects eliminated: picking or adding an item now clears leftover multi-select extras everywhere, ctrl-clicking the primary reliably promotes another selected item, and selections no longer survive deletions, undo/redo, or removing the active floor ([#117](https://github.com/ch-bas/threejs-sims-house-builder/issues/117))
- Scene staleness fixes: exterior wall cutouts rebuild when interior walls change (no more double-cut doors), a roof restyled in cutaway mode no longer pops in over the open interior, toggling NPCs off erases them immediately, and the floor-plan image cache survives multi-floor rebuilds instead of re-decoding on each ([#119](https://github.com/ch-bas/threejs-sims-house-builder/issues/119))
- Furniture sets that would overlap themselves when squeezed into a small room are refused instead of stamped broken — intentional overlaps like the office computer on its desk still place fine ([#127](https://github.com/ch-bas/threejs-sims-house-builder/issues/127))
- Auto-organize keeps items it can't pack at their original spot instead of stacking them in an overlapping pile at the room centre, and no longer pushes too-wide items through the wall ([#128](https://github.com/ch-bas/threejs-sims-house-builder/issues/128))
- CI: the GitHub Pages deploy runs on Node 22 — the jsdom test environment introduced in 1.8.3 killed the Node 20 test worker, so releases 1.8.3 and 1.8.4 never reached the live site; this release ships them

## [1.8.4] - 2026-09-02

### Fixed
- Typing an out-of-range room width/depth can no longer destroy the saved house: the reducer clamps the dimensions to schema-safe bounds, and any stored layout that exists but fails to load is backed up to a `-recovery` localStorage key before the fallback layout's autosave can overwrite it ([#113](https://github.com/ch-bas/threejs-sims-house-builder/issues/113))
- Walkthrough mouse-look is no longer overwritten every frame: the render loop skips `OrbitControls.update()` (which has no `enabled` guard) while walkthrough is active, and exiting the mode always releases pointer lock ([#114](https://github.com/ch-bas/threejs-sims-house-builder/issues/114))
- Patterned walls with a door or window — and patterned floors above a stairwell — now tile their texture at the same density as neighbouring surfaces instead of shrinking the pattern by the surface's size ([#125](https://github.com/ch-bas/threejs-sims-house-builder/issues/125))
- Focus-on-selection now frames items on upper floors instead of diving the camera into the storey below ([#126](https://github.com/ch-bas/threejs-sims-house-builder/issues/126))

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
