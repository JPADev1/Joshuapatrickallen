"""Render a pine-bough garland with cranberries for the top of the primetime billboard.
Coordinates are in CSS px of the 520x80 lamp area; drawn at S x and downsampled for antialiasing.
Writes garland-back.webp (behind the lamp stems) and garland-front.webp (in front)."""
import math, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 520, 80          # CSS px
S = 8                   # supersample factor while drawing
OUT = 2                 # output scale (retina)
random.seed(7)

LAMPS = [520 * .17, 520 * .50, 520 * .83]

def bez(p0, p1, p2, p3, n):
    pts = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        pts.append((u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0],
                    u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]))
    return pts

def swag(a, b, dip):
    """Hanging curve from a to b whose lowest point sits near y=dip."""
    mx = (a[0] + b[0]) / 2
    return bez(a, (a[0] + (mx - a[0]) * .55, dip + 6), (b[0] - (b[0] - mx) * .55, dip + 6), b, 80)

# --- build the garland path as (points, layer) segments ---
segs = []
RAIL_L, RAIL_R, RY = 18, 502, 8
# left end: tail hanging off the rail end
segs.append((bez((RAIL_L, RY), (RAIL_L - 4, 18), (RAIL_L + 3, 28), (RAIL_L - 1, 38), 40), 'f'))
prev = (RAIL_L, RY)
for i, x in enumerate(LAMPS):
    entry = (x - 11, 11)
    segs.append((swag(prev, entry, 40 if i == 0 else 48), 'f'))
    # spiral round the stem: front down-right, behind back left, front out to the right
    segs.append((bez(entry, (x - 4, 10), (x + 6, 13), (x + 9, 16), 30), 'f'))
    segs.append((bez((x + 9, 16), (x + 6, 20), (x - 4, 20), (x - 9, 23), 30), 'b'))
    segs.append((bez((x - 9, 23), (x - 5, 28), (x + 5, 29), (x + 11, 30), 30), 'f'))
    prev = (x + 11, 30)
segs.append((swag(prev, (RAIL_R, RY), 40), 'f'))
segs.append((bez((RAIL_R, RY), (RAIL_R + 4, 18), (RAIL_R - 3, 28), (RAIL_R + 1, 38), 40), 'f'))

def resample(pts, step):
    out = [pts[0]]; acc = 0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        d = math.hypot(x1 - x0, y1 - y0); acc += d
        while acc >= step:
            acc -= step; f = 1 - acc / d if d else 0
            out.append((x0 + (x1 - x0) * f, y0 + (y1 - y0) * f))
    return out

GREENS_DARK = [(18, 44, 24), (22, 52, 28), (16, 38, 22), (26, 58, 30)]
GREENS_MID = [(34, 78, 40), (40, 88, 44), (30, 70, 38), (46, 96, 48), (52, 104, 50)]
GREENS_TIP = [(86, 132, 70), (96, 140, 74), (78, 120, 62), (110, 150, 80)]

def needles(draw, pts, passes):
    """passes: list of (palette, count per sample, spread, length range, width)."""
    for pal, cnt, spread, (l0, l1), wd in passes:
        for k in range(1, len(pts) - 1):
            (x0, y0), (x1, y1) = pts[k - 1], pts[k + 1]
            tx, ty = x1 - x0, y1 - y0; tl = math.hypot(tx, ty) or 1; tx /= tl; ty /= tl
            nx, ny = -ty, tx
            for _ in range(cnt):
                o = random.uniform(-spread, spread); along = random.uniform(-1, 1)
                bx, by = pts[k][0] + nx * o + tx * along, pts[k][1] + ny * o + ty * along
                # needles point back along the bough and outward, like real pine
                side = 1 if o >= 0 else -1
                ang = math.atan2(-ty, -tx) + side * random.uniform(.35, 1.45) + random.uniform(-.2, .2)
                if random.random() < .25: ang += math.pi
                L = random.uniform(l0, l1)
                ex, ey = bx + math.cos(ang) * L, by + math.sin(ang) * L
                c = random.choice(pal); j = random.randint(-6, 6)
                col = (max(0, c[0] + j), max(0, c[1] + j), max(0, c[2] + j), 255)
                draw.line([(bx * S, by * S), (ex * S, ey * S)], fill=col, width=max(1, int(wd * S)))

