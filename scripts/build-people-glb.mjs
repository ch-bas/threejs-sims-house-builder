// Rebuilds components/room-organizer/assets/people.glb from Quaternius'
// Universal Animation Library (CC0). Not part of the app build.
//
//   git clone --depth 1 https://github.com/J-Ponzo/gltf-universal-animation-library /tmp/ual
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4
//   node scripts/build-people-glb.mjs /tmp/ual/glTF/AnimationLibrary_Godot_Standard.gltf
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, resample, weld } from '@gltf-transform/functions';

const KEEP = new Set(['Idle_Loop', 'Idle_Talking_Loop', 'Walk_Loop']);
const input = process.argv[2];
const output = process.argv[3] ?? 'components/room-organizer/assets/people.glb';
if (!input) {
  console.error('usage: node scripts/build-people-glb.mjs <AnimationLibrary_Godot_Standard.gltf> [out.glb]');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
for (const clip of root.listAnimations()) {
  if (KEEP.has(clip.getName())) continue;
  // Disposing a clip leaves its samplers alive, and they keep ~70% of the
  // file's keyframe accessors referenced; dispose them explicitly.
  for (const channel of clip.listChannels()) channel.dispose();
  for (const sampler of clip.listSamplers()) sampler.dispose();
  clip.dispose();
}

await doc.transform(resample({ tolerance: 1e-3 }), dedup(), prune(), weld(), quantize({ quantizeWeight: 8 }), prune());
await io.write(output, doc);
console.log(`wrote ${output}: ${root.listAnimations().map((c) => c.getName()).join(', ')}`);
