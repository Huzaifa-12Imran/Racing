// 3D Racing Game - Toon Shaded City Racer
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { initAudio, updateAudio, playCoin, playCrash, playBoost } from './audio.js';

// ============ LEVEL SYSTEM ============
let currentLevel = 0; // 0 = not selected
const LEVELS = {
  1: { name: 'CRUISE', desc: 'Empty streets — just you and the neon', color: '#44e0ff', opponents: 0, boxes: false },
  2: { name: 'RUSH HOUR', desc: 'Weave through rival night racers', color: '#c084ff', opponents: 3, boxes: false },
  3: { name: 'GRIDLOCK', desc: 'Rivals plus crates block every turn', color: '#ff5577', opponents: 3, boxes: true },
};

// ============ GAME STATE ============
const state = {
  speed: 0,
  maxSpeed: 0.45,
  acceleration: 0.008,
  braking: 0.018,
  friction: 0.004,
  turnSpeed: 0.035,
  carAngle: Math.PI / 2,
  carPos: { x: -3, z: 25 },
  lap: 0,
  lapTime: 0,
  bestLap: Infinity,
  totalTime: 0,
  maxTime: 60,
  timeRemaining: 60,
  gameOver: false,
  started: false,
  countdown: 3,
  keys: {},
  checkpoints: [false, false, false, false],
  lastCheckpoint: -1,
  opponents: [],
  particles: [],
  carCrashCooldown: 0,
  wallCrashCooldown: 0,
  screenShake: 0,
  screenShakeIntensity: 0,
  crashFlash: 0,
  crashFlashIntensity: 0,
  wrongWay: false,
  wrongWayTimer: 0,
  wrongWayCooldown: 0,
  pointsFlash: 0,
  pointsFlashIntensity: 0,
  boxes: [],
  turnInput: 0,
  turnHoldTime: 0,
  lastTurnDir: 0,
  drifting: false,
  driftAngle: 0,
  driftMomentum: 0,
  velocityAngle: Math.PI / 2,
  driftSparks: [],
  driftBoost: 0,
  driftBoostActive: false,
  driftBoostTimer: 0,
  skidMarks: [],
  skidMarkIndex: 0,
  maxSkidMarks: 300,
  driftGracePeriod: 0,
  driftPoints: 0,
  totalPoints: 0,
  pointsMultiplier: 1,
  showPointsBanked: 0,
  bankedAmount: 0,
  pointsLog: [],
  coins: [],
  floatingTexts: [],
};

