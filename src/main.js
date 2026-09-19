import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Vite rewrites both of these to hashed URLs and copies the files into the
// build, so the page fetches its assets instead of carrying them inline.
import glbUrl from '../assets/dragon_geometry_2k.glb?url';
import texUrl from '../assets/dragon_basecolor_2k.jpg?url';

// ---------- basics ----------
const $ = id => document.getElementById(id);
const isCoarse = matchMedia('(pointer:coarse)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp = (a,b,t)=>a+(b-a)*t;
const damp = (a,b,l,dt)=>lerp(a,b,1-Math.exp(-l*dt));
const rnd = (a=1,b=0)=>b+Math.random()*(a-b);
const easeOut = t=>1-Math.pow(1-t,3);
const easeInOut = t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const smooth = t=>t*t*(3-2*t);

// ---------- quality tiers ----------
// Every setting that costs real frame time lives here, so one switch moves them all.
const QUALITY = {
  low:  { pr:1.0, shadows:false, shadowMap:1024, bloom:false, ash:0,   tex:1024, particles:0.45 },
  med:  { pr:1.5, shadows:true,  shadowMap:1024, bloom:false, ash:160, tex:2048, particles:0.75 },
  high: { pr:2.0, shadows:true,  shadowMap:2048, bloom:true,  ash:340, tex:2048, particles:1.0 },
};
const qOrder = ['low','med','high'];
let qName = isCoarse ? 'med' : 'high';
let Q = QUALITY[qName];

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x171214);
scene.fog = new THREE.FogExp2(0x171214, 0.028);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

const hemi = new THREE.HemisphereLight(0x8a7a70, 0x1a1013, 0.9);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffe2c4, 2.2);
key.position.set(6, 12, 4);
key.castShadow = true;
key.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
key.shadow.camera.left = key.shadow.camera.bottom = -14;
key.shadow.camera.right = key.shadow.camera.top = 14;
key.shadow.camera.near = 1; key.shadow.camera.far = 40;
key.shadow.bias = -0.0008;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x6d7fa8, 0.8);
rim.position.set(-8, 6, -8);
scene.add(rim);
const fireLight = new THREE.PointLight(0xff7a2a, 0, 14, 1.6);
scene.add(fireLight);
const mouthLight = new THREE.PointLight(0xff9a4a, 0, 2.2, 2);
scene.add(mouthLight);

// ---------- arena floor with scorch decals baked into the shader ----------
const MAX_SCORCH = 32;
const floorUniforms = {
  uTime:{value:0},
  uScorch:{value:Array.from({length:MAX_SCORCH},()=>new THREE.Vector4(0,0,0,0))},
  uCount:{value:0},
  uFog:{value:new THREE.Color(0x171214)},
};
const floor = new THREE.Mesh(new THREE.CircleGeometry(22, 96), new THREE.ShaderMaterial({
  uniforms: floorUniforms,
  vertexShader:`
    varying vec3 vW; varying vec3 vN;
    void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; vN=normalMatrix*normal;
      gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader:`
    precision highp float;
    uniform float uTime; uniform vec4 uScorch[${MAX_SCORCH}]; uniform int uCount; uniform vec3 uFog;
    varying vec3 vW;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
    // hex plate tiling (Inigo Quilez): xy cell id, z distance to edge, w distance to centre
    vec4 hexagon(vec2 p){ vec2 q = vec2(p.x*2.0*0.5773503, p.y + p.x*0.5773503); vec2 pi = floor(q); vec2 pf = fract(q);
      float v = mod(pi.x + pi.y, 3.0); float ca = step(1.0,v); float cb = step(2.0,v); vec2 ma = step(pf.xy,pf.yx);
      float e = dot(ma, 1.0-pf.yx + ca*(pf.x+pf.y-1.0) + cb*(pf.yx-2.0*pf.xy));
      p = vec2(q.x + floor(0.5+p.y/1.5), 4.0*p.y/3.0)*0.5 + 0.5; float f = length((fract(p)-0.5)*vec2(1.0,0.85));
      return vec4(pi + ca - cb*ma, e, f); }
    void main(){
      vec2 p = vW.xz;
      float r = length(p);
      vec4 hc = hexagon(p*0.9);
      float groove = 1.0 - smoothstep(0.025, 0.09, hc.z);
      float plateId = hash(hc.xy);
      vec3 steel = vec3(0.12,0.12,0.14) * (0.7+0.5*plateId);
      vec3 rust = vec3(0.22,0.08,0.06);
      float wear = noise(p*1.3+plateId*7.0);
      vec3 col = mix(steel, rust, smoothstep(0.55,0.9,wear)*0.7);
      col *= 1.0 - 0.6*groove;
      col *= 0.85 + 0.3*noise(p*6.0);
      col *= 0.92 + 0.16*smoothstep(0.5,0.0,hc.w);
      // centre ring markings
      float ring = smoothstep(0.03,0.0,abs(r-6.0)-0.05) + smoothstep(0.03,0.0,abs(r-12.0)-0.05);
      col = mix(col, vec3(0.45,0.16,0.12), ring*0.7);
      // scorch marks
      float burn = 0.0; float glow = 0.0;
      for(int i=0;i<${MAX_SCORCH};i++){ if(i>=uCount) break; vec4 s=uScorch[i];
        float d = length(p - s.xy); float n = noise(p*3.0+s.xy*5.0);
        float m = 1.0 - smoothstep(s.z*(0.55+0.45*n), s.z*(0.95+0.3*n), d);
        burn = max(burn, m*s.w); glow += m*max(0.0, s.w-0.85)*6.0*(1.0-smoothstep(0.0,s.z*0.6,d)); }
      col = mix(col, vec3(0.03,0.02,0.02), burn*0.9);
      col += vec3(1.0,0.35,0.08)*glow*(0.6+0.4*sin(uTime*13.0+r*5.0));
      // fade to fog at the rim
      float fogF = smoothstep(9.0, 21.0, r);
      col = mix(col, uFog, fogF);
      gl_FragColor = vec4(col,1.0);
    }`,
}));
floor.rotation.x = -Math.PI/2;
floor.receiveShadow = false;
scene.add(floor);
// a shadow catcher on top of the shader floor
const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(22, 48), new THREE.ShadowMaterial({opacity:0.5, color:0x000000}));
shadowCatcher.rotation.x = -Math.PI/2; shadowCatcher.position.y = 0.002; shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// perimeter: broken pillars
const pillarMat = new THREE.MeshStandardMaterial({color:0x3b3d45, metalness:0.75, roughness:0.45});
const pillarRed = new THREE.MeshStandardMaterial({color:0x5c181b, metalness:0.5, roughness:0.55});
for (let i=0;i<10;i++){
  const a = i/10*Math.PI*2 + 0.2;
  const h = rnd(5.5, 2.4);
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 8), pillarMat);
  base.position.y = 0.25;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, h, 8), i%3===0?pillarRed:pillarMat);
  shaft.position.y = 0.5+h/2;
  shaft.rotation.z = rnd(0.08,-0.08);
  shaft.castShadow = true;
  g.add(base, shaft);
  g.position.set(Math.cos(a)*15.5, 0, Math.sin(a)*15.5);
  scene.add(g);
}

// ---------- particle systems ----------
function makeSprite(){
  const c = document.createElement('canvas'); c.width=c.height=64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32,32,0,32,32,32);
  gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(0.35,'rgba(255,255,255,0.6)'); gr.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0,0,64,64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const sprite = makeSprite();

class Particles {
  constructor(n, opts){
    this.n = n; this.opts = Object.assign({blend:THREE.AdditiveBlending, gravity:0, drag:0, sizeMul:1, depthWrite:false}, opts);
    this.pos = new Float32Array(n*3); this.vel = new Float32Array(n*3);
    this.life = new Float32Array(n); this.maxLife = new Float32Array(n); this.size = new Float32Array(n); this.seed = new Float32Array(n);
    this.alive = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.aLife = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.aSize = new THREE.BufferAttribute(this.size, 1);
    this.aSeed = new THREE.BufferAttribute(this.seed, 1);
    geo.setAttribute('aLife', this.aLife); geo.setAttribute('aSize', this.aSize); geo.setAttribute('aSeed', this.aSeed);
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms:{ uTex:{value:sprite}, uScale:{value:1}, uRamp:{value:this.opts.ramp} },
      vertexShader:`
        attribute float aLife; attribute float aSize; attribute float aSeed;
        varying float vLife; varying float vSeed; uniform float uScale;
        void main(){ vLife=aLife; vSeed=aSeed; vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader:`
        uniform sampler2D uTex; uniform vec4 uRamp[4];
        varying float vLife; varying float vSeed;
        void main(){
          vec4 tex = texture2D(uTex, gl_PointCoord);
          float t = vLife;
          vec3 c = t<0.33 ? mix(uRamp[0].rgb,uRamp[1].rgb,t/0.33) : t<0.66 ? mix(uRamp[1].rgb,uRamp[2].rgb,(t-0.33)/0.33) : mix(uRamp[2].rgb,uRamp[3].rgb,(t-0.66)/0.34);
          float a = t<0.33 ? mix(uRamp[0].a,uRamp[1].a,t/0.33) : t<0.66 ? mix(uRamp[1].a,uRamp[2].a,(t-0.33)/0.33) : mix(uRamp[2].a,uRamp[3].a,(t-0.66)/0.34);
          gl_FragColor = vec4(c, a*tex.a);
        }`,
      transparent:true, depthWrite:this.opts.depthWrite, blending:this.opts.blend, fog:false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = this.opts.order||0;
    scene.add(this.points);
  }
  emit(p, v, life, size){
    if (this.alive >= this.n) return -1;
    const i = this.alive++;
    this.pos[i*3]=p.x; this.pos[i*3+1]=p.y; this.pos[i*3+2]=p.z;
    this.vel[i*3]=v.x; this.vel[i*3+1]=v.y; this.vel[i*3+2]=v.z;
    this.life[i]=0; this.maxLife[i]=life; this.size[i]=size; this.seed[i]=Math.random();
    return i;
  }
  kill(i){
    const j = --this.alive;
    if (i!==j){
      for(let k=0;k<3;k++){ this.pos[i*3+k]=this.pos[j*3+k]; this.vel[i*3+k]=this.vel[j*3+k]; }
      this.life[i]=this.life[j]; this.maxLife[i]=this.maxLife[j]; this.size[i]=this.size[j]; this.seed[i]=this.seed[j];
    }
  }
  update(dt, onStep){
    const {gravity, drag} = this.opts;
    const dr = Math.exp(-drag*dt);
    for (let i=0;i<this.alive;i++){
      this.life[i]+=dt;
      if (this.life[i]>=this.maxLife[i]){ this.kill(i); i--; continue; }
      this.vel[i*3+1]+=gravity*dt;
      this.vel[i*3]*=dr; this.vel[i*3+1]*=dr; this.vel[i*3+2]*=dr;
      this.pos[i*3]+=this.vel[i*3]*dt; this.pos[i*3+1]+=this.vel[i*3+1]*dt; this.pos[i*3+2]+=this.vel[i*3+2]*dt;
      if (onStep) onStep(this, i, dt);
      this.aLife.array[i] = this.life[i]/this.maxLife[i];
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.aLife.needsUpdate = true; this.aSize.needsUpdate = true; this.aSeed.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.alive);
    this.mat.uniforms.uScale.value = innerHeight * 0.55 * renderer.getPixelRatio();
  }
}
const V4 = (r,g,b,a)=>new THREE.Vector4(r,g,b,a);
const flames = new Particles(3000, { ramp:[V4(1.0,0.90,0.66,0.55), V4(1.0,0.48,0.11,0.45), V4(0.72,0.12,0.02,0.20), V4(0.12,0.01,0.0,0.0)], gravity:3.4, drag:2.6, order:2 });
const smoke  = new Particles(900,  { blend:THREE.NormalBlending, ramp:[V4(0.13,0.11,0.10,0.0), V4(0.11,0.09,0.08,0.20), V4(0.09,0.08,0.08,0.12), V4(0.07,0.07,0.07,0.0)], gravity:1.5, drag:2.4, order:3 });
const sparks = new Particles(800,  { ramp:[V4(1.0,0.95,0.8,1.0), V4(1.0,0.6,0.2,0.9), V4(1.0,0.3,0.05,0.5), V4(0.4,0.05,0.0,0.0)], gravity:-14, drag:0.4, order:2 });
const dust   = new Particles(600,  { blend:THREE.NormalBlending, ramp:[V4(0.35,0.3,0.27,0.0), V4(0.32,0.28,0.25,0.28), V4(0.3,0.27,0.25,0.15), V4(0.3,0.27,0.25,0.0)], gravity:-0.6, drag:1.8, order:1 });

// ---------- airborne ash ----------
// A slab of motes that follows the camera, so the arena never runs out of air.
const ash = (()=>{
  const n = 340;
  const pos = new Float32Array(n*3), vel = new Float32Array(n*3), ph = new Float32Array(n), sz = new Float32Array(n);
  for (let i=0;i<n;i++){
    pos[i*3]=rnd(16,-16); pos[i*3+1]=rnd(9,0.2); pos[i*3+2]=rnd(16,-16);
    vel[i*3]=rnd(0.25,-0.25); vel[i*3+1]=rnd(0.28,-0.10); vel[i*3+2]=rnd(0.25,-0.25);
    ph[i]=rnd(Math.PI*2); sz[i]=rnd(0.05,0.014);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sz,1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(ph,1));
  const mat = new THREE.ShaderMaterial({
    uniforms:{ uTex:{value:sprite}, uScale:{value:1}, uTime:{value:0} },
    vertexShader:`attribute float aSize; attribute float aSeed; varying float vF; uniform float uScale; uniform float uTime;
      void main(){ vec3 p = position; p.x += sin(uTime*0.6+aSeed)*0.25; p.z += cos(uTime*0.5+aSeed*1.7)*0.25;
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        vF = (0.45+0.55*sin(uTime*1.7+aSeed*3.0)) * smoothstep(26.0, 6.0, -mv.z);
        gl_PointSize = aSize*uScale/-mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader:`uniform sampler2D uTex; varying float vF;
      void main(){ gl_FragColor = vec4(vec3(1.0,0.62,0.34), texture2D(uTex, gl_PointCoord).a*vF*0.55); }`,
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, fog:false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = 4;
  scene.add(points);
  return { n, pos, vel, geo, mat, points,
    update(dt, t, centre){
      const live = Math.min(n, Q.ash);
      points.visible = live > 0;
      if (!live) return;
      for (let i=0;i<live;i++){
        pos[i*3]+=vel[i*3]*dt; pos[i*3+1]+=vel[i*3+1]*dt; pos[i*3+2]+=vel[i*3+2]*dt;
        // wrap around the camera focus rather than respawning, which avoids popping
        for (const k of [0,2]){
          const d = pos[i*3+k]-centre[k?'z':'x'];
          if (d > 17) pos[i*3+k] -= 34; else if (d < -17) pos[i*3+k] += 34;
        }
        if (pos[i*3+1] > 9.5) pos[i*3+1] = 0.1; else if (pos[i*3+1] < 0.05) pos[i*3+1] = 9.4;
      }
      geo.setDrawRange(0, live);
      geo.attributes.position.needsUpdate = true;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uScale.value = innerHeight*0.55*renderer.getPixelRatio();
    } };
})();

// ---------- scorch marks ----------
const scorch = [];
function addScorch(x, z, r){
  // merge with a nearby mark instead of stacking
  for (const s of scorch){ if (Math.hypot(s.x-x, s.z-z) < r*0.6){ s.r = Math.min(3.2, s.r + 0.05); s.heat = 1; return; } }
  scorch.push({x, z, r, heat:1, age:0});
  if (scorch.length > MAX_SCORCH) scorch.shift();
}
function updateScorch(dt){
  for (let i=0;i<scorch.length;i++){ const s=scorch[i]; s.age+=dt; s.heat = Math.max(0.78, s.heat - dt*0.35);
    floorUniforms.uScorch.value[i].set(s.x, s.z, s.r, s.heat); }
  floorUniforms.uCount.value = scorch.length;
}

// ---------- targets: cinder eggs on iron cradles ----------
// Basalt shells with molten seams. The seams spread and brighten as the shell
// takes damage, so the target's state is readable from across the arena.
const drones = [];          // kept as the name so the aiming and attack code reads one list
const debris = [];

function eggGeometry(seed){
  // lathe an egg profile, then break the surface up so it reads as stone, not plastic
  const pts = [];
  for (let i=0;i<=22;i++){
    const v = i/22;                       // 0 base, 1 tip
    const y = v*1.30 - 0.06;
    const taper = Math.pow(Math.sin(Math.PI*Math.pow(v,0.80)), 0.86) * (1 - 0.06*Math.pow(v,2.4));
    pts.push(new THREE.Vector2(Math.max(0.001, taper*0.50), y));
  }
  const g = new THREE.LatheGeometry(pts, 30);
  const p = g.attributes.position, n = g.attributes.normal;
  const h = (x,y,z)=>{ const v = Math.sin(x*12.9+y*78.2+z*37.7+seed)*43758.5453; return v-Math.floor(v); };
  for (let i=0;i<p.count;i++){
    const x=p.getX(i), y=p.getY(i), z=p.getZ(i);
    // driven purely by position, so the lathe seam displaces identically on both sides
    const lump = (h(Math.round(x*7)/7, Math.round(y*7)/7, Math.round(z*7)/7)-0.5)*0.055
               + (h(Math.round(x*17)/17, Math.round(y*17)/17, Math.round(z*17)/17)-0.5)*0.022;
    p.setXYZ(i, x+n.getX(i)*lump, y+n.getY(i)*lump, z+n.getZ(i)*lump);
  }
  g.computeVertexNormals();
  return g;
}

// one shell material per egg: uDamage drives how wide and hot the seams run
function shellMaterial(seed){
  const m = new THREE.MeshStandardMaterial({color:0x2b2724, roughness:0.88, metalness:0.06});
  m.userData.u = { uDamage:{value:0}, uSeed:{value:seed}, uHeat:{value:0} };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n  vObj = position;');
    sh.fragmentShader = `
      varying vec3 vObj; uniform float uDamage; uniform float uSeed; uniform float uHeat;
      float vhash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))+uSeed)*43758.5453); }
      float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        float a=mix(mix(mix(vhash(i),vhash(i+vec3(1,0,0)),f.x),mix(vhash(i+vec3(0,1,0)),vhash(i+vec3(1,1,0)),f.x),f.y),
                    mix(mix(vhash(i+vec3(0,0,1)),vhash(i+vec3(1,0,1)),f.x),mix(vhash(i+vec3(0,1,1)),vhash(i+vec3(1,1,1)),f.x),f.y),f.z);
        return a; }
      float fbm(vec3 p){ return 0.55*vnoise(p) + 0.28*vnoise(p*2.1) + 0.17*vnoise(p*4.3); }
      ` + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          float fq = fbm(vObj*3.4);
          float major = 1.0 - smoothstep(0.0, 0.016 + uDamage*0.042, abs(fq-0.5));
          float minorq = fbm(vObj*8.1+11.0);
          float minor = (1.0 - smoothstep(0.0, 0.008 + uDamage*0.020, abs(minorq-0.5))) * (0.18 + uDamage*uDamage*0.9);
          float crack = clamp(major + minor, 0.0, 1.0);
          float grain = fbm(vObj*13.0);
          diffuseColor.rgb *= 0.78 + 0.34*grain;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035,0.027,0.024), crack*0.85);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float dmg2 = uDamage*uDamage;
          float glow = crack * (0.14 + dmg2*2.2 + uHeat*0.9);
          vec3 hot = mix(vec3(1.0,0.24,0.04), vec3(1.0,0.78,0.38), clamp(dmg2*0.9 + uHeat*0.45, 0.0, 1.0));
          totalEmissiveRadiance += hot*glow + vec3(1.0,0.35,0.08)*uHeat*0.14;`);
  };
  return m;
}

