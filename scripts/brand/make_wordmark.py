"""Work Journey Board 워드마크(타이틀) SVG 생성기 — 디자인 시점 도구. 앱 실행·빌드와 무관하다.

타이틀은 글꼴 파일을 앱에 넣지 않고 글자 윤곽을 SVG 도형으로 만들어 넣는다(OFL: 글꼴로 만든 그림·로고는 제약 없음).
  Work · Board : Bricolage Grotesque 700, opsz 96 (SIL OFL 1.1)
  Journey      : Caveat 700 손글씨, 1.42배 · -4° 기울임 · 밑줄 (SIL OFL 1.1)
손글씨는 기울임·밑줄까지 포함한 실제 외곽으로 전체 영역(viewBox)을 잡는다 → 위아래 요소와 겹치지 않는다.

준비(scripts/brand/README.md):  pip install fonttools uharfbuzz  +  글꼴 2개를 --fonts 폴더에
실행:  python3 scripts/brand/make_wordmark.py --fonts <폴더> --out src/shared/brand/wordmark.svg
"""

import argparse
import math
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

BASE_FILE = "Bricolage-96-700.ttf"
HAND_FILE = "Caveat-700.ttf"

EM = 1000  # 워드마크 좌표계: 본문 글자 크기 = 1000
TRACK = -0.03  # Work·Board 자간(em)
HAND_SCALE = 1.36  # Journey 크기
HAND_ROT = 3.5  # Journey 기울기(도) — 오른쪽이 올라가게(글꼴 좌표는 위가 +라 반시계가 +)
HAND_DROP = 0.04  # Journey 기준선을 살짝 내림(em)
GAP_BEFORE = 0.20  # Work 끝 ↔ Journey 시작(em, 기울인 외곽 기준)
GAP_AFTER = 0.24  # Journey 끝 ↔ Board 시작(em)
UNDER_Y = 0.13  # 밑줄 위치: Journey 기준선 아래(em)
UNDER_W = 0.045  # 밑줄 굵기(em)
PAD = 0.04  # 바깥 여백(em)
ACCENT = "#d85a30"  # 라이트 기본값 — 화면에서는 CSS(.wm-j)가 테마 색으로 덮어쓴다


class Face:
    def __init__(self, path: Path):
        self.tt = TTFont(path)
        self.glyphs = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        self.upm = self.tt["head"].unitsPerEm
        blob = hb.Blob.from_file_path(str(path))
        self.hb = hb.Font(hb.Face(blob))

    def shape(self, text: str):
        """[(글리프 이름, x 위치, x 전진)] — 커닝 포함, 글꼴 단위."""
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb, buf, {"kern": True, "liga": True})
        out, x = [], 0
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            out.append((self.order[info.codepoint], x + pos.x_offset, pos.x_advance))
            x += pos.x_advance
        return out


def affine(scale, rot_deg, tx, ty, origin=(0.0, 0.0)):
    """글꼴 좌표(위가 +) → SVG 좌표(아래가 +).
    놓기: q = k·p + T,  기울이기: q' = R·(q − o) + o,  마지막에 y 뒤집기. fontTools 순서 (xx, xy, yx, yy, dx, dy)."""
    r = math.radians(rot_deg)
    c, s = math.cos(r), math.sin(r)
    ox, oy = origin
    dx = c * (tx - ox) - s * (ty - oy) + ox
    dy = s * (tx - ox) + c * (ty - oy) + oy
    return (c * scale, -s * scale, -s * scale, -c * scale, dx, -dy)


def draw_word(face: Face, text: str, size: float, track: float, cursor):
    """글자 윤곽(path d)과 외곽 상자(SVG 좌표). track = 자간(em)."""
    d_parts, bounds = [], None
    k = size / face.upm
    for name, _, adv in face.shape(text):
        t = cursor.transform()
        sp = SVGPathPen(face.glyphs)
        face.glyphs[name].draw(TransformPen(sp, t))
        d_parts.append(sp.getCommands())
        bp = BoundsPen(face.glyphs)
        face.glyphs[name].draw(TransformPen(bp, t))
        if bp.bounds:
            bounds = bp.bounds if bounds is None else union(bounds, bp.bounds)
        cursor.advance(adv * k + track * size)
    return " ".join(p for p in d_parts if p), bounds


