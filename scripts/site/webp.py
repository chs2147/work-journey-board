# PNG → WebP(폭 맞춤, 화질 82) — scripts/site/shots.mjs에서 부른다.  python3 webp.py 원본.png 결과.webp 폭
import sys
from PIL import Image

src, dst, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert("RGB")
if im.width > width:
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
im.save(dst, "WEBP", quality=82, method=6)
print(dst, im.size)
