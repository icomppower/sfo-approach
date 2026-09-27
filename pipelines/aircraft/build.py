# Offline aircraft model (Blender 5.x, headless): a generic twin-engine widebody with the published dimensions of a
# Boeing 777-300ER (Boeing D6-58329-2, "777-200LR / -300ER Airplane Characteristics for Airport Planning":
# length 73.9 m, span 64.8 m, height 18.5 m, fuselage diameter 6.2 m, wheelbase 31.2 m, main gear track 11.0 m,
# wing sweep 31.6°, horizontal tail span 21.5 m; GE90-115B nacelle ~4.1 m diameter). Landing configuration:
# gear down, flaps 30. Three LOD GLBs.
#   blender -b --factory-startup --python pipelines/aircraft/build.py -- <out_dir>
# Blender axes: X starboard, Y forward (nose), Z up; the glTF exporter (Y-up) turns this into x right, y up,
# z aft, so the model's nose points down -z (= north in the engine frame at heading 0). Origin: the point on the
# ground under the main gear (the sim's aircraft position); the fuselage centreline is at Z = GROUND_TO_CL.
import bpy, math, sys, os

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
os.makedirs(OUT, exist_ok=True)

def srgb(r, g, b):
    f = lambda c: (c / 255) / 12.92 if c / 255 <= 0.04045 else (((c / 255) + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)

PALETTE = {  # name: (sRGB, roughness, metallic, emission)
    'white': ((236, 238, 240), 0.35, 0.05, None),
    'belly': ((176, 182, 190), 0.4, 0.1, None),
    'blue': ((22, 44, 98), 0.4, 0.1, None),
    'wing': ((198, 204, 210), 0.45, 0.15, None),
    'nacelle': ((214, 218, 222), 0.3, 0.3, None),
    'dark': ((36, 38, 42), 0.6, 0.4, None),
    'glass': ((14, 18, 26), 0.15, 0.2, None),
    'tyre': ((22, 22, 24), 0.9, 0.0, None),
    'metal': ((150, 150, 152), 0.35, 0.8, None),
    'nav_red': ((255, 30, 30), 0.5, 0.0, (1.0, 0.05, 0.05)),
    'nav_green': ((30, 255, 60), 0.5, 0.0, (0.05, 1.0, 0.15)),
    'nav_white': ((255, 255, 255), 0.5, 0.0, (1.0, 1.0, 0.95)),
    'beacon': ((255, 40, 20), 0.5, 0.0, (1.0, 0.1, 0.02)),
}
MATS = {}

def make_materials():
    MATS.clear()
    for name, (rgb, rough, metal, emit) in PALETTE.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        p = m.node_tree.nodes.get('Principled BSDF')
        p.inputs['Base Color'].default_value = srgb(*rgb)
        p.inputs['Roughness'].default_value = rough
        p.inputs['Metallic'].default_value = metal
        if emit:
            p.inputs['Emission Color'].default_value = (*emit, 1.0)
            p.inputs['Emission Strength'].default_value = 1.0
        MATS[name] = m

GROUND_TO_CL = 5.5      # fuselage centreline above the ground on the gear (m)
R = 3.1                 # fuselage radius
NOSE_Y = 41.7           # nose ahead of the main gear (wheelbase 31.2 + nose gear 10.5 ahead of the nose... see below)
LENGTH = 73.9
TAIL_Y = NOSE_Y - LENGTH

class Builder:
    def __init__(self): self.parts = {}
    def add(self, material, verts, faces, smooth=False):
        v, f, s = self.parts.setdefault(material, ([], [], []))
        o = len(v); v.extend(verts); f.extend([tuple(i + o for i in face) for face in faces]); s.extend([smooth] * len(faces))
    def box(self, m, c, size, rot=None):
        cx, cy, cz = c; sx, sy, sz = size
        pts = [(cx + dx * sx / 2, cy + dy * sy / 2, cz + dz * sz / 2) for dz in (-1, 1) for dy in (-1, 1) for dx in (-1, 1)]
        if rot: pts = [rot(p) for p in pts]
        self.add(m, pts, [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])
    def loft(self, m, rings, close_start=False, close_end=False, smooth=True, cap_material=None):
        # rings: list of lists of 3D points, same length; quads between consecutive rings
        n = len(rings[0]); verts = [p for r in rings for p in r]; faces = []
        for k in range(len(rings) - 1):
            for i in range(n):
                a, b = k * n + i, k * n + (i + 1) % n
                faces.append((a, b, b + n, a + n))
        if close_start: faces.append(tuple(range(n - 1, -1, -1)))
        if close_end: faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
        self.add(m, verts, faces, smooth)
    def build(self, name):
        for mname, (v, f, s) in sorted(self.parts.items()):
            me = bpy.data.meshes.new(f'{name}_{mname}')
            me.from_pydata(v, [], f)
            me.validate(); me.update()
            for poly, sm in zip(me.polygons, s): poly.use_smooth = sm
            me.materials.append(MATS[mname])
            ob = bpy.data.objects.new(f'{name}_{mname}', me)
            bpy.context.scene.collection.objects.link(ob)

def ring(cy, cz, rx, rz, seg, phase=0.0, squash_bottom=0.0):
    out = []
    for i in range(seg):
        a = 2 * math.pi * i / seg + phase
        x, z = math.cos(a) * rx, math.sin(a) * rz
        if z < 0: z *= (1 - squash_bottom)
        out.append((x, cy, cz + z))
    return out

def fuselage(B, lod):
    seg = 36 if lod == 0 else 18 if lod == 1 else 10
    cl = GROUND_TO_CL
    # stations from the nose (0) to the tail (LENGTH): (s, radius factor, centre offset, bottom squash)
    prof = []
    nose = [(0.0, 0.05, -0.55), (0.35, 0.22, -0.5), (1.0, 0.42, -0.42), (2.0, 0.6, -0.32), (3.2, 0.76, -0.2), (4.6, 0.88, -0.1), (6.2, 0.96, -0.03), (8.5, 1.0, 0.0)]
    for s, k, dz in nose: prof.append((s, k, dz, 0.0))
    for s in (12, 20, 30, 40, 50, 56, 60): prof.append((s, 1.0, 0.0, 0.0))
    tail = [(63, 0.94, 0.25, 0.15), (66, 0.8, 0.7, 0.3), (69, 0.6, 1.3, 0.4), (71.5, 0.4, 1.85, 0.45), (73.2, 0.2, 2.25, 0.4), (LENGTH, 0.06, 2.4, 0.0)]
    prof += tail
    if lod == 2: prof = [p for i, p in enumerate(prof) if i % 2 == 0 or p[0] in (0.0, LENGTH, 8.5, 60)]
    rings = [ring(NOSE_Y - s, cl + dz, R * k, R * k, seg, phase=math.pi / seg, squash_bottom=sq) for s, k, dz, sq in prof]
    # livery by face height: belly below cl - 1.6, blue cheatline band, white above — split the loft into three lofts
    def band(lo, hi, mat):
        rs = []
        for r in rings:
            rs.append([(x, y, min(max(z, lo), hi)) if False else (x, y, z) for x, y, z in r])
        return rs
    B.loft('white', rings, close_start=True, close_end=True, smooth=True)
    # cheatline + belly as slightly offset shells (2 cm) over the lower part only, cut by height
    if lod < 2:
        shell = lambda r, k: [(x * k, y, cl + (z - cl) * k) for x, y, z in r]
        def partial(mat, zlo, zhi, k):
            pts, faces = [], []
            rs = [shell(r, k) for r in rings]
            n = len(rs[0])
            for ri in range(len(rs) - 1):
                for i in range(n):
                    quad = [rs[ri][i], rs[ri][(i + 1) % n], rs[ri + 1][(i + 1) % n], rs[ri + 1][i]]
                    zc = sum(p[2] for p in quad) / 4
                    if zlo <= zc < zhi and 8.0 <= NOSE_Y - quad[0][1] <= 63:
                        o = len(pts); pts.extend(quad); faces.append((o, o + 1, o + 2, o + 3))
            if faces: B.add(mat, pts, faces, True)
        partial('belly', -99, cl - 1.55, 1.006)
        partial('blue', cl - 1.55, cl - 0.95, 1.006)
    # cockpit windows: dark patches on the nose rings (stations 3.2–5.6, 25°–70° from the top, both sides)
    if lod < 2:
        pts, faces = [], []
        for si in range(len(prof) - 1):
            s0, s1 = prof[si][0], prof[si + 1][0]
            if not (3.0 <= s0 and s1 <= 6.3): continue
            r0, r1 = rings[si], rings[si + 1]
            n = len(r0)
            for i in range(n):
                a = (2 * math.pi * i / n + math.pi / n) % (2 * math.pi)  # angle from +x
                up = abs(((a - math.pi / 2 + math.pi) % (2 * math.pi)) - math.pi)  # angle from the top
                if math.radians(22) <= up <= math.radians(72):
                    quad = [r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i]]
                    quad = [(x * 1.012, y, cl + (z - cl) * 1.012) for x, y, z in quad]
                    o = len(pts); pts.extend(quad); faces.append((o, o + 1, o + 2, o + 3))
        B.add('glass', pts, faces, True)
        # cabin window band
        y0, y1 = NOSE_Y - 9.0, NOSE_Y - 60.0
        for sx in (-1, 1):
            x = sx * (R * 0.985)
            B.add('glass', [(x * 1.02, y0, cl + 0.55), (x * 1.02, y1, cl + 0.55), (x * 1.02, y1, cl + 0.95), (x * 1.02, y0, cl + 0.95)], [(0, 1, 2, 3) if sx > 0 else (3, 2, 1, 0)])

