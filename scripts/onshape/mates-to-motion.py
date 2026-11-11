"""Turn an Onshape assembly's mates into a motion spec for a CAD build (data/builds/<name>.motion.json).

Uses the assembly definition from Onshape's API (rootAssembly: occurrences with transforms, and the mate
features with each connector's position and axis on its part), saved by the page that fetched it.

  python scripts/onshape/mates-to-motion.py <mates.json> <extract.json> <build.json> <out.motion.json> \
      --drive "Revolute 2" [--gear-sign -1] [--max 120] [--min 0] [--step 2.5] [--lift dr6b] [--ground-part "V5 Smart Motor"]

What it does: parts joined by FASTENED mates form rigid bodies; REVOLUTE and CYLINDRICAL mates (all with axes along the
robot's x axis, so the motion is in the y-z plane) pin two bodies together at a point; a mate relation (GEAR) ties two
joint angles; the body holding `--ground-part` is fixed. The drive joint is turned through its range and the linkage is
solved at each step (least squares, from the previous step), giving every body a pose (turn about its center, shift)
per output angle. Parts the mates do not reach (a mirrored copy of one side) follow their mirror partner.

Gear relations: Onshape's default (not reversed) turns the two mates the same way about their own z axes; the sign is
chosen with --gear-sign (-1 = the physical counter-rotation of meshing gears).
"""
import argparse, collections, json
import numpy as np
from scipy.optimize import least_squares

ap = argparse.ArgumentParser()
ap.add_argument('mates'); ap.add_argument('extract'); ap.add_argument('build'); ap.add_argument('out')
ap.add_argument('--drive', default=None); ap.add_argument('--list', action='store_true', help='print the joints and the degrees of freedom, then stop')
ap.add_argument('--gear-sign', type=float, default=-1.0)
ap.add_argument('--min', type=float, default=0.0); ap.add_argument('--max', type=float, default=120.0); ap.add_argument('--step', type=float, default=2.5)
ap.add_argument('--lift', default='lift'); ap.add_argument('--ground-part', default='V5 Smart Motor')
ap.add_argument('--root', default='root', help='which assembly of the file: root, or sub<N>')
a = ap.parse_args()

D = json.load(open(a.mates))
root = D['root'] if 'root' in D else D
if a.root.startswith('sub'): root = D['subs'][int(a.root[3:])]
root['inst'] = {k: (v if isinstance(v, str) else v[0]) for k, v in root['inst'].items()}
X = json.load(open(a.extract, encoding='utf-8'))
build = json.load(open(a.build, encoding='utf-8'))
org = build['source']['origin']; yaw = build['source'].get('yaw', 0)
M2 = lambda t: np.array(t).reshape(4, 4)
Gm = lambda m: np.array(m).reshape(4, 4).T  # glTF nodes are column-major

occs = [(tuple(o[0]), M2(o[1]), o[2]) for o in root['occ']]
occ2part, used = {}, set()
for p, t, h in occs:
    if h: continue
    best = None
    for i, x in enumerate(X):
        if i in used: continue
        d = np.abs(Gm(x['m']) - t).max()
        if best is None or d < best[0]: best = (d, i)
    if best and best[0] < 2e-3: occ2part[p] = best[1]; used.add(best[1])
print(f'{len(occ2part)} of {sum(1 for o in occs if not o[2])} visible occurrences matched to build parts')

par = {}
def find(x):
    par.setdefault(x, x)
    while par[x] != x: par[x] = par[par[x]]; x = par[x]
    return x
for p in occ2part: find(p)
for m in root['mates']:
    if m.get('type') == 'FASTENED' and not m.get('s'):
        p, q = [tuple(e[0]) for e in m['e']]; par.setdefault(p, p); par.setdefault(q, q); par[find(p)] = find(q)
bodies = collections.defaultdict(list)
for p in occ2part: bodies[find(p)].append(p)
occT = {p: t for p, t, h in occs}
IN = 1 / 0.0254

# world (y, z) in inches, CAD frame; the build frame is CAD minus the origin the importer used (then yawed)
def to_build(yz):
    x0, y0, fl = org
    c, s = np.cos(np.radians(yaw)), np.sin(np.radians(yaw))
    return yz  # (yaw 0 for every build solved so far; see below)
if yaw: raise SystemExit('yaw builds are not handled yet')

joints = []
for m in root['mates']:
    if m.get('type') in ('REVOLUTE', 'CYLINDRICAL') and not m.get('s'):
        p, q = [tuple(e[0]) for e in m['e']]; e = m['e'][0]; Ta = occT.get(p)
        if Ta is None or p not in occ2part and q not in occ2part: continue
        P = (Ta @ np.append(np.array(e[1]), 1))[:3] * IN; z = Ta[:3, :3] @ np.array(e[2])
        if abs(z[0]) < 0.95: print('warning: joint', m['name'], 'is not about x (axis', np.round(z, 2), '): skipped'); continue
        joints.append(dict(id=m['id'], name=m['name'], a=find(p), b=find(q), P=P[1:], s=float(np.sign(z[0])), lim=m.get('lim')))
byid = {j['id']: j for j in joints}
rels = []
for m in root['mates']:
    if m['ft'] == 'mateRelation' and m['rel']['type'] == 'GEAR':
        j1, j2 = (byid.get(x['featureId']) for x in m['rel']['mates'])
        if j1 and j2: rels.append((j1, j2, m['rel']['ratio']))
