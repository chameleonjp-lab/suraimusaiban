import * as THREE from 'three';
import { clampFrameDelta, createSlime, type SceneQuality } from './slime';
import { createCourtroom } from './courtroom';
import { createFrameMonitor } from './frame-budget';
export { createSlime, createCourtroom };
export type { SlimeRig, SceneQuality } from './slime';

export type SceneHandle = {
  setView(view: 'home' | 'trial' | 'still'): void;
  setReducedMotion(value: boolean): void;
  dispose(): void;
};

/** Owns the complete renderer lifecycle. No ballot/result state enters this API. */
export function mountScene(canvas: HTMLCanvasElement, onUnavailable: () => void): SceneHandle {
  let disposed = false, failed = false;
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene | undefined;
  let animationId = 0, previousFrame = 0, elapsed = 0;
  let inView = true, reducedMotion = false;
  let view: 'home' | 'trial' | 'still' = 'home';
  let quality: SceneQuality = 'standard';
  const frameBudget = createFrameMonitor();
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = media.matches;
  let observer: IntersectionObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let disposeRig = () => {};
  let tickRig = (_dt: number, _elapsed: number, _reduced: boolean) => {};
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
  const canAnimate = () => !disposed && !failed && !document.hidden && inView && !reducedMotion && view !== 'still';
  function cancelFrame() { if (animationId) cancelAnimationFrame(animationId); animationId = 0; previousFrame = 0; }
  function releaseScene() {
    if (!scene) return;
    // The rig releases its own resources and removes its mesh children first.
    disposeRig();
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    scene.traverse(node => {
      if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
        geometries.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          materials.add(material);
          if ('gradientMap' in material && material.gradientMap instanceof THREE.Texture) textures.add(material.gradientMap);
        }
      }
      for (const texture of node.userData.ownedTextures ?? []) textures.add(texture);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    scene.clear(); scene = undefined;
  }
  function fail() {
    if (failed || disposed) return;
    failed = true; cancelFrame();
    canvas.dataset.sceneState = 'unavailable';
    observer?.disconnect(); resizeObserver?.disconnect();
    releaseScene(); renderer?.dispose();
    onUnavailable();
  }
  function render() {
    if (disposed || failed || !renderer || !scene || document.hidden || !inView) return;
    try { renderer.render(scene, camera); } catch { fail(); }
  }
  function frame(now: number) {
    animationId = 0;
    if (!canAnimate()) return;
    const rawDt = previousFrame ? (now - previousFrame) / 1000 : 1 / 60;
    if (frameBudget.record(rawDt) && renderer && renderer.getPixelRatio() > 1) {
      renderer.setPixelRatio(1); quality = 'low'; canvas.dataset.sceneQuality = quality;
      resize();
    }
    const dt = clampFrameDelta(rawDt);
    previousFrame = now; elapsed += dt; tickRig(dt, elapsed, false); render();
    if (canAnimate()) animationId = requestAnimationFrame(frame);
  }
  function reconcile() {
    cancelFrame();
    tickRig(0, elapsed, reducedMotion);
    render();
    if (canAnimate()) animationId = requestAnimationFrame(frame);
  }
  function resize() {
    if (!renderer || failed || disposed) return;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    camera.aspect = w / h;
    // A vertical frame brings the subject forward; a wide frame includes both desks.
    const portrait = camera.aspect < 1.1;
    camera.position.set(portrait ? 4.4 : 5.4, portrait ? 3.2 : 3.7, portrait ? 8.4 : 9.4);
    if (view === 'trial') camera.position.set(portrait ? 3.5 : 4.5, 3.0, portrait ? 7.7 : 8.5);
    const target = new THREE.Vector3(0, 1.15, -0.25);
    camera.lookAt(target);
    renderer.setSize(w, h, false); camera.updateProjectionMatrix(); render();
  }
  const visibilityChanged = () => reconcile();
  const mediaChanged = (event: MediaQueryListEvent) => { reducedMotion = event.matches; reconcile(); };
  const contextLost = (event: Event) => { event.preventDefault(); fail(); };
  canvas.addEventListener('webglcontextlost', contextLost);
  document.addEventListener('visibilitychange', visibilityChanged);
  media.addEventListener('change', mediaChanged);
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
    quality = (navigator.hardwareConcurrency || 4) <= 4 || window.devicePixelRatio > 2 ? 'low' : 'standard';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'standard' ? 1.5 : 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor('#d9d2c2');
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#d9d2c2');
    scene.fog = new THREE.Fog('#d9d2c2', 14, 24);
    scene.add(new THREE.AmbientLight('#fff5e2', 2.0));
    const light = new THREE.DirectionalLight('#fff1d7', 3.0); light.position.set(-3, 7, 5); scene.add(light);
    scene.add(createCourtroom());
    const rig = createSlime(quality); rig.root.scale.setScalar(0.78); rig.root.position.set(0, 0.18, 0.51); scene.add(rig.root);
    disposeRig = rig.dispose; tickRig = rig.update;
    // Transparent ellipses produce a soft contact shadow without a shadow-map pass.
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: '#66637e', transparent: true, opacity: 0.16, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.scale.set(0.97, 0.73, 1); shadow.position.set(-0.08, 0.204, 0.53); scene.add(shadow);
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? true; reconcile(); }, { threshold: 0.01 }); observer.observe(canvas);
    }
    if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas); }
    window.addEventListener('resize', resize);
    canvas.dataset.sceneState = 'active'; canvas.dataset.sceneQuality = quality;
    resize(); reconcile();
  } catch { fail(); }

  return {
    setView(value) { view = value; resize(); reconcile(); },
    setReducedMotion(value) { reducedMotion = value; reconcile(); },
    dispose() {
      if (disposed) return;
      disposed = true; cancelFrame();
      observer?.disconnect(); resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibilityChanged);
      media.removeEventListener('change', mediaChanged);
      canvas.removeEventListener('webglcontextlost', contextLost);
      releaseScene(); renderer?.dispose(); renderer?.forceContextLoss(); renderer = undefined;
      canvas.dataset.sceneState = 'disposed';
    },
  };
}
