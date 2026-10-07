import * as THREE from 'three';
import { U, GLSL_COMMON, VEX_GLSL } from './common.js';

/** River & flood water: per vertex, water surface = nearest-drainage elevation + current river stage (HAND method). */
export function waterMaterial(hole = 0) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uHole: { value: hole } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    vertexShader: /* glsl */`
      attribute float aHand; attribute float aDrainElev; attribute float aClass;
      ${VEX_GLSL}
      uniform vec4 uStages;
      varying vec3 vPos; varying float vDepth; varying float vClass; varying float vElev;
      float stageFor(float c){ return c < .5 ? uStages.x : c < 1.5 ? uStages.y : c < 2.5 ? uStages.z : uStages.w; }
      void main(){
        float vx = vexAt(position.xz);
        float ground = position.y / vx + uBaseElev;
        // depth = river stage minus height above the nearest channel (aHand already includes bank height)
        vDepth = stageFor(aClass) - aHand;
        float water = ground + vDepth;
        vClass = aClass;
        float y = vDepth > 0. ? (water - uBaseElev) * vx : position.y - 2.;
        vElev = max(ground, water);
        vPos = (modelMatrix * vec4(position.x, y, position.z, 1.)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      uniform float uHole;
      varying vec3 vPos; varying float vDepth; varying float vClass; varying float vElev;
      void main(){
        if (vDepth < .04) discard;
        if (max(abs(vPos.x), abs(vPos.z)) < uHole) discard; // the detailed core draws its own water
        float rise = riseFor(vClass);
        // ripples flowing with the wind and the current
        vec2 p = vPos.xz * .012;
        float t = uTime;
        float r1 = vnoise(p + vec2(t * .15, t * .06)), r2 = vnoise(p * 2.1 - vec2(t * .08, t * .17));
        float amp = .12 + .06 * uWindStrength;
        vec3 n = normalize(vec3((r1 - .5) * amp, 1., (r2 - .5) * amp));
        vec3 clear = vec3(.10,.20,.22);
        vec3 muddy = vec3(.52,.42,.29);
        float mud = clamp(rise * .45 + uWet * .3, 0., 1.);
        vec3 col = mix(clear, muddy, mud);
        // floodwater over land looks shallower/browner at the edges
        col = mix(col, muddy * 1.1, smoothstep(1.5, .1, vDepth) * mud);
        vec3 viewDir = normalize(cameraPosition - vPos);
        vec3 lit = lighting(n, col, 80., .6 * (1. - mud * .6), viewDir);
        // sky reflection (stronger at grazing angles) makes water read as water even under grey skies
        float fres = pow(1. - max(dot(n, viewDir), 0.), 3.);
        lit = mix(lit, uFogColor * 1.05 + uSkyAmb * .15, (.1 + fres * .4) * (1. - mud * .5));
        // streaks of foam on fast, high water
        vec2 fp = vec2(vPos.x * .02 + t * .8, vPos.z * .06);
        float foam = smoothstep(.72, .9, vnoise(fp) * .6 + vnoise(fp * 3.7) * .4) * smoothstep(2., 5., rise);
        lit = mix(lit, vec3(.8,.76,.68), foam * .25);
        float a = clamp(vDepth * 2.2, 0., .92);
        gl_FragColor = vec4(applyFog(lit, vPos, vElev), a);
      }`,
  });
}