def airfoil(chord, thick, camber=0.02, n=10, flap_deflect=0.0, flap_frac=0.0):
    # closed section in the (y forward, z up) plane, leading edge at y = 0 going aft (negative y); returns list of (dy, dz)
    pts = []
    for i in range(n):  # upper surface LE -> TE
        t = i / (n - 1); x = 0.5 - 0.5 * math.cos(math.pi * t)
        yt = 5 * thick * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4)
        pts.append((-x * chord, (camber * math.sin(math.pi * x) + yt) * chord))
    for i in range(n - 2, 0, -1):  # lower surface TE -> LE
        t = i / (n - 1); x = 0.5 - 0.5 * math.cos(math.pi * t)
        yt = 5 * thick * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4)
        pts.append((-x * chord, (camber * math.sin(math.pi * x) - yt) * chord))
    return pts

def wing(B, lod, side):
    # planform (x = spanwise from the fuselage centre, y = LE station from the nose)
    ROOT_S, ROOT_C = 27.5, 14.5     # root LE station, chord at the fuselage side
    KINK_X, KINK_C = 11.0, 9.2
    TIP_X, TIP_C = 32.4, 2.6
    sweep = math.tan(math.radians(31.6))
    dihedral = math.tan(math.radians(6.0))
    cl = GROUND_TO_CL - 1.35        # wing root chord plane below the centreline (low wing)
    xs = [2.6, 6.5, KINK_X, 17, 23, 28.5, TIP_X] if lod == 0 else [2.6, KINK_X, 23, TIP_X] if lod == 1 else [2.6, KINK_X, TIP_X]
    def chord_at(x):
        if x <= KINK_X: return ROOT_C + (KINK_C - ROOT_C) * (x - 2.6) / (KINK_X - 2.6)
        return KINK_C + (TIP_C - KINK_C) * (x - KINK_X) / (TIP_X - KINK_X)
    def le_at(x):
        base = ROOT_S + (x - 2.6) * sweep
        if x > 30.0: base += (x - 30.0) * (math.tan(math.radians(52)) - sweep)  # raked tip
        return base
    n = 12 if lod == 0 else 8 if lod == 1 else 5
    rings = []
    for x in xs:
        c = chord_at(x); le = le_at(x); thick = 0.13 - 0.05 * (x - 2.6) / (TIP_X - 2.6)
        sec = airfoil(c, thick, 0.025, n)
        z0 = cl + (x - 2.6) * dihedral + 0.3 * (1 - min(1, (x - 2.6) / 6))  # root fairing lifts slightly
        rings.append([(side * x, NOSE_Y - le + dy, z0 + dz) for dy, dz in sec])
    B.loft('wing', rings, close_start=False, close_end=True, smooth=True)
    # flaps 30 (inboard 3.6–10.5 m, outboard 12.5–27 m): plates hinged 0.02 chord ahead of the trailing edge
    if lod < 2:
        for xa, xb, cf in ((3.4, 10.5, 3.3), (12.5, 27.0, 2.3)):
            pts = []
            for x in (xa, xb):
                c = chord_at(x); te = NOSE_Y - le_at(x) - c; z0 = cl + (x - 2.6) * dihedral + 0.05
                hinge_y = te + cf * 0.15
                ang = math.radians(30)
                for k in range(3):
                    f = k / 2
                    y = hinge_y - cf * f * math.cos(ang); z = z0 - cf * f * math.sin(ang)
                    pts.append((side * x, y, z + 0.09)); pts.append((side * x, y, z - 0.09))
            faces = []
            for k in range(2):
                a = k * 2
                faces.append((a, a + 2, a + 8, a + 6)); faces.append((a + 1, a + 7, a + 9, a + 3))
            faces.append((4, 10, 11, 5)); faces.append((0, 1, 7, 6))
            B.add('wing', pts, faces, False)
    # engine (GE90-115B class): nacelle centred 9.7 m out, ahead of and below the leading edge
    ex = 9.7 * side
    le = NOSE_Y - le_at(9.7); zw = cl + (9.7 - 2.6) * dihedral
    ecy, ecz = le + 3.9, zw - 2.55
    seg = 28 if lod == 0 else 14 if lod == 1 else 8
    nac = [(0.0, 1.62), (0.25, 1.9), (0.8, 2.05), (2.0, 2.08), (4.5, 2.02), (6.2, 1.8), (7.3, 1.45)]
    if lod == 2: nac = [nac[0], nac[2], nac[4], nac[6]]
    B.loft('nacelle', [ring(ecy - s, ecz, r, r, seg) for s, r in nac], smooth=True)
    # intake lip inner wall and fan face
    B.loft('dark', [ring(ecy - 0.0, ecz, 1.62, 1.62, seg), ring(ecy - 0.9, ecz, 1.45, 1.45, seg)], close_end=True, smooth=True)
    # core exhaust cone
    B.loft('dark', [ring(ecy - 7.3, ecz, 1.45, 1.45, seg), ring(ecy - 8.6, ecz, 0.9, 0.9, seg), ring(ecy - 10.2, ecz, 0.25, 0.25, seg)], close_end=True, smooth=True)
    # pylon
    B.box('wing', (ex, ecy - 4.6, (ecz + zw - 0.25) / 2), (0.9, 5.0, max(0.6, zw - 0.25 - ecz)))
    # navigation light at the tip (red port, green starboard), strobe white at the trailing edge
    tipy = NOSE_Y - le_at(TIP_X) - 0.6
    B.box('nav_red' if side < 0 else 'nav_green', (side * (TIP_X - 0.25), tipy, cl + (TIP_X - 2.6) * dihedral + 0.05), (0.35, 0.6, 0.25))
    # main landing gear: 6-wheel bogie under the wing root, 5.5 m off the centreline
    if lod < 2:
        gx = side * 5.5; gy = 0.0
        B.box('metal', (gx, gy, GROUND_TO_CL - 2.4), (0.5, 0.5, 4.2))            # strut
        B.box('metal', (gx, gy, 0.7), (0.4, 3.4, 0.35))                          # bogie beam
        for ay in (-1.45, 0.0, 1.45):
            for wx in (-0.75, 0.75):
                B.loft('tyre', [ring(0, 0, 0, 0, 1)] if False else [
                    [(gx + wx - 0.24, gy + ay + math.cos(a) * 0.66, 0.66 + math.sin(a) * 0.66) for a in [2 * math.pi * i / 10 for i in range(10)]],
                    [(gx + wx + 0.24, gy + ay + math.cos(a) * 0.66, 0.66 + math.sin(a) * 0.66) for a in [2 * math.pi * i / 10 for i in range(10)]]],
                    close_start=True, close_end=True, smooth=True)

