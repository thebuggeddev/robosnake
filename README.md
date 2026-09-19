# Ironcoil

A browser arena built around one AI generated robotic dragon. Move it, make it
fight, set things on fire. It is a Vite project: plain HTML, CSS and JavaScript,
with three.js as the only runtime dependency.

```
npm install
npm run dev
```

`npm run build` writes a static bundle to `dist/`, and `npm run preview` serves
that bundle so you can check it before deploying.

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

---

## What was built on top, and the idea behind each piece

### Movement that suits a snake

There are no legs to walk on, so locomotion is a phase driven slither. The
spine, waist and head counter rotate against each other on offset sine phases,
and the head counter steers so it keeps looking forward while the body sways
under it.

### A tail wave without a tail

One toe bone cannot make a wave. You need to know how far along the coil each
vertex sits, and the rig will not tell you.

It turns out the skin weights will. The leg bones that got reused for the tail
happen to run in order from base to tip, so if you give each bone a rank
(thigh 0.3, calf 0.55, foot 0.78, toe 1.0) and blend those ranks by each
vertex's skin weights, you get a clean 0 at the hips rising to 1 at the whip
tip. Verified across the full range.

That number then drives a rotation applied to the **rest position, before
skinning**. This is the key trick and it gets used three times in this project.
If you move a vertex before the skinning step runs, the bones pick up your
change and carry it wherever they go. You get deformation the skeleton cannot
express, for free, with no new bones.

The tail rotation is fed by a lag spring on how fast the body is turning, with
the lag rising as the 1.35 power along the coil so the tip trails further than
the base, plus a travelling wave that scales with speed and a vertical lift
from forward acceleration.

### A jaw without a jaw bone

Same trick. I measured the head profile to find the hinge, at mesh coordinates
z 0.175, y 0.870, then built an oriented band that covers the lower jaw and
fangs and fades to zero at the hinge and before the throat. Those vertices
rotate around the hinge before skinning, and the head bone carries the result.

It cannot close. I measured the angular clearance between the lower jaw and the
mouth roof in polar coordinates about the hinge, and the upper fangs interlock
into the lower jaw with only 2.5 degrees of room. Closing the mouth would drive
the jaw through the teeth. That is a property of the sculpt, not something you
can animate around.

So the jaw work went into how it opens instead: an idle breath, a rattle while
the jet is burning, a wide roar gape, and a real bite on the lunge and slam
where it gapes on the way in then snaps shut at three times the normal damping
rate. It also trails the head, so a head that snaps upward drags the jaw open
behind it.

### Back blades that lag

The blades share the waist and both clavicles with the arms, so you cannot
spring them with bones without dragging the arms along. Same solution: a spring
in body space, driven by the body's own acceleration, applied to the rest
positions before skinning.

### Two bone inverse kinematics on the claw

A canned swipe animation always swings through the same arc, so it misses
anything that is not exactly where the animator assumed.

The IK solves in the shoulder's parent frame. Point the upper arm at the
target, then set the elbow angle with the law of cosines from the two bone
lengths and the distance to the target. It blends in over the strike and clamps
to what the arm can actually reach, so a genuine miss still reads as a miss
instead of the arm stretching.

### Fire

Two modes on one key. A tap under 0.22 seconds throws a fireball on a
ballistic arc that bursts on the first thing it touches. Holding opens a
sustained jet.

The jet is a pooled particle system with a colour and alpha ramp in the
shader, buoyancy, drag, and a handoff where dying flames become smoke. Flames
that hit the floor occasionally burn a scorch mark into it.

Getting this to read correctly took several passes. Additive sprites at high
alpha and high spawn rate just clip to white, which looks like a light bulb
rather than fire. The fix was lower alpha with more particles, a size that
grows along the jet, and a bloom threshold high enough that only the core
blooms.

### Breakable cinder eggs

The targets are basalt shells floating in the air. Their crack seams are two
layers of ridged noise injected into the standard material through
`onBeforeCompile`, so they still take real lighting and shadows.

A damage uniform widens the seams and lights them, ramping on damage squared so
one hit shows hairline red and the last hit before bursting is properly molten.
Fire breath feeds a separate heat uniform. Each shell sits on a spring that
pulls it back to its anchor, so a hit sends it swinging.

### The floor

Procedural hex plating in a shader. Rust and wear from layered noise, and up to
32 scorch marks passed in as uniforms and burned into the surface, which is
much cheaper than decal geometry.

### Performance

The simulation runs on a fixed 1/60 step with up to four catch up steps per
frame, so spring constants, particle counts and damage rates behave the same at
30fps as at 144. Rendering stays per frame.

Three quality tiers move pixel ratio, shadows, shadow map size, bloom, ash
count, particle budget and texture size together. There is an FPS readout and
one automatic step down if the machine sustains under 34fps.

The low tier halves the texture to 1024 while decoding, which takes it from
about 22 MB of video memory to 5.6 MB.

### Things deliberately not done

**KTX2 or Basis texture compression.** The Basis transcoder runs in a Worker
created from a `blob:` URL, which is the same mechanism that already blocks the
embedded texture on a hosted page. The file size win would have been small
anyway, 815 KB as JPEG against roughly 500 KB as ETC1S. The real win was video
memory, and the low quality tier gets the same saving with no dependency.

**Instancing the eggs.** There are five of them, and each needs its own damage,
heat and seed uniforms plus its own lumped geometry. Instancing would save four
draw calls out of about twenty and cost a rewrite.

---

## Layout

```
index.html                  Vite entry: the page markup
src/main.js                 the whole game, one module
src/style.css               the HUD and loader styles
vite.config.js              build config
tools/repair_rig.py         rebuilds the rig from the inverse bind matrices
assets/
  dragon_geometry_2k.glb    repaired geometry and skinning, no image
  dragon_basecolor_2k.jpg   base colour map, resized to 2K
  robotic_dragon_rig_fixed_8k.glb   the repaired model with its original 8K map
```

`src/main.js` imports the GLB and the JPEG with Vite's `?url` suffix, so both
are fetched at runtime and copied into `dist/assets/` with hashed names. They
are never inlined: `assetsInlineLimit` is 0 in the config, because a 2.3 MB
base64 string in the bundle helps nobody.

Runtime dependencies are three.js from npm and Google Fonts. `tools/repair_rig.py`
is a one-off asset pipeline script and needs numpy and pillow; it is not part of
the web build.

---

## Credits and licensing

The dragon model was generated with Tripo. Check Tripo's terms for what you are
allowed to do with it before you ship anything commercial. The repair script,
the page and everything described above are yours to use.
