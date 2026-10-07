// Uniforms shared by every custom material, plus reusable GLSL snippets.
import * as THREE from 'three';
import { BANDS, BAND_ELEV0, BAND_STEP } from '../sim/engine.js';
import { BASE_ELEV, VEX, VEX_NEAR, VEX_R0, VEX_R1, RADIUS_M } from '../geo.js';

export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
  uSkyAmb: { value: new THREE.Color(0.45, 0.5, 0.6) },
  uGroundAmb: { value: new THREE.Color(0.25, 0.22, 0.2) },
  uFogColor: { value: new THREE.Color(0.7, 0.75, 0.82) },
  uFogDensity: { value: 0.00003 },
  uValleyFog: { value: 0 },
  uValleyFogTop: { value: 700 },
  uSnow: { value: new Float32Array(BANDS) },
  uIce: { value: new Float32Array(BANDS) },
  uBand0: { value: BAND_ELEV0 },
  uBandStep: { value: BAND_STEP },
  uBaseElev: { value: BASE_ELEV },
  uVexTaper: { value: new THREE.Vector4(VEX_NEAR, VEX, VEX_R0, VEX_R1) },
  uWet: { value: 0 },
  uDoy: { value: 180 },       // day of year drives leaf-out, fall color and leaf drop (shifted by elevation)
  uStages: { value: new THREE.Vector4(0.3, 0.8, 1.4, 1.8) },
  uPeakStages: { value: new THREE.Vector4(0, 0, 0, 0) },
  uRise: { value: new THREE.Vector4(0, 0, 0, 0) },
  uFlash: { value: 0 },
  uNight: { value: 0 },
  uPowerOut: { value: 0 },
  uWind: { value: new THREE.Vector2(1, 0) },
  uWindStrength: { value: 0.2 },
  uRadius: { value: RADIUS_M },
  uShowRing: { value: 1 },
  uRoadIce: { value: 0 },
  uRoadStatus: { value: 0 },
  uTreesDown: { value: 0 },
};

export const GLSL_COMMON = /* glsl */`
uniform float uTime, uFogDensity, uValleyFog, uValleyFogTop, uBand0, uBandStep, uBaseElev, uWet,
  uDoy, uFlash, uNight, uPowerOut, uWindStrength, uRadius, uShowRing, uRoadIce, uRoadStatus, uTreesDown;
uniform vec3 uSunDir, uSunColor, uSkyAmb, uGroundAmb, uFogColor;
uniform float uSnow[${BANDS}];
uniform float uIce[${BANDS}];
uniform vec4 uStages, uPeakStages, uRise;
uniform vec2 uWind;

uniform vec4 uVexTaper;
float vexAt(vec2 p){ return mix(uVexTaper.x, uVexTaper.y, smoothstep(uVexTaper.z, uVexTaper.w, length(p))); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= .5; } return s; }

float bandLookup(float arr[${BANDS}], float e){
  float f = clamp((e - uBand0) / uBandStep, 0., ${BANDS - 1}.);
  int i = int(floor(f)); float t = f - floor(f);
  float a = 0., b = 0.;
  for (int k = 0; k < ${BANDS}; k++) { if (k == i) a = arr[k]; if (k == i + 1) b = arr[k]; }
  if (i >= ${BANDS - 1}) b = a;
  return mix(a, b, t);
}
// Seasons in the mountains: spring green-up climbs the slopes (~3 days per 100 m), fall color comes down from the ridges.
float seasonShift(float e){ return (e - 650.) * .03; }
float leafAt(float e){ float ds = uDoy - seasonShift(e), df = uDoy + seasonShift(e);
  return min(smoothstep(100., 128., ds), 1. - smoothstep(300., 322., df)); }
float fallAt(float e){ float df = uDoy + seasonShift(e); return smoothstep(272., 298., df) * step(df, 340.); }
float springAt(float e){ float ds = uDoy - seasonShift(e); return smoothstep(95., 112., ds) * (1. - smoothstep(130., 165., ds)); }
float snowAt(float e){ return bandLookup(uSnow, e); }
float iceAt(float e){ return bandLookup(uIce, e); }
float stageFor(float c){ return c < .5 ? uStages.x : c < 1.5 ? uStages.y : c < 2.5 ? uStages.z : uStages.w; }
float peakFor(float c){ return c < .5 ? uPeakStages.x : c < 1.5 ? uPeakStages.y : c < 2.5 ? uPeakStages.z : uPeakStages.w; }
float riseFor(float c){ return c < .5 ? uRise.x : c < 1.5 ? uRise.y : c < 2.5 ? uRise.z : uRise.w; }

vec3 lighting(vec3 n, vec3 albedo, float shininess, float spec, vec3 viewDir){
  float d = max(dot(n, uSunDir), 0.);
  vec3 amb = mix(uGroundAmb, uSkyAmb, n.y * .5 + .5);
  vec3 h = normalize(uSunDir + viewDir);
  float s = pow(max(dot(n, h), 0.), shininess) * spec;
  return albedo * (amb + uSunColor * d) + uSunColor * s + albedo * uFlash * 1.5;
}

vec3 applyFog(vec3 col, vec3 worldPos, float elev){
  float dist = length(worldPos - cameraPosition);
  // haze sits in the lowest few km of air: looking down from high up, most of the path is clear
  float lowAir = clamp(3000. / (abs(cameraPosition.y - worldPos.y) + 1.), .07, 1.);
  float fogAmt = 1. - exp(-pow(uFogDensity * dist * lowAir, 1.15));
  // valley (radiation) fog: dense below the fog top, feathered edge, a little texture
  float vf = uValleyFog * smoothstep(uValleyFogTop + 25., uValleyFogTop - 35., elev + (fbm(worldPos.xz * .0012 + uTime * .01) - .5) * 50.);
  fogAmt = max(fogAmt, vf * (1. - exp(-dist * .004)));
  return mix(col, uFogColor, clamp(fogAmt, 0., 1.));
}
`;

/** For vertex shaders that don't include GLSL_COMMON: local exaggeration and true elevation from world y. */
export const VEX_GLSL = /* glsl */`
uniform float uBaseElev; uniform vec4 uVexTaper;
float vexAt(vec2 p){ return mix(uVexTaper.x, uVexTaper.y, smoothstep(uVexTaper.z, uVexTaper.w, length(p))); }
float elevFromY(float y, vec2 xz){ return y / vexAt(xz) + uBaseElev; }`;