// ============ TOON SHADING HELPERS ============
// Create a gradient map texture for toon shading (3 steps)
function createToonGradientMap(steps = 4) {
  const colors = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    colors[i] = Math.round((i / (steps - 1)) * 255);
  }
  const tex = new THREE.DataTexture(colors, steps, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const toonGradient3 = createToonGradientMap(3);
const toonGradient4 = createToonGradientMap(4);
const toonGradient5 = createToonGradientMap(5);

// Outline shader for cel-shading edge detection
const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tNormal: { value: null },
    resolution: { value: new THREE.Vector2() },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 500 },
    outlineColor: { value: new THREE.Color(0x0d0a1a) },
    outlineStrength: { value: 1.8 },
    depthThreshold: { value: 0.0015 },
    normalThreshold: { value: 0.35 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tNormal;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform vec3 outlineColor;
    uniform float outlineStrength;
    uniform float depthThreshold;
    uniform float normalThreshold;
    varying vec2 vUv;

    float getLinearDepth(vec2 uv) {
      float fragCoordZ = texture2D(tDepth, uv).x;
      float viewZ = perspectiveDepthToViewZ(fragCoordZ, cameraNear, cameraFar);
      return viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
    }

    vec3 getNormal(vec2 uv) {
      return texture2D(tNormal, uv).xyz * 2.0 - 1.0;
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 texel = vec2(1.0 / resolution.x, 1.0 / resolution.y);

      // Sobel-like depth edge detection
      float d  = getLinearDepth(vUv);
      float dU = getLinearDepth(vUv + vec2(0.0, texel.y));
      float dD = getLinearDepth(vUv - vec2(0.0, texel.y));
      float dL = getLinearDepth(vUv - vec2(texel.x, 0.0));
      float dR = getLinearDepth(vUv + vec2(texel.x, 0.0));

      float depthEdge = abs(dU - d) + abs(dD - d) + abs(dL - d) + abs(dR - d);
      depthEdge = smoothstep(depthThreshold, depthThreshold * 4.0, depthEdge);

      // Normal edge detection
      vec3 n  = getNormal(vUv);
      vec3 nU = getNormal(vUv + vec2(0.0, texel.y));
      vec3 nD = getNormal(vUv - vec2(0.0, texel.y));
      vec3 nL = getNormal(vUv - vec2(texel.x, 0.0));
      vec3 nR = getNormal(vUv + vec2(texel.x, 0.0));

      float normalEdge = 0.0;
      normalEdge += 1.0 - dot(n, nU);
      normalEdge += 1.0 - dot(n, nD);
      normalEdge += 1.0 - dot(n, nL);
      normalEdge += 1.0 - dot(n, nR);
      normalEdge = smoothstep(normalThreshold, normalThreshold * 2.5, normalEdge * 0.25);

      float edge = max(depthEdge, normalEdge) * outlineStrength;
      edge = clamp(edge, 0.0, 1.0);

      gl_FragColor = vec4(mix(color.rgb, outlineColor, edge * 0.85), color.a);
    }
  `
};

// ============ SCENE SETUP ============
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4a4a7a);
scene.fog = new THREE.FogExp2(0x4a4a7a, 0.012);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const root = document.getElementById('root') ?? document.body;
root.appendChild(renderer.domElement);

// ============ DEPTH & NORMAL RENDER TARGETS ============
const depthTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
});
depthTarget.depthTexture = new THREE.DepthTexture();
depthTarget.depthTexture.format = THREE.DepthFormat;
depthTarget.depthTexture.type = THREE.UnsignedIntType;

const normalTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
});
const normalMat = new THREE.MeshNormalMaterial();

// ============ POST-PROCESSING ============
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const outlinePass = new ShaderPass(OutlineShader);
outlinePass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
outlinePass.uniforms.cameraNear.value = camera.near;
outlinePass.uniforms.cameraFar.value = camera.far;
composer.addPass(outlinePass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.15, 0.4, 0.85);
composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

// ============ LIGHTING ============
const ambientLight = new THREE.AmbientLight(0x8899bb, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffeedd, 1.8);
sunLight.position.set(40, 60, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -120;
sunLight.shadow.camera.right = 120;
sunLight.shadow.camera.top = 120;
sunLight.shadow.camera.bottom = -120;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 300;
sunLight.shadow.bias = -0.001;
sunLight.shadow.normalBias = 0.05;
scene.add(sunLight);
scene.add(sunLight.target);

const fillLight = new THREE.DirectionalLight(0x6688cc, 0.4);
fillLight.position.set(-30, 20, -20);
scene.add(fillLight);

// ============ COOL DUSK TOON LIGHTING SETUP ============
{
  // Vibrant Daytime Sky / Fog
  const fogColor = 0x5bc0eb;
  scene.background = new THREE.Color(fogColor);
  
  // Bright sunlight
  sunLight.color.set(0xfffdf0);
  sunLight.intensity = 2.0;
  
  // Soft blue sky fill
  fillLight.color.set(0xaee2ff);
  fillLight.intensity = 0.9;
  
  // Warm ambient light
  ambientLight.color.set(0x99aadd);
  ambientLight.intensity = 1.3;
  
  scene.fog = new THREE.FogExp2(new THREE.Color(fogColor), 0.010); // slightly less dense fog for daytime
  renderer.toneMappingExposure = 1.05;
}

// ============ TOON MATERIALS ============
function toon(color, gradientMap = toonGradient4) {
  return new THREE.MeshToonMaterial({ color, gradientMap });
}

const mat = {
  // Road & Pavement
  road: toon(0x3a3f47, toonGradient3),       // Darker, punchier asphalt
  sidewalk: toon(0xcccccc, toonGradient3),   // Clean concrete
  curb: toon(0xe84e4e, toonGradient3),       // Red/White racing curbs (base red)
  stripe: toon(0xffffff, toonGradient3),     // Bright white road lines
  
  // Buildings (Vibrant city blocks)
  brick: toon(0xf06b6b, toonGradient4),      // Warm coral/red
  brickDark: toon(0x4ca3dd, toonGradient4),  // Bright blue
  brickLight: toon(0xfcd84a, toonGradient4), // Cheerful yellow
  roof: toon(0x2d3436, toonGradient3),       // Dark roofs
  roofDark: toon(0x1a1e1f, toonGradient3),
  window: toon(0x93e5ff, toonGradient5),     // Bright reflective glass
  
  // Nature
  grass: toon(0x52cc5b, toonGradient3),      // Vibrant Mario-style green grass
  tree: toon(0x35a342, toonGradient3),       // Leafy green trees
  treeDark: toon(0x278032, toonGradient3),   // Darker tree variation
  trunk: toon(0x8a5a44, toonGradient3),      // Warm brown trunks
  
  // Cars (Keep bright toon colors)
  carRed: toon(0xff3b3b, toonGradient5),
  carBlue: toon(0x00d2ff, toonGradient5),
  carGreen: toon(0x27de75, toonGradient5),
  carYellow: toon(0xffc800, toonGradient5),
  carWhite: toon(0xf5f5f5, toonGradient5),
  
  // Misc
  white: toon(0xffffff, toonGradient3),
  metal: toon(0xa4b0be, toonGradient4),      // Lighter silver/grey metal
  lampLight: new THREE.MeshToonMaterial({ color: 0xfff6d9, emissive: 0xffdf73, emissiveIntensity: 1.0, gradientMap: toonGradient3 }), // Warmer lamp color
  glass: new THREE.MeshToonMaterial({ color: 0xc4f0ff, gradientMap: toonGradient5, transparent: true, opacity: 0.6 }),
  tire: toon(0x1e1e1e, toonGradient3),
};

// ============ TRACK DEFINITION ============
const TRACK_WIDTH = 11;
const trackPoints = [
  { x: 0, z: 25 },
  { x: 25, z: 25 },
  { x: 35, z: 20 },
  { x: 40, z: 10 },
  { x: 40, z: -10 },
  { x: 35, z: -20 },
  { x: 25, z: -25 },
  { x: 0, z: -25 },
  { x: -25, z: -25 },
  { x: -35, z: -20 },
  { x: -40, z: -10 },
  { x: -40, z: 10 },
  { x: -35, z: 20 },
  { x: -25, z: 25 },
];

function getTrackPoint(t) {
  const n = trackPoints.length;
  const i = Math.floor(t * n) % n;
  const next = (i + 1) % n;
  const prev = (i - 1 + n) % n;
  const next2 = (i + 2) % n;
  const f = (t * n) % 1;
  
  const catmull = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  
  return {
    x: catmull(trackPoints[prev].x, trackPoints[i].x, trackPoints[next].x, trackPoints[next2].x, f),
    z: catmull(trackPoints[prev].z, trackPoints[i].z, trackPoints[next].z, trackPoints[next2].z, f)
  };
}

function getTrackTangent(t) {
  const dt = 0.001;
  const p1 = getTrackPoint(t);
  const p2 = getTrackPoint(t + dt);
  const dx = p2.x - p1.x, dz = p2.z - p1.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  return { x: dx / len, z: dz / len };
}

function getClosestTrackT(px, pz) {
  let bestT = 0, bestDist = Infinity;
  for (let t = 0; t < 1; t += 0.005) {
    const p = getTrackPoint(t);
    const d = (p.x - px) ** 2 + (p.z - pz) ** 2;
    if (d < bestDist) { bestDist = d; bestT = t; }
  }
  for (let t = bestT - 0.005; t < bestT + 0.005; t += 0.0005) {
    const tt = ((t % 1) + 1) % 1;
    const p = getTrackPoint(tt);
    const d = (p.x - px) ** 2 + (p.z - pz) ** 2;
    if (d < bestDist) { bestDist = d; bestT = tt; }
  }
  return { t: bestT, dist: Math.sqrt(bestDist) };
}

// ============ BUILD TRACK ============
function buildTrack() {
  const group = new THREE.Group();
  
  const groundGeo = new THREE.PlaneGeometry(800, 800, 64, 64);
  // Fade ground vertex colors to fog color at edges
  const fogCol = new THREE.Color(0x5bc0eb); // Matched to new daytime sky
  const grassCol = new THREE.Color(0x52cc5b); // Matched to new vibrant grass
  const gPositions = groundGeo.attributes.position;
  const colors = new Float32Array(gPositions.count * 3);
  for (let i = 0; i < gPositions.count; i++) {
    const x = gPositions.getX(i);
    const z = gPositions.getY(i); // PlaneGeometry uses x,y before rotation
    const dist = Math.sqrt(x * x + z * z);
    // Start fading at 50 units, fully fog-colored by 130 (matches fog density)
    const t = THREE.MathUtils.smoothstep(dist, 50, 130);
    const c = grassCol.clone().lerp(fogCol, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const groundMat = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: toonGradient3,
    polygonOffset: true,
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 4,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.name = 'groundPlane';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);

  // Fog-colored horizon ring to hide any remaining edge
  const horizonGeo = new THREE.RingGeometry(120, 500, 64);
  const horizonMat = new THREE.MeshBasicMaterial({
    color: fogCol,
    side: THREE.DoubleSide,
    fog: false,
    transparent: true,
    opacity: 1.0,
  });
  const horizon = new THREE.Mesh(horizonGeo, horizonMat);
  horizon.name = 'horizonRing';
  horizon.rotation.x = -Math.PI / 2;
  horizon.position.y = -0.01;
  group.add(horizon);
  
  const segments = 200;
  
  const outerPts = [], innerPts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = getTrackPoint(t);
    const tan = getTrackTangent(t);
    const nx = -tan.z, nz = tan.x;
    outerPts.push({ x: p.x + nx * TRACK_WIDTH / 2, z: p.z + nz * TRACK_WIDTH / 2 });
    innerPts.push({ x: p.x - nx * TRACK_WIDTH / 2, z: p.z - nz * TRACK_WIDTH / 2 });
  }
  
  const roadGeo = new THREE.BufferGeometry();
  const roadVerts = [], roadIndices = [], roadUvs = [];
  
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = getTrackPoint(t);
    const tan = getTrackTangent(t);
    const nx = -tan.z, nz = tan.x;
    
    roadVerts.push(p.x + nx * (TRACK_WIDTH / 2 + 1), 0.01, p.z + nz * (TRACK_WIDTH / 2 + 1));
    roadVerts.push(p.x - nx * (TRACK_WIDTH / 2 + 1), 0.01, p.z - nz * (TRACK_WIDTH / 2 + 1));
    roadUvs.push(0, t * 20);
    roadUvs.push(1, t * 20);
    
    if (i < segments) {
      const base = i * 2;
      roadIndices.push(base, base + 1, base + 2);
      roadIndices.push(base + 1, base + 3, base + 2);
    }
  }
  
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVerts, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();
  
  const roadNormals = new Float32Array((segments + 1) * 2 * 3);
  for (let i = 0; i < (segments + 1) * 2; i++) {
    roadNormals[i * 3] = 0;
    roadNormals[i * 3 + 1] = 1;
    roadNormals[i * 3 + 2] = 0;
  }
  roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
  
  const road = new THREE.Mesh(roadGeo, mat.road);
  road.name = 'roadSurface';
  road.receiveShadow = true;
  road.renderOrder = 1;
  mat.road.side = THREE.DoubleSide;
  mat.road.depthWrite = true;
  group.add(road);
  
  for (let side = -1; side <= 1; side += 2) {
    const curbGeo = new THREE.BufferGeometry();
    const cVerts = [], cIdx = [], cUvs = [];
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = getTrackPoint(t);
      const tan = getTrackTangent(t);
      const nx = -tan.z, nz = tan.x;
      const innerOff = side * (TRACK_WIDTH / 2 + 1);
      const outerOff = side * (TRACK_WIDTH / 2 + 2.2);
      
      cVerts.push(p.x + nx * innerOff, 0.06, p.z + nz * innerOff);
      cVerts.push(p.x + nx * outerOff, 0.06, p.z + nz * outerOff);
      cUvs.push(0, t * 40);
      cUvs.push(1, t * 40);
      
      if (i < segments) {
        const base = i * 2;
        cIdx.push(base, base + 1, base + 2);
        cIdx.push(base + 1, base + 3, base + 2);
      }
    }
    
    curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(cVerts, 3));
    curbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cUvs, 2));
    curbGeo.setIndex(cIdx);
    curbGeo.computeVertexNormals();
    
    const curbMat = new THREE.MeshToonMaterial({ color: 0x3fd6e8, gradientMap: toonGradient3, side: THREE.DoubleSide });
    const curb = new THREE.Mesh(curbGeo, curbMat);
    curb.name = `curb_${side === -1 ? 'left' : 'right'}`;
    curb.receiveShadow = true;
    group.add(curb);
  }
  
  for (let side = -1; side <= 1; side += 2) {
    const swGeo = new THREE.BufferGeometry();
    const sVerts = [], sIdx = [], sUvs = [];
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = getTrackPoint(t);
      const tan = getTrackTangent(t);
      const nx = -tan.z, nz = tan.x;
      const innerOff = side * (TRACK_WIDTH / 2 + 2.2);
      const outerOff = side * (TRACK_WIDTH / 2 + 5.5);
      
      sVerts.push(p.x + nx * innerOff, 0.15, p.z + nz * innerOff);
      sVerts.push(p.x + nx * outerOff, 0.15, p.z + nz * outerOff);
      sUvs.push(0, t * 20);
      sUvs.push(1, t * 20);
      
      if (i < segments) {
        const base = i * 2;
        sIdx.push(base, base + 1, base + 2);
        sIdx.push(base + 1, base + 3, base + 2);
      }
    }
    
    swGeo.setAttribute('position', new THREE.Float32BufferAttribute(sVerts, 3));
    swGeo.setAttribute('uv', new THREE.Float32BufferAttribute(sUvs, 2));
    swGeo.setIndex(sIdx);
    swGeo.computeVertexNormals();
    
    const swMat = new THREE.MeshToonMaterial({ color: 0x9aa3bb, gradientMap: toonGradient3, side: THREE.DoubleSide });
    const sw = new THREE.Mesh(swGeo, swMat);
    sw.name = `sidewalk_${side === -1 ? 'left' : 'right'}`;
    sw.receiveShadow = true;
    group.add(sw);

    const curbEdgeGeo = new THREE.BufferGeometry();
    const ceVerts = [], ceIdx = [], ceUvs = [];
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = getTrackPoint(t);
      const tan = getTrackTangent(t);
      const nx = -tan.z, nz = tan.x;
      const off = side * (TRACK_WIDTH / 2 + 2.2);
      
      ceVerts.push(p.x + nx * off, 0.0, p.z + nz * off);
      ceVerts.push(p.x + nx * off, 0.15, p.z + nz * off);
      ceUvs.push(0, t * 40);
      ceUvs.push(1, t * 40);
      
      if (i < segments) {
        const base = i * 2;
        if (side === 1) {
          ceIdx.push(base, base + 2, base + 1);
          ceIdx.push(base + 1, base + 2, base + 3);
        } else {
          ceIdx.push(base, base + 1, base + 2);
          ceIdx.push(base + 1, base + 3, base + 2);
        }
      }
    }
    
    curbEdgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(ceVerts, 3));
    curbEdgeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ceUvs, 2));
    curbEdgeGeo.setIndex(ceIdx);
    curbEdgeGeo.computeVertexNormals();
    
    const curbEdgeMat = new THREE.MeshToonMaterial({ color: 0x7d87a8, gradientMap: toonGradient3, side: THREE.DoubleSide });
    const curbEdge = new THREE.Mesh(curbEdgeGeo, curbEdgeMat);
    curbEdge.name = `curbEdge_${side === -1 ? 'left' : 'right'}`;
    curbEdge.receiveShadow = true;
    group.add(curbEdge);
  }
  
  {
    // Pre-compute arc-length table for equal spacing
    const arcSamples = 1000;
    const arcLengths = [0];
    let prevP = getTrackPoint(0);
    for (let i = 1; i <= arcSamples; i++) {
      const t = i / arcSamples;
      const p = getTrackPoint(t);
      const dx = p.x - prevP.x, dz = p.z - prevP.z;
      arcLengths.push(arcLengths[i - 1] + Math.sqrt(dx * dx + dz * dz));
      prevP = p;
    }
    const totalLength = arcLengths[arcSamples];

    // Map arc-length distance to parameter t
    function arcToT(targetLen) {
      let lo = 0, hi = arcSamples;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arcLengths[mid] < targetLen) lo = mid + 1;
        else hi = mid;
      }
      if (lo === 0) return 0;
      const segLen = arcLengths[lo] - arcLengths[lo - 1];
      const frac = segLen > 0 ? (targetLen - arcLengths[lo - 1]) / segLen : 0;
      return ((lo - 1) + frac) / arcSamples;
    }

    const stripeGeo = new THREE.BoxGeometry(0.3, 0.02, 1.5);
    const stripeGeos = [];
    const stripeSpacing = 4.0; // equal spacing in world units
    const numStripes = Math.floor(totalLength / stripeSpacing);
    for (let i = 0; i < numStripes; i++) {
      // Alternate: skip every other for dashed look
      if (i % 2 === 1) continue;
      const dist = i * stripeSpacing;
      const t = arcToT(dist);
      const p = getTrackPoint(t);
      const tan = getTrackTangent(t);
      const angle = Math.atan2(tan.x, tan.z);
      const m = new THREE.Matrix4();
      m.makeRotationY(angle);
      m.setPosition(p.x, 0.02, p.z);
      const g = stripeGeo.clone().applyMatrix4(m);
      stripeGeos.push(g);
    }
    const mergedStripeGeo = mergeGeometries(stripeGeos);
    mergedStripeGeo.computeBoundingSphere();
    const stripeMat = new THREE.MeshToonMaterial({
      color: 0xd8e6ff, gradientMap: toonGradient3, fog: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const stripesMesh = new THREE.Mesh(mergedStripeGeo, stripeMat);
    stripesMesh.name = 'roadMarkings';
    stripesMesh.frustumCulled = false;
    stripesMesh.renderOrder = 0;
    group.add(stripesMesh);
    
    // Create Finish Line (Checkerboard)
    const fCanvas = document.createElement('canvas');
    fCanvas.width = 128;
    fCanvas.height = 128;
    const fCtx = fCanvas.getContext('2d');
    fCtx.fillStyle = '#ffffff'; fCtx.fillRect(0, 0, 128, 128);
    fCtx.fillStyle = '#111111'; fCtx.fillRect(0, 0, 64, 64); fCtx.fillRect(64, 64, 64, 64);
    
    const checkerTex = new THREE.CanvasTexture(fCanvas);
    checkerTex.wrapS = THREE.RepeatWrapping;
    checkerTex.wrapT = THREE.RepeatWrapping;
    checkerTex.repeat.set(TRACK_WIDTH / 1.5, 2.5 / 1.5);
    
    const finishGeo = new THREE.BoxGeometry(TRACK_WIDTH, 0.04, 2.5);
    const finishMat = new THREE.MeshBasicMaterial({ map: checkerTex, color: 0xffffff });
    const finishMesh = new THREE.Mesh(finishGeo, finishMat);
    
    const startP = getTrackPoint(0);
    const startTan = getTrackTangent(0);
    const startAngle = Math.atan2(startTan.x, startTan.z);
    finishMesh.position.set(startP.x, 0.03, startP.z);
    finishMesh.rotation.y = startAngle;
    group.add(finishMesh);
    stripeGeos.forEach(g => g.dispose());
    stripeGeo.dispose();
  }
  
  return group;
}

// ============ BUILDING CREATION ============
function createBuilding(width, height, depth, brickMat) {
  const group = new THREE.Group();
  
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    brickMat
  );
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  
  const roofHeight = height * 0.28;
  const hw = width / 2, hd = depth / 2;
  const roofOverhang = 0.3;
  const rhw = hw + roofOverhang;
  const rhd = hd + roofOverhang;
  const roofVerts2 = new Float32Array([
    -rhw, height, -rhd,   -rhw, height, rhd,   0, height + roofHeight, -rhd,
    0, height + roofHeight, -rhd,   -rhw, height, rhd,   0, height + roofHeight, rhd,
    rhw, height, -rhd,   0, height + roofHeight, -rhd,   rhw, height, rhd,
    0, height + roofHeight, -rhd,   0, height + roofHeight, rhd,   rhw, height, rhd,
    -rhw, height, -rhd,   0, height + roofHeight, -rhd,   rhw, height, -rhd,
    rhw, height, rhd,   0, height + roofHeight, rhd,   -rhw, height, rhd,
    -rhw, height, -rhd,   rhw, height, -rhd,   rhw, height, rhd,
    -rhw, height, -rhd,   rhw, height, rhd,   -rhw, height, rhd,
  ]);
  const roofGeo2 = new THREE.BufferGeometry();
  roofGeo2.setAttribute('position', new THREE.Float32BufferAttribute(roofVerts2, 3));
  roofGeo2.computeVertexNormals();
  const roofMesh = new THREE.Mesh(roofGeo2, mat.roofDark);
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = false;
  group.add(roofMesh);
  
  const windowRows = Math.floor(height / 2.5);
  const windowCols = Math.max(1, Math.floor(width / 2.5));
  const wSize = 0.8;
  
  const windowGeos = [];
  const winGeoFB = new THREE.BoxGeometry(wSize, wSize * 1.3, 0.1);
  const winGeoSide = new THREE.BoxGeometry(0.1, wSize * 1.3, wSize);
  const wMatrix = new THREE.Matrix4();
  
  for (let row = 0; row < windowRows; row++) {
    for (let col = 0; col < windowCols; col++) {
      const wx = -width / 2 + (col + 0.5) * (width / windowCols);
      const wy = 1.5 + row * 2.5;
      
      const gf = winGeoFB.clone();
      wMatrix.makeTranslation(wx, wy, depth / 2 + 0.05);
      gf.applyMatrix4(wMatrix);
      windowGeos.push(gf);
      
      const gb = winGeoFB.clone();
      wMatrix.makeTranslation(wx, wy, -depth / 2 - 0.05);
      gb.applyMatrix4(wMatrix);
      windowGeos.push(gb);
    }
  }
  
  const sideWindowCols = Math.max(1, Math.floor(depth / 2.5));
  for (let row = 0; row < windowRows; row++) {
    for (let col = 0; col < sideWindowCols; col++) {
      const wz = -depth / 2 + (col + 0.5) * (depth / sideWindowCols);
      const wy = 1.5 + row * 2.5;
      
      for (let side = -1; side <= 1; side += 2) {
        const gs = winGeoSide.clone();
        wMatrix.makeTranslation(side * (width / 2 + 0.05), wy, wz);
        gs.applyMatrix4(wMatrix);
        windowGeos.push(gs);
      }
    }
  }
  
  if (windowGeos.length > 0) {
    const mergedWindowGeo = mergeGeometries(windowGeos);
    const windowMesh = new THREE.Mesh(mergedWindowGeo, mat.window);
    windowMesh.name = 'buildingWindows';
    group.add(windowMesh);
    windowGeos.forEach(g => g.dispose());
  }
  winGeoFB.dispose();
  winGeoSide.dispose();
  
  return group;
}

// ============ TREE CREATION ============
function createTree(size = 1) {
  const group = new THREE.Group();
  
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15 * size, 0.25 * size, 2 * size, 6),
    mat.trunk
  );
  trunk.position.y = size;
  trunk.castShadow = true;
  group.add(trunk);
  
  const foliageMat = Math.random() > 0.5 ? mat.tree : mat.treeDark;
  const foliagePositions = [
    { x: 0, y: 2.5 * size, z: 0, r: 1.2 * size },
    { x: 0.5 * size, y: 2.2 * size, z: 0.3 * size, r: 0.8 * size },
    { x: -0.4 * size, y: 2.8 * size, z: -0.2 * size, r: 0.7 * size },
    { x: 0.2 * size, y: 3.1 * size, z: -0.3 * size, r: 0.6 * size },
  ];
  
  foliagePositions.forEach(fp => {
    const f = new THREE.Mesh(
      new THREE.SphereGeometry(fp.r, 6, 5),
      foliageMat
    );
    f.position.set(fp.x, fp.y, fp.z);
    f.castShadow = true;
    group.add(f);
  });
  
  return group;
}

// ============ LAMP POST ============
function createLampPost() {
  const group = new THREE.Group();
  
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 4, 6),
    mat.metal
  );
  pole.position.y = 2;
  pole.castShadow = true;
  group.add(pole);
  
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 1.2),
    mat.metal
  );
  arm.position.set(0, 4, 0.6);
  group.add(arm);
  
  const elbow = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 6, 4),
    mat.metal
  );
  elbow.position.set(0, 4, 0.05);
  group.add(elbow);
  
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.2, 0.4),
    mat.lampLight
  );
  lamp.position.set(0, 3.85, 1.15);
  group.add(lamp);

  const lampGlow = new THREE.PointLight(0x7fe9ff, 2.0, 12, 1.5);
  lampGlow.position.set(0, 3.7, 1.15);
  group.add(lampGlow);
  
  return group;
}

// ============ CAR CREATION ============
function createCar(bodyMat, isPlayer = false) {
  const group = new THREE.Group();
  group.userData.wheels = [];
  
  const bodyLower = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.4, 2.4),
    bodyMat
  );
  bodyLower.position.y = 0.35;
  bodyLower.castShadow = true;
  bodyLower.receiveShadow = true;
  group.add(bodyLower);
  
  const bodyUpper = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.35, 1.3),
    bodyMat
  );
  bodyUpper.position.set(0, 0.72, -0.15);
  bodyUpper.castShadow = true;
  bodyUpper.receiveShadow = true;
  group.add(bodyUpper);
  
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.3, 0.05),
    mat.glass
  );
  windshield.position.set(0, 0.72, 0.5);
  group.add(windshield);
  
  const rearWindow = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.28, 0.05),
    mat.glass
  );
  rearWindow.position.set(0, 0.72, -0.8);
  rearWindow.name = 'rearWindow';
  group.add(rearWindow);
  
  const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.15, 16);
  const hubcapGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.02, 12);
  const hubcapMat = new THREE.MeshToonMaterial({ color: 0xd7e0ff, gradientMap: toonGradient4 });
  const hubDotGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.025, 8);
  const hubDotMat = new THREE.MeshToonMaterial({ color: 0x666a88, gradientMap: toonGradient3 });

  const wheelPositions = [
    { x: -0.6, z: 0.7 }, { x: 0.6, z: 0.7 },
    { x: -0.6, z: -0.7 }, { x: 0.6, z: -0.7 },
  ];
  
  wheelPositions.forEach(wp => {
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(wp.x, 0.22, wp.z);

    const wheel = new THREE.Mesh(wheelGeo, mat.tire);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    wheelGroup.add(wheel);

    const hubcapSide = Math.sign(wp.x);
    const hubcap = new THREE.Mesh(hubcapGeo, hubcapMat);
    hubcap.rotation.z = Math.PI / 2;
    hubcap.position.set(hubcapSide * 0.075, 0, 0);
    wheelGroup.add(hubcap);

    const hubDot = new THREE.Mesh(hubDotGeo, hubDotMat);
    hubDot.rotation.z = Math.PI / 2;
    hubDot.position.set(hubcapSide * 0.085, 0, 0);
    wheelGroup.add(hubDot);
    group.add(wheelGroup);
    group.userData.wheels.push(wheelGroup);
  });
  
  const headlightGeo = new THREE.BoxGeometry(0.2, 0.12, 0.05);
  const headlightMat = new THREE.MeshToonMaterial({ color: 0xdffcff, emissive: 0xa8f2ff, emissiveIntensity: 0.5, gradientMap: toonGradient3 });
  for (let x = -0.4; x <= 0.4; x += 0.8) {
    const hl = new THREE.Mesh(headlightGeo, headlightMat);
    hl.position.set(x, 0.35, 1.21);
    group.add(hl);
  }
  
  const taillightMat = new THREE.MeshToonMaterial({ color: 0xff2266, emissive: 0xff0044, emissiveIntensity: 0.4, gradientMap: toonGradient3 });
  for (let x = -0.4; x <= 0.4; x += 0.8) {
    const tl = new THREE.Mesh(headlightGeo, taillightMat);
    tl.position.set(x, 0.35, -1.21);
    group.add(tl);
  }
  
  if (isPlayer) {
    const decalMat = new THREE.MeshToonMaterial({ color: 0x2ee6ff, gradientMap: toonGradient3 });
    const decal = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.34, 0.01),
      decalMat
    );
    decal.position.set(0, 0.5, 1.22);
    group.add(decal);
  }
  
  return group;
}

// ============ POPULATE SCENE ============
const track = buildTrack();
scene.add(track);

const playerCar = createCar(mat.carRed, true);
scene.add(playerCar);

// Opponents and boxes are spawned dynamically per level
const opponentMats = [mat.carBlue, mat.carGreen, mat.carYellow];
const allOpponentMeshes = [];
for (let i = 0; i < 3; i++) {
  const opp = createCar(opponentMats[i]);
  opp.visible = false;
  scene.add(opp);
  allOpponentMeshes.push(opp);
  state.opponents.push({
    mesh: opp,
    t: 0.1 + i * 0.3,
    speed: 0.0003 + Math.random() * 0.00015,
    offset: (Math.random() - 0.5) * 3,
    lap: 0,
    prevT: 0.1 + i * 0.3,
  });
}

// ============ BOX OBSTACLES ============
const boxMat = new THREE.MeshToonMaterial({ color: 0xff8f4d, gradientMap: toonGradient4 });
const boxBandMat = new THREE.MeshToonMaterial({ color: 0x8a4a2e, gradientMap: toonGradient3 });
const boxObstacles = [];

function createBoxObstacle() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 1.1), boxMat);
  body.position.y = 0.65;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  // Bands
  const bandGeo = new THREE.BoxGeometry(1.15, 0.12, 1.15);
  const band1 = new THREE.Mesh(bandGeo, boxBandMat);
  band1.position.y = 0.4;
  group.add(band1);
  const band2 = new THREE.Mesh(bandGeo, boxBandMat);
  band2.position.y = 0.95;
  group.add(band2);
  return group;
}

function spawnBoxes() {
  // Clear existing
  boxObstacles.forEach(b => scene.remove(b.mesh));
  boxObstacles.length = 0;
  state.boxes = [];

  const boxCount = 8;
  const placed = [];
  for (let i = 0; i < boxCount; i++) {
    const t = (i / boxCount + 0.05) % 1;
    const p = getTrackPoint(t);
    const tan = getTrackTangent(t);
    const nx = -tan.z, nz = tan.x;
    const offset = (Math.random() - 0.5) * (TRACK_WIDTH - 2);
    const bx = p.x + nx * offset;
    const bz = p.z + nz * offset;
    // Avoid placing too close to start line
    if (Math.abs(bx - (-3)) < 5 && Math.abs(bz - 25) < 8) continue;
    // Avoid clustering
    let tooClose = false;
    for (const pp of placed) {
      if ((pp.x - bx) ** 2 + (pp.z - bz) ** 2 < 16) { tooClose = true; break; }
    }
    if (tooClose) continue;

    const box = createBoxObstacle();
    box.position.set(bx, 0, bz);
    box.rotation.y = Math.random() * Math.PI;
    box.name = `obstacle_box_${i}`;
    scene.add(box);
    const entry = { mesh: box, x: bx, z: bz, radius: 1.0 };
    boxObstacles.push(entry);
    state.boxes.push(entry);
    placed.push({ x: bx, z: bz });
  }
}

function clearBoxes() {
  boxObstacles.forEach(b => scene.remove(b.mesh));
  boxObstacles.length = 0;
  state.boxes = [];
}

// ============ COINS ============
const coinGeo = new THREE.TorusGeometry(0.5, 0.15, 8, 16);
const coinMat = new THREE.MeshToonMaterial({ color: 0xffdd00, emissive: 0x443300, gradientMap: toonGradient4 });
const coinCollectibles = [];

function spawnCoins() {
  clearCoins();
  const coinCount = 20;
  for (let i = 0; i < coinCount; i++) {
    // Distribute them evenly around the track
    const t = (i / coinCount + 0.02) % 1;
    const p = getTrackPoint(t);
    const tan = getTrackTangent(t);
    const nx = -tan.z, nz = tan.x;
    
    // Offset coins to the outside/inside of curves
    const offset = (Math.random() - 0.5) * (TRACK_WIDTH - 3);
    const cx = p.x + nx * offset;
    const cz = p.z + nz * offset;
    
    const coin = new THREE.Mesh(coinGeo, coinMat);
    coin.position.set(cx, 1.0, cz);
    coin.rotation.y = Math.random() * Math.PI;
    
    scene.add(coin);
    const entry = { mesh: coin, x: cx, z: cz, radius: 1.5, active: true };
    coinCollectibles.push(entry);
    state.coins.push(entry);
  }
}

function clearCoins() {
  coinCollectibles.forEach(c => scene.remove(c.mesh));
  coinCollectibles.length = 0;
  state.coins = [];
}

// ============ LEVEL SELECTION SCREEN ============
const levelSelectOverlay = document.createElement('div');
levelSelectOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);backdrop-filter:blur(12px);z-index:500;font-family:"Fredoka","Lilita One",sans-serif;';
document.body.appendChild(levelSelectOverlay);

function buildLevelSelect() {
  levelSelectOverlay.style.display = 'flex';
  levelSelectOverlay.innerHTML = `
    <div style="text-align:center;">
      <div style="font-size:15px;letter-spacing:6px;color:rgba(255,255,255,0.5);margin-bottom:8px;font-weight:600;">CHOOSE YOUR</div>
      <div style="font-size:56px;font-weight:700;color:#fff;letter-spacing:1px;margin-bottom:40px;font-family:'Lilita One',sans-serif;-webkit-text-stroke:2px rgba(0,0,0,0.25);text-shadow:0 5px 0 rgba(0,0,0,0.35);">NIGHT RUN</div>
      <div style="display:flex;gap:18px;justify-content:center;flex-wrap:wrap;">
        ${[1,2,3].map(lvl => {
          const l = LEVELS[lvl];
          return `<div class="level-btn" data-level="${lvl}" style="cursor:pointer;pointer-events:auto;width:200px;padding:28px 20px;border-radius:20px;background:rgba(255,255,255,0.08);border:3px solid rgba(255,255,255,0.25);transition:all 0.2s;text-align:center;box-shadow:0 5px 0 rgba(0,0,0,0.3);">
            <div style="font-size:38px;font-weight:700;color:${l.color};letter-spacing:1px;font-family:'Lilita One',sans-serif;-webkit-text-stroke:1px rgba(0,0,0,0.2);text-shadow:0 3px 0 rgba(0,0,0,0.3);">${l.name}</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-top:10px;line-height:1.5;font-weight:500;">${l.desc}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="font-size:14px;color:rgba(255,255,255,0.4);margin-top:30px;font-weight:500;">Pick a route to fire up the engine!</div>
    </div>`;

  levelSelectOverlay.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255,255,255,0.15)';
      btn.style.borderColor = 'rgba(255,255,255,0.6)';
      btn.style.transform = 'translateY(-4px)';
      btn.style.boxShadow = '0 8px 0 rgba(0,0,0,0.3)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(255,255,255,0.08)';
      btn.style.borderColor = 'rgba(255,255,255,0.25)';
      btn.style.transform = 'translateY(0)';
      btn.style.boxShadow = '0 5px 0 rgba(0,0,0,0.3)';
    });
    btn.addEventListener('click', () => {
      const lvl = parseInt(btn.dataset.level);
      startLevel(lvl);
    });
  });
}

