# 설치 프로그램 그림 PNG → NSIS BMP(24비트, 알파 없음) — 디자인 시점 도구(release-phase2-spec 3절).
# 실행: python3 scripts/brand/pack_installer.py <render_installer.mjs 출력 폴더>
# 결과: src-tauri/installer/sidebar.bmp(164×314) · header.bmp(150×57) — tauri.conf.json nsis.sidebarImage·headerImage
import sys
from pathlib import Path

from PIL import Image

src = Path(sys.argv[1])
dst = Path("src-tauri/installer")
dst.mkdir(parents=True, exist_ok=True)
for name, size in (("sidebar", (164, 314)), ("header", (150, 57))):
    im = Image.open(src / f"{name}.png").convert("RGB")
    assert im.size == size, f"{name}: {im.size} != {size}"
    im.save(dst / f"{name}.bmp", format="BMP")
    print(f"{name}.bmp {size}")
