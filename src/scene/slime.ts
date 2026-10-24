import * as THREE from "three";

export type SceneQuality = "standard" | "low";
export type SlimeRig = {
  root: THREE.Group;
  update(
    dtSeconds: number,
    elapsedSeconds: number,
    reducedMotion: boolean,
  ): void;
  dispose(): void;
};

/** A resumed tab must not feed a large jump into the neutral animation clock. */
export function clampFrameDelta(dt: number): number {
  return Number.isFinite(dt) ? Math.max(0, Math.min(0.05, dt)) : 0;
}

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec3 vLocal;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vLocal = position;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;
const fragmentShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec3 vLocal;
  uniform float uAlpha;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 lightDir = normalize(vec3(-0.65, 1.2, 0.8));
    float light = dot(n, lightDir);
    vec3 shadow = vec3(0.30, 0.35, 0.73);
    vec3 middle = vec3(0.55, 0.65, 0.96);
    vec3 pale = vec3(0.78, 0.87, 1.0);
    vec3 color = mix(shadow, middle, smoothstep(-0.20, -0.10, light));
    color = mix(color, pale, smoothstep(0.48, 0.57, light));
    float facing = max(dot(n, viewDir), 0.0);
    float rim = 1.0 - facing;
    color = mix(color, vec3(0.30, 0.29, 0.83), smoothstep(0.70, 0.98, rim) * 0.80);
    color += vec3(0.09, 0.12, 0.16) * pow(rim, 3.0);
    // Low contrast liquid bands evoke the reference's pearly internal flow.
    float flow = sin(vLocal.y * 7.0 + sin(vLocal.x * 3.0 + vLocal.z * 2.5) * 1.4);
    color = mix(color, pale, smoothstep(0.91, 0.99, flow) * 0.22 * facing);
    vec3 halfDir = normalize(lightDir + viewDir);
    float gleam = pow(max(dot(n, halfDir), 0.0), 65.0);
    color = mix(color, vec3(1.0), smoothstep(0.24, 0.53, gleam) * 0.96);
    float smallGleam = pow(max(dot(n, normalize(vec3(0.8, 0.4, 1.3) + viewDir)), 0.0), 150.0);
    color = mix(color, vec3(0.97, 1.0, 1.0), smoothstep(0.4, 0.68, smallGleam) * 0.65);
    gl_FragColor = vec4(color, uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function slimeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uAlpha: { value: 1 } },
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true,
  });
}