function startLevel(lvl) {
  currentLevel = lvl;
  const cfg = LEVELS[lvl];
  levelSelectOverlay.style.display = 'none';

  // Configure opponents
  const activeCount = cfg.opponents;
  state.opponents.forEach((opp, i) => {
    opp.mesh.visible = i < activeCount;
    opp.t = 0.1 + i * 0.3;
    opp.prevT = opp.t;
    opp.lap = 0;
  });

  // Configure boxes & coins
  clearBoxes();
  if (cfg.boxes) spawnBoxes();
  
  clearCoins();
  spawnCoins();

  // Reset game state
  state.speed = 0;
  state.carAngle = Math.PI / 2;
  state.carPos = { x: -3, z: 25 };
  state.lap = 0;
  state.lapTime = 0;
  state.bestLap = Infinity;
  state.totalTime = 0;
  state.timeRemaining = state.maxTime;
  state.gameOver = false;
  state.checkpoints = [false, false, false, false];
  state.lastCheckpoint = -1;
  state.drifting = false;
  state.driftAngle = 0;
  state.driftMomentum = 0;
  state.driftBoost = 0;
  state.driftBoostActive = false;
  state.driftBoostTimer = 0;
  state.driftPoints = 0;
  state.totalPoints = 0;
  state.pointsMultiplier = 1;
  state.showPointsBanked = 0;
  state.bankedAmount = 0;
  state.driftGracePeriod = 0;
  state.carCrashCooldown = 0;
  state.wallCrashCooldown = 0;
  state.wrongWay = false;
  state.wrongWayTimer = 0;
  state.wrongWayCooldown = 0;
  state.screenShake = 0;
  state.screenShakeIntensity = 0;
  state.crashFlash = 0;
  state.crashFlashIntensity = 0;
  state.pointsFlash = 0;
  state.pointsFlashIntensity = 0;
  state.pendingPointsFlashIntensity = 0;
  state.pointsLog = [];
  state.coins.forEach(c => { c.active = true; c.mesh.visible = true; });
  state.turnInput = 0;
  state.turnHoldTime = 0;
  state.lastTurnDir = 0;
  state.velocityAngle = Math.PI / 2;
  gameOverOverlay.style.display = 'none';
  countdownTimer = 3;
  raceStarted = false;
  countdownDisplay.style.opacity = '1';
  cameraOffset.set(state.carPos.x, 8, state.carPos.z - 12);
  cameraLookAt.set(state.carPos.x, 1, state.carPos.z);
}

const buildingConfigs = [];
for (let i = 0; i < 80; i++) {
  const t = i / 80;
  const p = getTrackPoint(t);
  const tan = getTrackTangent(t);
  const nx = -tan.z, nz = tan.x;
  
  for (let side = -1; side <= 1; side += 2) {
    if (Math.random() > 0.35) continue;
    
    const dist = TRACK_WIDTH / 2 + 8 + Math.random() * 6;
    const bx = p.x + nx * side * dist;
    const bz = p.z + nz * side * dist;
    
    let tooClose = false;
    for (const bc of buildingConfigs) {
      if ((bc.x - bx) ** 2 + (bc.z - bz) ** 2 < 64) { tooClose = true; break; }
    }
    if (tooClose) continue;
    
    const w = 3 + Math.random() * 4;
    const h = 5 + Math.random() * 10;
    const d = 3 + Math.random() * 4;
    const bMat = [mat.brick, mat.brickDark, mat.brickLight][Math.floor(Math.random() * 3)];
    
    const building = createBuilding(w, h, d, bMat);
    building.position.set(bx, 0, bz);
    building.rotation.y = Math.atan2(tan.x, tan.z) + (Math.random() - 0.5) * 0.3;
    scene.add(building);
    
    buildingConfigs.push({ x: bx, z: bz });
  }
}

// Trees via InstancedMesh (120 trees: 1 trunk + 4 foliage spheres each → 3 instanced meshes)
{
  const TREE_COUNT = 120;
  const FOLIAGE_PER_TREE = 4;

  // Pre-generate tree data (positions, sizes, foliage type)
  const treeData = [];
  const seededRandom = (() => { let s = 42; return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; }; })();

  for (let i = 0; i < TREE_COUNT; i++) {
    const t = i / TREE_COUNT;
    const p = getTrackPoint(t);
    const tan = getTrackTangent(t);
    const nx = -tan.z, nz = tan.x;
    const side = seededRandom() > 0.5 ? 1 : -1;
    const dist = TRACK_WIDTH / 2 + 5 + seededRandom() * 4;
    const tx = p.x + nx * side * dist + (seededRandom() - 0.5) * 2;
    const tz = p.z + nz * side * dist + (seededRandom() - 0.5) * 2;
    const size = 0.6 + seededRandom() * 0.6;
    const useDarkFoliage = seededRandom() > 0.5;
    treeData.push({ x: tx, z: tz, size, useDarkFoliage });
  }

  // Trunk instanced mesh
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 2, 6);
  trunkGeo.translate(0, 1, 0); // position.y = size (we'll scale per instance)
  const trunkInstanced = new THREE.InstancedMesh(trunkGeo, mat.trunk, TREE_COUNT);
  trunkInstanced.name = 'treesTrunks';
  trunkInstanced.castShadow = true;
  trunkInstanced.receiveShadow = false;

  // Foliage: separate light and dark instanced meshes
  // Count how many foliage instances for each type
  let lightCount = 0, darkCount = 0;
  treeData.forEach(td => {
    if (td.useDarkFoliage) darkCount += FOLIAGE_PER_TREE;
    else lightCount += FOLIAGE_PER_TREE;
  });

  const foliageGeo = new THREE.SphereGeometry(1, 6, 5); // unit sphere, scaled per instance
  const foliageLightInstanced = new THREE.InstancedMesh(foliageGeo, mat.tree, lightCount);
  foliageLightInstanced.name = 'treesFoliageLight';
  foliageLightInstanced.castShadow = true;
  foliageLightInstanced.receiveShadow = false;

  const foliageDarkInstanced = new THREE.InstancedMesh(foliageGeo, mat.treeDark, darkCount);
  foliageDarkInstanced.name = 'treesFoliageDark';
  foliageDarkInstanced.castShadow = true;
  foliageDarkInstanced.receiveShadow = false;

  // Foliage offsets relative to tree origin (before scaling by tree size)
  const foliageOffsets = [
    { x: 0, y: 2.5, z: 0, r: 1.2 },
    { x: 0.5, y: 2.2, z: 0.3, r: 0.8 },
    { x: -0.4, y: 2.8, z: -0.2, r: 0.7 },
    { x: 0.2, y: 3.1, z: -0.3, r: 0.6 },
  ];

  const dummy = new THREE.Object3D();
  let lightIdx = 0, darkIdx = 0;

  treeData.forEach((td, i) => {
    const s = td.size;

    // Trunk: scaled uniformly by tree size, positioned at tree location
    dummy.position.set(td.x, 0, td.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    trunkInstanced.setMatrixAt(i, dummy.matrix);

    // Foliage spheres
    foliageOffsets.forEach(fo => {
      dummy.position.set(td.x + fo.x * s, fo.y * s, td.z + fo.z * s);
      dummy.rotation.set(0, 0, 0);
      const fr = fo.r * s;
      dummy.scale.set(fr, fr, fr);
      dummy.updateMatrix();

      if (td.useDarkFoliage) {
        foliageDarkInstanced.setMatrixAt(darkIdx++, dummy.matrix);
      } else {
        foliageLightInstanced.setMatrixAt(lightIdx++, dummy.matrix);
      }
    });
  });

  trunkInstanced.instanceMatrix.needsUpdate = true;
  foliageLightInstanced.instanceMatrix.needsUpdate = true;
  foliageDarkInstanced.instanceMatrix.needsUpdate = true;

  scene.add(trunkInstanced);
  scene.add(foliageLightInstanced);
  scene.add(foliageDarkInstanced);

  trunkGeo.dispose();
  // foliageGeo shared, don't dispose until both are added
}