// curved shell fragments, cut straight out of the egg silhouette
const shardGeos = [];
for (let i=0;i<4;i++){
  shardGeos.push(new THREE.SphereGeometry(0.5, 5, 3, rnd(Math.PI*2), rnd(1.5,0.7), rnd(1.4,0.3), rnd(1.1,0.5)));
}
const shardMat = new THREE.MeshStandardMaterial({color:0x2b2724, roughness:0.85, metalness:0.06,
  emissive:0xff4a10, emissiveIntensity:0, side:THREE.DoubleSide});

function spawnEgg(i, delay=0){
  const a = i/5*Math.PI*2 + 0.55;
  const rad = rnd(10.5, 6.0);
  const seed = rnd(100);
  const sc = rnd(1.12, 0.86);
  // hangs at about chest height on the dragon, so claws and jet both reach it
  const base = new THREE.Vector3(Math.cos(a)*rad, rnd(2.60, 1.85), Math.sin(a)*rad);
  const g = new THREE.Group(); g.position.copy(base);
  const shell = new THREE.Mesh(eggGeometry(seed), shellMaterial(seed));
  shell.scale.setScalar(0.01);
  shell.position.y = -0.62*sc;                 // lathe profile starts at the base, so centre it
  shell.rotation.set(rnd(0.14,-0.14), rnd(Math.PI*2), rnd(0.14,-0.14));
  shell.castShadow = true;
  g.add(shell);
  scene.add(g);
  const d = { g, shell, seed, scale:sc, hp:3, heat:0, t:rnd(10), delay, dead:false,
    tilt:new THREE.Vector2(), tiltV:new THREE.Vector2(),
    off:new THREE.Vector3(), vel:new THREE.Vector3(),
    rest:shell.rotation.clone(), base, home:base.clone() };
  shell.visible = delay <= 0;
  drones.push(d);
  return d;
}
for (let i=0;i<5;i++) spawnEgg(i, i*0.35);

function damageOf(d){ return clamp(1 - d.hp/3, 0, 1); }