motor = next((p for p in occ2part if a.ground_part in root['inst'][p[-1]]), None)
ground = find(motor) if motor else max(bodies, key=lambda b: len(bodies[b]))
pts = {b: np.array([[occT[p][1, 3] * IN, occT[p][2, 3] * IN] for p in ps]) for b, ps in bodies.items()}
cen = {b: pts[b].mean(0) for b in pts}
ids = [b for b in pts if b != ground and any(j['a'] == b or j['b'] == b for j in joints)]
ix = {b: i for i, b in enumerate(ids)}

def pos(b, x, P):
    if b == ground or b not in ix: return P
    th, ty, tz = x[3 * ix[b]:3 * ix[b] + 3]; c, s = np.cos(th), np.sin(th); d = P - cen[b]
    return cen[b] + np.array([c * d[0] - s * d[1], s * d[0] + c * d[1]]) + np.array([ty, tz])
def th(b, x): return 0.0 if (b == ground or b not in ix) else x[3 * ix[b]]
def phi(j, x): return (th(j['b'], x) - th(j['a'], x)) * j['s']
if a.list:
    print(len(bodies), 'rigid bodies;', len(ids), 'of them move;', 'ground has', len(bodies[ground]), 'parts')
    for j in joints:
        print(' ', j['name'].ljust(14), 'bodies', sorted(len(bodies[j['a']]) for _ in [0]) and (len(bodies[j['a']]), len(bodies[j['b']])), 'pivot (y, z) %.1f %.1f' % tuple(j['P']), 'limits' if j['lim'] else '')
    from scipy.linalg import null_space
    def cons(x):
        r = []
        for j in joints: r += list(pos(j['a'], x, j['P']) - pos(j['b'], x, j['P']))
        for j1, j2, ratio in rels: r.append(phi(j1, x) - a.gear_sign * ratio * phi(j2, x))
        return np.array(r)
    x0 = np.zeros(3 * len(ids)); e = 1e-6
    Jm = np.array([(cons(x0 + e * np.eye(len(x0))[i]) - cons(x0 - e * np.eye(len(x0))[i])) / (2 * e) for i in range(len(x0))]).T
    print('degrees of freedom at the CAD pose:', null_space(Jm, rcond=1e-7).shape[1])
    raise SystemExit
drive = next(j for j in joints if j['name'] == a.drive)
def resid(x, out):
    r = []
    for j in joints: r += list(pos(j['a'], x, j['P']) - pos(j['b'], x, j['P']))
    for j1, j2, ratio in rels: r.append(phi(j1, x) - a.gear_sign * ratio * phi(j2, x))
    r.append(phi(drive, x) - out)
    return np.array(r)

outs = np.arange(a.min, a.max + 1e-9, a.step)
mid = int(np.argmin(np.abs(outs)))  # solve outward from the CAD pose (out 0) both ways
sol = {}
for rng in (range(mid, len(outs)), range(mid, -1, -1)):
    x = np.zeros(3 * len(ids))
    for k in rng:
        r = least_squares(resid, x, args=(np.radians(outs[k]),), xtol=1e-12, ftol=1e-12)
        if r.cost > 1e-8: print(f'linkage stops closing at out = {outs[k]:.1f} deg (cost {r.cost:.2e})'); break
        x = r.x; sol[k] = x.copy()
ks = sorted(sol)
lo_k, hi_k = ks[0], ks[-1]
print(f'solved out {outs[lo_k]:.1f} .. {outs[hi_k]:.1f} deg, {len(ids)} moving bodies, {len(joints)} joints, {len(rels)} gear relations, ground = {len(bodies[ground])} parts')

# mirror partners: unmatched-by-mates parts follow the solved part with the same name and the same (y, z)
moving_parts = {p: b for b in ids for p in bodies[b]}
base = lambda n: n.split(' <')[0].replace('-Mirrored', '')
followers = collections.defaultdict(list)
for p in occ2part:
    if p in moving_parts or find(p) == ground: continue
    for q, b in moving_parts.items():
        if base(root['inst'][q[-1]]) == base(root['inst'][p[-1]]) and np.abs(np.array([occT[p][1, 3], occT[p][2, 3]]) - np.array([occT[q][1, 3], occT[q][2, 3]])).max() * IN < 0.1 and p != q:
            followers[b].append(p); break

groups = []
for b in ids:
    keys = []
    for k in range(lo_k, hi_k + 1):
        x = sol[k]; i = ix[b]
        keys.append([round(float(outs[k]), 4), round(float(np.degrees(x[3 * i])), 4), round(float(x[3 * i + 1]), 4), round(float(x[3 * i + 2]), 4)])
    if max(abs(v) for kk in keys for v in kk[1:]) < 1e-3: continue
    parts = sorted(occ2part[p] for p in bodies[b] + followers[b])
    c = cen[b]
    groups.append({'name': 'body ' + root['inst'][bodies[b][0][-1]][:22], 'parts': parts, 'joint': {'type': 'track', 'about': [round(float(c[0] - org[1]), 4), round(float(c[1] - org[2]), 4)], 'keys': keys}})
spec = {'v': 1, 'lift': a.lift, 'out': {'unit': 'deg', 'min': float(outs[lo_k]), 'max': float(outs[hi_k])}, 'groups': groups,
        'notes': f'From the CAD mates: drive {a.drive}, gear sign {a.gear_sign}. out 0 is the CAD pose.'}
json.dump(spec, open(a.out, 'w'))
print(f'wrote {a.out}: {len(groups)} moving groups, {sum(len(g["parts"]) for g in groups)} parts')