def berry_sprite(r):
    """Shaded cranberry sphere, r in supersampled px."""
    n = int(r * 2 + 4); yy, xx = np.mgrid[0:n, 0:n].astype(float)
    cx = cy = n / 2; dx, dy = (xx - cx) / r, (yy - cy) / r; d2 = dx * dx + dy * dy
    inside = d2 <= 1; dz = np.sqrt(np.clip(1 - d2, 0, 1))
    L = np.array([-.45, -.6, .66]); L /= np.linalg.norm(L)
    lam = np.clip(dx * L[0] + dy * L[1] + dz * L[2], 0, 1)
    # Blinn specular toward the viewer
    Hh = L + np.array([0, 0, 1]); Hh /= np.linalg.norm(Hh)
    spec = np.clip(dx * Hh[0] + dy * Hh[1] + dz * Hh[2], 0, 1) ** 40
    base = np.array([150, 10, 30]); dark = np.array([60, 0, 12])
    col = dark[None, None] + (base - dark)[None, None] * lam[..., None] * 1.25
    col = col + np.array([255, 235, 235])[None, None] * spec[..., None] * .9
    rim = np.clip((d2 - .75) / .25, 0, 1)[..., None]                 # warm bounce on the lower rim
    col = col * (1 - rim * .35) + np.array([120, 20, 20]) * rim * .35
    a = np.clip((1 - np.sqrt(d2)) * r / 1.2, 0, 1) * 255             # soft antialiased edge
    img = np.dstack([np.clip(col, 0, 255), a]).astype(np.uint8)
    return Image.fromarray(img, 'RGBA')

def render(layer):
    im = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    berries = []
    for pts, lay in segs:
        if lay != layer: continue
        p = resample(pts, .9)
        tail = pts is segs[0][0] or pts is segs[-1][0]
        wrap = len(pts) == 31                     # the short passes around a lamp stem: thinner so the stem shows between them
        sp = 2.4 if wrap else (3.6 if tail else 4.8); f = .62 if wrap else 1
        needles(d, p, [(GREENS_DARK, 9, sp, (4.5 * f, 8.0 * f), .5),
                       (GREENS_MID, 8, sp * .85, (4.0 * f, 7.0 * f), .46),
                       (GREENS_TIP, 3, sp * .75, (2.6 * f, 4.6 * f), .36)])
        # cranberries tucked through the boughs, in little clusters
        q = resample(pts, 1.0); k = random.randint(2, 8)
        while k < len(q):
            n = random.choice([1, 2, 2, 3])
            for _ in range(n):
                berries.append((q[k][0] + random.uniform(-3.2, 3.2), q[k][1] + random.uniform(-3.2, 3.2), random.uniform(1.8, 2.5)))
            k += random.randint(9, 15)
    # a few needles over some berries so they sit inside the garland, not on top
    random.shuffle(berries)
    for i, (x, y, r) in enumerate(berries):
        spr = berry_sprite(r * S)
        im.alpha_composite(spr, (int(x * S - spr.width / 2), int(y * S - spr.height / 2)))
    over = Image.new('RGBA', im.size, (0, 0, 0, 0)); od = ImageDraw.Draw(over)
    for pts, lay in segs:
        if lay != layer: continue
        p = resample(pts, 2.4)
        needles(od, p, [(GREENS_MID, 2, 4.2, (3.4, 6.0), .42), (GREENS_TIP, 1, 3.6, (2.4, 4.0), .34)])
    im.alpha_composite(over)
    # soft shadow under the garland for depth
    a = im.split()[3].filter(ImageFilter.GaussianBlur(S * 1.6))
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0)); sh.putalpha(a.point(lambda v: int(v * .55)))
    base = Image.new('RGBA', im.size, (0, 0, 0, 0)); base.alpha_composite(sh, (0, int(S * 1.6))); base.alpha_composite(im)
    return base.resize((W * OUT, H * OUT), Image.LANCZOS)

out = sys.argv[1] if len(sys.argv) > 1 else '.'
for layer, name in (('b', 'garland-back'), ('f', 'garland-front')):
    render(layer).save(f'{out}/{name}.webp', 'WEBP', quality=88, method=6)
    print(name, 'ok')