// Lamp posts via InstancedMesh (40 posts, but only 2 instanced meshes + 5 lights)
{
  const LAMP_COUNT = 40;

  // Shared geometries
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 4, 6);
  poleGeo.translate(0, 2, 0);
  const armGeo = new THREE.BoxGeometry(0.08, 0.08, 1.2);
  armGeo.translate(0, 4, 0.6);
  const elbowGeo = new THREE.SphereGeometry(0.1, 6, 4);
  elbowGeo.translate(0, 4, 0.05);
  const lampHeadGeo = new THREE.BoxGeometry(0.3, 0.2, 0.4);
  lampHeadGeo.translate(0, 3.85, 1.15);

  // Merge pole + arm + elbow into one geometry for the "structure" instanced mesh
  const structureGeo = mergeGeometries([poleGeo, armGeo, elbowGeo]);
  const structureInstanced = new THREE.InstancedMesh(structureGeo, mat.metal, LAMP_COUNT);
  structureInstanced.name = 'lampPostStructures';
  structureInstanced.castShadow = true;
  structureInstanced.receiveShadow = false;

  // Lamp head as separate instanced mesh (emissive material)
  const lampHeadInstanced = new THREE.InstancedMesh(lampHeadGeo, mat.lampLight, LAMP_COUNT);
  lampHeadInstanced.name = 'lampPostHeads';
  lampHeadInstanced.castShadow = false;
  lampHeadInstanced.receiveShadow = false;

  // Pre-compute all lamp positions and rotations, set instance matrices
  const lampPositions = []; // store for light placement
  const dummy = new THREE.Object3D();

  for (let i = 0; i < LAMP_COUNT; i++) {
    const t = i / LAMP_COUNT;
    const p = getTrackPoint(t);
    const tan = getTrackTangent(t);
    const nx = -tan.z, nz = tan.x;
    const side = (i % 2 === 0) ? 1 : -1;
    const dist = TRACK_WIDTH / 2 + 2.5;
    const lx = p.x + nx * side * dist;
    const lz = p.z + nz * side * dist;
    const toRoadX = p.x - lx;
    const toRoadZ = p.z - lz;
    const rotY = Math.atan2(toRoadX, toRoadZ);

    dummy.position.set(lx, 0, lz);
    dummy.rotation.set(0, rotY, 0);
    dummy.updateMatrix();

    structureInstanced.setMatrixAt(i, dummy.matrix);
    lampHeadInstanced.setMatrixAt(i, dummy.matrix);

    lampPositions.push({ x: lx, z: lz, rotY });
  }

  structureInstanced.instanceMatrix.needsUpdate = true;
  lampHeadInstanced.instanceMatrix.needsUpdate = true;

  scene.add(structureInstanced);
  scene.add(lampHeadInstanced);

  // Clean up merged source geos
  poleGeo.dispose();
  armGeo.dispose();
  elbowGeo.dispose();
  lampHeadGeo.dispose();

  // Only 5 strategically placed PointLights evenly around the track
  const LIGHT_COUNT = 5;
  for (let li = 0; li < LIGHT_COUNT; li++) {
    // Pick the lamp post closest to evenly-spaced track positions
    const targetIdx = Math.round((li / LIGHT_COUNT) * LAMP_COUNT) % LAMP_COUNT;
    const lp = lampPositions[targetIdx];
    // Offset light toward the road (in the direction the lamp arm faces)
    const offX = Math.sin(lp.rotY) * 1.15;
    const offZ = Math.cos(lp.rotY) * 1.15;
    const light = new THREE.PointLight(0x7fe9ff, 2.5, 18, 1.5);
    light.name = `lampLight_${li}`;
    light.position.set(lp.x + offX, 3.7, lp.z + offZ);
    scene.add(light);
  }
}

// ============ COLLISION ============
function isOnTrack(px, pz) {
  const { dist } = getClosestTrackT(px, pz);
  return dist < TRACK_WIDTH / 2 + 1;
}

// ============ INJECT GLOBAL HUD STYLES ============
const hudStyleEl = document.createElement('style');
hudStyleEl.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Lilita+One&display=swap');

  /* Base card: deep navy + soft shadow — matches the game sky/building palette */
  .rg-card {
    background: rgba(14, 17, 50, 0.82);
    backdrop-filter: blur(6px);
    border-radius: 14px;
    border: 2px solid rgba(255,255,255,0.1);
    box-shadow: 0 6px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.07);
    position: relative;
    overflow: hidden;
    font-family: 'Fredoka', sans-serif;
  }
  /* Colored top accent strip */
  .rg-card::after {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 3px;
    border-radius: 14px 14px 0 0;
    background: var(--accent, #2ee6ff);
  }

  .rg-label {
    font-family: 'Fredoka', sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: rgba(255,255,255,0.45);
    margin-bottom: 2px;
  }
  .rg-value {
    font-family: 'Lilita One', 'Fredoka', sans-serif;
    font-weight: 700;
    color: #fff;
    line-height: 1;
  }

  /* Bounce-in animation for combo */
  @keyframes rg-pop { 0%{transform:translate(-50%,-50%) scale(0.7);opacity:0} 60%{transform:translate(-50%,-50%) scale(1.1)} 100%{transform:translate(-50%,-50%) scale(1);opacity:1} }
  @keyframes rg-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }

  /* Key badge style for controls */
  .rg-key {
    display:inline-flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,0.12);
    border:1.5px solid rgba(255,255,255,0.25);
    border-radius:7px;
    padding:2px 7px;
    font-family:'Fredoka',sans-serif;
    font-size:12px;
    font-weight:600;
    color:#fff;
    letter-spacing:0.5px;
  }
`;
document.head.appendChild(hudStyleEl);

// ============ HUD ROOT ============
const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';
document.body.appendChild(hud);

// ── TOP LEFT: TIMER ────────────────────────────────────────────
const timerDisplay = document.createElement('div');
timerDisplay.className = 'rg-card';
timerDisplay.style.cssText = 'position:absolute;top:16px;left:18px;padding:10px 18px 10px 16px;min-width:105px;--accent:#2ee6ff;';
hud.appendChild(timerDisplay);

// ── TOP RIGHT: LAP ─────────────────────────────────────────────
const lapDisplay = document.createElement('div');
lapDisplay.className = 'rg-card';
lapDisplay.style.cssText = 'position:absolute;top:16px;right:18px;padding:10px 16px 10px 16px;text-align:right;min-width:82px;--accent:#a78bfa;';
hud.appendChild(lapDisplay);

// ── GAME OVER OVERLAY ──────────────────────────────────────────
const gameOverOverlay = document.createElement('div');
gameOverOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(8,10,35,0.78);backdrop-filter:blur(12px);z-index:200;font-family:Fredoka,sans-serif;';
hud.appendChild(gameOverOverlay);

// ── MINIMAP ────────────────────────────────────────────────────
const minimapCanvas = document.createElement('canvas');
minimapCanvas.width = 160;
minimapCanvas.height = 160;
minimapCanvas.style.cssText = [
  'position:absolute', 'bottom:24px', 'left:18px',
  'border-radius:18px',
  'border:2px solid rgba(255,255,255,0.12)',
  'background:rgba(14,17,50,0.85)',
  'box-shadow:0 6px 20px rgba(0,0,0,0.45), 0 0 0 1px rgba(46,230,255,0.2)',
].join(';');
hud.appendChild(minimapCanvas);
const minimapCtx = minimapCanvas.getContext('2d');

// ── SPEED LINES OVERLAY ─────────────────────────────────────────
const speedLinesOverlay = document.createElement('div');
speedLinesOverlay.style.cssText = [
  'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
  'pointer-events:none', 'z-index:50',
  'background:radial-gradient(ellipse at center, transparent 40%, rgba(255,255,255,0.15) 70%, rgba(255,255,255,0.4) 100%)',
  'box-shadow:inset 0 0 100px rgba(46,230,255,0.3)',
  'mix-blend-mode:overlay', 'opacity:0', 'transition:opacity 0.1s',
].join(';');
hud.appendChild(speedLinesOverlay);

// ── FLOATING TEXTS CONTAINER ────────────────────────────────────
const floatingTextContainer = document.createElement('div');
floatingTextContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:45;overflow:hidden;';
document.body.appendChild(floatingTextContainer);

function spawnFloatingText(text, x, y, z, color = '#ffdd00') {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:absolute;font-family:'Lilita One',sans-serif;font-size:28px;color:${color};text-shadow:0 3px 0 #b38000, 0 0 10px rgba(255,221,0,0.8);transform:translate(-50%,-50%);opacity:1;will-change:transform,opacity;`;
  floatingTextContainer.appendChild(el);
  state.floatingTexts.push({ el, x, y, z, life: 1.0 });
}

// ── COUNTDOWN ──────────────────────────────────────────────────
const countdownDisplay = document.createElement('div');
countdownDisplay.style.cssText = [
  'position:absolute', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
  'font-family:\'Lilita One\',\'Fredoka\',sans-serif',
  'font-size:140px', 'font-weight:700', 'color:#fff',
  'text-shadow:0 0 0 #fff, 0 8px 0 rgba(0,0,0,0.25), 0 0 40px rgba(46,230,255,0.35)',
  '-webkit-text-stroke:3px rgba(0,0,0,0.15)',
  'transition:all 0.25s',
].join(';');
hud.appendChild(countdownDisplay);

// ── TOP CENTER: SCORE ──────────────────────────────────────────
const pointsDisplay = document.createElement('div');
pointsDisplay.className = 'rg-card';
pointsDisplay.style.cssText = [
  'position:absolute', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
  'text-align:center', 'pointer-events:none',
  'padding:8px 26px', 'min-width:120px',
  '--accent:#facc15',
].join(';');
hud.appendChild(pointsDisplay);

// ── BOTTOM RIGHT: POINTS LOG ───────────────────────────────────
const pointsLogPanel = document.createElement('div');
pointsLogPanel.style.cssText = [
  'position:absolute', 'bottom:24px', 'right:18px',
  'width:200px', 'max-height:260px', 'overflow:hidden',
  'pointer-events:none', 'display:flex', 'flex-direction:column-reverse',
].join(';');
hud.appendChild(pointsLogPanel);

// ── CENTER: DRIFT COMBO ────────────────────────────────────────
const driftComboDisplay = document.createElement('div');
driftComboDisplay.style.cssText = [
  'position:absolute', 'top:40%', 'left:50%', 'transform:translate(-50%,-50%)',
  'text-align:center', 'pointer-events:none', 'opacity:0', 'transition:opacity 0.2s',
  'font-family:"Lilita One",sans-serif'
].join(';');
hud.appendChild(driftComboDisplay);

// ── WRONG WAY ──────────────────────────────────────────────────
const wrongWayDisplay = document.createElement('div');
wrongWayDisplay.style.cssText = [
  'position:absolute', 'top:22%', 'left:50%', 'transform:translate(-50%,-50%)',
  'text-align:center', 'pointer-events:none', 'opacity:0', 'transition:opacity 0.2s', 'z-index:150',
  'font-family:"Lilita One",sans-serif'
].join(';');
hud.appendChild(wrongWayDisplay);

// ── BOTTOM CENTER WRAPPER ──────────────────────────────────────
const bottomHud = document.createElement('div');
bottomHud.style.cssText = [
  'position:absolute', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
  'display:flex', 'flex-direction:column', 'align-items:center', 'gap:9px',
  'pointer-events:none', 'z-index:110',
].join(';');
hud.appendChild(bottomHud);

// ── CHALLENGE / DIFFICULTY BADGE ───────────────────────────────
const diffBtn = document.createElement('div');
diffBtn.style.cssText = [
  'pointer-events:auto', 'cursor:pointer', 'user-select:none',
  'display:inline-flex', 'align-items:center', 'gap:0',
  'border-radius:12px', 'overflow:hidden',
  'border:2px solid rgba(255,255,255,0.1)',
  'background:rgba(14,17,50,0.82)',
  'box-shadow:0 6px 20px rgba(0,0,0,0.4)',
  'transition:transform 0.15s, box-shadow 0.15s',
  'font-family:\'Fredoka\',sans-serif',
].join(';');
bottomHud.appendChild(diffBtn);

function updateDiffBtn() {
  const lvl = LEVELS[currentLevel];
  if (!lvl) { diffBtn.style.display = 'none'; return; }
  diffBtn.style.display = 'inline-flex';
  // Colors that match the cartoon game palette
  const accentColors = { 1: '#2ee6ff', 2: '#facc15', 3: '#f472b6' };
  const bgColors     = { 1: 'rgba(46,230,255,0.18)', 2: 'rgba(250,204,21,0.18)', 3: 'rgba(244,114,182,0.2)' };
  const ac = accentColors[currentLevel] || '#a78bfa';
  const bg = bgColors[currentLevel]    || 'rgba(167,139,250,0.18)';
  diffBtn.innerHTML = `
    <div style="padding:9px 16px 9px 18px;">
      <div style="font-size:9px;font-weight:600;letter-spacing:2.5px;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-bottom:3px;">CHALLENGE</div>
      <div style="font-size:15px;font-weight:700;color:rgba(255,255,255,0.85);letter-spacing:0.3px;">${lvl.name}</div>
    </div>
    <div style="
      padding:9px 18px 9px 14px;
      background:${bg};
      border-left:2px solid ${ac};
      display:flex; align-items:center; gap:0;
    ">
      <div style="
        width:8px; height:8px; border-radius:50%;
        background:${ac};
        box-shadow:0 0 8px ${ac};
        margin-right:8px;
        animation: rg-float 2s ease-in-out infinite;
      "></div>
      <div style="font-size:14px;font-weight:700;color:${ac};letter-spacing:0.3px;">${currentLevel === 1 ? 'EASY' : currentLevel === 2 ? 'MED' : 'HARD'}</div>
    </div>
  `;
  diffBtn._ac = ac;
}
updateDiffBtn();

diffBtn.addEventListener('mouseenter', () => {
  diffBtn.style.transform = 'translateY(-3px)';
  diffBtn.style.boxShadow = `0 10px 28px rgba(0,0,0,0.5), 0 0 0 2px ${diffBtn._ac || '#2ee6ff'}55`;
});
diffBtn.addEventListener('mouseleave', () => {
  diffBtn.style.transform = 'translateY(0)';
  diffBtn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
});
diffBtn.addEventListener('click', () => {
  initAudio();
  const nextLvl = (currentLevel % 3) + 1;
  startLevel(nextLvl);
  updateDiffBtn();
});

// ── CONTROLS HINT ──────────────────────────────────────────────
const controlsHint = document.createElement('div');
controlsHint.className = 'rg-card';
controlsHint.style.cssText = [
  'pointer-events:none',
  'display:flex', 'align-items:center', 'gap:10px',
  'padding:9px 20px',
  'white-space:nowrap',
  '--accent:rgba(255,255,255,0.08)',
  'font-family:\'Fredoka\',sans-serif',
].join(';');
controlsHint.innerHTML = `
  <span class="rg-key">WASD</span>
  <span style="font-size:13px;color:rgba(255,255,255,0.6);font-weight:500;">Throttle, Brake &amp; Steer</span>
  <span style="color:rgba(255,255,255,0.2);font-size:16px;margin:0 2px;">&#124;</span>
  <span class="rg-key">SHIFT</span>
  <span style="font-size:13px;color:rgba(255,255,255,0.6);font-weight:500;">Drift Boost</span>
`;
bottomHud.appendChild(controlsHint);

// ============ FPS COUNTER ============
let fpsVisible = false;
let fpsFrames = 0;
let fpsLastTime = performance.now();
let fpsValue = 0;

const fpsDisplay = document.createElement('div');
fpsDisplay.style.cssText = 'position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.55);color:#0f0;padding:6px 14px;border-radius:14px;font-family:"Fredoka",monospace;font-size:14px;font-weight:700;border:3px solid rgba(0,255,0,0.5);display:none;pointer-events:none;z-index:300;box-shadow:0 4px 0 rgba(0,0,0,0.3);';
hud.appendChild(fpsDisplay);

function toggleFPS() {
  fpsVisible = !fpsVisible;
  fpsDisplay.style.display = fpsVisible ? 'block' : 'none';
}

function updateFPS() {
  fpsFrames++;
  const now = performance.now();
  const elapsed = now - fpsLastTime;
  if (elapsed >= 500) {
    fpsValue = Math.round((fpsFrames * 1000) / elapsed);
    fpsFrames = 0;
    fpsLastTime = now;
    if (fpsVisible) {
      fpsDisplay.textContent = `${fpsValue} FPS`;
    }
  }
}

// ============ MINIMAP ============
function drawMinimap() {
  const ctx = minimapCtx;
  const w = 160, h = 160;
  ctx.clearRect(0, 0, w, h);
  
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const p = getTrackPoint(t);
    const mx = w / 2 + p.x * 1.7;
    const my = h / 2 + p.z * 1.7;
    if (i === 0) ctx.moveTo(mx, my);
    else ctx.lineTo(mx, my);
  }
  ctx.closePath();
  ctx.stroke();
  
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const p = getTrackPoint(t);
    const mx = w / 2 + p.x * 1.7;
    const my = h / 2 + p.z * 1.7;
    if (i === 0) ctx.moveTo(mx, my);
    else ctx.lineTo(mx, my);
  }
  ctx.closePath();
  ctx.stroke();
  
  state.opponents.forEach((opp, i) => {
    if (!opp.mesh.visible) return;
    const p = getTrackPoint(opp.t);
    const mx = w / 2 + p.x * 1.7;
    const my = h / 2 + p.z * 1.7;
    ctx.fillStyle = ['#2ee6ff', '#39ff9d', '#ff5fa8'][i];
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw boxes on minimap
  state.boxes.forEach(box => {
    const mx = w / 2 + box.x * 1.7;
    const my = h / 2 + box.z * 1.7;
    ctx.fillStyle = '#CC8833';
    ctx.fillRect(mx - 2, my - 2, 4, 4);
  });
  
  const px = w / 2 + state.carPos.x * 1.7;
  const py = h / 2 + state.carPos.z * 1.7;
  ctx.fillStyle = '#FF3333';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// ============ PARTICLE SYSTEM ============
// Pre-allocate geometries and materials for massive performance boost
const dustGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const dustMat = new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.8 });

