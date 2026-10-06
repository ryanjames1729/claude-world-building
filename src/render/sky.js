import * as THREE from 'three';
import { U, GLSL_COMMON } from './common.js';
import { elevToY, HALF_EXTENT_M } from '../geo.js';

export function createSky() {
  const uniforms = { ...U, uCloud: { value: 0.3 }, uStorm: { value: 0 }, uSunElev: { value: 0.5 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uFogColor; uniform float uCloud, uStorm, uSunElev, uFlash, uNight, uTime;
      varying vec3 vDir;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vDir);
        float up = clamp(d.y, -0.1, 1.);
        float day = smoothstep(-.12, .2, uSunElev);
        float dusk = smoothstep(.35, 0., abs(uSunElev - .02)) ;
        vec3 zenith = mix(vec3(.01,.015,.04), vec3(.18,.36,.68), day);
        vec3 horizon = mix(vec3(.04,.05,.09), vec3(.62,.74,.88), day);
        horizon = mix(horizon, vec3(.95,.55,.3), dusk * .7 * smoothstep(-.2, .9, dot(normalize(d.xz + 1e-4), normalize(uSunDir.xz + 1e-4))));
        vec3 col = mix(horizon, zenith, pow(max(up, 0.), .55));
        float sd = max(dot(d, uSunDir), 0.);
        col += vec3(1., .85, .6) * (pow(sd, 900.) * 6. + pow(sd, 12.) * .25) * day * (1. - uCloud * .95);
        // stars
        float star = step(.9975, h(floor(d * 400.))) * (1. - day) * (1. - uCloud);
        col += vec3(star);
        // overcast
        vec3 grey = mix(vec3(.05,.055,.06), vec3(.55,.57,.6) - uStorm * .25, day);
        col = mix(col, grey, smoothstep(.35, .95, uCloud));
        col = mix(col, uFogColor, smoothstep(.12, -.05, d.y));
        col += vec3(.7,.75,1.) * uFlash * .9;
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 32, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return { mesh: sky, uniforms };
}

function cloudMaterial(layer) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uCover: { value: 0.4 }, uDark: { value: 0 }, uOffset: { value: new THREE.Vector2() }, uLayer: { value: layer } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vPos; void main(){ vPos = (modelMatrix * vec4(position,1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos,1.); }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      uniform float uCover, uDark, uLayer; uniform vec2 uOffset;
      varying vec3 vPos;
      void main(){
        vec2 p = (vPos.xz + uOffset) * (uLayer > .5 ? .00045 : .00025);
        float n = fbm(p) * .65 + fbm(p * 3.1 + 5.) * .35;
        float thresh = 1. - uCover;
        float a = smoothstep(thresh - .08, thresh + .22, n + uCover * .25);
        a *= uCover > .02 ? 1. : 0.;
        float edge = smoothstep(${(HALF_EXTENT_M * 2.6).toFixed(1)}, ${(HALF_EXTENT_M * 1.2).toFixed(1)}, length(vPos.xz));
        // fade when the camera flies close to the layer
        float camNear = smoothstep(60., 600., abs(cameraPosition.y - vPos.y));
        a *= edge * mix(.35, 1., camNear);
        // looking down from above the deck: thin it out so the ground stays visible
        a *= mix(1., uLayer > .5 ? .22 : .35, smoothstep(40., 400., cameraPosition.y - vPos.y));
        float lightSide = cameraPosition.y > vPos.y ? 1. : .55;
        vec3 base = mix(vec3(.95), vec3(.38,.40,.44), uDark) * lightSide;
        vec3 col = base * (uSunColor * .55 + uSkyAmb * .9) + uFlash * vec3(.8,.85,1.);
        col = mix(col, uFogColor, .25);
        gl_FragColor = vec4(col, a * (uLayer > .5 ? .92 : .85));
      }`,
  });
}

export function createClouds() {
  const geo = new THREE.PlaneGeometry(HALF_EXTENT_M * 6, HALF_EXTENT_M * 6, 1, 1).rotateX(-Math.PI / 2);
  const high = new THREE.Mesh(geo, cloudMaterial(0));
  const low = new THREE.Mesh(geo, cloudMaterial(1));
  high.renderOrder = 5; low.renderOrder = 6;
  const group = new THREE.Group();
  group.add(high, low);
  const off = new THREE.Vector2();
  return {
    group, high, low,
    update(wx, dtReal, simDtH, enabled) {
      // drift clouds with the wind (direction is where wind comes FROM)
      const dir = (wx.windDir + 180) * Math.PI / 180;
      const spd = 4 + wx.windMs * 1.2;
      off.x -= Math.sin(dir) * spd * simDtH * 60;
      off.y += Math.cos(dir) * spd * simDtH * 60;
      const storm = Math.min(1, wx.precip / 6);
      high.material.uniforms.uOffset.value.copy(off);
      low.material.uniforms.uOffset.value.set(off.x * 1.4, off.y * 1.4);
      high.material.uniforms.uCover.value = wx.cloud;
      high.material.uniforms.uDark.value = Math.min(1, storm * 1.3 + wx.cloud * .25);
      // low scud clouds wrap the ridges in heavy precipitation (as during Helene)
      low.material.uniforms.uCover.value = Math.min(0.92, Math.max(0, (wx.precip - 0.6) / 6) + wx.thunder * .3);
      low.material.uniforms.uDark.value = Math.min(1, 0.4 + storm);
      high.position.y = elevToY(1900 - storm * 300);
      low.position.y = elevToY(1080 - storm * 120);
      group.visible = enabled;
    },
  };
}

/** A soft "sea of fog" sheet at the top of valley fog — gives the classic view of ridges above the clouds. */
export function createFogSheet() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U },
    transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vPos; void main(){ vPos = (modelMatrix * vec4(position,1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos,1.); }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      varying vec3 vPos;
      void main(){
        float n = fbm(vPos.xz * .0009 + vec2(uTime * .004, 0.));
        float a = uValleyFog * smoothstep(.25, .6, n + uValleyFog * .35) * .9;
        a *= smoothstep(${(HALF_EXTENT_M * 1.05).toFixed(1)}, ${(HALF_EXTENT_M * .85).toFixed(1)}, max(abs(vPos.x), abs(vPos.z)));
        vec3 col = vec3(.93,.94,.96) * (uSunColor * .6 + uSkyAmb * .8);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(HALF_EXTENT_M * 2, HALF_EXTENT_M * 2).rotateX(-Math.PI / 2), mat);
  mesh.renderOrder = 4;
  return mesh;
}