function droneHit(d, dmg, from, force){
  if (d.dead || d.delay>0) return;
  d.hp -= dmg;
  d.flash = 1;
  const dir = d.home.clone().sub(from).setY(0.25).normalize();
  d.vel.addScaledVector(dir, force*0.22);   // shove it through the air
  d.tiltV.x += dir.z * force * 0.06;        // and set it swinging
  d.tiltV.y -= dir.x * force * 0.06;
  burstSparks(d.home, 18, 6);
  Sound.burst(900, 0.3, 0.4);
  if (d.hp <= 0) killDrone(d);
}
let score = 0;
function killDrone(d){
  d.dead = true; d.shell.visible = false;
  score++; $('score').textContent = score;
  burstSparks(d.home, 70, 12);
  for (let i=0;i<11;i++){
    const m = new THREE.Mesh(shardGeos[i%shardGeos.length], shardMat.clone());
    m.position.copy(d.home).add(new THREE.Vector3(rnd(0.22,-0.22), rnd(0.3,-0.2), rnd(0.22,-0.22)));
    m.scale.setScalar(d.scale * rnd(0.85, 0.45));
    m.castShadow = true;
    const out = new THREE.Vector3(rnd(1,-1), 0, rnd(1,-1)).normalize();
    m.userData.vel = out.multiplyScalar(rnd(6.5,2.5)).setY(rnd(7.5,3.0));
    m.userData.spin = new THREE.Vector3(rnd(11,-11), rnd(11,-11), rnd(11,-11));
    m.userData.age = 0;
    m.material.emissiveIntensity = rnd(1.8, 0.5);
    scene.add(m); debris.push(m);
  }
  // the shell was full of heat: let some of it out
  for (let i=0;i<26;i++){
    flames.emit(d.home.clone().add(new THREE.Vector3(rnd(0.2,-0.2),rnd(0.2,-0.1),rnd(0.2,-0.2))),
      new THREE.Vector3(rnd(3,-3), rnd(7,2), rnd(3,-3)), rnd(0.75,0.45), rnd(0.5,0.25));
  }
  addScorch(d.home.x, d.home.z, 1.2);
  rings.push({t:0, r:2.4, x:d.home.x, z:d.home.z});
  fireLight.position.copy(d.home); fireLight.intensity = Math.max(fireLight.intensity, 55);
  Sound.thud();
  shake(0.35);
  setTimeout(()=>{
    d.hp=3; d.heat=0; d.dead=false; d.flash=0; d.tilt.set(0,0); d.tiltV.set(0,0);
    d.off.set(0,0,0); d.vel.set(0,0,0); d.home.copy(d.base); d.g.position.copy(d.base);
    d.shell.visible = true; d.shell.scale.setScalar(0.01);
  }, 4500);
}
function burstSparks(p, n, speed){
  for (let i=0;i<n;i++){
    const v = new THREE.Vector3(rnd(1,-1),rnd(1,-0.2),rnd(1,-1)).normalize().multiplyScalar(rnd(speed, speed*0.3));
    sparks.emit(p, v, rnd(0.9,0.3), rnd(0.09,0.04));
  }
}
function updateDrones(dt, t){
  for (const d of drones){
    if (d.delay>0){ d.delay-=dt; if (d.delay<=0){ d.shell.visible=true; d.shell.scale.setScalar(0.01); } continue; }
    if (d.dead) continue;
    d.t += dt;
    d.shell.scale.setScalar(damp(d.shell.scale.x, d.scale, 7, dt));
    d.heat = Math.max(0, d.heat - dt*0.5);
    d.flash = Math.max(0, (d.flash||0) - dt*3);
    const dmg = damageOf(d);
    // a cracked shell is never quite still, and it shakes harder the closer it is to bursting
    const unrest = 0.10 + dmg*0.9 + d.heat*0.6;
    d.tiltV.x += (Math.sin(d.t*17.3+d.seed)*0.9*dmg + Math.sin(d.t*1.7+d.seed)*0.5) * unrest * dt;
    d.tiltV.y += (Math.cos(d.t*14.9+d.seed)*0.9*dmg + Math.cos(d.t*1.3+d.seed)*0.5) * unrest * dt;
    d.tiltV.x -= d.tilt.x*9*dt; d.tiltV.y -= d.tilt.y*9*dt;       // spring back upright
    d.tiltV.multiplyScalar(Math.exp(-3.2*dt));
    d.tilt.x = clamp(d.tilt.x + d.tiltV.x*dt, -0.3, 0.3);
    d.tilt.y = clamp(d.tilt.y + d.tiltV.y*dt, -0.3, 0.3);
    d.shell.rotation.set(d.rest.x + d.tilt.x, d.rest.y + d.t*0.13, d.rest.z + d.tilt.y);
    // a knock shoves it through the air and it drifts back to its anchor
    d.vel.addScaledVector(d.off, -7.5*dt);
    d.vel.multiplyScalar(Math.exp(-2.1*dt));
    d.off.addScaledVector(d.vel, dt);
    if (d.off.lengthSq() > 1.44) d.off.setLength(1.2);
    const bob = Math.sin(d.t*0.85 + d.seed)*0.14 + Math.sin(d.t*1.9 + d.seed*2)*0.05;
    d.home.copy(d.base).add(d.off); d.home.y += bob;
    d.g.position.copy(d.home);
    const u = d.shell.material.userData.u;
    u.uDamage.value = Math.min(1, dmg + (d.flash||0)*0.22);
    u.uHeat.value = Math.min(1, d.heat);
    // heat bleeding off a damaged shell
    if (dmg > 0.3 && Math.random() < dt*dmg*9){
      smoke.emit(d.home.clone().add(new THREE.Vector3(rnd(0.3,-0.3), rnd(0.2,-0.2), rnd(0.3,-0.3))),
        new THREE.Vector3(rnd(0.3,-0.3), rnd(1.4,0.7), rnd(0.3,-0.3)), rnd(1.8,1.0), rnd(0.7,0.4));
    }
    if (d.heat > 0.45 && Math.random() < dt*d.heat*7){
      sparks.emit(d.home.clone().add(new THREE.Vector3(rnd(0.3,-0.3), rnd(0.3,-0.3), rnd(0.3,-0.3))),
        new THREE.Vector3(rnd(1.4,-1.4), rnd(2.4,0.6), rnd(1.4,-1.4)), rnd(0.7,0.3), 0.055);
    }
  }
  for (let i=debris.length-1;i>=0;i--){
    const m = debris[i]; const u = m.userData; u.age += dt;
    u.vel.y -= 15*dt; m.position.addScaledVector(u.vel, dt);
    m.rotation.x += u.spin.x*dt; m.rotation.y += u.spin.y*dt; m.rotation.z += u.spin.z*dt;
    if (m.position.y < 0.05){ m.position.y = 0.05; u.vel.y = Math.abs(u.vel.y)*0.3; u.vel.x*=0.66; u.vel.z*=0.66; u.spin.multiplyScalar(0.45); }
    m.material.emissiveIntensity = Math.max(0, m.material.emissiveIntensity - dt*0.55);
    if (u.age > 4){ m.scale.multiplyScalar(0.94); if (u.age>5){ scene.remove(m); debris.splice(i,1); } }
  }
}

// ---------- fireballs ----------
// The tap fire mode. Lobbed on an arc, bursts on the first thing it touches.
const balls = [];
const ballGeo = new THREE.IcosahedronGeometry(0.22, 1);
const ballMat = new THREE.MeshBasicMaterial({color:0xffd08a});
function spawnBall(from, dir, power){
  const m = new THREE.Mesh(ballGeo, ballMat);
  m.position.copy(from);
  scene.add(m);
  const light = new THREE.PointLight(0xff7a2a, 22, 9, 1.8);
  light.position.copy(from); scene.add(light);
  balls.push({ m, light, vel: dir.clone().multiplyScalar(16 + power*7).add(new THREE.Vector3(0, 2.4, 0)), age:0, power });
  Sound.burst(1400, 0.28, 0.5);
}
function burstBall(b, at){
  const r = 2.6 + b.power*1.1;
  for (let i=0;i<70;i++){
    const v = new THREE.Vector3(rnd(1,-1), rnd(1,-0.25), rnd(1,-1)).normalize().multiplyScalar(rnd(11,3));
    flames.emit(at.clone(), v, rnd(0.8,0.45), rnd(0.55,0.28));
  }
  burstSparks(at, 45, 11);
  rings.push({t:0, r, x:at.x, z:at.z});
  addScorch(at.x, at.z, r*0.6);
  fireLight.position.copy(at); fireLight.intensity = Math.max(fireLight.intensity, 90);
  Sound.thud(); shake(0.4); flash(0.12);
  for (const d of drones){
    if (d.dead||d.delay>0) continue;
    if (d.home.distanceTo(at) < r){ d.heat = Math.min(1.2, d.heat + 0.7); droneHit(d, 2, at, 18); }
  }
  scene.remove(b.m); scene.remove(b.light);
}
function updateBalls(dt){
  for (let i=balls.length-1;i>=0;i--){
    const b = balls[i]; b.age += dt;
    b.vel.y -= 13*dt;
    b.m.position.addScaledVector(b.vel, dt);
    b.light.position.copy(b.m.position);
    b.light.intensity = 22 + Math.sin(b.age*40)*5;
    b.m.rotation.x += dt*9; b.m.rotation.y += dt*7;
    if (Math.random() < dt*90) flames.emit(b.m.position.clone(), new THREE.Vector3(rnd(1.2,-1.2), rnd(1.6,0.2), rnd(1.2,-1.2)), rnd(0.55,0.3), rnd(0.4,0.2));
    let hit = null;
    if (b.m.position.y <= 0.16) hit = b.m.position.clone().setY(0.12);
    else for (const d of drones){ if (!d.dead && d.delay<=0 && d.home.distanceTo(b.m.position) < 0.9){ hit = b.m.position.clone(); break; } }
    if (hit || b.age > 4){ if (!hit){ scene.remove(b.m); scene.remove(b.light); } else burstBall(b, hit); balls.splice(i,1); }
  }
}

// ---------- camera shake, flash ----------
let shakeAmt = 0;
function shake(a){ shakeAmt = Math.min(1, shakeAmt + a); }
function flash(a){ const f=$('flash'); f.style.transition='none'; f.style.opacity=a; requestAnimationFrame(()=>{ f.style.transition='opacity .35s'; f.style.opacity=0; }); }

// ---------- sound (procedural, off by default) ----------
const Sound = {
  ctx:null, on:false, fireGain:null,
  init(){ if (this.ctx) return; const C = this.ctx = new (window.AudioContext||window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = 0.7; this.master.connect(C.destination);
    // noise buffer
    const n = C.sampleRate*2, buf = C.createBuffer(1, n, C.sampleRate), d = buf.getChannelData(0);
    let b0=0,b1=0,b2=0; for (let i=0;i<n;i++){ const w=Math.random()*2-1; b0=0.99765*b0+w*0.099; b1=0.963*b1+w*0.2965; b2=0.57*b2+w*1.0526; d[i]=(b0+b1+b2+w*0.1848)*0.15; }
    this.noise = buf;
    // fire loop
    const src = C.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = C.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=380; bp.Q.value=0.6;
    const lp = C.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2400;
    this.fireGain = C.createGain(); this.fireGain.gain.value=0;
    src.connect(bp).connect(lp).connect(this.fireGain).connect(this.master); src.start();
    this.fireLfo = C.createOscillator(); this.fireLfo.frequency.value = 9; const lg = C.createGain(); lg.gain.value = 500; this.fireLfo.connect(lg).connect(lp.frequency); this.fireLfo.start();
  },
  fire(active){ if (!this.on||!this.ctx) return; if (this._fireActive===active) return; this._fireActive=active; const g=this.fireGain.gain; g.cancelScheduledValues(this.ctx.currentTime); g.setTargetAtTime(active?0.9:0, this.ctx.currentTime, active?0.08:0.25); },
  burst(freq=1800, dur=0.25, vol=0.5){ if (!this.on||!this.ctx) return; const C=this.ctx, s=C.createBufferSource(); s.buffer=this.noise;
    const f=C.createBiquadFilter(); f.type='bandpass'; f.Q.value=1.2; f.frequency.setValueAtTime(freq, C.currentTime); f.frequency.exponentialRampToValueAtTime(freq*0.25, C.currentTime+dur);
    const g=C.createGain(); g.gain.setValueAtTime(vol, C.currentTime); g.gain.exponentialRampToValueAtTime(0.001, C.currentTime+dur);
    s.connect(f).connect(g).connect(this.master); s.start(); s.stop(C.currentTime+dur+0.05); },
  thud(){ if (!this.on||!this.ctx) return; const C=this.ctx, o=C.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(110, C.currentTime); o.frequency.exponentialRampToValueAtTime(38, C.currentTime+0.35);
    const g=C.createGain(); g.gain.setValueAtTime(0.9, C.currentTime); g.gain.exponentialRampToValueAtTime(0.001, C.currentTime+0.45); o.connect(g).connect(this.master); o.start(); o.stop(C.currentTime+0.5); },
  roar(){ if (!this.on||!this.ctx) return; const C=this.ctx, t=C.currentTime;
    const o=C.createOscillator(); o.type='sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(120, t+0.25); o.frequency.exponentialRampToValueAtTime(45, t+1.4);
    const o2=C.createOscillator(); o2.type='square'; o2.frequency.setValueAtTime(140, t); o2.frequency.exponentialRampToValueAtTime(60, t+1.4);
    const ws=C.createWaveShaper(); const curve=new Float32Array(256); for(let i=0;i<256;i++){ const x=i/128-1; curve[i]=Math.tanh(x*4); } ws.curve=curve;
    const lp=C.createBiquadFilter(); lp.type='lowpass'; lp.frequency.setValueAtTime(900,t); lp.frequency.exponentialRampToValueAtTime(250,t+1.4);
    const g=C.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.7,t+0.12); g.gain.exponentialRampToValueAtTime(0.001,t+1.5);
    o.connect(ws); o2.connect(ws); ws.connect(lp).connect(g).connect(this.master); o.start(); o2.start(); o.stop(t+1.6); o2.stop(t+1.6);
    this.burst(600, 1.2, 0.35); },
};

