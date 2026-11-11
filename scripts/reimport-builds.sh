#!/bin/bash
# Rebuild every data/builds/*.build.json and its .fixed.build.json from the reduced exports.
# The reduced exports (<name>_x.json) and mesh files (<name>_mesh.json) come from scripts/onshape/gltf-extract.py
# (run it as: python scripts/onshape/gltf-extract.py <assembly.gltf> <dir>/<name>_x.json <dir>/<name>_mesh.json).
#   bash scripts/reimport-builds.sh /c/tmp/cornfield
set -e
dir="${1:?folder with the reduced exports (cascade_x.json, dr4b_x.json, ...)}"
cd "$(dirname "$0")/.."
build() { # <build name> <extract name> [extra importer flags]
  local mesh=""
  [ -f "$dir/$2_mesh.json" ] && mesh="--meshes=$dir/$2_mesh.json"
  node scripts/import-onshape.ts "$dir/$2_x.json" "data/builds/$1.build.json" $mesh ${3:-} | sed -n 1,2p
}
build cascade cascade
build dr4b dr4b
build dr6b dr6b
build sixbar sixbar
build fourbar fourbar
build twobar twobar --yaw=90
build continuous cont
build claw-piston clawp
for n in cascade dr4b dr6b sixbar fourbar twobar continuous; do
  node scripts/fix-cad-logic.ts "data/builds/$n.build.json" | tail -1
done
# the cascade's intake bridge (see docs/onshape-import.md)
node scripts/fix-cad-logic.ts data/builds/cascade.build.json '--bridge={"part":"custom-box","size":[9.176,3.3,0.12],"pos":[0,0,0],"rot":[0,0,0],"xf":{"c":[0.02,0.39,4.49],"r":[0,1,0,-0.9372,0,0.3487,0.3487,0,0.9372]},"note":"intake bridge from the first-stage rollers (y 1.0, z -11.6 in the CAD) to the second stage (y -7.6, z -8.4): the side ramps ended at y -2.7 and the back plate began at y -7.6, leaving a gap pieces fell through"}' | tail -1
