// Giving a built Mortar Overdrive track group back.
//
// The hazard this guards is not a leak, it is the opposite: the track builder
// mixes geometry it MINTS with geometry it BORROWS from shared caches (the GLB
// loader's parsed scenes, surfaceMat, the texture factory), so a disposer that
// frees everything it can reach takes the authored circuits down with the draft
// it was asked to free. Every InstancedMesh in that group is a borrower.
//
// Driven with a counting fake rather than a real scene: the contract is which
// objects are asked to dispose, and a headless Vitest can answer that exactly.

import { describe, expect, it } from 'vitest';
import {
  type DisposableGroupLike,
  type DisposableMeshLike,
  disposeMortarOverdriveTrackGroup,
} from '../src/render/mortar_overdrive/track_dispose_core';

interface FakeMesh extends DisposableMeshLike {
  name: string;
  geometryDisposals: number;
  selfDisposals: number;
}

function plainMesh(name: string): FakeMesh {
  const mesh: FakeMesh = {
    type: 'Mesh',
    name,
    isMesh: true,
    geometryDisposals: 0,
    selfDisposals: 0,
  };
  mesh.geometry = {
    dispose: () => {
      mesh.geometryDisposals++;
    },
  };
  return mesh;
}

function instancedMesh(name: string): FakeMesh {
  const mesh = plainMesh(name);
  mesh.isInstancedMesh = true;
  mesh.dispose = () => {
    mesh.selfDisposals++;
  };
  return mesh;
}

function nonMesh(name: string): FakeMesh {
  const mesh = plainMesh(name);
  mesh.isMesh = false;
  mesh.type = 'Group';
  return mesh;
}

function fakeGroup(children: FakeMesh[]): DisposableGroupLike & { cleared: number } {
  return {
    cleared: 0,
    traverse(callback: (object: DisposableMeshLike) => void) {
      for (const child of children) callback(child);
    },
    clear() {
      this.cleared++;
    },
  };
}

describe('disposeMortarOverdriveTrackGroup', () => {
  it('frees the geometry of every plain mesh, which is what the builder mints', () => {
    const road = plainMesh('road');
    const lawn = plainMesh('lawn');
    const group = fakeGroup([road, lawn]);
    disposeMortarOverdriveTrackGroup(group);
    expect(road.geometryDisposals).toBe(1);
    expect(lawn.geometryDisposals).toBe(1);
  });

  it('never frees an InstancedMesh geometry: it belongs to a shared cache', () => {
    // Freeing this is how a draft rebuild would take the authored circuits'
    // flower beds, trees and ironwork down with it.
    const beds = instancedMesh('flower-beds');
    const group = fakeGroup([beds]);
    disposeMortarOverdriveTrackGroup(group);
    expect(beds.geometryDisposals).toBe(0);
    // Its own per-instance attributes ARE the group's, so they come back.
    expect(beds.selfDisposals).toBe(1);
  });

  it('leaves non-mesh nodes alone', () => {
    const fixture = nonMesh('start-lights');
    const group = fakeGroup([fixture]);
    disposeMortarOverdriveTrackGroup(group);
    expect(fixture.geometryDisposals).toBe(0);
    expect(fixture.selfDisposals).toBe(0);
  });

  it('detaches the children so a disposed group cannot be drawn again', () => {
    const group = fakeGroup([plainMesh('road')]);
    disposeMortarOverdriveTrackGroup(group);
    expect(group.cleared).toBe(1);
  });

  it('survives a mesh with no geometry and an InstancedMesh with no dispose', () => {
    const bare: FakeMesh = {
      type: 'Mesh',
      name: 'bare',
      isMesh: true,
      geometryDisposals: 0,
      selfDisposals: 0,
    };
    const odd: FakeMesh = {
      type: 'Mesh',
      name: 'odd',
      isMesh: true,
      isInstancedMesh: true,
      geometryDisposals: 0,
      selfDisposals: 0,
    };
    expect(() => disposeMortarOverdriveTrackGroup(fakeGroup([bare, odd]))).not.toThrow();
  });

  it('frees a whole mixed group exactly once per owned geometry', () => {
    // The shape a real track group has: many swept ribbons plus the borrowed
    // instanced dressing.
    const owned = ['lawn', 'road', 'kerb-a', 'kerb-b', 'basin', 'start-line'].map(plainMesh);
    const borrowed = ['trees', 'beds', 'ironwork', 'reeds'].map(instancedMesh);
    disposeMortarOverdriveTrackGroup(fakeGroup([...owned, ...borrowed]));
    expect(owned.map((m) => m.geometryDisposals)).toEqual(owned.map(() => 1));
    expect(borrowed.map((m) => m.geometryDisposals)).toEqual(borrowed.map(() => 0));
    expect(borrowed.map((m) => m.selfDisposals)).toEqual(borrowed.map(() => 1));
  });
});
