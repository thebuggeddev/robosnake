# Model notes: repairing an AI generated dragon

Background on the asset behind Ironcoil — what came out of the generator, what
was wrong with it, and what `tools/repair_rig.py` does about it. None of this is
needed to run or play the game; see the [README](../README.md) for that.

---

## What the model was like out of the box

The model came out of Tripo, an AI 3D generator. Before building anything I
pulled it apart and measured it, because you should not trust an asset you did
not make. Here is what I found, good and bad.

### The mesh is solid

29,908 vertices and 48,297 triangles. That is a sensible budget for the web.
Only 2 degenerate triangles out of 48 thousand, and no edges shared by three or
more faces, so the topology is clean in the places that matter.

It is not watertight. There are 66 separate shells, 2,768 open boundary edges,
and 96 non manifold edges once you merge vertices by position. None of that
matters for rendering. It would matter if you wanted to 3D print it or run a
physics solve on it.

285 vertex normals point against their own face. You will never see it.

### The UVs are genuinely good

This surprised me. AI generated UVs are usually a mess.

- 363 islands, laid out with real packing rather than a projection dump
- 72.5% of the UV square is covered, which is a good packing ratio
- 0.01% of texels overlap, so almost nothing is stacked on top of anything else
- texel density varies by only 1.8x between the 5th and 95th percentile, so the
  detail is even across the body instead of crisp on the head and blurry on the
  tail
- 7 zero area triangles and 32 mirrored ones, which is noise at this scale

The texture itself is a single 8192 by 8192 JPEG, 12 MB. That is far too heavy
for a web page, and it has lighting baked into the colour, which means you can
see painted shadows that do not move when you move the light. There are no
normal, roughness or metallic maps. Just colour.

### The rig is where it falls apart

Two separate problems. The first one is a bug. The second one is a design
choice that you have to work around.

**The file is broken and nothing tells you.**

Every one of the 81 nodes is missing its translation and rotation. The bind
pose survives only inside the inverse bind matrices, and those were written in
a Z up coordinate frame while the mesh itself is Y up.

Load it into three.js as it comes and every bone sits at the world origin. The
mesh collapses. Average vertex displacement at rest is 0.80 units on a model
that is 1 unit tall.

The official Khronos glTF validator passes the file with zero errors, because
the file is structurally legal. It cannot know the transforms are missing. This
is the thing worth taking away: an AI generated model can clear every automated
check and still be unusable.

**The skeleton is a humanoid template stretched over a snake.**

51 skinned bones: a pelvis, two legs with feet and toes, a spine, a head, two
arms with full finger sets. The model has no legs.

- the entire coiled tail is weighted to `R_ToeBase`, which carries more weight
  than any other bone in the rig, plus the thighs, calves and feet
- there is no tail chain, no wing or blade bones, no jaw, and no neck joint in
  the skin
- `NeckTwist`, the twist bones, the share bones and the eye bones all exist as
  nodes but carry zero weights, so they do nothing at all
- the legs are not even symmetric. `L_Foot` and `R_Foot` sit at the identical
  position, and `R_Calf` is on the left side of the body

The weighting itself is careful, which is the strange part. Weights sum to 1.0
everywhere, no vertex has more than 4 influences, and across 145 thousand edges
only 137 have a hard weight discontinuity. The fingers are genuinely well
weighted. Someone built a good skinning pass on top of the wrong skeleton.

---

## What was fixed, and how

### Rebuilding the rig

`tools/repair_rig.py` does this. Run it yourself:

```
python tools/repair_rig.py path/to/original.glb assets/
```

The idea is simple. An inverse bind matrix is, by definition, the inverse of
where a joint sits in world space when the model is in its bind pose. So invert
it and you get the joint back.

For each joint:

1. invert the inverse bind matrix to recover its world transform
2. apply the axis swap and height offset that move it from the Z up frame into
   the mesh's Y up frame
3. run the rotation part through an SVD and snap it back to a pure rotation, so
   any scale or shear that crept in is discarded
4. divide by the parent joint's world transform to get the local transform
5. write that out as translation and rotation, then rewrite the inverse bind
   matrices to match the new hierarchy

The check is the part that matters. Skinning the mesh at rest with the rebuilt
skeleton has to reproduce the original vertex positions. It does, to 1.2e-07.
Validator errors went from 21 to 0.

### Splitting the texture out of the GLB

This one is a trap worth knowing about.

Three.js loads an image embedded inside a GLB by wrapping those bytes in a
`blob:` URL and then fetching it. Most hosting setups do not list `blob:` in
their content security policy, so the fetch is refused. Three.js logs a warning
and carries on with no texture, and you get a plain white model with no error
that anyone actually reads.

So the build keeps the geometry and the image in separate files. The page
decodes the JPEG itself with `createImageBitmap` on a `Blob`, which never
creates a URL, so no policy applies to it. There is a `data:` URI fallback for
Safari and a solid colour fallback if both fail.
