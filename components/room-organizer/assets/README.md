# Assets

## people.glb

Rigged, animated mannequin used for placed people and the walking NPCs.

- **Source:** Quaternius, *Universal Animation Library* (Standard/free edition),
  <https://quaternius.itch.io/universal-animation-library>, taken from the
  glTF mirror at <https://github.com/J-Ponzo/gltf-universal-animation-library>.
- **License:** CC0 1.0 — no attribution required; credited anyway in the README.
- **Contents:** the `Mannequin` mesh and its 53-bone skin, plus three clips:
  `Idle_Loop`, `Idle_Talking_Loop`, `Walk_Loop` (the other 43 are dropped).
- **Processing:** keyframes resampled, vertex attributes quantized
  (`KHR_mesh_quantization`, decoded natively by `GLTFLoader` — no decoder
  to ship), unused data pruned. About 420 KB, fetched only once a layout
  contains a person or the walkers are switched on.

Rebuild with `scripts/build-people-glb.mjs` (instructions in its header).