// ---------- dragon ----------
let dragon = null;
class Dragon {
  constructor(gltf){
    this.group = new THREE.Group();
    this.model = gltf.scene;
    this.scale = 2.3;                 // model is 1 unit tall
    this.model.scale.setScalar(this.scale);
    this.group.add(this.model);
    scene.add(this.group);
    this.bones = {};
    this.model.traverse(o=>{
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh){ this.mesh = o; o.frustumCulled = false; o.castShadow = true; o.receiveShadow = false;
        const m = o.material; m.roughness = 0.42; m.metalness = 0.25; m.envMapIntensity = 0.9; }
    });
    this.buildDeformers();
    this.model.updateMatrixWorld(true);
    // rest pose and parent frames
    this.rest = {}; this.parentInv = {};
    for (const [n,b] of Object.entries(this.bones)){
      this.rest[n] = b.quaternion.clone();
      const pq = new THREE.Quaternion(); b.parent.getWorldQuaternion(pq);
      this.parentInv[n] = pq.invert();
    }
    // world axes of the rest pose, expressed in each bone's parent frame (body relative)
    // model faces +Z, up is +Y, its left hand is +X
    this.axis = {};
    const ax = {X:new THREE.Vector3(1,0,0), Y:new THREE.Vector3(0,1,0), Z:new THREE.Vector3(0,0,1)};
    for (const n of Object.keys(this.bones)){
      this.axis[n] = {};
      for (const k in ax) this.axis[n][k] = ax[k].clone().applyQuaternion(this.parentInv[n]).normalize();
    }
    // anchors in mesh space, from the rig analysis
    this.mouth = this.anchor('Head', 0.05, 0.86, 0.35);
    this.mouthDir = this.anchor('Head', 0.05, 0.85, 0.9);
    this.clawL = this.anchor('L_Hand', 0.39, 0.41, 0.22);
    this.clawR = this.anchor('R_Hand', -0.28, 0.40, 0.23);
    this.chest = this.anchor('Spine02', 0.05, 0.72, 0.1);
    this.tailTip = this.anchor('R_ToeBase', -0.40, 0.23, 0.06);
    // state
    this.pos = this.group.position;
    this.yaw = 0; this.speed = 0; this.vel = new THREE.Vector3();
    this.phase = 0; this.t = 0;
    this.action = null; this.actionT = 0;
    this.fireOn = false; this.fireCharge = 0; this.fireTime = 0;
    this.fireHeld = 0; this.firedBall = false;
    this.combo = 0; this.comboWindow = 0; this.lastClaw = 'R';
    this.lungeCool = 0;
    // secondary motion state: lagged copies of the body's own motion
    this.yawPrev = 0; this.yawLag = 0; this.yawLagV = 0; this.yawLagSlow = 0;
    this.tailLift = 0; this.jawVel = 0; this.headPitchPrev = 0;
    this.bladeSpring = new THREE.Vector3(); this.bladeVel = new THREE.Vector3();
    this.prevWorldVel = new THREE.Vector3(); this.prevPos = new THREE.Vector3();
    this.jawOpen = 0; this.jawTarget = 0;
    this.helper = new THREE.SkeletonHelper(this.model); this.helper.visible = false; scene.add(this.helper);
    this.q = new THREE.Quaternion();
    this.stateName = 'Idle';
  }
  // The rig has no jaw bone and no blade bones. Rather than rebuild the skeleton,
  // both are done by moving the rest position before skinning: the Head bone then
  // carries the open jaw wherever the head goes, for free.
  buildDeformers(){
    const geo = this.mesh.geometry;
    const p = geo.attributes.position;
    const nV = p.count;
    const aJaw = new Float32Array(nV), aBlade = new Float32Array(nV);
    // jaw band, measured off the head profile: an oriented slab from the hinge forward
    const HZ = 0.175, HY = 0.870, ANG = Math.atan2(-0.068, 0.13);
    const ca = Math.cos(ANG), sa = Math.sin(ANG);
    for (let i=0;i<nV;i++){
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const dz = z-HZ, dy = y-HY;
      const u =  dz*ca + dy*sa;          // along the jaw
      const v = -dz*sa + dy*ca;          // across it
      let w = clamp(u/0.03,0,1) * clamp((0.22-u)/0.03,0,1)
            * clamp((v+0.085)/0.025,0,1) * clamp((0.015-v)/0.02,0,1)
            * clamp((0.12-Math.abs(x-0.049))/0.03,0,1);
      aJaw[i] = w;
      // back blades: everything behind the spine, ramping with how far back it sits
      const back = -z;
      aBlade[i] = (y > 0.52 && back > 0.045) ? clamp((back-0.045)/0.13,0,1) * clamp((y-0.52)/0.10,0,1) : 0;
    }
    // Distance along the coil, read straight off the skin weights. The rig has no
    // tail chain, but the leg bones it reused run base to tip in order, so blending
    // their weights gives a clean 0 at the hips and 1 at the whip tip.
    const rank = { Pelvis:0.06, L_Thigh:0.30, R_Thigh:0.30, L_Calf:0.55, R_Calf:0.55,
                   L_Foot:0.78, R_Foot:0.78, L_ToeBase:1.0, R_ToeBase:1.0 };
    const boneRank = this.mesh.skeleton.bones.map(b => rank[b.name] || 0);
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const aTail = new Float32Array(nV);
    for (let i=0;i<nV;i++){
      let t = 0;
      for (let k=0;k<4;k++) t += sw.getComponent(i,k) * boneRank[si.getComponent(i,k)];
      aTail[i] = t;
    }
    geo.setAttribute('aTail', new THREE.BufferAttribute(aTail,1));
    geo.setAttribute('aJaw', new THREE.BufferAttribute(aJaw,1));
    geo.setAttribute('aBlade', new THREE.BufferAttribute(aBlade,1));
    const u = this.defUniforms = {
      uJaw:{value:0}, uBlade:{value:new THREE.Vector3()},
      uHinge:{value:new THREE.Vector2(HY, HZ)},
      // x twist, y lift, z wave amplitude, w wave phase
      uTail:{value:new THREE.Vector4()},
      uTailRoot:{value:new THREE.Vector2(0.05, 0.06)},
    };
    const mat = this.mesh.material;
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      const decl = `
        attribute float aJaw; attribute float aBlade; attribute float aTail;
        uniform float uJaw; uniform vec3 uBlade; uniform vec2 uHinge;
        uniform vec4 uTail; uniform vec2 uTailRoot;
        float tailAngle(){
          // lag grows down the coil, and a travelling wave runs out to the tip
          return uTail.x*pow(aTail, 1.35) + uTail.z*sin(uTail.w - aTail*4.6)*aTail;
        }
        vec3 deform(vec3 p){
          if (aJaw > 0.001){                       // swing the lower jaw about the hinge
            float a = uJaw*aJaw; float c = cos(a), s = sin(a);
            float dy = p.y-uHinge.x, dz = p.z-uHinge.y;
            p.y = uHinge.x + dy*c - dz*s;
            p.z = uHinge.y + dy*s + dz*c;
          }
          if (aTail > 0.002){                      // continuous bend the one tail bone cannot do
            float a = tailAngle(); float c = cos(a), s = sin(a);
            float dx = p.x-uTailRoot.x, dz = p.z-uTailRoot.y;
            p.x = uTailRoot.x + dx*c + dz*s;
            p.z = uTailRoot.y - dx*s + dz*c;
            p.y += uTail.y*aTail*aTail;
          }
          p += uBlade*aBlade;                      // blades lag behind the torso
          return p;
        }
        vec3 deformDir(vec3 n){
          if (aJaw > 0.001){ float a = uJaw*aJaw; float c = cos(a), s = sin(a);
            n = vec3(n.x, n.y*c - n.z*s, n.y*s + n.z*c); }
          if (aTail > 0.002){ float a = tailAngle(); float c = cos(a), s = sin(a);
            n = vec3(n.x*c + n.z*s, n.y, -n.x*s + n.z*c); }
          return n;
        }
`;
      sh.vertexShader = decl + sh.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = deformDir(objectNormal);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = deform(transformed);');
    };
    mat.customProgramCacheKey = ()=>'ironcoil-deform';
    mat.needsUpdate = true;
  }
  // Two bone IK so the claw reaches what it is swinging at instead of a fixed arc.
  // Solves in the shoulder's parent frame: aim the upper arm, then bend the elbow
  // by the law of cosines. Falls back to the animated pose when the target is
  // outside reach, so a miss still looks like a miss.
  armIK(side, targetWorld, blend){
    const up = this.bones[side+'_Upperarm'], fo = this.bones[side+'_Forearm'];
    if (!up || !fo || blend <= 0.001) return;
    this.model.updateMatrixWorld(true);
    const sh = new THREE.Vector3(), el = new THREE.Vector3(), hd = new THREE.Vector3();
    up.getWorldPosition(sh); fo.getWorldPosition(el);
    (this.bones[side+'_Hand']||fo).getWorldPosition(hd);
    const l1 = sh.distanceTo(el), l2 = el.distanceTo(hd);
    if (l1 < 1e-4 || l2 < 1e-4) return;
    const to = targetWorld.clone().sub(sh);
    const dist = clamp(to.length(), Math.abs(l1-l2)+1e-3, (l1+l2)*0.995);
    to.normalize();
    // current forward of the arm, in world space
    const cur = hd.clone().sub(sh).normalize();
    const swing = new THREE.Quaternion().setFromUnitVectors(cur, to);
    const pq = new THREE.Quaternion(); up.parent.getWorldQuaternion(pq);
    const pInv = pq.clone().invert();
    const local = pInv.clone().multiply(swing).multiply(pq);
    up.quaternion.premultiply(new THREE.Quaternion().slerp(local, blend));
    // elbow angle needed to put the hand at that distance
    const cosE = clamp((l1*l1 + l2*l2 - dist*dist)/(2*l1*l2), -1, 1);
    const want = Math.PI - Math.acos(cosE);
    const curE = Math.acos(clamp((l1*l1 + l2*l2 - sh.distanceTo(hd)**2)/(2*l1*l2), -1, 1));
    const delta = (Math.PI - curE) - want;
    this.q.setFromAxisAngle(this.axis[side+'_Forearm'].X, -delta*blend);
    fo.quaternion.premultiply(this.q);
  }
  nearestTarget(aimYaw){
    let best = null, bestScore = Infinity;
    const f = new THREE.Vector3(Math.sin(aimYaw), 0, Math.cos(aimYaw));
    for (const d of drones){
      if (d.dead || d.delay > 0) continue;
      const rel = d.home.clone().sub(this.pos);
      const dist = rel.length(); if (dist > 10) continue;
      const cos = rel.clone().setY(0).normalize().dot(f);
      if (cos < 0.78) continue;                 // roughly 38 degrees off the aim
      const sc = dist * (2 - cos);
      if (sc < bestScore){ bestScore = sc; best = d; }
    }
    return best;
  }
  anchor(boneName, x, y, z){
    const b = this.bones[boneName];
    const o = new THREE.Object3D();
    const w = this.mesh.localToWorld(new THREE.Vector3(x,y,z));
    b.add(o); o.position.copy(b.worldToLocal(w));
    return o;
  }
  // rotate bone about a body axis (rest frame), angle in radians; premultiplied in parent space
  rot(name, axisKey, angle){
    const b = this.bones[name]; if (!b || !angle) return;
    this.q.setFromAxisAngle(this.axis[name][axisKey], angle);
    b.quaternion.premultiply(this.q);
  }
  resetPose(){ for (const n in this.bones) this.bones[n].quaternion.copy(this.rest[n]); }
  startAction(name){
    if (this.action && this.actionT < this.action.dur*0.72) return false;
    const durs = {clawL:0.62, clawR:0.62, slam:0.92, tail:0.95, roar:1.7, lunge:0.60};
    this.action = {name, dur:durs[name]}; this.actionT = 0; this.hitDone = false;
    if (name==='roar') Sound.roar();
    return true;
  }
  // Claw combo: alternating swipes, and a two handed slam if the third press
  // lands inside the window. Break the rhythm and it resets to a single swipe.
  claw(){
    // A press during the back half of a swipe is buffered, not dropped. Without
    // this the next swipe is only legal for the last tenth of a second and the
    // combo is effectively unreachable.
    const a = this.action;
    if (a && (a.name === 'clawL' || a.name === 'clawR' || a.name === 'slam')){
      if (this.actionT > a.dur*0.30) this.queuedClaw = true;
      return;
    }
    this.clawStep();
  }
  clawStep(){
    if (this.comboWindow > 0 && this.combo >= 2){
      if (this.startAction('slam')){ this.combo = 0; this.comboWindow = 0; }
      return;
    }
    const side = this.lastClaw === 'L' ? 'R' : 'L';
    if (this.startAction('claw'+side)){
      this.lastClaw = side;
      this.combo = this.comboWindow > 0 ? this.combo+1 : 1;
      this.comboWindow = 0.9;
    }
  }
  lunge(){
    if (this.lungeCool > 0) return;
    if (this.startAction('lunge')){ this.lungeCool = 1.1; this.lungeHits = new Set(); Sound.burst(320, 0.35, 0.4); }
  }
  update(dt, input, camYaw, camPitch){
    this.t += dt;
    // ---- locomotion ----
    const wantMove = input.move.lengthSq() > 0.001;
    let targetSpeed = 0;
    const busy = this.action && this.action.name!=='fire' && this.action.name!=='clawL' && this.action.name!=='clawR';
    if (wantMove && !busy){
      // camera-relative: forward is away from the camera
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
      const d = new THREE.Vector3(rx*input.move.x + fx*input.move.y, 0, rz*input.move.x + fz*input.move.y).normalize();
      const targetYaw = Math.atan2(d.x, d.z);
      let dy = targetYaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += clamp(dy, -6*dt, 6*dt);
      targetSpeed = (input.sprint?6.2:3.6) * input.move.length();
      if (this.fireOn) targetSpeed *= 0.45;
    }
    this.aimPitch = 0;
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    if (this.comboWindow === 0) this.combo = 0;
    this.lungeCool = Math.max(0, this.lungeCool - dt);
    if (this.action && this.action.name === 'lunge'){
      this.speed = 17.5 * Math.pow(1 - this.actionT/this.action.dur, 1.6);   // flat burst, short tail
    } else this.speed = damp(this.speed, targetSpeed, 5, dt);
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.addScaledVector(fwd, this.speed*dt);
    const r = Math.hypot(this.pos.x, this.pos.z); if (r > 13.5){ this.pos.x *= 13.5/r; this.pos.z *= 13.5/r; }
    this.phase += dt * (1.6 + this.speed*1.35);
    const s = this.speed/6.2;               // 0..1

    // ---- secondary motion ----
    // The tail and blades have no bones of their own, so their lag is driven by
    // how fast the body is turning and accelerating, run through a damped spring.
    let dyaw = this.yaw - this.yawPrev; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yawPrev = this.yaw;
    const yawRate = dt > 1e-5 ? dyaw/dt : 0;
    this.yawLagV += (yawRate - this.yawLag)*46*dt - this.yawLagV*11*dt;
    this.yawLag += this.yawLagV*dt;
    const whip = clamp((yawRate - this.yawLag)*0.10, -0.55, 0.55);
    const worldVel = fwd.clone().multiplyScalar(this.speed);
    const accel = worldVel.clone().sub(this.prevWorldVel).divideScalar(Math.max(dt,1e-5));
    this.prevWorldVel.copy(worldVel);
    const cy = Math.cos(-this.yaw), sy = Math.sin(-this.yaw);
    const localAcc = new THREE.Vector3(accel.x*cy - accel.z*sy, accel.y, accel.x*sy + accel.z*cy);
    this.bladeVel.addScaledVector(localAcc, -0.05*dt);
    this.bladeVel.addScaledVector(this.bladeSpring, -34*dt);
    this.bladeVel.multiplyScalar(Math.exp(-7*dt));
    this.bladeSpring.addScaledVector(this.bladeVel, dt);
    this.bladeSpring.clampLength(0, 0.07);
    this.defUniforms.uBlade.value.copy(this.bladeSpring);
    // Tail: a slower second lag so the tip trails further than the base, plus a
    // travelling wave that scales with how fast the body is moving.
    this.yawLagSlow = damp(this.yawLagSlow, yawRate, 5.5, dt);
    const tailTwist = clamp((this.yawLagSlow - yawRate)*0.085, -0.75, 0.75);
    const liftTarget = clamp(-localAcc.z*0.0032, -0.07, 0.07) + Math.sin(this.t*0.8)*0.008;
    this.tailLift = damp(this.tailLift, liftTarget, 7, dt);
    const waveAmp = (0.035 + 0.115*s) * (this.action && this.action.name==='tail' ? 0.3 : 1);
    this.defUniforms.uTail.value.set(tailTwist, this.tailLift, waveAmp, this.phase*1.15);
    this.defUniforms.uBlade.value.x += -whip*0.05;     // plates fan out through a turn

    // ---- pose: idle + locomotion layers ----
    this.resetPose();
    const t = this.t, ph = this.phase;
    const breath = Math.sin(t*1.4);
    // torso
    this.rot('Pelvis','Z',  Math.sin(ph)*0.10*s);
    this.rot('Waist','Y',   Math.sin(ph)*0.28*s + Math.sin(t*0.7)*0.04);
    this.rot('Waist','X',   breath*0.02 + s*0.08);
    this.rot('Spine01','Y', Math.sin(ph-0.6)*0.18*s);
    this.rot('Spine01','X', breath*0.03);
    this.rot('Spine02','Y', Math.sin(ph-1.2)*0.12*s + Math.sin(t*0.9)*0.03);
    this.rot('Spine02','X', breath*0.02 - s*0.06);
    // head: gentle scan, counter the body sway so it keeps looking forward
    this.rot('Head','Y', -Math.sin(ph-0.8)*0.3*s + Math.sin(t*0.55)*0.12*(1-s));
    this.rot('Head','X', breath*0.03 + Math.sin(t*0.8)*0.04 - s*0.04);
    this.rot('Head','Z', Math.sin(ph-1.8)*0.06*s);
    // arms swing opposite to the body twist, hang a little
    for (const side of ['L','R']){
      const sg = side==='L'?1:-1;
      this.rot(side+'_Clavicle','Z', sg*(-0.04 + Math.sin(t*1.4+sg)*0.02));
      this.rot(side+'_Upperarm','X', Math.sin(ph+ (side==='L'?0:Math.PI))*0.35*s + Math.sin(t*1.1+sg*2)*0.04);
      this.rot(side+'_Upperarm','Z', sg*(0.12*s - 0.05 + breath*0.02));
      this.rot(side+'_Forearm','X', -(0.25*s + Math.sin(t*1.3+sg)*0.05 + 0.1));
      this.rot(side+'_Hand','X', Math.sin(t*1.9+sg*1.3)*0.08);
      this.curl(side, 0.15 + Math.sin(t*1.7+sg)*0.1);
    }
    // coil: leg bones drive the serpent body. small phase-offset undulation
    const w = Math.sin(ph-2.2), w2 = Math.sin(ph-2.9), w3 = Math.sin(ph-3.6);
    this.rot('L_Thigh','Y', w*0.12*s + Math.sin(t*0.8)*0.03);
    this.rot('R_Thigh','Y', w*0.12*s + Math.sin(t*0.8+1)*0.03);
    this.rot('L_Calf','Y', w2*0.14*s);  this.rot('R_Calf','Y', w2*0.14*s);
    this.rot('L_Foot','Y', w3*0.14*s);  this.rot('R_Foot','Y', w3*0.14*s);
    this.rot('L_ToeBase','Y', w3*0.18*s + Math.sin(t*1.1)*0.05);
    this.rot('R_ToeBase','Y', Math.sin(ph-4.2)*0.28*s + Math.sin(t*0.9)*0.08);
    this.rot('R_ToeBase','X', Math.sin(t*1.3)*0.04);
    // the coil trails the turn, each link further out lagging more
    this.rot('L_Thigh','Y', whip*0.14);   this.rot('R_Thigh','Y', whip*0.14);
    this.rot('L_Calf','Y',  whip*0.24);   this.rot('R_Calf','Y',  whip*0.24);
    this.rot('L_Foot','Y',  whip*0.38);   this.rot('R_Foot','Y',  whip*0.38);
    this.rot('L_ToeBase','Y', whip*0.55); this.rot('R_ToeBase','Y', whip*0.62);
    this.group.position.y = Math.abs(Math.sin(ph))*0.03*s;

    // ---- action layer ----
    this.spinYaw = 0;
    if (this.action){
      this.actionT += dt;
      const a = this.action, u = clamp(this.actionT/a.dur, 0, 1);
      if (a.name==='clawL' || a.name==='clawR') this.poseClaw(a.name==='clawL'?'L':'R', u);
      else if (a.name==='slam') this.poseSlam(u);
      else if (a.name==='lunge') this.poseLunge(u);
      else if (a.name==='tail') this.poseTail(u);
      else if (a.name==='roar') this.poseRoar(u);
      if (u>=1){
        const ended = a.name;
        this.action = null;
        if (this.queuedClaw){ this.queuedClaw = false; if (ended !== 'slam') this.clawStep(); }
      }
    }
    // ---- fire ----
    if (this.fireOn){
      this.fireHeld += dt;
      this.fireCharge = Math.min(1, Math.max(0, (this.fireHeld - 0.20))*4.2);
      this.fireTime += dt;
      // head pushes forward, mouth drops, body braces
      const k = this.fireCharge;
      this.rot('Head','X', (0.10 + clamp((camPitch-0.40)*0.8, -0.3, 0.4) + (this.aimPitch||0))*k + Math.sin(t*23)*0.015*k);
      this.rot('Spine02','X', 0.12*k);
      this.rot('Spine01','X', -0.08*k);
      this.rot('L_Upperarm','Z', 0.35*k); this.rot('R_Upperarm','Z', -0.35*k);
      this.rot('L_Forearm','X', -0.4*k); this.rot('R_Forearm','X', -0.4*k);
      this.curl('L', 0.55*k); this.curl('R', 0.55*k);
    } else { this.fireCharge = Math.max(0, this.fireCharge - dt*3); this.fireTime = 0; }

    // ---- jaw ----
    // Rest is the modelled pose, which is already slightly open. Everything here
    // opens it further; it is never closed past the sculpt, which would clip the fangs.
    // The jaw cannot close: the upper fangs interlock into the lower jaw with only
    // about 2.5 degrees of clearance. So everything here is about how it opens, how
    // hard it snaps back to the sculpt, and how it trails the head.
    let jaw = 0.018*Math.sin(t*1.25);                      // idle breath
    if (this.fireOn && this.fireCharge > 0.05){
      jaw = 0.10 + 0.32*this.fireCharge + Math.sin(t*27)*0.018*this.fireCharge;
    }
    let snap = 0;                                          // a bite closes fast, not on a spring
    if (this.action){
      const u = clamp(this.actionT/this.action.dur,0,1), n = this.action.name;
      if (n==='roar')  jaw = Math.max(jaw, 0.62*Math.sin(clamp((u-0.16)/0.52,0,1)*Math.PI) + Math.sin(t*34)*0.02);
      if (n==='lunge'){
        // gape on the way in, then bite shut at the end of the dash
        jaw = Math.max(jaw, 0.58*smooth(clamp(u/0.34,0,1)) * (1 - smooth(clamp((u-0.42)/0.22,0,1))));
        if (u > 0.42) snap = 1;
      }
      if (n==='slam'){
        jaw = Math.max(jaw, 0.34*Math.sin(clamp((u-0.22)/0.34,0,1)*Math.PI));
        if (u > 0.5) snap = 1;
      }
      if (n==='clawL' || n==='clawR') jaw = Math.max(jaw, 0.14*Math.sin(clamp((u-0.2)/0.4,0,1)*Math.PI));
      if (n==='tail') jaw = Math.max(jaw, 0.20*Math.sin(clamp(u/0.7,0,1)*Math.PI));
    }
    // Inertia: a head that snaps upward drags the jaw open behind it.
    const headPitch = this.bones.Head ? this.bones.Head.rotation.x : 0;
    const headRate = dt > 1e-5 ? (headPitch - this.headPitchPrev)/dt : 0;
    this.headPitchPrev = headPitch;
    jaw += clamp(headRate*0.035, -0.05, 0.14);
    jaw = clamp(jaw, -0.04, 0.72);                         // -0.04 is the measured closing limit
    this.jawOpen = damp(this.jawOpen, jaw, snap ? 46 : 15, dt);
    this.defUniforms.uJaw.value = this.jawOpen;

    this.group.rotation.y = this.yaw + this.spinYaw;
    this.group.updateMatrixWorld(true);
    // ---- hand IK, applied last so it overrides the animated arc ----
    if (this.ikSide && this.ikBlend > 0.001 && this.ikTarget){
      this.armIK(this.ikSide, this.ikTarget, this.ikBlend);
      this.group.updateMatrixWorld(true);
    }
    // state label
    let st = 'Idle';
    if (this.action) st = {clawL:'Claw swipe', clawR:'Claw swipe', tail:'Tail spin', roar:'Roar'}[this.action.name];
    else if (this.fireOn) st = 'Fire breath';
    else if (this.speed>0.4) st = input.sprint?'Charging':'Slithering';
    if (this.fireOn && this.action) st += ', fire breath';
    if (st!==this.stateName){ this.stateName=st; $('state').textContent = st; }
  }
  curl(side, k){
    for (const f of ['Index','Mid','Ring','Pinky']){ this.rot(`${side}_${f}1`,'X', k*0.6); this.rot(`${side}_${f}2`,'X', k*0.9); this.rot(`${side}_${f}3`,'X', k*0.8); }
    this.rot(`${side}_Thumb1`,'X', k*0.5); this.rot(`${side}_Thumb2`,'X', k*0.6);
  }
  poseClaw(side, u){
    const sg = side==='L'?1:-1;
    // windup 0..0.3 (pull back and out), strike 0.3..0.5 (forward and across), recover 0.5..1
    let pitch, out, across, elbow, twist;
    if (u<0.3){ const k=easeOut(u/0.3); pitch=0.55*k; out=0.75*k; across=0.6*k; elbow=0.35*k; twist=0.35*k; }
    else if (u<0.5){ const k=easeInOut((u-0.3)/0.2); pitch=lerp(0.55,-1.35,k); out=lerp(0.75,0.25,k); across=lerp(0.6,-0.75,k); elbow=lerp(0.35,0.95,k); twist=lerp(0.35,-0.5,k);
      if (!this.hitDone && k>0.55){ this.hitDone=true; this.doClawHit(side); } }
    else { const k=smooth((u-0.5)/0.5); pitch=lerp(-1.35,0,k); out=lerp(0.25,0,k); across=lerp(-0.75,0,k); elbow=lerp(0.95,0,k); twist=lerp(-0.5,0,k); }
    // reach for whatever is in front, strongest through the strike
    const tgt = this.nearestTarget(this.yaw);
    this.ikSide = side; this.ikTarget = tgt ? tgt.home : null;
    this.ikBlend = tgt ? 0.85*Math.sin(clamp((u-0.18)/0.5,0,1)*Math.PI) : 0;
    this.rot(side+'_Clavicle','Y', sg*across*0.25);
    this.rot(side+'_Upperarm','X', pitch);
    this.rot(side+'_Upperarm','Z', sg*out);
    this.rot(side+'_Upperarm','Y', sg*across);
    this.rot(side+'_Forearm','X', -elbow);
    this.rot(side+'_Hand','X', 0.35*Math.max(0,-pitch));
    this.curl(side, 0.25 + 0.7*Math.max(0,-pitch)/1.35);
    this.rot('Waist','Y', sg*twist);
    this.rot('Spine01','Y', sg*twist*0.5);
    this.rot('Head','Y', -sg*twist*0.7);
    this.rot(side==='L'?'R_Upperarm':'L_Upperarm','X', 0.3*Math.max(0,-pitch));
  }
  // Two handed overhead slam, the payoff at the end of the combo.
  poseSlam(u){
    let rear;
    if (u<0.32) rear = easeOut(u/0.32);
    else if (u<0.47) rear = lerp(1, -0.85, easeInOut((u-0.32)/0.15));
    else rear = lerp(-0.85, 0, smooth((u-0.47)/0.53));
    for (const side of ['L','R']){
      const sg = side==='L'?1:-1;
      this.rot(side+'_Clavicle','Z', sg*0.18*Math.max(0,rear));
      this.rot(side+'_Upperarm','X', 1.15*rear);
      this.rot(side+'_Upperarm','Z', sg*0.55*Math.abs(rear));
      this.rot(side+'_Forearm','X', -0.55*Math.max(0,rear) - 0.35*Math.max(0,-rear));
      this.curl(side, 0.35 + 0.6*Math.abs(rear));
    }
    this.rot('Spine02','X', -0.32*rear); this.rot('Spine01','X', -0.18*rear);
    this.rot('Waist','X', -0.12*rear);
    this.rot('Head','X', -0.30*rear);
    this.group.position.y += 0.12*Math.max(0,rear);
    this.ikBlend = 0;
    if (!this.hitDone && u>0.44){
      this.hitDone = true; Sound.thud(); shake(0.5); this.groundRing(4.2);
      const p = this.pos.clone().addScaledVector(new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw)), 1.9);
      addScorch(p.x, p.z, 1.1); burstSparks(p.clone().setY(0.3), 40, 9);
      for (let i=0;i<18;i++) dust.emit(p.clone().setY(0.06), new THREE.Vector3(rnd(3,-3), rnd(2.6,0.6), rnd(3,-3)), rnd(1.3,0.7), rnd(1.0,0.5));
      for (const d of drones){ if (d.dead||d.delay>0) continue; if (d.home.distanceTo(p) < 3.4) droneHit(d, 3, this.pos, 22); }
    }
  }
  // Serpent strike: the body goes low and long, then snaps upright.
  poseLunge(u){
    const push = Math.sin(clamp(u/0.85,0,1)*Math.PI);
    const dive = easeOut(clamp(u/0.25,0,1)) * (1 - smooth(clamp((u-0.55)/0.45,0,1)));
    this.rot('Waist','X', 0.38*dive);
    this.rot('Spine01','X', 0.26*dive);
    this.rot('Spine02','X', 0.22*dive);
    this.rot('Head','X', -0.42*dive);
    this.rot('L_Upperarm','X', -0.75*dive); this.rot('R_Upperarm','X', -0.75*dive);
    this.rot('L_Upperarm','Z', 0.30*dive);  this.rot('R_Upperarm','Z', -0.30*dive);
    this.rot('L_Forearm','X', -0.30*dive);  this.rot('R_Forearm','X', -0.30*dive);
    this.curl('L', 0.75*dive); this.curl('R', 0.75*dive);
    this.rot('L_ToeBase','Y', -0.35*push); this.rot('R_ToeBase','Y', -0.45*push);
    this.rot('L_Calf','Y', -0.2*push); this.rot('R_Calf','Y', -0.2*push);
    this.group.position.y += 0.22*push;
    this.ikBlend = 0;
    if (u < 0.75 && Math.random() < 0.7){
      const p = this.pos.clone(); p.y = 0.06;
      dust.emit(p, new THREE.Vector3(rnd(2,-2), rnd(1.6,0.4), rnd(2,-2)), rnd(1.1,0.5), rnd(0.9,0.45));
    }
    // damages whatever it passes through, once each
    for (const d of drones){
      if (d.dead||d.delay>0 || this.lungeHits.has(d)) continue;
      if (d.home.distanceTo(this.pos) < 2.4){ this.lungeHits.add(d); droneHit(d, 2, this.pos, 26); shake(0.3); }
    }
  }
  doClawHit(side){
    const p = new THREE.Vector3(); (side==='L'?this.clawL:this.clawR).getWorldPosition(p);
    Sound.burst(2400, 0.22, 0.45);
    burstSparks(p, 14, 6);
    for (const d of drones){ if (d.dead||d.delay>0) continue; if (d.home.distanceTo(p) < 2.2 || d.home.distanceTo(this.pos) < 2.6){ droneHit(d, 1, this.pos, 9); shake(0.15); } }
    this.ikBlend = 0;
  }
  poseTail(u){
    // one full body spin, tail flung out; hits everything within reach at the midpoint
    const k = easeInOut(clamp((u-0.08)/0.72,0,1));
    this.spinYaw = k*Math.PI*2;
    const fling = Math.sin(clamp((u-0.05)/0.85,0,1)*Math.PI);
    this.rot('R_ToeBase','Y', -1.15*fling);
    this.rot('R_ToeBase','X', 0.35*fling);
    this.rot('L_ToeBase','Y', -0.4*fling);
    this.rot('R_Calf','Y', -0.35*fling); this.rot('L_Calf','Y', -0.35*fling);
    this.rot('R_Thigh','Y', -0.25*fling); this.rot('L_Thigh','Y', -0.25*fling);
    this.rot('Waist','Y', 0.5*fling); this.rot('Waist','X', 0.25*fling);
    this.rot('Spine02','X', 0.2*fling);
    this.rot('Head','Y', -0.4*fling); this.rot('Head','X', -0.2*fling);
    this.rot('L_Upperarm','Z', 0.9*fling); this.rot('R_Upperarm','Z', -0.9*fling);
    this.rot('L_Upperarm','X', -0.4*fling); this.rot('R_Upperarm','X', -0.4*fling);
    this.group.position.y += 0.18*fling;
    if (u>0.3 && u<0.7 && Math.random()<0.6){
      const tp = new THREE.Vector3(); this.tailTip.getWorldPosition(tp); tp.y = 0.05;
      dust.emit(tp, new THREE.Vector3(rnd(1,-1),rnd(1.2,0.3),rnd(1,-1)), rnd(1.2,0.6), rnd(0.9,0.45));
    }
    if (!this.hitDone && u>0.42){ this.hitDone=true; Sound.thud(); shake(0.4); this.groundRing(3.4);
      for (const d of drones){ if (d.dead||d.delay>0) continue; if (d.home.distanceTo(this.pos) < 4.2) droneHit(d, 2, this.pos, 16); } }
  }
  poseRoar(u){
    // rear back, flare, then snap forward with a shockwave
    let back;
    if (u<0.35) back = easeOut(u/0.35);
    else if (u<0.5) back = lerp(1,-0.55, easeInOut((u-0.35)/0.15));
    else back = lerp(-0.55, 0, smooth((u-0.5)/0.5));
    this.rot('Head','X', -0.55*back + (u>0.35&&u<0.8?Math.sin(this.t*40)*0.02:0));
    this.rot('Spine02','X', -0.28*back); this.rot('Spine01','X', -0.15*back);
    this.rot('Waist','X', -0.1*back);
    this.rot('L_Upperarm','Z', 1.3*Math.max(0,back)); this.rot('R_Upperarm','Z', -1.3*Math.max(0,back));
    this.rot('L_Upperarm','X', -0.9*Math.max(0,back)); this.rot('R_Upperarm','X', -0.9*Math.max(0,back));
    this.rot('L_Forearm','X', -0.6*Math.max(0,back)); this.rot('R_Forearm','X', -0.6*Math.max(0,back));
    this.curl('L', 0.9*Math.max(0,back)); this.curl('R', 0.9*Math.max(0,back));
    this.rot('R_ToeBase','Y', 0.3*back); this.rot('L_ToeBase','Y', -0.2*back);
    this.group.position.y += 0.08*Math.max(0,back);
    mouthLight.intensity = Math.max(mouthLight.intensity, 12*Math.max(0,back));
    if (!this.hitDone && u>0.42){ this.hitDone=true; shake(0.6); flash(0.25); this.groundRing(6);
      for (const d of drones){ if (d.dead||d.delay>0) continue; if (d.home.distanceTo(this.pos) < 9){ droneHit(d, 0, this.pos, 20); d.heat = Math.min(1, d.heat+0.35); } } }
  }
  groundRing(r){ rings.push({t:0, r, x:this.pos.x, z:this.pos.z}); }
  // F down starts the timer; a short press throws a fireball, a long one opens the jet.
  fireDown(){ if (this.fireOn) return; this.fireOn = true; this.fireHeld = 0; this.firedBall = false; }
  fireUp(){
    if (!this.fireOn) return;
    if (this.fireHeld < 0.22 && !this.firedBall){
      const m = new THREE.Vector3(), d = new THREE.Vector3();
      this.mouth.getWorldPosition(m); this.mouthDir.getWorldPosition(d); d.sub(m).normalize();
      spawnBall(m.addScaledVector(d, 0.2), d, clamp(this.fireHeld*4, 0, 1));
      this.firedBall = true;
      this.jawOpen = Math.max(this.jawOpen, 0.4);
      mouthLight.intensity = 14;
    }
    this.fireOn = false; this.fireHeld = 0;
  }
  updateFire(dt){
    fireLight.intensity = damp(fireLight.intensity, 0, 6, dt);
    mouthLight.intensity = damp(mouthLight.intensity, 0, 10, dt);
    if (!this.fireOn || this.fireCharge < 0.35) return;
    const m = new THREE.Vector3(), d = new THREE.Vector3();
    this.mouth.getWorldPosition(m); this.mouthDir.getWorldPosition(d); d.sub(m).normalize();
    mouthLight.position.copy(m).addScaledVector(d, 0.3); mouthLight.intensity = 4.5 + Math.sin(this.t*31)*1.2;
    fireLight.position.copy(m).addScaledVector(d, 3.8); fireLight.position.y = Math.max(0.6, fireLight.position.y);
    fireLight.intensity = 45 + Math.sin(this.t*27)*9 + Math.sin(this.t*47)*5;
    const n = Math.round(520*Q.particles*dt*this.fireCharge) + 1;
    const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0,1,0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, d).normalize();
    for (let i=0;i<n;i++){
      const a = rnd(Math.PI*2), rr = Math.pow(Math.random(),0.6)*0.17;
      const spd = rnd(15,10);
      const v = d.clone().multiplyScalar(spd).addScaledVector(right, Math.cos(a)*rr*5.5).addScaledVector(up, Math.sin(a)*rr*5.5);
      const p = m.clone().addScaledVector(right, Math.cos(a)*rr*0.4).addScaledVector(up, Math.sin(a)*rr*0.4).addScaledVector(d, 0.12);
      flames.emit(p, v, rnd(0.80,0.55), rnd(0.30,0.14));
    }
    if (Math.random() < 0.25) sparks.emit(m, d.clone().multiplyScalar(rnd(20,12)).add(new THREE.Vector3(rnd(2,-2),rnd(2,-2),rnd(2,-2))), rnd(0.8,0.4), rnd(0.08,0.04));
    // damage
    const tip = m.clone().addScaledVector(d, 4.2);
    for (const dr of drones){
      if (dr.dead||dr.delay>0) continue;
      const rel = dr.home.clone().sub(m); const along = rel.dot(d);
      if (along>0.5 && along<7.0){ const off = rel.clone().addScaledVector(d, -along).length(); if (off < 0.75 + along*0.17){
        dr.heat = Math.min(1.4, dr.heat + dt*1.9);
        if (Math.random()<dt*2.2) sparks.emit(dr.home, new THREE.Vector3(rnd(3,-3),rnd(4,1),rnd(3,-3)), 0.6, 0.06);
        if (dr.heat >= 1.3){ dr.heat = 0.55; droneHit(dr, 1, m, 5); }
      } }
    }
  }
}

