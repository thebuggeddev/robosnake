# Ironcoil

A browser arena built around one AI generated robotic dragon. You play the
dragon: slither around a hex plated pit, claw and burn five cinder eggs until
they shatter, and watch the coil whip behind you while you do it.

Plain HTML, CSS and JavaScript on Vite, with three.js as the only runtime
dependency. No game engine, no physics library, no asset pipeline at runtime.

```
npm install
npm run dev
```

`npm run build` writes a static bundle to `dist/`, and `npm run preview` serves
that bundle so you can check it before deploying.

---

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Move, relative to the camera |
| `Shift` | Sprint |
| `J` | Claw. Two more in rhythm ends in a two handed slam |
| `K` | Tail spin, hits everything around you |
| `F` | Tap to throw a fireball, hold to breathe a jet |
| `L` | Lunge through a target |
| `Space` | Roar, knocks eggs back and heats them |
| `R` | Return to the middle |
| Drag / wheel | Orbit the camera, zoom |
| `H` `O` `Q` `V` `M` `B` `I` | Help, settings, quality, bloom, sound, skeleton, rig notes |

On a touch screen the ability bar doubles as the buttons and a thumb stick
appears bottom left, so phone and desktop run the same layout.

---

## The dragon

**Movement made for a snake.** There are no legs to walk on, so locomotion is a
phase driven slither: spine, waist and head counter rotate against each other
on offset sine phases, and the head counter steers so it keeps looking forward
while the body sways underneath it.

**A tail that whips.** The coil trails behind you on a lag spring driven by how
fast you are turning, with the lag rising toward the tip so the end of the tail
swings wider than the base. A travelling wave runs down it with your speed, and
hard acceleration lifts it.

**A jaw that reacts.** It breathes while idle, rattles while the jet is
burning, gapes wide for a roar, and snaps shut on a real bite during the lunge
and the slam. It also trails the head, so a head that snaps upward drags the
jaw open behind it.

**Back blades on springs.** Driven by the body's own acceleration, so they lag
and settle instead of sitting welded to the torso.

**Claws that aim.** The swipe is solved with two bone inverse kinematics rather
than played back as a canned animation, so the arm actually reaches toward
where the target is. It clamps to what the arm can reach, so a genuine miss
reads as a miss instead of the arm stretching.

None of that is skeletal animation in the usual sense. The rig that shipped
with the model has no tail chain, no jaw and no blade bones, so those motions
are computed per vertex before skinning and the bones carry the result.
[docs/model-notes.md](docs/model-notes.md) covers why, if you are curious.

---

## Combat

Five abilities, each on its own cooldown, all readable from the bar at the
bottom of the screen: a sweep for the cooldown, a meter for the fire charge,
and pips for where you are in the claw combo.

**Claw combo.** Alternating left and right swipes. Land the third press inside
the rhythm window and it becomes a two handed overhead slam with a much wider
hit radius.

**Tail spin.** A sweep that hits everything around you at once.

**Fire, two modes on one key.** A tap under 0.22 seconds throws a fireball on a
ballistic arc that bursts on the first thing it touches. Holding opens a
sustained jet: a pooled particle system with buoyancy, drag, a colour and alpha
ramp in the shader, and a handoff where dying flames turn into smoke. Flames
that hit the floor burn scorch marks into it that stay there.

**Lunge.** A dash that drives through a target, biting on the way in.

**Roar.** A shockwave that shoves every egg back and heats it.

---

## The arena

**Cinder eggs.** Five basalt shells float on iron cradles. Their crack seams
are two layers of ridged noise injected into the standard material, so they
still take real lighting and shadows. A damage uniform widens and lights the
seams as a shell takes hits, hairline red on the first and properly molten
before it bursts, so you can read a target's state from across the pit. Fire
breath feeds a separate heat channel. Each shell hangs on a spring, so a hit
sends it swinging. Break one and it throws shards, sparks and flame, scorches
the floor beneath it, and reforms four and a half seconds later.

**A floor that remembers.** Procedural hex plating in a shader, with rust and
wear from layered noise and up to 32 scorch marks burned into the surface.

**Atmosphere.** Drifting ash, bloom on the hot core of the fire, dynamic
shadows, a light that flares from every burst, and camera shake weighted to the
size of the hit.

**Sound.** Off by default, on with `M`. Everything is synthesised in the Web
Audio API at runtime, so no audio files ship with the page.

---

## Performance and options

**Three quality tiers.** Low, medium and high move pixel ratio, shadows, shadow
map size, bloom, ash count, particle budget and texture size together, so one
switch covers the whole cost profile. The low tier halves the texture while
decoding it, taking it from roughly 22 MB of video memory to 5.6 MB.

**It picks for you.** Touch devices start on medium and everything else on
high. There is a live FPS readout, and if the machine sustains under 34fps the
page steps itself down one tier.

**A fixed 1/60 simulation step** with up to four catch up steps per frame, so
spring constants, particle counts and damage rates behave identically at 30fps
and at 144. Rendering stays per frame.

**Honours `prefers-reduced-motion`** by dropping camera shake.

**Debug views.** `B` draws the skeleton over the dragon. `I` opens a panel
explaining what the rig can and cannot do.

---

## Layout

```
index.html                  Vite entry: the page markup
src/main.js                 the whole game, one module
src/style.css               the HUD and loader styles
vite.config.js              build config
docs/model-notes.md         what was wrong with the source model, and the fix
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

Runtime dependencies are three.js from npm and Google Fonts.
`tools/repair_rig.py` is a one-off asset script needing numpy and pillow; it is
not part of the web build.

---

## Credits and licensing

The dragon model was generated with Tripo. Check Tripo's terms for what you are
allowed to do with it before you ship anything commercial. The repair script,
the page and everything described above are yours to use.
