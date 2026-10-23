import * as THREE from 'three';

function toon(color: THREE.ColorRepresentation, gradientMap: THREE.DataTexture) {
  return new THREE.MeshToonMaterial({ color, gradientMap });
}

/** Muted stone, oak furniture and three deliberately simplified, neutral people. */
export function createCourtroom(): THREE.Group {
  const room = new THREE.Group(); room.name = 'courtroom';
  const gradient = new THREE.DataTexture(new Uint8Array([100, 178, 255]), 3, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter; gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false; gradient.needsUpdate = true;
  // The texture is attached to the group so the shared scene owner can release it.
  room.userData.ownedTextures = [gradient];
  const stone = toon('#b9af9c', gradient), paleStone = toon('#d7ccb7', gradient);
  const oak = toon('#674631', gradient), oakLight = toon('#97704a', gradient);
  const dark = toon('#252a34', gradient), gold = toon('#c8a96b', gradient);
  const skin = toon('#d8b99c', gradient), paper = toon('#e6dac0', gradient);

  function box(name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, parent: THREE.Group = room) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.name = name; mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function cylinder(name: string, rt: number, rb: number, height: number, x: number, y: number, z: number, material: THREE.Material, parent: THREE.Group = room) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, height, 12), material);
    mesh.name = name; mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  box('stone-floor', 11, 0.12, 10, 0, -0.10, -1, stone);
  box('back-wall', 10, 5.4, 0.24, 0, 2.6, -3.65, stone);
  box('back-wall-plinth', 10, 0.55, 0.35, 0, 0.2, -3.46, paleStone);
  box('wall-cornice', 10, 0.22, 0.43, 0, 4.9, -3.43, paleStone);
  const linePositions: number[] = [];
  for (let i = -5; i <= 5; i++) {
    linePositions.push(i, -0.033, -5, i, -0.033, 4);
    linePositions.push(-5, -0.033, i, 5, -0.033, i);
  }
  const floorLines = new THREE.BufferGeometry(); floorLines.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  room.add(new THREE.LineSegments(floorLines, new THREE.LineBasicMaterial({ color: '#9e9586', transparent: true, opacity: 0.38 })));

  for (const x of [-4.15, -1.65, 1.65, 4.15]) {
    cylinder('stone-column', 0.19, 0.22, 4.4, x, 2.2, -3.26, paleStone);
    box('column-capital', 0.6, 0.19, 0.55, x, 4.38, -3.26, paleStone);
    box('column-base', 0.56, 0.20, 0.53, x, 0.07, -3.26, paleStone);
  }
  // Recessed arched window geometry, real depth behind the timber mullions.
  const arch = new THREE.Shape();
  arch.moveTo(-0.58, 0); arch.lineTo(0.58, 0); arch.lineTo(0.58, 1.35);
  arch.absarc(0, 1.35, 0.58, 0, Math.PI, false); arch.lineTo(-0.58, 0);
  for (const x of [-2.85, 2.85]) {
    const window = new THREE.Mesh(new THREE.ExtrudeGeometry(arch, { depth: 0.06, bevelEnabled: false, curveSegments: 12 }), new THREE.MeshBasicMaterial({ color: '#dbe2dc' }));
    window.position.set(x, 2.2, -3.48); room.add(window);
    box('window-mullion', 0.07, 1.8, 0.12, x, 3.08, -3.35, oakLight);
    box('window-crossbar', 1.13, 0.07, 0.12, x, 3.27, -3.35, oakLight);
  }
  // Raised judge's bench, with a quiet geometric seal rather than religious signs.
  box('judge-platform', 3.2, 0.24, 1.8, 0, 0.09, -2.49, oak);
  box('judge-chair', 1.13, 1.9, 0.25, 0, 1.21, -3.04, oak);
  box('judge-chair-inlay', 0.85, 1.5, 0.04, 0, 1.27, -2.88, oakLight);
  box('judge-bench', 2.9, 0.92, 0.64, 0, 0.69, -1.94, oak);
  box('judge-desktop', 3.08, 0.12, 0.82, 0, 1.20, -1.94, oakLight);
  const seal = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.028, 6, 28), gold);
  seal.position.set(0, 0.77, -1.60); room.add(seal);
  box('seal-center', 0.05, 0.28, 0.04, 0, 0.77, -1.57, gold);

  for (const x of [-2.55, 2.55]) {
    box('counsel-table', 1.72, 0.10, 0.92, x, 0.94, -0.24, oakLight);
    box('counsel-front', 1.60, 0.76, 0.11, x, 0.5, 0.11, oak);
    for (const offset of [-0.66, 0.66]) box('table-leg', 0.11, 0.86, 0.11, x + offset, 0.43, -0.55, oak);
    const pages = box('case-papers', 0.36, 0.025, 0.43, x + 0.3, 1.01, -0.17, paper); pages.rotation.y = x * 0.05;
  }
  cylinder('slime-dais', 1.56, 1.65, 0.20, 0, 0.07, 0.51, paleStone);
  cylinder('slime-dais-inset', 1.45, 1.45, 0.025, 0, 0.185, 0.51, stone);

  function person(name: string, x: number, z: number, robeColor: string, hairColor: string, y: number = 0) {
    const human = new THREE.Group(); human.name = name; human.position.set(x, y, z); room.add(human);
    const robe = toon(robeColor, gradient), hair = toon(hairColor, gradient);
    cylinder('robe', 0.23, 0.36, 0.93, 0, 0.81, 0, robe, human);
    box('collar', 0.16, 0.15, 0.06, 0, 1.23, 0.21, paper, human);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.225, 14, 12), skin); head.position.set(0, 1.51, 0); head.scale.y = 1.10; human.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.233, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); cap.position.set(0, 1.57, -0.025); human.add(cap);
    for (const side of [-1, 1]) {
      const arm = cylinder('sleeve', 0.12, 0.14, 0.65, side * 0.30, 0.94, 0.04, robe, human); arm.rotation.z = side * 0.20;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), skin); hand.position.set(side * 0.36, 0.64, 0.08); human.add(hand);
    }
    // No lip synchronization or expression change is attached to testimony.
    return human;
  }
  person('judge', 0, -2.58, '#34323b', '#c5bdad', 0.23);
  const prosecutor = person('prosecutor', -2.55, -0.79, '#665054', '#4c3b32'); prosecutor.rotation.y = 0.22;
  const advocate = person('advocate', 2.55, -0.79, '#435660', '#897361'); advocate.rotation.y = -0.22;
  return room;
}