// shockwave rings drawn on the floor
const rings = [];
const ringGeo = new THREE.RingGeometry(0.9, 1, 64);
const ringMat = new THREE.MeshBasicMaterial({color:0xff9a4a, transparent:true, opacity:0.9, side:THREE.DoubleSide, depthWrite:false, blending:THREE.AdditiveBlending});
const ringMeshes = [];
function updateRings(dt){
  for (let i=rings.length-1;i>=0;i--){
    const r = rings[i]; r.t += dt; const u = r.t/0.7;
    if (!r.mesh){ r.mesh = new THREE.Mesh(ringGeo, ringMat.clone()); r.mesh.rotation.x=-Math.PI/2; r.mesh.position.set(r.x,0.03,r.z); scene.add(r.mesh); }
    const sc = 0.2 + easeOut(clamp(u,0,1))*r.r;
    r.mesh.scale.setScalar(sc); r.mesh.material.opacity = (1-u)*0.9;
    if (u>=1){ scene.remove(r.mesh); rings.splice(i,1); }
  }
}

// ---------- input ----------
const input = { move:new THREE.Vector2(), sprint:false };
const keys = {};
const toggles = { bones:false, bloom:!isCoarse, sound:false, notes:false, help:false, settings:false };
function setToggle(name, v){
  toggles[name] = v;
  const btn = {bones:'btnBones', bloom:'btnBloom', sound:'btnSound', notes:'btnNotes'}[name];
  if (btn) $(btn).setAttribute('aria-pressed', String(v));
  if (name==='bones' && dragon) dragon.helper.visible = v;
  if (name==='notes'){ $('notes').dataset.open = String(v); if (v){ toggles.help=false; $('help').dataset.open='false'; $('btnHelp').setAttribute('aria-pressed','false');
                                                                     toggles.settings=false; $('settings').dataset.open='false'; $('btnCog').setAttribute('aria-pressed','false'); } }
  if (name==='help'){ $('help').dataset.open = String(v); $('btnHelp').setAttribute('aria-pressed', String(v));
    if (v){ toggles.settings=false; $('settings').dataset.open='false'; $('btnCog').setAttribute('aria-pressed','false'); toggles.notes=false; $('notes').dataset.open='false'; $('btnNotes').setAttribute('aria-pressed','false'); } }
  if (name==='settings'){ $('settings').dataset.open = String(v); $('btnCog').setAttribute('aria-pressed', String(v));
    if (v){ toggles.help=false; $('help').dataset.open='false'; $('btnHelp').setAttribute('aria-pressed','false'); } }
  if (name==='sound'){ if (v){ Sound.init(); Sound.ctx.resume(); } Sound.on = v; if (!v && Sound.fireGain) Sound.fireGain.gain.value = 0; }
}
$('btnBones').onclick = ()=>setToggle('bones', !toggles.bones);
$('btnBloom').onclick = ()=>setToggle('bloom', !toggles.bloom);
$('btnSound').onclick = ()=>setToggle('sound', !toggles.sound);
$('btnNotes').onclick = ()=>setToggle('notes', !toggles.notes);
$('btnHelp').onclick = ()=>setToggle('help', !toggles.help);
$('btnCog').onclick  = ()=>setToggle('settings', !toggles.settings);
function applyQuality(name, fromAuto){
  qName = name; Q = QUALITY[name];
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
  renderer.shadowMap.enabled = Q.shadows;
  key.castShadow = Q.shadows;
  if (key.shadow.map && key.shadow.mapSize.x !== Q.shadowMap){ key.shadow.map.dispose(); key.shadow.map = null; }
  key.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
  scene.traverse(o=>{ if (o.isMesh && o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
  setToggle('bloom', Q.bloom);
  $('btnQuality').textContent = 'Quality: ' + {low:'Low', med:'Medium', high:'High'}[name] + (fromAuto ? ' (auto)' : '');
  resize();
}
function cycleQuality(){ applyQuality(qOrder[(qOrder.indexOf(qName)+1) % qOrder.length]); }
$('btnQuality').onclick = cycleQuality;
setToggle('bloom', toggles.bloom);

addEventListener('keydown', e=>{
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (!dragon) return;
  if (k==='j') pressAction('claw');
  if (k==='k') pressAction('tail');
  if (k==='l') pressAction('lunge');
  if (k===' '){ e.preventDefault(); pressAction('roar'); }
  if (k==='f') pressAction('fire');
  if (k==='q') cycleQuality();
  if (k==='h' || k==='?' || k==='/') setToggle('help', !toggles.help);
  if (k==='o') setToggle('settings', !toggles.settings);
  if (k==='escape'){ setToggle('help', false); setToggle('settings', false); setToggle('notes', false); }
  if (k==='b') setToggle('bones', !toggles.bones);
  if (k==='v') setToggle('bloom', !toggles.bloom);
  if (k==='m') setToggle('sound', !toggles.sound);
  if (k==='i') setToggle('notes', !toggles.notes);
  if (k==='r'){ dragon.pos.set(0,0,0); dragon.yaw = 0; }
});
addEventListener('keyup', e=>{ const k=e.key.toLowerCase(); keys[k]=false; if (k==='f' && dragon) dragon.fireUp(); });
addEventListener('blur', ()=>{ for (const k in keys) keys[k]=false; if (dragon) dragon.fireUp(); });

// orbit camera
const cam = { yaw:Math.PI*0.15, pitch:0.40, dist: innerWidth<innerHeight ? 7.4 : 8.2, target:new THREE.Vector3() };
let dragging = null;
canvas.addEventListener('pointerdown', e=>{
  if (isCoarse && e.clientX < innerWidth*0.5 && e.clientY > innerHeight*0.55){ pad.start(e); return; }
  dragging = {id:e.pointerId, x:e.clientX, y:e.clientY}; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e=>{
  if (pad.active && pad.id===e.pointerId){ pad.move(e); return; }
  if (!dragging || dragging.id!==e.pointerId) return;
  cam.yaw -= (e.clientX-dragging.x)*0.005; cam.pitch = clamp(cam.pitch + (e.clientY-dragging.y)*0.004, 0.02, 1.15);
  dragging.x=e.clientX; dragging.y=e.clientY;
});
const endDrag = e=>{ if (pad.active && pad.id===e.pointerId) pad.end(); if (dragging && dragging.id===e.pointerId) dragging=null; };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', e=>{ cam.dist = clamp(cam.dist * (1 + e.deltaY*0.0012), 3.5, 16); }, {passive:true});

// touch joystick and buttons
const pad = { active:false, id:null, cx:0, cy:0, v:new THREE.Vector2(),
  start(e){ this.active=true; this.id=e.pointerId; const r=$('pad').getBoundingClientRect(); this.cx=r.left+r.width/2; this.cy=r.top+r.height/2; canvas.setPointerCapture(e.pointerId); this.move(e); },
  move(e){ const dx=e.clientX-this.cx, dy=e.clientY-this.cy; const l=Math.hypot(dx,dy); const m=Math.min(l,50); this.v.set(dx/50*(m/(l||1)), dy/50*(m/(l||1))); $('knob').style.transform=`translate(${this.v.x*40}px,${this.v.y*40}px)`; },
  end(){ this.active=false; this.v.set(0,0); $('knob').style.transform=''; } };
// One set of ability slots serves mouse, touch and the keyboard bindings.
const slots = {};
for (const b of document.querySelectorAll('.hotbar .slot')){
  const act = b.dataset.act;
  slots[act] = b;
  const down = e=>{ e.preventDefault(); b.blur(); if (!dragon) return; pressAction(act); };
  const up = e=>{ e.preventDefault(); if (dragon && act==='fire') dragon.fireUp(); };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
}
function pressAction(act){
  if (act==='fire') dragon.fireDown();
  else if (act==='claw') dragon.claw();
  else if (act==='tail') dragon.startAction('tail');
  else if (act==='lunge') dragon.lunge();
  else if (act==='roar') dragon.startAction('roar');
  flashSlot(act);
}
function flashSlot(act){
  const b = slots[act]; if (!b) return;
  b.classList.add('hit'); setTimeout(()=>b.classList.remove('hit'), 110);
}
// Live state on the bar: cooldown sweep, fire charge, combo pips.
function updateHotbar(){
  if (!dragon) return;
  const lungeReady = 1 - clamp(dragon.lungeCool/1.1, 0, 1);
  slots.lunge.querySelector('.cool').style.opacity = (1-lungeReady)*0.78;
  slots.lunge.dataset.ready = lungeReady > 0.99 ? '1' : '0';
  const busy = dragon.action ? clamp(1 - dragon.actionT/(dragon.action.dur*0.72), 0, 1) : 0;
  for (const k of ['claw','tail','roar']){
    slots[k].querySelector('.cool').style.opacity = busy*0.55;
    slots[k].dataset.ready = busy > 0.02 ? '0' : '1';
  }
  slots.fire.querySelector('.charge i').style.width = (dragon.fireOn ? clamp(dragon.fireHeld/0.22,0,1)*100 : dragon.fireCharge*100) + '%';
  const pips = slots.claw.querySelectorAll('.pips i');
  for (let i=0;i<pips.length;i++) pips[i].classList.toggle('on', i < dragon.combo);
}

// ---------- post processing ----------
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.65, 0.95);
const outputPass = new OutputPass();
composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(outputPass);
function resize(){
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w/h; camera.updateProjectionMatrix();
  // a tall narrow viewport crops the arena, so widen the field of view a little
  camera.fov = clamp(50 / Math.min(1, camera.aspect*1.45), 50, 58); camera.updateProjectionMatrix();
  bloom.resolution.set(w, h);
}
addEventListener('resize', resize); resize();

// ---------- load the model ----------
async function fetchAsset(url, label){
  const res = await fetch(url);
  if (!res.ok) throw new Error(label + ' failed: HTTP ' + res.status);
  return res;
}
// The base colour map is kept out of the GLB on purpose. GLTFLoader turns an
// embedded image into a blob: URL and fetches it, and a hosted page's content
// policy refuses blob: connections, which silently leaves the model
// untextured. Fetching the JPEG as its own asset never touches a blob: URL.
async function loadBaseColor(){
  const blob = await (await fetchAsset(texUrl, 'base colour map')).blob();
  let tex;
  if (typeof createImageBitmap === 'function'){
    // Low quality halves the map, taking it from about 22 MB of video memory
    // down to 5.6 MB. Same win a basis texture would give, without the
    // transcoder worker that the host's policy blocks.
    const opt = {imageOrientation:'none'};
    if (Q.tex < 2048){ opt.resizeWidth = Q.tex; opt.resizeHeight = Q.tex; opt.resizeQuality = 'high'; }
    tex = new THREE.Texture(await createImageBitmap(blob, opt));
  } else {
    // Safari fallback: decode through an <img> pointed at the same asset URL
    const img = new Image(); img.src = texUrl;
    await img.decode();
    tex = new THREE.Texture(img);
  }
  tex.flipY = false;                       // glTF UV convention
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}
async function boot(){
  $('loadbar').style.width = '15%'; $('loadmsg').textContent = 'Downloading model';
  const buf = await (await fetchAsset(glbUrl, 'model')).arrayBuffer();
  applyQuality(qName);
  $('loadbar').style.width = '35%'; $('loadmsg').textContent = 'Decoding plate texture';
  let baseColor = null;
  try { baseColor = await loadBaseColor(); }
  catch (e){ console.error('base colour map failed, falling back to flat plate colour', e); }
  $('loadbar').style.width = '70%'; $('loadmsg').textContent = 'Building skeleton';
  const loader = new GLTFLoader();
  loader.parse(buf, '', gltf=>{
    dragon = new Dragon(gltf);
    if (baseColor){ dragon.mesh.material.map = baseColor; dragon.mesh.material.needsUpdate = true; }
    else { dragon.mesh.material.color.setHex(0x8f3a35); }
    $('loadbar').style.width = '100%'; $('loadmsg').textContent = 'Ready';
    setTimeout(()=>$('loader').classList.add('done'), 250);
    requestAnimationFrame(loop);
  }, err=>{ $('loadmsg').textContent = 'Model failed to load: ' + err.message; console.error(err); });
}

// ---------- main loop ----------
const clock = new THREE.Clock();
// Simulation runs on a fixed 1/60 step so spring constants, particle counts and
// damage rates behave the same at 30fps as at 144. Rendering stays per frame.
const STEP = 1/60;
let acc = 0, simT = 0;
let fpsAcc = 0, fpsFrames = 0, fps = 60, autoDropped = false, slowFor = 0;
function setAuto(v){ autoDropped = !v; }
function loop(){
  requestAnimationFrame(loop);
  const raw = Math.min(clock.getDelta(), 0.25);

  fpsAcc += raw; fpsFrames++;
  if (fpsAcc >= 0.5){
    fps = fpsFrames/fpsAcc; fpsAcc = 0; fpsFrames = 0;
    $('fps').textContent = Math.round(fps) + ' fps';
    // one automatic step down if the device plainly cannot hold the tier
    if (fps < 34 && !autoDropped && clock.elapsedTime > 4){
      slowFor += 0.5;
      if (slowFor >= 2 && qOrder.indexOf(qName) > 0){ applyQuality(qOrder[qOrder.indexOf(qName)-1], true); autoDropped = true; }
    } else slowFor = 0;
  }

  // gather input once, then run whole steps
  input.move.set((keys['d']||keys['arrowright']?1:0)-(keys['a']||keys['arrowleft']?1:0), (keys['w']||keys['arrowup']?1:0)-(keys['s']||keys['arrowdown']?1:0));
  if (pad.active){ input.move.set(pad.v.x, -pad.v.y); }
  input.sprint = !!keys['shift'] || (pad.active && pad.v.length()>0.85);

  acc = Math.min(acc + raw, STEP*4);
  let steps = 0;
  while (acc >= STEP && steps < 4){ acc -= STEP; simT += STEP; steps++; step(STEP, simT); }
  if (steps === 0) simT = simT;     // nothing to advance this frame
  render(simT, raw);
}
function step(dt, t){
  floorUniforms.uTime.value = t;

  dragon.update(dt, input, cam.yaw, cam.pitch);
  dragon.updateFire(dt);
  Sound.fire(dragon.fireOn && dragon.fireCharge>0.3);

  // particles
  flames.update(dt, (ps,i)=>{
    const y = ps.pos[i*3+1];
    const u = ps.life[i]/ps.maxLife[i];
    ps.size[i] = 0.20 + u*1.05;
    if (y < 0.06){ ps.pos[i*3+1]=0.06; ps.vel[i*3+1] = Math.abs(ps.vel[i*3+1])*0.15; ps.vel[i*3]*=0.6; ps.vel[i*3+2]*=0.6;
      if (Math.random() < 0.02) addScorch(ps.pos[i*3], ps.pos[i*3+2], rnd(1.6,0.9)); }
    // hand a few flames off to smoke as they die
    if (ps.life[i] > ps.maxLife[i]*0.7 && Math.random()<0.06) smoke.emit(new THREE.Vector3(ps.pos[i*3],ps.pos[i*3+1],ps.pos[i*3+2]), new THREE.Vector3(ps.vel[i*3]*0.12+rnd(0.5,-0.5), 1.3+ps.vel[i*3+1]*0.1, ps.vel[i*3+2]*0.12+rnd(0.5,-0.5)), rnd(2.0,1.1), rnd(1.0,0.6));
  });
  smoke.update(dt, (ps,i)=>{ ps.size[i] = 0.6 + ps.life[i]*0.9; });
  sparks.update(dt, (ps,i)=>{ ps.size[i] = 0.07*(1-ps.life[i]/ps.maxLife[i]) + 0.02; if (ps.pos[i*3+1] < 0.03){ ps.pos[i*3+1]=0.03; ps.vel[i*3+1]*=-0.45; ps.vel[i*3]*=0.7; ps.vel[i*3+2]*=0.7; } });
  dust.update(dt, (ps,i)=>{ ps.size[i] = 0.5 + ps.life[i]*1.3; });
  updateScorch(dt); updateRings(dt); updateDrones(dt, t); updateBalls(dt);
  ash.update(dt, t, cam.target);
}
function render(t, raw){
  const dt = raw;
  // camera follow with shake
  const chest = new THREE.Vector3(); dragon.chest.getWorldPosition(chest);
  cam.target.x = damp(cam.target.x, dragon.pos.x, 6, dt); cam.target.z = damp(cam.target.z, dragon.pos.z, 6, dt); cam.target.y = damp(cam.target.y, 1.6, 6, dt);
  const cp = new THREE.Vector3(Math.sin(cam.yaw)*Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw)*Math.cos(cam.pitch)).multiplyScalar(cam.dist).add(cam.target);
  cp.y = Math.max(0.5, cp.y);
  shakeAmt = Math.max(0, shakeAmt - dt*2.2);
  const sh = reduceMotion ? 0 : shakeAmt*shakeAmt*0.35;
  camera.position.copy(cp).add(new THREE.Vector3(Math.sin(t*61)*sh, Math.sin(t*53+1)*sh, Math.cos(t*47)*sh));
  camera.lookAt(cam.target.x, cam.target.y + Math.sin(t*67)*sh*0.5, cam.target.z);
  key.target.position.copy(dragon.pos); key.position.copy(dragon.pos).add(new THREE.Vector3(6,12,4));

  updateHotbar();
  bloom.enabled = toggles.bloom;
  composer.render();
}
window.__dbg = { cam, renderer, THREE, toggles, setAuto, flames, smoke, sparks, balls, ash, applyQuality, get q(){ return qName; }, get dragon(){ return dragon; }, scorch, drones };
boot().catch(e=>{ $('loadmsg').textContent = e.message; console.error(e); });