def union(a, b):
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


class Cursor:
    """글자마다 x를 누적하며 같은 변환(크기·회전·이동)을 적용한다."""

    def __init__(self, scale, rot, tx, ty, origin):
        self.scale, self.rot, self.tx, self.ty, self.origin = scale, rot, tx, ty, origin
        self.x = 0.0

    def transform(self):
        return affine(self.scale, self.rot, self.tx + self.x, self.ty, self.origin)

    def advance(self, dx):
        self.x += dx


def word_width(face, text, size, track):
    k = size / face.upm
    glyphs = face.shape(text)
    return sum(adv * k for _, _, adv in glyphs) + track * size * (len(glyphs) - 1)


def build(fonts: Path) -> str:
    base, hand = Face(fonts / BASE_FILE), Face(fonts / HAND_FILE)
    kb, kh = EM / base.upm, EM * HAND_SCALE / hand.upm

    # 1) Work — 기준선 y=0
    work_d, work_b = draw_word(base, "Work", EM, TRACK, Cursor(kb, 0, 0, 0, (0, 0)))

    # 2) Journey — 먼저 회전 전 폭으로 중심을 잡고, 기울인 실제 외곽으로 위치를 맞춘다
    jw = word_width(hand, "Journey", EM * HAND_SCALE, 0)
    drop = -HAND_DROP * EM  # 글꼴 좌표는 위가 +

    def journey_at(x0):
        origin = (x0 + jw / 2, drop)
        return draw_word(hand, "Journey", EM * HAND_SCALE, 0, Cursor(kh, HAND_ROT, x0, drop, origin)), origin

    (_, jb0), _ = journey_at(0)
    x0 = work_b[2] + GAP_BEFORE * EM - jb0[0]
    (j_d, j_b), origin = journey_at(x0)

    # 밑줄: Journey 기준선 아래 손으로 그은 듯한 곡선, Journey와 같은 회전
    uy = drop - UNDER_Y * EM
    p0, p1, p2, p3 = (x0 + 0.02 * jw, uy + 10), (x0 + 0.30 * jw, uy + 70), (x0 + 0.68 * jw, uy + 62), (x0 + 0.97 * jw, uy + 22)
    t = affine(1, HAND_ROT, 0, 0, origin)

    def tp(p):
        x, y = p
        return (t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5])

    q = [tp(p) for p in (p0, p1, p2, p3)]
    under_d = "M{:.1f} {:.1f}C{:.1f} {:.1f} {:.1f} {:.1f} {:.1f} {:.1f}".format(*q[0], *q[1], *q[2], *q[3])
    half = UNDER_W * EM / 2
    under_b = (min(p[0] for p in q) - half, min(p[1] for p in q) - half, max(p[0] for p in q) + half, max(p[1] for p in q) + half)

    # 3) Board
    bx = j_b[2] + GAP_AFTER * EM
    board_d, board_b = draw_word(base, "Board", EM, TRACK, Cursor(kb, 0, bx, 0, (0, 0)))

    box = union(union(union(work_b, j_b), under_b), board_b)
    pad = PAD * EM
    vx, vy = box[0] - pad, box[1] - pad
    vw, vh = box[2] - box[0] + 2 * pad, box[3] - box[1] + 2 * pad
    base_d = f"{work_d} {board_d}"
    return (
        f'<svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.0f} {vy:.0f} {vw:.0f} {vh:.0f}" '
        f'role="img" aria-label="Work Journey Board">'
        f'<path class="wm-b" fill="currentColor" d="{base_d}"/>'
        f'<path class="wm-j" fill="{ACCENT}" d="{j_d}"/>'
        f'<path class="wm-u" fill="none" stroke="{ACCENT}" stroke-width="{UNDER_W * EM:.0f}" stroke-linecap="round" d="{under_d}"/>'
        f"</svg>\n"
    )


def compact(svg: str) -> str:
    """좌표를 소수 1자리로 줄인다(파일 크기)."""
    import re

    return re.sub(r"-?\d+\.\d+", lambda m: f"{float(m.group()):.1f}".rstrip("0").rstrip("."), svg)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonts", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(compact(build(a.fonts)), encoding="utf-8")
    print(f"wrote {a.out}")
