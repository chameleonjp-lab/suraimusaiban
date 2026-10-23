/** Deterministic inspection harness; not imported by the application. */
import * as THREE from "three";
import { createSlime } from "./slime";
import { createCourtroom } from "./courtroom";
const canvas = document.querySelector("canvas")!;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#efedea");
const camera = new THREE.PerspectiveCamera(
  34,
  innerWidth / innerHeight,
  0.1,
  30,
);
const rig = createSlime(
  new URLSearchParams(location.search).get("quality") === "low"
    ? "low"
    : "standard",
);
scene.add(rig.root);
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64),
  new THREE.MeshBasicMaterial({
    color: "#9290b0",
    transparent: true,
    opacity: 0.18,
  }),
);
shadow.rotation.x = -Math.PI / 2;
shadow.scale.set(1.28, 0.8, 1);
shadow.position.y = 0.01;
scene.add(shadow);
let angle = 0,
  animation = false,
  start = 0;
function render() {
  camera.position.set(Math.sin(angle) * 7.3, 2.2, Math.cos(angle) * 7.3);
  camera.lookAt(0.1, 1.35, 0);
  renderer.render(scene, camera);
}
function tick(now: number) {
  if (animation) {
    if (!start) start = now;
    rig.update(1 / 60, (now - start) / 1000, false);
    render();
  }
  requestAnimationFrame(tick);
}
const qa = {
  setAngle(value: number) {
    angle = value;
    render();
  },
  setTime(value: number) {
    rig.update(1 / 60, value, false);
    render();
  },
  animate(value: boolean) {
    animation = value;
    start = 0;
  },
  transparency(value: boolean) {
    rig.root.traverse((node) => {
      if (
        node instanceof THREE.Mesh &&
        node.material instanceof THREE.ShaderMaterial &&
        node.material.uniforms.uAlpha
      ) {
        node.material.uniforms.uAlpha.value = value ? 0.72 : 1;
        node.material.transparent = value;
        node.material.depthWrite = !value;
        node.material.needsUpdate = true;
      }
    });
    render();
  },
  info() {
    return {
      triangles: renderer.info.render.triangles,
      calls: renderer.info.render.calls,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length,
      pixelRatio: renderer.getPixelRatio(),
      width: canvas.width,
      height: canvas.height,
    };
  },
  courtroom() {
    scene.add(createCourtroom());
    scene.add(new THREE.AmbientLight("#fff5e2", 2));
    const light = new THREE.DirectionalLight("#fff1d7", 3);
    light.position.set(-3, 7, 5);
    scene.add(light);
    rig.root.scale.setScalar(0.78);
    rig.root.position.set(0, 0.18, 0.51);
    camera.position.set(5.4, 3.7, 9.4);
    camera.lookAt(0, 1.15, -0.25);
    renderer.render(scene, camera);
  },
  dataURL() {
    render();
    return canvas.toDataURL("image/webp", 0.94);
  },
};
(window as unknown as { sceneQA: typeof qa }).sceneQA = qa;
render();
requestAnimationFrame(tick);