/** Rings close at the poles; the broad lower half has a gently irregular skirt. */
function bodyGeometry(radial: number, rows: number): THREE.BufferGeometry {
  const positions: number[] = [],
    indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const theta = (row / rows) * Math.PI;
    const h = (1 - Math.cos(theta)) / 2;
    const r = Math.pow(Math.sin(theta), 0.78) * (1.18 - h * 0.3);
    for (let col = 0; col <= radial; col++) {
      const a = (col / radial) * Math.PI * 2;
      const skirt = (1 - h) ** 5;
      const ripple = 1 + 0.045 * Math.sin(a * 3 + 0.5) * skirt;
      positions.push(
        -0.16 + r * Math.cos(a) * ripple + 0.16 * h * h,
        0.025 +
          1.76 * Math.pow(h, 1.5) +
          0.025 * Math.sin(a * 3) * Math.sin(theta) * skirt,
        r * Math.sin(a) * 0.77 - 0.06 * h,
      );
      if (row < rows && col < radial) {
        const i = row * (radial + 1) + col;
        indices.push(
          i,
          i + radial + 1,
          i + 1,
          i + 1,
          i + radial + 1,
          i + radial + 2,
        );
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A tapered, fully volumetric sweep, including end caps, for liquid curls. */
function liquidSweep(
  points: number[][],
  radii: number[],
  segments: number,
  sides: number,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...(p as [number, number, number]))),
    false,
    "catmullrom",
    0.5,
  );
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [],
    indices: number[] = [];
  for (let ring = 0; ring <= segments; ring++) {
    const t = ring / segments;
    const point = curve.getPointAt(t);
    const rAt = t * (radii.length - 1);
    const ri = Math.min(radii.length - 2, Math.floor(rAt));
    const radius = THREE.MathUtils.lerp(radii[ri], radii[ri + 1], rAt - ri);
    for (let side = 0; side <= sides; side++) {
      const a = (side / sides) * Math.PI * 2;
      const v = point
        .clone()
        .addScaledVector(frames.normals[ring], Math.cos(a) * radius)
        .addScaledVector(frames.binormals[ring], Math.sin(a) * radius * 0.78);
      positions.push(v.x, Math.max(0.028, v.y), v.z);
      if (ring < segments && side < sides) {
        const i = ring * (sides + 1) + side;
        indices.push(
          i,
          i + 1,
          i + sides + 1,
          i + 1,
          i + sides + 2,
          i + sides + 1,
        );
      }
    }
  }
  for (const ring of [0, segments]) {
    const p = curve.getPointAt(ring / segments);
    const center = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    for (let s = 0; s < sides; s++) {
      const i = ring * (sides + 1) + s;
      if (ring === 0) indices.push(center, i + 1, i);
      else indices.push(center, i, i + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function eyeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv;
      void main(){
        vec3 c = mix(vec3(0.17,0.18,0.62), vec3(0.035,0.018,0.11), smoothstep(0.1,0.8,vUv.y));
        float shine = 1.0-smoothstep(0.02,0.065,length((vUv-vec2(0.33,0.78))*vec2(1.0,0.7)));
        c = mix(c,vec3(0.94,0.96,1.0),shine*0.88);
        float reflection = 1.0-smoothstep(0.02,0.24,length((vUv-vec2(0.55,0.17))*vec2(1.0,1.7)));
        c += vec3(0.10,0.15,0.26)*reflection;
        gl_FragColor = vec4(c,1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

// Eye patches follow the body's front surface; back-face culling and body depth
// naturally conceal them from rear views, without view-dependent visibility hacks.
function eyeGeometry(xCenter: number): THREE.BufferGeometry {
  const geometry = new THREE.CircleGeometry(1, 36);
  const attribute = geometry.getAttribute("position");
  for (let i = 0; i < attribute.count; i++) {
    const x = xCenter + attribute.getX(i) * 0.135;
    const y = 1.03 + attribute.getY(i) * 0.265;
    const h = Math.pow((y - 0.025) / 1.76, 1 / 1.5);
    const theta = Math.acos(1 - 2 * h);
    const r = Math.pow(Math.sin(theta), 0.78) * (1.18 - h * 0.3);
    const cx = -0.16 + 0.16 * h * h;
    const z = Math.sqrt(Math.max(0, r * r - (x - cx) ** 2)) * 0.77 - 0.06 * h;
    attribute.setXYZ(i, x - xCenter, y - 1.03, z + 0.018 - 0.7);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function createSlime(quality: SceneQuality): SlimeRig {
  const root = new THREE.Group();
  root.name = "slime";
  const bodyGroup = new THREE.Group();
  bodyGroup.name = "liquid-body";
  root.add(bodyGroup);
  const standard = quality === "standard";
  const surface = slimeMaterial();
  const body = new THREE.Mesh(
    bodyGeometry(standard ? 64 : 36, standard ? 40 : 24),
    surface,
  );
  body.name = "body";
  bodyGroup.add(body);
  const crest = new THREE.Mesh(
    liquidSweep(
      [
        [0.28, 1.46, -0.1],
        [0.58, 1.89, -0.13],
        [0.42, 2.12, -0.1],
        [0.05, 2.31, -0.08],
        [0.28, 2.55, -0.07],
        [0.65, 2.61, -0.09],
        [0.93, 2.64, -0.1],
        [1.09, 2.43, -0.09],
        [0.99, 2.25, -0.06],
        [0.82, 2.28, -0.05],
        [0.86, 2.36, -0.04],
      ],
      [0.39, 0.3, 0.25, 0.23, 0.2, 0.18, 0.14, 0.105, 0.065, 0.032, 0.004],
      standard ? 86 : 52,
      standard ? 16 : 10,
    ),
    surface,
  );
  crest.name = "crest";
  bodyGroup.add(crest);
  const tail = new THREE.Mesh(
    liquidSweep(
      [
        [0.15, 0.55, -0.1],
        [0.75, 0.25, -0.47],
        [1.22, 0.24, -0.74],
        [1.44, 0.54, -0.87],
        [1.64, 0.68, -0.91],
        [1.63, 0.89, -0.95],
        [1.47, 0.99, -0.94],
        [1.43, 0.91, -0.93],
      ],
      [0.32, 0.29, 0.23, 0.19, 0.13, 0.09, 0.05, 0.003],
      standard ? 54 : 32,
      standard ? 14 : 10,
    ),
    surface,
  );
  tail.name = "rear-flow";
  bodyGroup.add(tail);
  const lowerFlow = new THREE.Mesh(
    liquidSweep(
      [
        [0.12, 0.3, -0.08],
        [0.87, 0.14, -0.32],
        [1.26, 0.13, -0.55],
        [1.54, 0.25, -0.61],
        [1.59, 0.39, -0.61],
      ],
      [0.24, 0.2, 0.16, 0.09, 0.004],
      standard ? 32 : 20,
      10,
    ),
    surface,
  );
  lowerFlow.name = "skirt";
  bodyGroup.add(lowerFlow);
  const eyes = eyeMaterial();
  for (const [index, x] of [-0.47, 0.16].entries()) {
    const eye = new THREE.Mesh(eyeGeometry(x), eyes);
    eye.name = `eye-${index}`;
    eye.position.set(x, 1.03, 0.7);
    bodyGroup.add(eye);
  }
  const drops: THREE.Mesh[] = [];
  for (const [index, p] of [
    [-1.37, 1.57, 0.02],
    [1.37, 1.57, -0.06],
    [-1.48, 0.51, 0.1],
  ].entries()) {
    const drop = new THREE.Mesh(
      new THREE.SphereGeometry(1, standard ? 20 : 12, standard ? 14 : 8),
      surface,
    );
    drop.name = `droplet-${index}`;
    drop.position.set(...(p as [number, number, number]));
    drop.scale.set(index === 1 ? 0.15 : 0.115, index === 0 ? 0.21 : 0.15, 0.12);
    drop.rotation.z = index === 0 ? -0.55 : 0.3;
    root.add(drop);
    drops.push(drop);
  }
  const dropY = drops.map((d) => d.position.y);
  let disposed = false;
  function applyPose(t: number) {
    const wave = Math.sin((t * Math.PI * 2) / 5.2);
    bodyGroup.scale.set(1 - wave * 0.035, 1 + wave * 0.055, 1 - wave * 0.025);
    bodyGroup.rotation.y = Math.sin(t * 0.73) * 0.025;
    crest.rotation.y = Math.sin(t * 0.91) * 0.06;
    tail.rotation.y = Math.sin(t * 1.01 - 0.7) * 0.055;
    drops.forEach((d, i) => {
      d.position.y = dropY[i] + Math.sin(t * 1.3 + i * 1.8) * 0.085;
      d.rotation.y = Math.sin(t * 0.8 + i) * 0.16;
    });
  }
  applyPose(0);
  return {
    root,
    update(dt, elapsed, reducedMotion) {
      if (disposed) return;
      if (reducedMotion) applyPose(0);
      else if (clampFrameDelta(dt) > 0)
        applyPose(Number.isFinite(elapsed) ? elapsed : 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.traverse((node) => {
        if (node instanceof THREE.Mesh) node.geometry.dispose();
      });
      surface.dispose();
      eyes.dispose();
      root.clear();
    },
  };
}
