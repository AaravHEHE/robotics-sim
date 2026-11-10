#!/bin/bash
# Rebuild every data/builds/*.build.json and its .fixed.build.json from the reduced exports.
# The reduced exports (<name>_x.json) come from scripts/onshape/gltf-extract.py; pass their folder.
#   bash scripts/reimport-builds.sh /c/tmp/cornfield
set -e
dir="${1:?folder with the reduced exports (cascade_x.json, dr4b_x.json, ...)}"
cd "$(dirname "$0")/.."
build() { # <build name> <reduced export> [extra importer flags]
  node scripts/import-onshape.ts "$dir/$2" "data/builds/$1.build.json" ${3:-} | sed -n 1,2p
}
build dr6b dr6b_x.json
build sixbar sixbar_x.json
build fourbar fourbar_x.json
build twobar twobar_x.json --yaw=90
build continuous cont_x.json
for n in dr6b sixbar fourbar twobar continuous; do
  node scripts/fix-cad-logic.ts "data/builds/$n.build.json" | tail -1
done
