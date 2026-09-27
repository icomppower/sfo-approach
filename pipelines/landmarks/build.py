# Offline landmark builder (Blender 5.x, headless): the SFO control tower (OSM footprint + height 67.4 m; the 2016
# tower: a tapered shaft flaring into the cab, FAA/SFO published height 221 ft) and the San Mateo–Hayward Bridge's
# west section (carriageways from OSM; published clearance 135 ft at the main span, low trestle beyond), three LODs
# each.   blender -b --factory-startup --python pipelines/landmarks/build.py -- <input.json> <out_dir>
# Blender axes: X east, Y north, Z up (the glTF exporter turns this into x east, y up, z south).
import bpy, json, math, sys, os

args = sys.argv[sys.argv.index('--') + 1:]
INP, OUT = args[0], args[1]
data = json.load(open(INP))
os.makedirs(OUT, exist_ok=True)

def srgb(r, g, b):
    f = lambda c: (c / 255) / 12.92 if c / 255 <= 0.04045 else (((c / 255) + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)

PALETTE = {
    'concrete': ((196, 194, 188), 0.9, 0.0),
    'tower_shaft': ((222, 222, 218), 0.6, 0.05),
    'tower_glass': ((26, 40, 52), 0.2, 0.3),
    'tower_flare': ((206, 208, 210), 0.5, 0.1),
    'deck': ((84, 84, 86), 0.85, 0.0),
    'barrier': ((176, 176, 172), 0.8, 0.0),
    'pier': ((170, 168, 160), 0.9, 0.0),
    'dark': ((70, 72, 74), 0.6, 0.3),
}
MATS = {}
def make_materials():
    MATS.clear()
    for name, (rgb, rough, metal) in PALETTE.items():
        m = bpy.data.materials.new(name); m.use_nodes = True
        p = m.node_tree.nodes.get('Principled BSDF')
        p.inputs['Base Color'].default_value = srgb(*rgb); p.inputs['Roughness'].default_value = rough; p.inputs['Metallic'].default_value = metal
        MATS[name] = m

def bl(p): return (p[0], -p[1])
def area(r): return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2

class Builder:
    def __init__(self): self.parts = {}
    def add(self, m, verts, faces, smooth=False):
        v, f, s = self.parts.setdefault(m, ([], [], []))
        o = len(v); v.extend(verts); f.extend([tuple(i + o for i in face) for face in faces]); s.extend([smooth] * len(faces))
    def prism(self, m, ring, z0, z1, scale_top=1.0, centre=(0, 0)):
        if area(ring) < 0: ring = ring[::-1]
        n = len(ring); cx, cy = centre
        bot = [(x, y, z0) for x, y in ring]; top = [(cx + (x - cx) * scale_top, cy + (y - cy) * scale_top, z1) for x, y in ring]
        faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)] + [tuple(range(n, 2 * n))] + [tuple(range(n - 1, -1, -1))]
        self.add(m, bot + top, faces)
    def loft(self, m, rings, cap=True, smooth=True):
        n = len(rings[0]); verts = [p for r in rings for p in r]; faces = []
        for k in range(len(rings) - 1):
            for i in range(n):
                a, b = k * n + i, k * n + (i + 1) % n
                faces.append((a, b, b + n, a + n))
        if cap: faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n))); faces.append(tuple(range(n - 1, -1, -1)))
        self.add(m, verts, faces, smooth)
    def box(self, m, c, size, ang=0.0):
        cx, cy, cz = c; sx, sy, sz = size; ca, sa = math.cos(ang), math.sin(ang)
        pts = []
        for dz in (-1, 1):
            for dy, dx in ((-1, -1), (-1, 1), (1, 1), (1, -1)):
                x, y = dx * sx / 2, dy * sy / 2
                pts.append((cx + x * ca - y * sa, cy + x * sa + y * ca, cz + dz * sz / 2))
        self.add(m, pts, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    def build(self, name, location):
        for mname, (v, f, s) in sorted(self.parts.items()):
            me = bpy.data.meshes.new(f'{name}_{mname}'); me.from_pydata(v, [], f); me.validate(); me.update()
            for poly, sm in zip(me.polygons, s): poly.use_smooth = sm
            me.materials.append(MATS[mname])
            ob = bpy.data.objects.new(f'{name}_{mname}', me); ob.location = location
            bpy.context.scene.collection.objects.link(ob)

def ring_at(r, z, seg, rx=1.0, ry=1.0):
    return [(math.cos(2 * math.pi * i / seg) * r * rx, math.sin(2 * math.pi * i / seg) * r * ry, z) for i in range(seg)]

def sfo_tower(L, lod):
    # a tapered "torch": elliptical shaft (12 × 9 m at the base, 7 × 6 m at 48 m), flaring to the cab ring (17 × 15 m)
    # under a glazed cab (cabFrom … height), a roof deck above. Ground at L['ground'].
    B = Builder(); g = L['ground']; h = L['height']; cab0 = L['cabFrom']
    seg = 24 if lod == 0 else 12 if lod == 1 else 8
    rings = [ring_at(6.0, g - 1, seg, 1.0, 0.75), ring_at(5.2, g + 14, seg, 1.0, 0.8), ring_at(3.9, g + 40, seg, 1.0, 0.85), ring_at(3.6, g + 48, seg, 1.0, 0.9),
             ring_at(6.5, g + cab0 - 4, seg, 1.0, 0.9), ring_at(8.4, g + cab0 - 0.5, seg, 1.0, 0.9)]
    B.loft('tower_shaft', rings, cap=True, smooth=True)
    B.loft('tower_glass', [ring_at(8.3, g + cab0 - 0.5, seg, 1.0, 0.9), ring_at(8.7, g + cab0 + 3.2, seg, 1.0, 0.9), ring_at(8.9, g + h - 1.6, seg, 1.0, 0.9)], cap=False, smooth=True)
    B.loft('tower_flare', [ring_at(8.9, g + h - 1.6, seg, 1.0, 0.9), ring_at(9.2, g + h - 0.4, seg, 1.0, 0.9), ring_at(8.0, g + h, seg, 1.0, 0.9)], cap=True, smooth=True)
    if lod < 2:
        # the base building: the OSM footprint below the shaft (the tower rises from a four-storey base)
        ring = [bl(p) for p in L['ring']]
        if len(ring) >= 3: B.prism('concrete', ring, g - 1, g + 14)
        B.box('dark', (0, 0, g + h + 3.5), (0.4, 0.4, 7))  # mast
    return B

def bridge(L, lod):
    B = Builder(); P = L['profile']
    ways = L['carriageways']
    # deck height above local MSL along the bridge from its west abutment: trestle deck, rising over the high-rise
    # section to the main span clearance + structure, back down to the trestle
    def deck_z(s):
        top = P['highRiseClearance'] + 2.0
        if s < P['highRiseStart']: return P['trestleDeck']
        if s < P['mainSpanCentre']:
            t = (s - P['highRiseStart']) / (P['mainSpanCentre'] - P['highRiseStart']); return P['trestleDeck'] + (top - P['trestleDeck']) * (t * t * (3 - 2 * t))
        if s < P['highRiseEnd']:
            t = (s - P['mainSpanCentre']) / (P['highRiseEnd'] - P['mainSpanCentre']); return top + (P['trestleDeck'] - top) * (t * t * (3 - 2 * t))
        return P['trestleDeck']
    step = 30 if lod == 0 else 60 if lod == 1 else 150
    for wi, way in enumerate(ways):
        pts = [bl(p) for p in way]; ground = [p[2] for p in way]
        # resample along the polyline every `step` metres
        samples = []; s_acc = 0.0
        for i in range(len(pts) - 1):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]; seg_len = math.hypot(x1 - x0, y1 - y0)
            n = max(1, int(seg_len // step))
            for k in range(n):
                t = k / n; samples.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, s_acc + seg_len * t))
            s_acc += seg_len
        samples.append((pts[-1][0], pts[-1][1], s_acc))
        W = P['deckWidth'] / 2 - 1.0  # each carriageway half-width
        for i in range(len(samples) - 1):
            x0, y0, s0 = samples[i]; x1, y1, s1 = samples[i + 1]
            d = math.hypot(x1 - x0, y1 - y0) or 1; ux, uy = (x1 - x0) / d, (y1 - y0) / d; nx, ny = -uy, ux
            z0, z1 = deck_z(s0), deck_z(s1)
            # deck slab (1.6 m deep) and barriers
            a = [(x0 + nx * W, y0 + ny * W, z0), (x0 - nx * W, y0 - ny * W, z0), (x1 - nx * W, y1 - ny * W, z1), (x1 + nx * W, y1 + ny * W, z1)]
            b = [(x, y, z - 1.6) for x, y, z in a]
            B.add('deck', a + b, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 3, 7, 4), (1, 5, 6, 2), (0, 4, 5, 1), (3, 2, 6, 7)])
            if lod < 2:
                for side in (1, -1):
                    c = [(x0 + nx * W * side, y0 + ny * W * side, z0), (x0 + nx * (W - 0.5) * side, y0 + ny * (W - 0.5) * side, z0), (x1 + nx * (W - 0.5) * side, y1 + ny * (W - 0.5) * side, z1), (x1 + nx * W * side, y1 + ny * W * side, z1)]
                    dtop = [(x, y, z + 1.1) for x, y, z in c]
                    B.add('barrier', c + dtop, [(4, 5, 6, 7), (0, 4, 7, 3), (1, 2, 6, 5), (0, 1, 5, 4), (3, 7, 6, 2)])
            # piers: high-rise section every 90 m on box piers, trestle every 30 m on twin columns
            if wi == 0 or lod < 2:
                hr = P['highRiseStart'] <= s0 <= P['highRiseEnd']
                every = 90 if hr else 30
                if int(s0 // every) != int((s0 - step) // every) or i == 0:
                    zg = min(-2.0, ground[min(len(ground) - 1, max(0, int(i * len(ground) / max(1, len(samples)))))]) - 1
                    cx, cy = x0 + nx * 0, y0 + ny * 0
                    ang = math.atan2(uy, ux)
                    if hr: B.box('pier', (cx, cy, (zg + z0 - 1.6) / 2), (3.5, P['deckWidth'] + 2, z0 - 1.6 - zg), ang)
                    else:
                        for side in (1, -1): B.box('pier', (cx + nx * (W - 3) * side, cy + ny * (W - 3) * side, (zg + z0 - 1.6) / 2), (1.2, 1.2, z0 - 1.6 - zg), ang)
    return B

BUILDERS = {'sfo-tower': sfo_tower, 'san-mateo-bridge': bridge}
for L in data['landmarks']:
    for lod in (0, 1, 2):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        make_materials()
        B = BUILDERS[L['slug']](L, lod)
        ax, az = L['anchor']
        B.build(f"{L['slug']}_lod{lod}", (ax, -az, 0.0))
        path = os.path.join(OUT, f"{L['slug']}_lod{lod}.glb")
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                                  export_materials='EXPORT', export_texcoords=False, export_normals=True,
                                  export_extras=False, export_cameras=False, export_lights=False, use_selection=False)
        print('wrote', path)