const smokeGeo = new THREE.SphereGeometry(0.2, 4, 4);
const smokeMat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.6 });

const sparkGeo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffaa22 });

const flameGeo = new THREE.SphereGeometry(0.15, 4, 4);
const flameMat1 = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.8 });
const flameMat2 = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 });

function spawnParticle(x, y, z) {
  const particle = new THREE.Mesh(dustGeo, dustMat);
  particle.position.set(x, y, z);
  particle.scale.setScalar(0.5 + Math.random() * 0.8);
  scene.add(particle);
  state.particles.push({
    mesh: particle,
    vel: { x: (Math.random() - 0.5) * 0.1, y: Math.random() * 0.08, z: (Math.random() - 0.5) * 0.1 },
    life: 1,
    type: 'dust',
  });
}

function spawnDriftSmoke(x, y, z) {
  const particle = new THREE.Mesh(smokeGeo, smokeMat);
  particle.position.set(x, y, z);
  particle.scale.setScalar(0.7 + Math.random() * 0.5);
  scene.add(particle);
  state.particles.push({
    mesh: particle,
    vel: { x: (Math.random() - 0.5) * 0.03, y: 0.02 + Math.random() * 0.02, z: (Math.random() - 0.5) * 0.03 },
    life: 1,
    type: 'smoke',
  });
}

function spawnDriftSpark(x, y, z) {
  const particle = new THREE.Mesh(sparkGeo, sparkMat);
  particle.position.set(x, y, z);
  scene.add(particle);
  state.particles.push({
    mesh: particle,
    vel: {
      x: (Math.random() - 0.5) * 0.15,
      y: 0.05 + Math.random() * 0.1,
      z: (Math.random() - 0.5) * 0.15,
    },
    life: 0.5 + Math.random() * 0.3,
    type: 'spark',
  });
}

function spawnBoostFlame(x, y, z) {
  const geo = new THREE.SphereGeometry(0.12 + Math.random() * 0.1, 4, 4);
  const flameMat = new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0xff4400 : 0xffaa00, transparent: true, opacity: 0.8 });
  const particle = new THREE.Mesh(geo, flameMat);
  particle.position.set(x, y, z);
  scene.add(particle);
  state.particles.push({
    mesh: particle,
    vel: {
      x: (Math.random() - 0.5) * 0.05,
      y: 0.01 + Math.random() * 0.03,
      z: (Math.random() - 0.5) * 0.05,
    },
    life: 0.3 + Math.random() * 0.2,
    type: 'flame',
  });
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    const fadeRate = p.type === 'smoke' ? 1.5 : p.type === 'spark' ? 3 : p.type === 'flame' ? 4 : 2;
    p.life -= dt * fadeRate;
    p.mesh.position.x += p.vel.x;
    p.mesh.position.y += p.vel.y;
    p.mesh.position.z += p.vel.z;

    if (p.type === 'smoke') {
      p.mesh.scale.multiplyScalar(1 + dt * 2);
      p.vel.y *= 0.98;
    } else if (p.type === 'spark') {
      p.vel.y -= 0.006;
    } else if (p.type === 'flame') {
      p.mesh.scale.multiplyScalar(1 - dt * 3);
    } else {
      p.vel.y -= 0.003;
    }

    p.mesh.material.opacity = Math.max(0, p.life);
    p.mesh.material.transparent = true;
    
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      state.particles.splice(i, 1);
    }
  }
}

// ============ SKID MARK SYSTEM ============
// Skid marks via single InstancedMesh (300 instances, fading via instance color alpha)
const skidGeo = new THREE.PlaneGeometry(0.35, 1.2);
skidGeo.rotateX(-Math.PI / 2);
const skidMatInst = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  fog: false,
});
const skidInstanced = new THREE.InstancedMesh(skidGeo, skidMatInst, state.maxSkidMarks);
skidInstanced.name = 'skidMarksInstanced';
skidInstanced.frustumCulled = false;
skidInstanced.renderOrder = 2;
skidInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

// Instance colors: RGB where we use all channels for the dark skid color, alpha handled via color brightness
// We'll use instanceColor to fade: bright = visible, black = invisible against dark road
const skidColors = new Float32Array(state.maxSkidMarks * 3);
const skidDummy = new THREE.Object3D();

// Initialize all instances off-screen and invisible
for (let i = 0; i < state.maxSkidMarks; i++) {
  skidDummy.position.set(0, -100, 0);
  skidDummy.rotation.set(0, 0, 0);
  skidDummy.scale.set(1, 1, 1);
  skidDummy.updateMatrix();
  skidInstanced.setMatrixAt(i, skidDummy.matrix);
  // Start with zero color (invisible on dark road)
  skidColors[i * 3] = 0;
  skidColors[i * 3 + 1] = 0;
  skidColors[i * 3 + 2] = 0;
  state.skidMarks.push({ life: 0, maxLife: 0 });
}
skidInstanced.instanceColor = new THREE.InstancedBufferAttribute(skidColors, 3);
skidInstanced.instanceColor.setUsage(THREE.DynamicDrawUsage);
scene.add(skidInstanced);

function spawnSkidMark(x, z, angle) {
  const idx = state.skidMarkIndex % state.maxSkidMarks;
  const mark = state.skidMarks[idx];
  skidDummy.position.set(x, 0.07, z);
  skidDummy.rotation.set(0, angle, 0);
  skidDummy.scale.set(1, 1, 1);
  skidDummy.updateMatrix();
  skidInstanced.setMatrixAt(idx, skidDummy.matrix);
  skidInstanced.instanceMatrix.needsUpdate = true;
  // Set color to black skid mark at full intensity
  const ca = skidInstanced.instanceColor.array;
  ca[idx * 3] = 0.05;
  ca[idx * 3 + 1] = 0.05;
  ca[idx * 3 + 2] = 0.05;
  skidInstanced.instanceColor.needsUpdate = true;
  mark.life = 8.0;
  mark.maxLife = 8.0;
  state.skidMarkIndex++;
}

function updateSkidMarks(dt) {
  let colorDirty = false;
  const ca = skidInstanced.instanceColor.array;
  const baseC = 0.05;
  for (let i = 0; i < state.maxSkidMarks; i++) {
    const mark = state.skidMarks[i];
    if (mark.life > 0) {
      mark.life -= dt;
      let fade = 1;
      if (mark.life < 3) {
        fade = Math.max(0, mark.life / 3);
      }
      if (mark.life <= 0) {
        fade = 0;
        // Move off-screen
        skidDummy.position.set(0, -100, 0);
        skidDummy.rotation.set(0, 0, 0);
        skidDummy.scale.set(1, 1, 1);
        skidDummy.updateMatrix();
        skidInstanced.setMatrixAt(i, skidDummy.matrix);
        skidInstanced.instanceMatrix.needsUpdate = true;
      }
      const c = baseC * fade;
      ca[i * 3] = c;
      ca[i * 3 + 1] = c;
      ca[i * 3 + 2] = c;
      colorDirty = true;
    }
  }
  if (colorDirty) {
    skidInstanced.instanceColor.needsUpdate = true;
  }
}

// ============ DEBUG FREE-CAM MODE ============
let debugMode = false;
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.1;
orbitControls.enabled = false;
orbitControls.maxPolarAngle = Math.PI * 0.85;
orbitControls.minDistance = 2;
orbitControls.maxDistance = 150;

const debugBanner = document.createElement('div');
debugBanner.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.7);color:#0f0;padding:12px 28px;border-radius:16px;font-family:"Fredoka",monospace;font-size:15px;font-weight:600;z-index:300;pointer-events:none;opacity:0;transition:opacity 0.3s;border:3px solid rgba(0,255,0,0.5);box-shadow:0 4px 0 rgba(0,0,0,0.3);';
document.body.appendChild(debugBanner);

// ============ SCENE SETTINGS UI ============
let settingsOpen = false;
const settingsPanel = document.createElement('div');
settingsPanel.style.cssText = 'position:fixed;top:50%;right:20px;transform:translateY(-50%);width:280px;max-height:80vh;overflow-y:auto;background:rgba(10,10,14,0.85);border:3px solid rgba(255,255,255,0.5);border-radius:22px;padding:20px 18px;z-index:400;pointer-events:auto;font-family:"Fredoka","Lilita One",sans-serif;color:#fff;display:none;box-shadow:0 6px 0 rgba(0,0,0,0.3);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;';
document.body.appendChild(settingsPanel);

const settingsState = {
  fogDensity: 0.012,
  exposure: 0.45,
  bgBlur: 0.40,
  bgIntensity: 0.65,
  sunIntensity: 1.60,
  ambientIntensity: 0.00,
  shadowsEnabled: true,
  sunColorHex: '#ffd9ee',
  ambientColorHex: '#7788cc',
  fogColorHex: '#4a4a7a',
};

function toggleSettings() {
  settingsOpen = !settingsOpen;
  settingsPanel.style.display = settingsOpen ? 'block' : 'none';
}

function buildSettingsUI() {
  const s = settingsState;
  settingsPanel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div style="font-size:15px;font-weight:700;letter-spacing:1px;opacity:0.9;">⚙ SCENE SETTINGS</div>
      <div id="settings-close" style="cursor:pointer;font-size:18px;opacity:0.5;padding:2px 6px;">✕</div>
    </div>
    <div style="font-size:10px;letter-spacing:1.5px;opacity:0.35;margin-bottom:10px;font-weight:600;">LIGHTING</div>
    ${makeSlider('Sun Intensity', 'sunIntensity', 0, 5, 0.1, s.sunIntensity)}
    ${makeSlider('Ambient Intensity', 'ambientIntensity', 0, 3, 0.05, s.ambientIntensity)}
    ${makeColorPicker('Sun Color', 'sunColorHex', s.sunColorHex)}
    ${makeColorPicker('Ambient Color', 'ambientColorHex', s.ambientColorHex)}
    <div style="height:1px;background:rgba(255,255,255,0.08);margin:14px 0;"></div>
    <div style="font-size:10px;letter-spacing:1.5px;opacity:0.35;margin-bottom:10px;font-weight:600;">ATMOSPHERE</div>
    ${makeSlider('Fog Density', 'fogDensity', 0, 0.03, 0.001, s.fogDensity)}
    ${makeColorPicker('Fog Color', 'fogColorHex', s.fogColorHex)}
    ${makeSlider('Exposure', 'exposure', 0.2, 3, 0.05, s.exposure)}
    ${makeSlider('BG Blur', 'bgBlur', 0, 1, 0.05, s.bgBlur)}
    ${makeSlider('BG Intensity', 'bgIntensity', 0, 2, 0.05, s.bgIntensity)}
    <div style="height:1px;background:rgba(255,255,255,0.08);margin:14px 0;"></div>
    <div style="font-size:10px;letter-spacing:1.5px;opacity:0.35;margin-bottom:10px;font-weight:600;">RENDERING</div>
    ${makeToggle('Shadows', 'shadowsEnabled', s.shadowsEnabled)}
    <div style="margin-top:14px;text-align:center;">
      <button id="settings-reset" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#aaa;padding:6px 18px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;">Reset Defaults</button>
    </div>
    <div style="font-size:10px;opacity:0.25;text-align:center;margin-top:12px;">Press V to toggle</div>
  `;

  settingsPanel.querySelector('#settings-close').addEventListener('click', toggleSettings);
  settingsPanel.querySelector('#settings-reset').addEventListener('click', resetSettings);

  settingsPanel.querySelectorAll('[data-setting]').forEach(el => {
    const key = el.dataset.setting;
    if (el.type === 'range') {
      el.addEventListener('input', () => {
        settingsState[key] = parseFloat(el.value);
        const valSpan = el.parentElement.querySelector('.setting-val');
        if (valSpan) valSpan.textContent = parseFloat(el.value).toFixed(key === 'fogDensity' ? 3 : 2);
        applySettings();
      });
    } else if (el.type === 'color') {
      el.addEventListener('input', () => {
        settingsState[key] = el.value;
        applySettings();
      });
    } else if (el.type === 'checkbox') {
      el.addEventListener('change', () => {
        settingsState[key] = el.checked;
        applySettings();
      });
    }
  });
}

function makeSlider(label, key, min, max, step, value) {
  const dec = key === 'fogDensity' ? 3 : 2;
  return `<div style="margin-bottom:12px;">
    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
      <span style="font-size:12px;opacity:0.7;">${label}</span>
      <span class="setting-val" style="font-size:12px;opacity:0.5;font-variant-numeric:tabular-nums;">${value.toFixed(dec)}</span>
    </div>
    <input data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"
      style="width:100%;height:4px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,0.12);border-radius:2px;outline:none;cursor:pointer;accent-color:#6688ff;">
  </div>`;
}

function makeColorPicker(label, key, value) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <span style="font-size:12px;opacity:0.7;">${label}</span>
    <input data-setting="${key}" type="color" value="${value}"
      style="width:32px;height:24px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:transparent;cursor:pointer;padding:0;">
  </div>`;
}