def tail(B, lod):
    cl = GROUND_TO_CL
    # horizontal stabiliser
    span, rc, tc = 10.75, 6.8, 2.6
    sweep = math.tan(math.radians(35)); dih = math.tan(math.radians(7))
    n = 8 if lod < 2 else 5
    for side in (-1, 1):
        rings = []
        for x in (0.6, span * 0.55, span) if lod == 0 else (0.6, span):
            c = rc + (tc - rc) * (x - 0.6) / (span - 0.6); le = 62.3 + (x - 0.6) * sweep
            rings.append([(side * x, NOSE_Y - le + dy, cl + 0.55 + (x - 0.6) * dih + dz) for dy, dz in airfoil(c, 0.09, 0.0, n)])
        B.loft('wing', rings, close_end=True, smooth=True)
    # vertical fin
    h, rc, tc = 9.9, 12.4, 4.2
    sweep = math.tan(math.radians(41))
    rings = []
    for z in (0.0, h * 0.5, h) if lod == 0 else (0.0, h):
        c = rc + (tc - rc) * z / h; le = 57.6 + z * sweep
        sec = airfoil(c, 0.09, 0.0, n)
        rings.append([(dz, NOSE_Y - le + dy, cl + R * 0.92 + z) for dy, dz in sec])  # section stands upright: thickness along x
    B.loft('blue', rings, close_end=True, smooth=True)
    # tail nav light, beacons
    B.box('nav_white', (0, TAIL_Y + 0.3, cl + 2.35), (0.3, 0.3, 0.3))
    B.box('beacon', (0, NOSE_Y - 34, cl + R + 0.1), (0.35, 0.5, 0.25))
    B.box('beacon', (0, NOSE_Y - 34, cl - R - 0.1), (0.35, 0.5, 0.25))

