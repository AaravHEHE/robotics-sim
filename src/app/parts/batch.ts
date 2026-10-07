// A robot drawn from parts has hundreds of small meshes (every screw is three): drawing each
// separately would cost a draw call apiece. Parts that move together are merged into one
// mesh per material once they are placed.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merge every mesh under `root` (by material) into a few meshes, in `root`'s own frame.
 * Children marked `userData.moving` (animated parts) are left alone, and so is what is under
 * them. Returns how many meshes were merged.
 */
export function mergeRigid(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const shadows = new Map<THREE.Material, boolean>();
  const dropped: THREE.Object3D[] = [];
  let n = 0;
  const visit = (o: THREE.Object3D) => {
    for (const c of [...o.children]) {
      if (c.userData.moving) continue;
      const m = c as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && !(m as unknown as THREE.InstancedMesh).isInstancedMesh) {
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
        if (!g.attributes.normal) g.computeVertexNormals();
        g.applyMatrix4(inv.clone().multiply(m.matrixWorld));
        const list = byMat.get(m.material) ?? [];
        list.push(g);
        byMat.set(m.material, list);
        shadows.set(m.material, m.castShadow);
        n++;
        if (m.children.length) visit(m);
        dropped.push(m);
        continue;
      }
      visit(c);
    }
  };
  visit(root);
  if (n < 2) {
    for (const list of byMat.values()) for (const g of list) g.dispose();
    return 0;
  }
  // (their geometry was never drawn: a part's is the cached prototype's, shared and kept;
  // a one-off's, such as a cable's, is garbage once copied into the merged mesh)
  for (const m of dropped) m.removeFromParent();
  // empty groups left behind
  const prune = (o: THREE.Object3D) => {
    for (const c of [...o.children]) {
      if (c.userData.moving) continue;
      prune(c);
      if (!c.children.length && !(c as THREE.Mesh).isMesh) c.removeFromParent();
    }
  };
  prune(root);
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = shadows.get(mat) ?? true;
    mesh.receiveShadow = true;
    mesh.userData.merged = true;
    root.add(mesh);
  }
  return n;
}
