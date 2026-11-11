# Reduce an Onshape glTF export (one huge file) to what the importer needs: for every part
# instance its name, its matrix (m, meters), its box in the part's own axes (lo, hi) and a rough
# centroid (cen). Usage: python scripts/onshape/gltf-extract.py <assembly.gltf> <extract.json>
import json, sys, re, collections, unicodedata
src, out = sys.argv[1], sys.argv[2]
mesh_out = sys.argv[3] if len(sys.argv) > 3 else None  # optional: also write each part mesh's triangles (inches, part axes) here
MAX_TRIS = 6000  # bigger meshes (screws, gears, wheels) are drawn from the catalog, not as meshes
g = json.load(open(src, encoding='utf-8'))
acc, meshes, nodes = g['accessors'], g['meshes'], g['nodes']
def clean(s):
    # Onshape names carry invisible formatting characters (category Cf) and odd spaces
    # (some exports have them mis-decoded: a U+200E mark arrives as "â\u0080\u008e")
    s = re.sub('â[\u0080-¿]{2}', '', s)
    s = ''.join(c for c in s if unicodedata.category(c) not in ('Cf', 'Cc')).replace('\xa0', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    half = s.split('__')  # some documents name an instance "X__X"
    return half[0].strip() if len(half) == 2 and half[0] == half[1] else s
mcache = {}
def mesh_info(mi):
    if mi in mcache: return mcache[mi]
    lo=[1e9]*3; hi=[-1e9]*3; wsum=0; c=[0,0,0]
    for pr in meshes[mi]['primitives']:
        a = acc[pr['attributes']['POSITION']]
        n = a.get('count',0); mn, mx = a['min'], a['max']
        for i in range(3):
            lo[i]=min(lo[i],mn[i]); hi[i]=max(hi[i],mx[i])
            c[i]+= n*(mn[i]+mx[i])/2
        wsum+=n
    cen=[c[i]/max(wsum,1) for i in range(3)]
    mcache[mi]=(lo,hi,cen,wsum); return mcache[mi]
res=[]
for n in nodes:
    nm = n.get('name','')
    if nm.startswith('occurrence of ') and 'matrix' in n and n.get('children'):
        ch = nodes[n['children'][0]]
        if 'mesh' not in ch: continue
        lo,hi,cen,w = mesh_info(ch['mesh'])
        res.append({'name': clean(nm[14:]), 'm': n['matrix'], 'lo': lo, 'hi': hi, 'cen': cen, 'verts': w, 'mesh': ch['mesh']})
json.dump(res, open(out,'w',encoding='utf-8'), ensure_ascii=False)
print(len(res), 'instances,', len(mcache), 'meshes')

if mesh_out:
    import base64
    import numpy as np
    uri = g['buffers'][0]['uri']
    raw = np.frombuffer(base64.b64decode(uri.split(',', 1)[1]), dtype=np.uint8) if uri.startswith('data:') else np.fromfile(uri, dtype=np.uint8)
    bv = g['bufferViews']
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    def read(ai):
        a = acc[ai]; v = bv[a['bufferView']]; n = ncomp[a['type']]; d = np.dtype(dt[a['componentType']])
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = v.get('byteStride') or n * d.itemsize
        if stride == n * d.itemsize:
            return np.frombuffer(raw[start:start + a['count'] * n * d.itemsize].tobytes(), dtype=d).reshape(a['count'], n)
        return np.array([np.frombuffer(raw[start + i * stride:start + i * stride + n * d.itemsize].tobytes(), dtype=d) for i in range(a['count'])])
    IN = 1 / 0.0254
    wanted = sorted({i['mesh'] for i in res})
    meshes_out = {}
    for mi in wanted:
        verts, tris, base = [], [], 0
        total = 0
        for pr in meshes[mi]['primitives']:
            pos = read(pr['attributes']['POSITION']).astype(np.float64)
            idx = read(pr['indices']).reshape(-1).astype(np.int64) if 'indices' in pr else np.arange(len(pos))
            total += len(idx) // 3
            if total > MAX_TRIS: break
            verts.append(pos); tris.append(idx + base); base += len(pos)
        else:
            v = np.concatenate(verts) * IN; t = np.concatenate(tris)
            # merge duplicate vertices (a CAD export repeats them per face)
            key = np.round(v, 3); uniq, inv = np.unique(key, axis=0, return_inverse=True)
            meshes_out[str(mi)] = {'v': [round(float(x), 3) for x in uniq.reshape(-1)], 'i': [int(x) for x in inv.reshape(-1)[t]]}
    json.dump(meshes_out, open(mesh_out, 'w'))
    print(len(meshes_out), 'of', len(wanted), 'meshes written (the rest are over', MAX_TRIS, 'triangles)')
