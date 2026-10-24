import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createSlime, clampFrameDelta } from "../../src/scene/slime";
import { createCourtroom } from "../../src/scene/courtroom";
import { createFrameMonitor } from "../../src/scene/frame-budget";

function pose(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const matrices: number[][] = [];
  root.traverse((node) => matrices.push(node.matrixWorld.toArray()));
  return matrices;
}

describe("neutral slime animation", () => {
  it("shows a visible breathing change at mobile scale", () => {
    const rig = createSlime("low");
    const body = rig.root.getObjectByName("body")!;
    rig.update(0.02, 1.3, false);
    rig.root.updateMatrixWorld(true);
    const high = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).y;
    rig.update(0.02, 3.9, false);
    rig.root.updateMatrixWorld(true);
    const low = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).y;
    expect(high - low).toBeGreaterThan(0.15);
    rig.dispose();
  });
  it("keeps the current pose when dt is zero", () => {
    const rig = createSlime("low");
    rig.update(0.02, 2.1, false);
    const before = pose(rig.root);
    rig.update(0, 500, false);
    expect(pose(rig.root)).toEqual(before);
    rig.dispose();
  });
  it("caps a resumed frame at fifty milliseconds and rejects invalid deltas", () => {
    expect(clampFrameDelta(9)).toBe(0.05);
    expect(clampFrameDelta(-1)).toBe(0);
    expect(clampFrameDelta(Infinity)).toBe(0);
    expect(clampFrameDelta(0.016)).toBe(0.016);
  });
  it("uses one fixed pose whenever reduced motion is enabled", () => {
    const rig = createSlime("standard");
    rig.update(0.02, 3, false);
    rig.update(0.02, 6, true);
    const before = pose(rig.root);
    rig.update(0.05, 90, true);
    expect(pose(rig.root)).toEqual(before);
    rig.dispose();
  });
  it("reproduces the exact pose at a given elapsed time", () => {
    const a = createSlime("standard");
    const b = createSlime("standard");
    a.update(0.02, 4.25, false);
    b.update(0.01, 0.5, false);
    b.update(0.02, 4.25, false);
    expect(pose(a.root)).toEqual(pose(b.root));
    a.dispose();
    b.dispose();
  });
  it("keeps eyes opaque and depth tested, with no mouth or duplicated creature", () => {
    const rig = createSlime("standard");
    const eyes: THREE.Mesh[] = [];
    rig.root.traverse((n) => {
      if (n.name.startsWith("eye-")) eyes.push(n as THREE.Mesh);
    });
    expect(eyes).toHaveLength(2);
    for (const eye of eyes) {
      expect((eye.material as THREE.Material).transparent).toBe(false);
      expect((eye.material as THREE.Material).depthTest).toBe(true);
      expect(eye.position.z).toBeGreaterThan(0);
    }
    expect(rig.root.getObjectByName("mouth")).toBeUndefined();
    expect(rig.root.getObjectByName("crest")).toBeDefined();
    expect(rig.root.getObjectByName("rear-flow")).toBeDefined();
    rig.dispose();
  });
  it("keeps every surface above the contact plane at both deformation extremes", () => {
    const rig = createSlime("standard");
    const point = new THREE.Vector3();
    let minimum = Infinity;
    for (let time = 0; time < 10; time += 0.25) {
      rig.update(0.05, time, false);
      rig.root.updateMatrixWorld(true);
      rig.root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const positions = node.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          point
            .fromBufferAttribute(positions, i)
            .applyMatrix4(node.matrixWorld);
          minimum = Math.min(minimum, point.y);
        }
      });
    }
    expect(minimum).toBeGreaterThanOrEqual(0.02);
    rig.dispose();
  });
  it("has finite vertices and stays under the triangle budget", () => {
    const rig = createSlime("standard");
    let triangles = 0;
    rig.root.traverse((n) => {
      if (n instanceof THREE.Mesh) {
        const position = n.geometry.getAttribute("position");
        expect([...position.array].every(Number.isFinite)).toBe(true);
        triangles += (n.geometry.index?.count ?? position.count) / 3;
      }
    });
    expect(triangles).toBeLessThan(20_000);
    rig.dispose();
  });
});

it("provides exactly three simplified courtroom people", () => {
  const room = createCourtroom();
  expect(room.getObjectByName("judge")).toBeDefined();
  expect(room.getObjectByName("prosecutor")).toBeDefined();
  expect(room.getObjectByName("advocate")).toBeDefined();
});

it("lowers resolution once after sustained frames over 33.3ms", () => {
  const budget = createFrameMonitor();
  for (let i = 0; i < 44; i++) expect(budget.record(0.045)).toBe(false);
  expect(budget.record(0.045)).toBe(true);
  expect(budget.record(0.045)).toBe(false);
});
it("does not lower resolution for a transient slow frame or normal frames", () => {
  const budget = createFrameMonitor();
  expect(budget.record(0.05)).toBe(false);
  for (let i = 0; i < 180; i++) expect(budget.record(1 / 60)).toBe(false);
});

it("batches the static court without losing its three human groups", () => {
  const room = createCourtroom();
  let calls = 0;
  room.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments)
      calls++;
  });
  expect(calls).toBeLessThanOrEqual(24);
  for (const name of ["judge", "prosecutor", "advocate"]) {
    const human = room.getObjectByName(name)!;
    expect(human.children.some((child) => child instanceof THREE.Mesh)).toBe(
      true,
    );
  }
});
