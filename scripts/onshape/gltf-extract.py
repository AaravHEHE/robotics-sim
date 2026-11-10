# Reduce an Onshape glTF export (one huge file) to what the importer needs: for every part
# instance its name, its matrix (m, meters), its box in the part's own axes (lo, hi) and a rough
# centroid (cen). Usage: python scripts/onshape/gltf-extract.py <assembly.gltf> <extract.json>
import json, sys, re, collections, unicodedata
src, out = sys.argv[1], sys.argv[2]
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