function makeToggle(label, key, value) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <span style="font-size:12px;opacity:0.7;">${label}</span>
    <label style="position:relative;width:38px;height:20px;cursor:pointer;">
      <input data-setting="${key}" type="checkbox" ${value ? 'checked' : ''}
        style="opacity:0;width:0;height:0;position:absolute;">
      <span style="position:absolute;top:0;left:0;right:0;bottom:0;background:${value ? 'rgba(100,140,255,0.6)' : 'rgba(255,255,255,0.12)'};border-radius:10px;transition:background 0.2s;">
        <span style="position:absolute;top:2px;left:${value ? '20px' : '2px'};width:16px;height:16px;background:#fff;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></span>
      </span>
    </label>
  </div>`;
}

function applySettings() {
  const s = settingsState;
  renderer.toneMappingExposure = s.exposure;
  const fogColor = new THREE.Color(s.fogColorHex);
  scene.fog = new THREE.FogExp2(fogColor, s.fogDensity);
  // Always sync background to fog color for seamless horizon
  scene.background = fogColor.clone();
  scene.backgroundBlurriness = 0;
  scene.backgroundIntensity = 1.0;
  sunLight.intensity = s.sunIntensity;
  sunLight.color.set(s.sunColorHex);
  ambientLight.intensity = s.ambientIntensity;
  ambientLight.color.set(s.ambientColorHex);
  renderer.shadowMap.enabled = s.shadowsEnabled;
  sunLight.castShadow = s.shadowsEnabled;
  // Update ground vertex colors to fade into new fog color
  const ground = track.getObjectByName('groundPlane');
  if (ground) {
    const grassCol = new THREE.Color(0x2b9a7a);
    const positions = ground.geometry.attributes.position;
    const colors = ground.geometry.attributes.color;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getY(i);
      const dist = Math.sqrt(x * x + z * z);
      const t = THREE.MathUtils.smoothstep(dist, 50, 130);
      const c = grassCol.clone().lerp(fogColor, t);
      colors.setXYZ(i, c.r, c.g, c.b);
    }
    colors.needsUpdate = true;
  }
  // Update horizon ring color
  const horizon = track.getObjectByName('horizonRing');
  if (horizon) {
    horizon.material.color.copy(fogColor);
  }
}

function resetSettings() {
  settingsState.fogDensity = 0.012;
  settingsState.exposure = 0.45;
  settingsState.bgBlur = 0.40;
  settingsState.bgIntensity = 0.65;
  settingsState.sunIntensity = 1.60;
  settingsState.ambientIntensity = 0.00;
  settingsState.shadowsEnabled = true;
  settingsState.sunColorHex = '#ffd9ee';
  settingsState.ambientColorHex = '#7788cc';
  settingsState.fogColorHex = '#4a4a7a';
  applySettings();
  buildSettingsUI();
}

buildSettingsUI();

function toggleDebugMode() {
  debugMode = !debugMode;
  orbitControls.enabled = debugMode;
  if (debugMode) {
    orbitControls.target.set(state.carPos.x, 1, state.carPos.z);
    orbitControls.update();
    debugBanner.textContent = '🔍 FREE CAM — press F to return';
    debugBanner.style.opacity = '1';
    setTimeout(() => { debugBanner.style.opacity = '0'; }, 2000);
  } else {
    debugBanner.textContent = '🌃 CHASE CAM';
    debugBanner.style.opacity = '1';
    setTimeout(() => { debugBanner.style.opacity = '0'; }, 1500);
    cameraOffset.set(
      state.carPos.x - Math.sin(state.carAngle) * 12,
      8,
      state.carPos.z - Math.cos(state.carAngle) * 12
    );
    cameraLookAt.set(
      state.carPos.x + Math.sin(state.carAngle) * 3,
      1,
      state.carPos.z + Math.cos(state.carAngle) * 3
    );
  }
}

// ============ INPUT ============
window.addEventListener('keydown', e => {
  if (e.code === 'KeyF') { toggleDebugMode(); return; }
  if (e.code === 'KeyG') { toggleFPS(); return; }
  if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey) {
    toggleSettings();
    return;
  }
  state.keys[e.code] = true;
});
window.addEventListener('keyup', e => { state.keys[e.code] = false; });

const mobileControls = document.createElement('div');
mobileControls.style.cssText = 'position:fixed;bottom:0;left:0;width:100%;height:160px;pointer-events:none;z-index:101;display:none;';

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
if (isMobile) {
  mobileControls.style.display = 'block';
  controlsHint.style.display = 'none';
  
  const btnStyle = 'position:absolute;width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,0.2);border:2px solid rgba(255,255,255,0.4);pointer-events:auto;display:flex;align-items:center;justify-content:center;font-size:24px;color:white;-webkit-user-select:none;user-select:none;touch-action:none;';
  
  const btns = [
    { id: 'mUp', text: '▲', style: `${btnStyle}bottom:90px;right:45px;`, key: 'ArrowUp' },
    { id: 'mDown', text: '▼', style: `${btnStyle}bottom:15px;right:45px;`, key: 'ArrowDown' },
    { id: 'mLeft', text: '◀', style: `${btnStyle}bottom:30px;left:20px;`, key: 'ArrowLeft' },
    { id: 'mRight', text: '▶', style: `${btnStyle}bottom:30px;left:100px;`, key: 'ArrowRight' },
    { id: 'mDrift', text: '↻', style: `${btnStyle}bottom:90px;left:60px;width:70px;height:70px;font-size:28px;background:rgba(255,150,0,0.25);border-color:rgba(255,180,0,0.5);`, key: 'Space' },
  ];
  
  btns.forEach(b => {
    const btn = document.createElement('div');
    btn.style.cssText = b.style;
    btn.innerHTML = b.text;
    btn.addEventListener('touchstart', e => { e.preventDefault(); state.keys[b.key] = true; });
    btn.addEventListener('touchend', e => { e.preventDefault(); state.keys[b.key] = false; });
    btn.addEventListener('touchcancel', e => { state.keys[b.key] = false; });
    mobileControls.appendChild(btn);
  });
}
document.body.appendChild(mobileControls);

// ============ GAME LOOP ============
const clock = new THREE.Clock();
let countdownTimer = 3;
let raceStarted = false;
const cameraOffset = new THREE.Vector3();
const cameraLookAt = new THREE.Vector3();

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}
function formatTimeFixed(seconds) {
  const raw = formatTime(seconds);
  return raw.split('').map(ch => `<span style="display:inline-block;width:${ch === ':' || ch === '.' ? '0.45em' : '0.65em'};text-align:center;">${ch}</span>`).join('');
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  
  // Don't run game if no level selected
  if (currentLevel === 0) {
    renderToon();
    return;
  }

  // Countdown
  if (!raceStarted) {
    countdownTimer -= dt;
    if (countdownTimer > 0) {
      const num = Math.ceil(countdownTimer);
      countdownDisplay.textContent = num;
      countdownDisplay.style.transform = `translate(-50%,-50%) scale(${1 + (countdownTimer % 1) * 0.3})`;
      const cColor = num === 1 ? '#ff4444' : num === 2 ? '#ffaa00' : '#ffffff';
      const cGlow = num === 1 ? 'rgba(255,68,68,0.8)' : num === 2 ? 'rgba(255,170,0,0.8)' : 'rgba(255,255,255,0.8)';
      countdownDisplay.style.color = cColor;
      countdownDisplay.style.textShadow = `0 0 40px ${cGlow}, 0 0 80px ${cGlow}, 0 4px 20px rgba(0,0,0,0.5)`;
    } else {
      countdownDisplay.textContent = 'GO!';
      countdownDisplay.style.color = '#44ff44';
      countdownDisplay.style.textShadow = '0 0 40px rgba(68,255,68,0.8), 0 0 80px rgba(68,255,68,0.8), 0 4px 20px rgba(0,0,0,0.5)';
      if (countdownTimer < -0.8) {
        countdownDisplay.style.opacity = '0';
        raceStarted = true;
      }
    }
  }
  
  if (raceStarted && !state.gameOver) {
    state.totalTime += dt;
    state.lapTime += dt;
    state.timeRemaining = Math.max(0, state.maxTime - state.totalTime);

    if (state.timeRemaining <= 0) {
      // Bank any in-progress drift points before ending
      if (state.drifting && state.driftPoints > 0) {
        const banked = Math.round(state.driftPoints * state.pointsMultiplier);
        if (banked >= 5) {
          state.totalPoints += banked;
          state.pointsLog.push({ type: 'drift', amount: banked, time: state.totalTime, multiplier: state.pointsMultiplier });
        }
        state.driftPoints = 0;
        state.pointsMultiplier = 1;
        state.drifting = false;
        state.driftBoost = 0;
      }
      state.gameOver = true;
      state.speed = 0;
      gameOverOverlay.style.display = 'flex';
      gameOverOverlay.innerHTML = `
        <div style="text-align:center;color:#fff;font-family:'Fredoka','Lilita One',sans-serif;">
          <div style="font-size:20px;letter-spacing:4px;color:rgba(255,255,255,0.6);margin-bottom:8px;font-weight:600;">CHECKERED FLAG!</div>
          <div style="font-size:72px;font-weight:700;letter-spacing:-1px;margin-bottom:4px;font-family:'Lilita One',sans-serif;">FINAL SCORE</div>
          <div style="font-size:68px;font-weight:700;color:#2ee6ff;margin-bottom:24px;font-family:'Lilita One',sans-serif;">${Math.round(state.totalPoints).toLocaleString()}</div>
          <div style="font-size:16px;color:rgba(255,255,255,0.65);margin-bottom:6px;font-weight:500;">🏁 LAPS COMPLETED: ${state.lap}</div>
          <div style="font-size:16px;color:rgba(255,255,255,0.65);margin-bottom:6px;font-weight:500;">EVENTS: ${state.pointsLog.filter(e=>e.amount>0).length} earned · ${state.pointsLog.filter(e=>e.amount<0||e.amount===0&&e.type.startsWith('crash')).length} crashes</div>
          <div style="max-height:140px;overflow-y:auto;margin:12px auto 0;width:300px;text-align:left;pointer-events:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.3) transparent;">
            ${state.pointsLog.map(e => {
              const icon = e.type==='drift'?'⚡':e.type==='lap'?'🏁':e.type==='crash_wall'?'💥':'🚗';
              const color = e.amount>0?(e.type==='lap'?'#ffdd44':'#44ff88'):'#ff4444';
              const label = e.type==='drift'?`Drift x${e.multiplier.toFixed(1)}`:e.type==='lap'?`Lap ${e.lap}`:e.type==='crash_wall'?'Wall crash':'Car crash';
              const baseP = e.type==='drift'?Math.round(e.amount/e.multiplier):0;
              const amt = e.type==='drift'?`${baseP.toLocaleString()} → +${e.amount.toLocaleString()}`:e.amount>0?`+${e.amount.toLocaleString()}`:e.amount<0?e.amount.toLocaleString():'—';
              return `<div style="display:flex;justify-content:space-between;padding:4px 10px;margin-bottom:3px;border-radius:10px;background:rgba(255,255,255,0.08);border:2px solid rgba(255,255,255,0.12);font-size:12px;font-weight:500;"><span>${icon} <span style="color:#bbb;">${formatTime(e.time)}</span> ${label}</span><span style="color:${color};font-weight:700;">${amt}</span></div>`;
            }).join('')}
          </div>
          <div style="font-size:15px;color:rgba(255,255,255,0.45);margin-top:30px;font-weight:500;">Press ENTER or tap to restart</div>
        </div>`;
      return;
    }
    
    const dtScale = dt * 60;
    const holdingDrift = state.keys['Space'] || state.keys['ShiftLeft'] || state.keys['ShiftRight'];
    const turningLeft = state.keys['ArrowLeft'] || state.keys['KeyA'];
    const turningRight = state.keys['ArrowRight'] || state.keys['KeyD'];

    const rawTurnDir = turningLeft ? 1 : turningRight ? -1 : 0;
    const turnLerpSpeed = rawTurnDir !== 0 ? 0.18 : 0.12;
    state.turnInput = THREE.MathUtils.lerp(state.turnInput, rawTurnDir, turnLerpSpeed * dtScale);
    if (Math.abs(state.turnInput) < 0.01) state.turnInput = 0;

    if (rawTurnDir !== 0) {
      if (rawTurnDir === state.lastTurnDir) {
        state.turnHoldTime += dt;
      } else {
        state.turnHoldTime = 0;
      }
      state.lastTurnDir = rawTurnDir;
    } else {
      state.turnHoldTime = Math.max(0, state.turnHoldTime - dt * 3);
    }

    const turnIntensity = Math.min(1.0, 0.6 + state.turnHoldTime * 1.35);
    const turnDir = state.turnInput;
    const turning = Math.abs(turnDir) > 0.05;
    const absTurn = Math.abs(turnDir);

    let effectiveMax = state.maxSpeed;

    if (state.keys['ArrowUp'] || state.keys['KeyW']) {
      state.speed = Math.min(state.speed + state.acceleration * dtScale, effectiveMax);
    } else if (state.keys['ArrowDown'] || state.keys['KeyS']) {
      state.speed = Math.max(state.speed - state.braking * dtScale, -state.maxSpeed * 0.3);
    } else {
      if (state.speed > 0) state.speed = Math.max(0, state.speed - state.friction * dtScale);
      else state.speed = Math.min(0, state.speed + state.friction * dtScale);
    }

    const canDrift = holdingDrift && absTurn > 0.15 && state.speed > state.maxSpeed * 0.35 && turnDir > 0.15;
    if (canDrift && !state.drifting) {
      state.drifting = true;
      state.driftMomentum = Math.sign(turnDir) * 0.02;
      state.driftBoost = 0;
    }
    if (state.drifting && (!holdingDrift || state.speed < state.maxSpeed * 0.15)) {
      if (state.driftPoints > 0) {
        const banked = Math.round(state.driftPoints * state.pointsMultiplier);
        if (banked >= 5) {
          state.totalPoints += banked;
          state.bankedAmount = banked;
          state.showPointsBanked = 3.5;
          state.driftGracePeriod = 2.0;
          state.pendingPointsFlashIntensity = 0.4 + Math.min(0.4, banked / 2000);
          state.pointsLog.push({ type: 'drift', amount: banked, time: state.totalTime, multiplier: state.pointsMultiplier });
        }
      }
      state.driftPoints = 0;
      state.pointsMultiplier = 1;
      state.drifting = false;
      // DON'T zero driftAngle/driftMomentum — let them decay smoothly in the else branch
      state.driftBoost = 0;
    }

    if (state.drifting) {
      const driftTurnMul = 1.4;
      state.carAngle += turnDir * turnIntensity * state.turnSpeed * driftTurnMul * (state.speed / state.maxSpeed) * dtScale;

      const driftDir = Math.sign(state.driftMomentum) || Math.sign(turnDir);
      const targetMomentum = driftDir * 0.045;
      state.driftMomentum = THREE.MathUtils.lerp(state.driftMomentum, targetMomentum, 0.06 * dtScale);

      if (absTurn > 0.1 && Math.sign(turnDir) !== driftDir) {
        const counterForce = absTurn * 0.035;
        state.driftMomentum *= (1 - counterForce * dtScale);
      }

      state.driftAngle = THREE.MathUtils.lerp(state.driftAngle, state.driftMomentum * 18, 0.08 * dtScale);
      state.driftBoost += Math.abs(state.driftMomentum) * dt * 3;

      const pointRate = Math.abs(state.driftMomentum) * state.speed * 800;
      state.driftPoints += pointRate * dt;
      state.pointsMultiplier = Math.min(5, 1 + state.driftBoost * 0.8);
      state.speed *= (1 - 0.002 * dtScale);
    } else {
      state.carAngle += turnDir * turnIntensity * state.turnSpeed * (state.speed / state.maxSpeed) * dtScale;
      // Smooth recovery from drift — fast enough to feel responsive, slow enough to not snap
      const recoverySpeed = 0.12;
      state.driftAngle = THREE.MathUtils.lerp(state.driftAngle, 0, recoverySpeed * dtScale);
      state.driftMomentum = THREE.MathUtils.lerp(state.driftMomentum, 0, recoverySpeed * dtScale);
      // Clamp to zero when close to avoid lingering drift feel
      if (Math.abs(state.driftAngle) < 0.005) state.driftAngle = 0;
      if (Math.abs(state.driftMomentum) < 0.0005) state.driftMomentum = 0;
    }

    if (state.driftGracePeriod > 0) {
      const prevGrace = state.driftGracePeriod;
      state.driftGracePeriod -= dt;
      if (state.driftGracePeriod <= 0 && prevGrace > 0 && state.pendingPointsFlashIntensity > 0) {
        state.pointsFlash = 0.5;
        state.pointsFlashIntensity = state.pendingPointsFlashIntensity;
        state.pendingPointsFlashIntensity = 0;
      }
    }

    const moveAngle = state.carAngle;
    const forwardX = Math.sin(moveAngle) * state.speed * dtScale;
    const forwardZ = Math.cos(moveAngle) * state.speed * dtScale;
    const lateralX = Math.cos(moveAngle) * state.driftMomentum * state.speed * dtScale * 8;
    const lateralZ = -Math.sin(moveAngle) * state.driftMomentum * state.speed * dtScale * 8;

    const newX = state.carPos.x + forwardX + lateralX;
    const newZ = state.carPos.z + forwardZ + lateralZ;
    
    if (isOnTrack(newX, newZ)) {
      state.carPos.x = newX;
      state.carPos.z = newZ;
    } else {
      state.speed *= 0.85;
      if (state.wallCrashCooldown <= 0) {
        state.wallCrashCooldown = 1.0;
        state.screenShake = 0.35;
        state.screenShakeIntensity = 0.3 + Math.min(0.4, Math.abs(state.speed) * 0.8);
        state.crashFlash = 0.4;
        state.crashFlashIntensity = 0.5 + Math.min(0.5, Math.abs(state.speed) * 1.0);
        if (state.drifting && state.driftPoints > 0) {
          const lost = Math.round(state.driftPoints * state.pointsMultiplier);
          state.pointsLog.push({ type: 'crash_wall', amount: -lost, time: state.totalTime });
          state.driftPoints = 0;
          state.pointsMultiplier = 1;
          state.drifting = false;
          // Don't zero driftAngle/driftMomentum — let them decay naturally
          state.driftBoost = 0;
          state.showPointsBanked = 1.5;
          state.bankedAmount = -lost;
        } else if (state.driftGracePeriod > 0) {
          let clawback = 0;
          for (let li = state.pointsLog.length - 1; li >= 0; li--) {
            if (state.pointsLog[li].type === 'drift') {
              clawback = state.pointsLog[li].amount;
              state.pointsLog.splice(li, 1);
              break;
            }
          }
          if (clawback > 0) {
            state.totalPoints = Math.max(0, state.totalPoints - clawback);
            state.pointsLog.push({ type: 'crash_wall', amount: -clawback, time: state.totalTime });
            state.showPointsBanked = 1.5;
            state.bankedAmount = -clawback;
          } else {
            state.bankedAmount = -1;
            state.showPointsBanked = 1.0;
          }
          state.driftGracePeriod = 0;
        }
      }
      if (state.drifting) { state.driftMomentum *= 0.5; }
      if (isOnTrack(newX, state.carPos.z)) {
        state.carPos.x = newX;
      } else if (isOnTrack(state.carPos.x, newZ)) {
        state.carPos.z = newZ;
      }
      
      if (Math.abs(state.speed) > 0.1) {
        for (let i = 0; i < 3; i++) {
          spawnParticle(state.carPos.x, 0.3, state.carPos.z);
        }
      }
    }
    
    if (state.carCrashCooldown > 0) state.carCrashCooldown -= dt;
    if (state.wallCrashCooldown > 0) state.wallCrashCooldown -= dt;

    state.opponents.forEach(opp => {
      if (!opp.mesh.visible) return;
      const dx = state.carPos.x - opp.mesh.position.x;
      const dz = state.carPos.z - opp.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      // Elliptical hitbox: narrower on sides, full length front/back
      const toOppAngle = Math.atan2(dx, dz);
      const relAngle = toOppAngle - opp.mesh.rotation.y;
      const sideComponent = Math.abs(Math.sin(relAngle));
      const hitRadius = 2.2 - sideComponent * 0.6; // 2.2 front/back, ~1.6 on sides
      if (dist < hitRadius && dist > 0.01) {
        const pushX = dx / dist;
        const pushZ = dz / dist;
        const overlap = hitRadius - dist;
        state.carPos.x += pushX * (overlap + 0.05);
        state.carPos.z += pushZ * (overlap + 0.05);
        state.speed *= 0.85;

        if (state.carCrashCooldown <= 0) {
          state.carCrashCooldown = 1.0;
          state.speed *= 0.82;
          state.screenShake = 0.4;
          state.screenShakeIntensity = 0.4 + Math.min(0.5, Math.abs(state.speed) * 0.9);
          state.crashFlash = 0.45;
          state.crashFlashIntensity = 0.6 + Math.min(0.4, Math.abs(state.speed) * 1.0);

          if (state.drifting && state.driftPoints > 0) {
            const lost = Math.round(state.driftPoints * state.pointsMultiplier);
            state.pointsLog.push({ type: 'crash_car', amount: -lost, time: state.totalTime });
            state.driftPoints = 0;
            state.pointsMultiplier = 1;
          state.drifting = false;
          // Don't zero driftAngle/driftMomentum — let them decay naturally
          state.driftBoost = 0;
          state.showPointsBanked = 1.5;
          state.bankedAmount = -lost;
          } else if (state.driftGracePeriod > 0) {
            let clawback = 0;
            for (let li = state.pointsLog.length - 1; li >= 0; li--) {
              if (state.pointsLog[li].type === 'drift') {
                clawback = state.pointsLog[li].amount;
                state.pointsLog.splice(li, 1);
                break;
              }
            }
            if (clawback > 0) {
              state.totalPoints = Math.max(0, state.totalPoints - clawback);
              state.pointsLog.push({ type: 'crash_car', amount: -clawback, time: state.totalTime });
              state.showPointsBanked = 1.5;
              state.bankedAmount = -clawback;
            } else {
              state.bankedAmount = -1;
              state.showPointsBanked = 1.0;
            }
            state.driftGracePeriod = 0;
          }

          const hitX = (state.carPos.x + opp.mesh.position.x) / 2;
          const hitZ = (state.carPos.z + opp.mesh.position.z) / 2;
          for (let i = 0; i < 6; i++) {
            spawnDriftSpark(hitX + (Math.random() - 0.5) * 0.5, 0.4 + Math.random() * 0.3, hitZ + (Math.random() - 0.5) * 0.5);
          }
        }
      }
    });

    // Box obstacle collision
    state.boxes.forEach(box => {
      const dx = state.carPos.x - box.x;
      const dz = state.carPos.z - box.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < box.radius + 0.8 && dist > 0.01) {
        const pushX = dx / dist;
        const pushZ = dz / dist;
        const overlap = (box.radius + 0.8) - dist;
        state.carPos.x += pushX * (overlap + 0.05);
        state.carPos.z += pushZ * (overlap + 0.05);
        state.speed *= 0.6;

        if (state.wallCrashCooldown <= 0) {
          state.wallCrashCooldown = 0.5;
          state.screenShake = 0.25;
          state.screenShakeIntensity = 0.25 + Math.min(0.3, Math.abs(state.speed) * 0.6);
          state.crashFlash = 0.3;
          state.crashFlashIntensity = 0.4;
          playCrash(0.5);
          if (state.drifting && state.driftPoints > 0) {
            const lost = Math.round(state.driftPoints * state.pointsMultiplier);
            state.pointsLog.push({ type: 'crash_wall', amount: -lost, time: state.totalTime });
            state.driftPoints = 0;
            state.pointsMultiplier = 1;
            state.drifting = false;
            state.driftBoost = 0;
            state.showPointsBanked = 1.5;
            state.bankedAmount = -lost;
          }
          for (let i = 0; i < 4; i++) {
            spawnParticle(box.x + (Math.random()-0.5)*0.8, 0.5 + Math.random()*0.5, box.z + (Math.random()-0.5)*0.8);
          }
        }
      }
    });

    // Check coins
    for (let i = 0; i < state.coins.length; i++) {
      const coin = state.coins[i];
      if (!coin.active) continue;
      
      // Spin the coin
      coin.mesh.rotation.y += dt * 3;
      // Bobbing
      coin.mesh.position.y = 1.0 + Math.sin(state.totalTime * 4 + i) * 0.2;
      
      const distSq = (state.carPos.x - coin.x) ** 2 + (state.carPos.z - coin.z) ** 2;
      if (distSq < (coin.radius + 1.2) ** 2) {
        // Collected!
        coin.active = false;
        coin.mesh.visible = false;
        playCoin();
        
        const coinValue = 500;
        state.totalPoints += coinValue;
        state.pointsFlash = 0.4;
        state.pointsFlashIntensity = 0.8;
        state.pendingPointsFlashIntensity = 0.8;
        state.pointsLog.push({ type: 'coin', amount: coinValue, time: state.totalTime });
        
        spawnFloatingText(`+${coinValue}`, coin.x, 2.0, coin.z);
        
        for (let j = 0; j < 5; j++) {
          spawnParticle(coin.x + (Math.random()-0.5)*0.5, 1.0 + Math.random()*0.5, coin.z + (Math.random()-0.5)*0.5);
        }
      }
    }

    const { dist: trackDist } = getClosestTrackT(state.carPos.x, state.carPos.z);
    if (trackDist > TRACK_WIDTH / 2 - 0.5) {
      state.speed *= 0.98;
    }
    
    if (state.drifting && state.speed > state.maxSpeed * 0.3) {
      const rearOffsetX = -Math.sin(state.carAngle) * 1.0;
      const rearOffsetZ = -Math.cos(state.carAngle) * 1.0;
      const perpX = Math.cos(state.carAngle);
      const perpZ = -Math.sin(state.carAngle);
      for (let side = -1; side <= 1; side += 2) {
        if (Math.random() > 0.3) {
          const sx = state.carPos.x + rearOffsetX + perpX * side * 0.5 + (Math.random() - 0.5) * 0.2;
          const sz = state.carPos.z + rearOffsetZ + perpZ * side * 0.5 + (Math.random() - 0.5) * 0.2;
          spawnDriftSmoke(sx, 0.05, sz);
        }
      }
      if (Math.random() > 0.5) {
        const sx = state.carPos.x + rearOffsetX + (Math.random() - 0.5) * 1.0;
        const sz = state.carPos.z + rearOffsetZ + (Math.random() - 0.5) * 1.0;
        spawnDriftSpark(sx, 0.15, sz);
      }
    }

    if (state.drifting && state.speed > state.maxSpeed * 0.25) {
      const rearX = -Math.sin(state.carAngle) * 0.9;
      const rearZ = -Math.cos(state.carAngle) * 0.9;
      const perpX = Math.cos(state.carAngle);
      const perpZ = -Math.sin(state.carAngle);
      const markAngle = state.carAngle + state.driftAngle;
      for (let side = -1; side <= 1; side += 2) {
        const sx = state.carPos.x + rearX + perpX * side * 0.45;
        const sz = state.carPos.z + rearZ + perpZ * side * 0.45;
        spawnSkidMark(sx, sz, markAngle);
      }
    }

    if (!state.drifting && Math.abs(state.speed) > 0.3 && absTurn > 0.3) {
      if (Math.random() > 0.5) {
        spawnParticle(
          state.carPos.x - Math.sin(state.carAngle) * 0.8 + (Math.random() - 0.5) * 0.5,
          0.1,
          state.carPos.z - Math.cos(state.carAngle) * 0.8 + (Math.random() - 0.5) * 0.5
        );
      }
    }
    
    const { t: currentT } = getClosestTrackT(state.carPos.x, state.carPos.z);

    // Wrong-way detection
    if (state.speed > 0.05) {
      const tan = getTrackTangent(currentT);
      const trackAngle = Math.atan2(tan.x, tan.z);
      const carForwardAngle = state.carAngle;
      let angleDiff = carForwardAngle - trackAngle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      const goingWrongWay = Math.abs(angleDiff) > Math.PI * 0.6;

      if (goingWrongWay) {
        if (!state.wrongWay) {
          state.wrongWay = true;
          state.wrongWayTimer = 0;
        }
        state.wrongWayTimer += dt;
        if (state.wrongWayTimer >= 2.0 && state.wrongWayCooldown <= 0) {
          // Reset car to correct direction at current track position
          const resetTan = getTrackTangent(currentT);
          state.carAngle = Math.atan2(resetTan.x, resetTan.z);
          state.velocityAngle = state.carAngle;
          state.speed *= 0.3;
          state.driftAngle = 0;
          state.driftMomentum = 0;
          if (state.drifting) {
            state.driftPoints = 0;
            state.pointsMultiplier = 1;
            state.drifting = false;
            state.driftBoost = 0;
          }
          state.wrongWay = false;
          state.wrongWayTimer = 0;
          state.wrongWayCooldown = 1.0;
        }
      } else {
        state.wrongWay = false;
        state.wrongWayTimer = 0;
      }
    } else {
      state.wrongWay = false;
      state.wrongWayTimer = 0;
    }
    if (state.wrongWayCooldown > 0) state.wrongWayCooldown -= dt;
    
    const checkpointTs = [0.25, 0.5, 0.75, 0.95];
    for (let c = 0; c < 4; c++) {
      if (!state.checkpoints[c] && Math.abs(currentT - checkpointTs[c]) < 0.03) {
        if (c === 0 || state.checkpoints[c - 1]) {
          state.checkpoints[c] = true;
        }
      }
    }
    
    if (state.checkpoints.every(c => c) && currentT < 0.05 && state.lastCheckpoint > 0.9) {
      state.lap++;
      const lapBonus = 500 + state.lap * 200;
      state.totalPoints += lapBonus;
      state.bankedAmount = lapBonus;
      state.showPointsBanked = 2.0;
      state.pointsFlash = 0.6;
      state.pointsFlashIntensity = 0.5 + Math.min(0.3, lapBonus / 3000);
      state.pendingPointsFlashIntensity = 0;
      state.driftGracePeriod = 0;
      state.pointsLog.push({ type: 'lap', amount: lapBonus, time: state.totalTime, lap: state.lap });
      
      spawnFloatingText(`+${lapBonus}`, state.carPos.x, 3.0, state.carPos.z, '#44ff88');
      if (state.lapTime < state.bestLap) state.bestLap = state.lapTime;
      state.lapTime = 0;
      state.checkpoints = [false, false, false, false];
    }
    state.lastCheckpoint = currentT;
  }
  
  playerCar.position.set(state.carPos.x, 0.0, state.carPos.z);
  playerCar.rotation.y = state.carAngle;

  // Rotate wheels based on speed
  const wheelSpinSpeed = state.speed * 4.5;
  if (playerCar.userData.wheels) {
    playerCar.userData.wheels.forEach(w => {
      w.rotation.x += wheelSpinSpeed;
    });
  }
  state.opponents.forEach(opp => {
    if (opp.mesh.userData.wheels) {
      const oppSpinSpeed = opp.speed * 0.6 * 60 * 4.5;
      opp.mesh.userData.wheels.forEach(w => {
        w.rotation.x += oppSpinSpeed;
      });
    }
  });

    const turnYawAmount = state.turnInput * state.speed * 2.5;
    // Use driftAngle directly (it now smoothly lerps to 0 after drift ends)
    const totalVisualYaw = state.driftAngle + turnYawAmount * 0.08;
    playerCar.rotation.y = state.carAngle + totalVisualYaw;

  // Lean: apply ONLY visual Z-rotation to body meshes, never touch positions or wheels
  const targetTilt = state.turnInput * 0.05;
  // Use driftMomentum directly — it smoothly decays after drift ends
  const driftTilt = state.driftMomentum * 2.5;
  const desiredLean = (targetTilt * state.speed * 3) + driftTilt;
  // Slower lerp for smoother lean transitions (especially exiting drift)
  const leanLerpSpeed = state.drifting ? 0.1 : 0.05;
  const smoothLean = THREE.MathUtils.lerp(playerCar.userData.currentLean || 0, desiredLean, leanLerpSpeed);
  playerCar.userData.currentLean = smoothLean;

  // Never rotate the car group itself on Z
  playerCar.rotation.z = 0;

  const wheels = playerCar.userData.wheels || [];
  playerCar.children.forEach(child => {
    // Cache original positions once
    if (child.userData.origX === undefined) child.userData.origX = child.position.x;
    if (child.userData.origY === undefined) child.userData.origY = child.position.y;
    if (child.userData.origZ === undefined) child.userData.origZ = child.position.z;

    if (wheels.includes(child)) {
      // Wheels: always reset to exact original position, no lean at all
      child.position.x = child.userData.origX;
      child.position.y = child.userData.origY;
      child.position.z = child.userData.origZ;
      child.rotation.z = 0;
    } else {
      // Body parts: pivot around y=0 so bottom stays grounded, top leans
      const ox = child.userData.origX;
      const oy = child.userData.origY;
      const cosL = Math.cos(smoothLean);
      const sinL = Math.sin(smoothLean);
      // Rotate the position around the Z-axis at y=0 (ground level)
      child.position.x = ox * cosL - oy * sinL;
      child.position.y = ox * sinL + oy * cosL;
      child.position.z = child.userData.origZ;
      child.rotation.z = smoothLean;
    }
  });
  
  state.opponents.forEach(opp => {
    if (!opp.mesh.visible) return;
    opp.prevT = opp.t;
    opp.t += opp.speed * 0.6 * dt * 60 * (raceStarted ? 1 : 0);
    
    if (opp.t >= 1) {
      opp.t -= 1;
      opp.lap++;
    }
    
    const p = getTrackPoint(opp.t);
    const tan = getTrackTangent(opp.t);
    const nx = -tan.z, nz = tan.x;
    
    opp.mesh.position.set(p.x + nx * opp.offset, 0, p.z + nz * opp.offset);
    opp.mesh.rotation.y = Math.atan2(tan.x, tan.z);
  });
  
  // Dynamic FOV warp effect
  const warpFactor = Math.max(0, (state.speed / state.maxSpeed) - 0.8) * 5 + (state.driftBoost > 1 ? state.driftBoost * 0.5 : 0);
  const targetFov = 50 + warpFactor * 8;
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.1);
  camera.updateProjectionMatrix();
  
  // Speed lines visual
  if (warpFactor > 1.5) {
    speedLinesOverlay.style.opacity = Math.min(1, (warpFactor - 1.5) * 0.5);
  } else {
    speedLinesOverlay.style.opacity = '0';
  }

  const camDist = 12 + warpFactor * 1.5;
  const camHeight = 8 - warpFactor * 0.5;

  // Drift camera: rotate slightly left when drifting
  const driftCamTarget = (state.drifting && state.speed > state.maxSpeed * 0.2) ? 0.25 : 0;
  state._driftCamAngle = THREE.MathUtils.lerp(state._driftCamAngle || 0, driftCamTarget, 0.04);
  const camAngle = state.carAngle + state._driftCamAngle;

  const idealOffset = new THREE.Vector3(
    state.carPos.x - Math.sin(camAngle) * camDist,
    camHeight,
    state.carPos.z - Math.cos(camAngle) * camDist
  );
  
  const idealLookAt = new THREE.Vector3(
    state.carPos.x + Math.sin(camAngle) * 3,
    1,
    state.carPos.z + Math.cos(camAngle) * 3
  );
  
  cameraOffset.lerp(idealOffset, 0.04);
  cameraLookAt.lerp(idealLookAt, 0.06);
  
  if (!debugMode) {
    camera.position.copy(cameraOffset);
  }
  
  if (state.screenShake > 0) {
    const shakeDecay = state.screenShake / 0.4;
    const intensity = state.screenShakeIntensity * shakeDecay;
    const freq = 35;
    const t = performance.now() * 0.001;
    camera.position.x += Math.sin(t * freq) * intensity * 0.7;
    camera.position.y += Math.cos(t * freq * 1.3) * intensity * 0.4;
    camera.position.z += Math.sin(t * freq * 0.9 + 1.5) * intensity * 0.7;
    state.screenShake -= dt;
    if (state.screenShake <= 0) {
      state.screenShake = 0;
      state.screenShakeIntensity = 0;
    }
  }
  
  if (!debugMode) {
    camera.lookAt(cameraLookAt);
  } else {
    orbitControls.update();
  }
  
  sunLight.position.set(state.carPos.x + 40, 60, state.carPos.z + 30);
  sunLight.target.position.set(state.carPos.x, 0, state.carPos.z);
  sunLight.target.updateMatrixWorld();
  
  // Day / Night Cycle Interpolation
  const cycleDuration = 45; // 45 seconds for a full cycle
  const cycleT = (state.totalTime % cycleDuration) / cycleDuration;
  
  const cyclePhases = [
    { t: 0.00, fog: 0x5bc0eb, sun: 0xfffdf0, fill: 0xaee2ff, amb: 0x99aadd, exp: 1.05 }, // Day
    { t: 0.35, fog: 0xff7b54, sun: 0xffd085, fill: 0x8a4b62, amb: 0x6a405a, exp: 0.85 }, // Sunset
    { t: 0.60, fog: 0x120c24, sun: 0x2a2754, fill: 0x541e46, amb: 0x3a3a5c, exp: 0.60 }, // Night
    { t: 1.00, fog: 0x5bc0eb, sun: 0xfffdf0, fill: 0xaee2ff, amb: 0x99aadd, exp: 1.05 }  // Day
  ];
  
  let p1 = cyclePhases[0], p2 = cyclePhases[1];
  for (let i = 0; i < cyclePhases.length - 1; i++) {
    if (cycleT >= cyclePhases[i].t && cycleT <= cyclePhases[i+1].t) {
      p1 = cyclePhases[i];
      p2 = cyclePhases[i+1];
      break;
    }
  }
  
  const localT = (cycleT - p1.t) / (p2.t - p1.t);
  
  const lerpColor = (c1, c2, t) => {
    const r = ((c1 >> 16) & 255) + (((c2 >> 16) & 255) - ((c1 >> 16) & 255)) * t;
    const g = ((c1 >> 8) & 255) + (((c2 >> 8) & 255) - ((c1 >> 8) & 255)) * t;
    const b = (c1 & 255) + ((c2 & 255) - (c1 & 255)) * t;
    return (r << 16) | (g << 8) | b;
  };
  
  const currentFog = lerpColor(p1.fog, p2.fog, localT);
  scene.background.setHex(currentFog);
  scene.fog.color.setHex(currentFog);
  sunLight.color.setHex(lerpColor(p1.sun, p2.sun, localT));
  fillLight.color.setHex(lerpColor(p1.fill, p2.fill, localT));
  ambientLight.color.setHex(lerpColor(p1.amb, p2.amb, localT));
  renderer.toneMappingExposure = p1.exp + (p2.exp - p1.exp) * localT;
  
  // Track lighting glow effect (if applicable)
  const lampEmissive = localT > 0.4 && cycleT > 0.4 && cycleT < 0.9 ? 1.5 : 0.0;
  mat.lampLight.emissiveIntensity = THREE.MathUtils.lerp(mat.lampLight.emissiveIntensity, lampEmissive, 0.05);

  updateParticles(dt);
  updateAudio(state.speed, state.maxSpeed, state.drifting);

  renderer.autoClear = false;
  updateSkidMarks(dt);
  
  const playerT = getClosestTrackT(state.carPos.x, state.carPos.z).t;
  const playerProgress = state.lap + playerT;
  let position = 1;
  state.opponents.forEach(opp => {
    if (opp.mesh.visible && opp.lap + opp.t > playerProgress) position++;
  });
  
  lapDisplay.innerHTML = `<div class="rg-label">LAP</div><div class="rg-value" style="font-size:36px;margin-top:2px;">${state.lap + 1}</div>`;
  
  const timeLeft = state.timeRemaining;
  const timerColor = timeLeft <= 10 ? (Math.floor(timeLeft * 3) % 2 === 0 ? '#ff3333' : '#ff6666') : '#fff';
  const timerGlow = timeLeft <= 10 ? 'text-shadow:0 0 15px rgba(255,50,50,0.6);' : '';
  timerDisplay.innerHTML = `<div class="rg-label">TIME</div><div class="rg-value" style="font-size:36px;color:${timerColor};margin-top:2px;${timerGlow}">${formatTimeFixed(timeLeft)}</div>`;
  
  if (state.showPointsBanked > 0) state.showPointsBanked -= dt;

  pointsDisplay.innerHTML = `<div class="rg-label" style="color:rgba(250,204,21,0.6);">SCORE</div><div class="rg-value" style="font-size:36px;color:#facc15;margin-top:2px;">${Math.round(state.totalPoints).toLocaleString()}</div>`;

  if (state.drifting && state.driftPoints > 5) {
    const mulColor = state.pointsMultiplier >= 4 ? '#ff4400' : state.pointsMultiplier >= 2.5 ? '#ffaa00' : '#ffdd44';
    driftComboDisplay.style.opacity = '1';
    driftComboDisplay.innerHTML = `<div style="font-size:48px;font-weight:900;color:#fff;text-shadow:0 0 20px rgba(255,150,0,0.6);letter-spacing:-1px;">+${Math.round(state.driftPoints * state.pointsMultiplier).toLocaleString()}</div><div style="font-size:16px;font-weight:700;color:${mulColor};margin-top:2px;letter-spacing:1px;">x${state.pointsMultiplier.toFixed(1)} MULTIPLIER</div>`;
  } else if (state.showPointsBanked > 0) {
    driftComboDisplay.style.opacity = String(Math.min(1, state.showPointsBanked * 2));
    if (state.bankedAmount < 0) {
      driftComboDisplay.innerHTML = `<div style="font-size:36px;font-weight:900;color:#ff3333;text-shadow:0 0 20px rgba(255,0,0,0.5);">CRASH!</div><div style="font-size:14px;color:#ff6666;margin-top:4px;">POINTS LOST</div>`;
    } else {
      const graceLeft = Math.max(0, state.driftGracePeriod);
      const graceFraction = state.driftGracePeriod > 0 ? graceLeft / 2.0 : 0;
      const r = Math.round(255 * graceFraction + 68 * (1 - graceFraction));
      const g = Math.round(221 * graceFraction + 255 * (1 - graceFraction));
      const b = Math.round(68 * graceFraction + 136 * (1 - graceFraction));
      const pointsColor = `rgb(${r},${g},${b})`;
      const glowR = Math.round(255 * graceFraction);
      const glowG = Math.round(150 * graceFraction + 255 * (1 - graceFraction));
      const glowB = Math.round(0 * graceFraction + 100 * (1 - graceFraction));
      const glowColor = `rgba(${glowR},${glowG},${glowB},0.4)`;
      const lastLog = state.pointsLog.length > 0 ? state.pointsLog[state.pointsLog.length - 1] : null;
      const sourceIcon = lastLog && lastLog.type === 'lap' ? '🏁' : '⚡';
      const graceBar = graceLeft > 0 ? `<div style="font-size:11px;color:#ffdd44;margin-top:6px;letter-spacing:1px;">⚠ SAFE FOR ${graceLeft.toFixed(1)}s</div>` : '';
      const bankedLabel = graceLeft > 0 ? '' : `<div style="font-size:14px;color:#88ffaa;margin-top:4px;">${sourceIcon} POINTS WON</div>`;
      const pointsNumColor = graceLeft > 0 ? pointsColor : '#44ff88';
      const pointsNumGlow = graceLeft > 0 ? glowColor : 'rgba(0,255,100,0.4)';
      const numIcon = graceLeft > 0 ? `${sourceIcon} ` : '';
      const justBanked = graceLeft <= 0 && state.showPointsBanked > 0 && state.showPointsBanked < 1.6;
      const popScale = justBanked ? 1 + Math.max(0, (state.showPointsBanked - 0.8)) * 0.5 : 1;
      const popStyle = `transform:translate(-50%,-50%) scale(${popScale});transition:transform 0.25s cubic-bezier(0.18,1.4,0.4,1);`;
      driftComboDisplay.style.cssText = `position:absolute;top:40%;left:50%;${popStyle}text-align:center;pointer-events:none;font-family:'Lilita One',sans-serif;opacity:${Math.min(1, state.showPointsBanked * 2)};`;
      driftComboDisplay.innerHTML = `<div style="font-size:36px;font-weight:900;color:${pointsNumColor};text-shadow:0 0 20px ${pointsNumGlow};transition:color 0.15s,text-shadow 0.15s;">${numIcon}+${state.bankedAmount.toLocaleString()}</div>${bankedLabel}${graceBar}`;
    }
  } else {
    driftComboDisplay.style.opacity = '0';
  }

  // Wrong-way HUD
  if (state.wrongWay) {
    const pulse = Math.floor(state.wrongWayTimer * 4) % 2 === 0;
    const remaining = Math.max(0, 2.0 - state.wrongWayTimer);
    wrongWayDisplay.style.opacity = '1';
    wrongWayDisplay.innerHTML = `<div style="font-size:48px;font-weight:900;color:${pulse ? '#ff3333' : '#ff6666'};text-shadow:0 0 30px rgba(255,0,0,0.7);letter-spacing:4px;">⚠ WRONG WAY ⚠</div><div style="font-size:16px;color:#ff8888;margin-top:8px;">Resetting in ${remaining.toFixed(1)}s</div>`;
  } else {
    wrongWayDisplay.style.opacity = '0';
  }

  if (state.crashFlash > 0) {
    state.crashFlash -= dt;
    const flashAlpha = Math.max(0, state.crashFlash / 0.45) * state.crashFlashIntensity;
    const vignetteEl = document.getElementById('crash-vignette');
    const chromL = document.getElementById('chromatic-left');
    const chromR = document.getElementById('chromatic-right');
    vignetteEl.style.opacity = flashAlpha;
    chromL.style.opacity = flashAlpha * 0.8;
    chromR.style.opacity = flashAlpha * 0.8;
    if (state.crashFlash <= 0) {
      state.crashFlash = 0;
      vignetteEl.style.opacity = '0';
      chromL.style.opacity = '0';
      chromR.style.opacity = '0';
    }
  }

  if (state.pointsFlash > 0) {
    state.pointsFlash -= dt;
    const pAlpha = Math.max(0, state.pointsFlash / 0.6) * state.pointsFlashIntensity;
    
    // Scale bump for the score UI
    const scale = 1.0 + pAlpha * 0.4;
    pointsDisplay.style.transform = `translateX(-50%) scale(${scale})`;
    pointsDisplay.style.filter = `drop-shadow(0 0 ${pAlpha * 20}px rgba(250,204,21,1))`;

    if (state.pointsFlash <= 0) {
      state.pointsFlash = 0;
      pointsDisplay.style.transform = 'translateX(-50%) scale(1)';
      pointsDisplay.style.filter = 'none';
    }
  }

  // Update floating texts
  for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
    const ft = state.floatingTexts[i];
    ft.life -= dt * 1.5;
    ft.y += dt * 3; // float upwards
    
    if (ft.life <= 0) {
      ft.el.remove();
      state.floatingTexts.splice(i, 1);
    } else {
      const vec = new THREE.Vector3(ft.x, ft.y, ft.z);
      vec.project(camera);
      // Check if behind camera
      if (vec.z > 1) {
        ft.el.style.opacity = '0';
      } else {
        const sx = (vec.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-(vec.y * 0.5) + 0.5) * window.innerHeight;
        ft.el.style.transform = `translate(-50%,-50%) translate(${sx}px, ${sy}px) scale(${ft.life * 0.5 + 0.5})`;
        ft.el.style.opacity = ft.life;
      }
    }
  }

  drawMinimap();
  updatePointsLog();
  updateFPS();
  
  renderToon();
}

// ============ TOON RENDER FUNCTION ============
function renderToon() {
  // 1. Render depth pass
  renderer.setRenderTarget(depthTarget);
  renderer.render(scene, camera);

  // 2. Render normal pass (override all materials)
  scene.overrideMaterial = normalMat;
  renderer.setRenderTarget(normalTarget);
  renderer.render(scene, camera);
  scene.overrideMaterial = null;

  // 3. Reset render target
  renderer.setRenderTarget(null);

  // 4. Feed depth + normal textures to outline shader
  outlinePass.uniforms.tDepth.value = depthTarget.depthTexture;
  outlinePass.uniforms.tNormal.value = normalTarget.texture;
  outlinePass.uniforms.cameraNear.value = camera.near;
  outlinePass.uniforms.cameraFar.value = camera.far;

  // 5. Render final composited image via EffectComposer
  composer.render();
}

// ============ RESIZE ============
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  depthTarget.setSize(window.innerWidth, window.innerHeight);
  normalTarget.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  outlinePass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
});

function restartGame() {
  if (!state.gameOver) return;
  startLevel(currentLevel);
  updateDiffBtn();
}

function returnToLevelSelect() {
  state.gameOver = true;
  state.speed = 0;
  gameOverOverlay.style.display = 'none';
  // Restart at current difficulty
  startLevel(currentLevel || 2);
  updateDiffBtn();
}

window.addEventListener('keydown', e => {
  if (e.code === 'Enter' && state.gameOver) restartGame();
  if (e.code === 'Escape' && state.gameOver) restartGame();
});
window.addEventListener('touchstart', () => {
  if (state.gameOver) restartGame();
});

// ============ POINTS LOG RENDERER ============
function updatePointsLog() {
  const log = state.pointsLog;
  const recentCount = 8;
  const startIdx = Math.max(0, log.length - recentCount);
  const recent = log.slice(startIdx);

  let html = '';
  recent.forEach((entry, i) => {
    const age = state.totalTime - entry.time;
    const opacity = age < 3 ? 1 : Math.max(0.3, 1 - (age - 3) * 0.15);
    const isNeg = entry.amount < 0 || entry.amount === 0 && entry.type.startsWith('crash');
    const timeStr = formatTime(entry.time);
    let icon, label, color, amtStr;

    if (entry.type === 'drift') {
      icon = '⚡'; label = `DRIFT x${entry.multiplier.toFixed(1)}`; color = '#44ff88';
      amtStr = `+${entry.amount.toLocaleString()}`;
    } else if (entry.type === 'lap') {
      icon = '🏁'; label = `LAP ${entry.lap}`; color = '#44ff88'; amtStr = `+${entry.amount.toLocaleString()}`;
    } else if (entry.type === 'crash_wall') {
      icon = '💥'; label = 'WALL CRASH'; color = '#ff4444'; amtStr = entry.amount === 0 ? '—' : `${entry.amount.toLocaleString()}`;
    } else if (entry.type === 'crash_car') {
      icon = '🚗'; label = 'CAR CRASH'; color = '#ff6644'; amtStr = entry.amount === 0 ? '—' : `${entry.amount.toLocaleString()}`;
    } else if (entry.type === 'coin') {
      icon = '🪙'; label = 'RING'; color = '#ffdd00'; amtStr = `+${entry.amount.toLocaleString()}`;
    } else {
      icon = '•'; label = entry.type; color = '#fff'; amtStr = `${entry.amount}`;
    }

    const isNew = age < 0.8;
    const animStyle = isNew ? 'animation:logSlide 0.3s ease-out;' : '';

    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 10px;margin-bottom:3px;border-radius:6px;background:rgba(0,0,0,0.55);border:1px solid ${isNeg ? 'rgba(255,60,60,0.25)' : 'rgba(255,255,255,0.08)'};opacity:${opacity};font-size:12px;color:#ccc;${animStyle}backdrop-filter:blur(4px);">
      <div style="display:flex;align-items:center;gap:5px;">
        <span style="font-size:13px;">${icon}</span>
        <span style="color:${color};font-weight:700;font-size:11px;">${label}</span>
      </div>
      <div style="font-weight:800;color:${color};font-size:13px;font-variant-numeric:tabular-nums;">${amtStr}</div>
    </div>`;
  });

  pointsLogPanel.innerHTML = html;
}

const logStyle = document.createElement('style');
logStyle.textContent = `@keyframes logSlide { from { transform: translateX(30px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
document.head.appendChild(logStyle);

cameraOffset.set(state.carPos.x, 8, state.carPos.z - 12);
cameraLookAt.set(state.carPos.x, 1, state.carPos.z);

// Auto-start on medium difficulty (after all HUD elements are created)
startLevel(2);
updateDiffBtn();

// Use setAnimationLoop for WebGPU renderer
renderer.setAnimationLoop(animate);