def nose_gear(B, lod):
    if lod == 2: return
    gy = NOSE_Y - 10.5
    B.box('metal', (0, gy, GROUND_TO_CL - 2.9), (0.4, 0.4, 5.0))
    for wx in (-0.5, 0.5):
        B.loft('tyre', [
            [(wx - 0.2, gy + math.cos(a) * 0.55, 0.55 + math.sin(a) * 0.55) for a in [2 * math.pi * i / 10 for i in range(10)]],
            [(wx + 0.2, gy + math.cos(a) * 0.55, 0.55 + math.sin(a) * 0.55) for a in [2 * math.pi * i / 10 for i in range(10)]]],
            close_start=True, close_end=True, smooth=True)
    # landing lights on the nose gear
    B.box('nav_white', (0, gy + 0.4, 1.6), (0.5, 0.2, 0.3))

for lod in (0, 1, 2):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    B = Builder()
    fuselage(B, lod)
    for side in (-1, 1): wing(B, lod, side)
    tail(B, lod)
    nose_gear(B, lod)
    B.build(f'b77w_lod{lod}')
    path = os.path.join(OUT, f'b77w_lod{lod}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_materials='EXPORT', export_texcoords=False, export_normals=True,
                              export_extras=False, export_cameras=False, export_lights=False, use_selection=False)
    print('wrote', path)
