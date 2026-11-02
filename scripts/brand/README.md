# scripts/brand — 앱 아이콘·워드마크 만들기(디자인 시점 도구)

앱 실행·빌드와 관계없다. 결과물(`src/shared/brand/*.svg`, `src-tauri/icons/*`)만 저장소에 들어가고, 글꼴 파일은 앱에 넣지 않는다.
규칙과 치수는 [docs/brand-spec.md](../../docs/brand-spec.md).

## 워드마크 다시 만들기
1. 도구: `pip install fonttools uharfbuzz`
2. 글꼴(SIL OFL 1.1) — Google Fonts API에서 정적 인스턴스를 받는다(이 단계만 인터넷 사용):
   ```bash
   mkdir -p /tmp/wjb-fonts
   for q in "Bricolage+Grotesque:opsz,wght@96,700|Bricolage-96-700" "Caveat:wght@700|Caveat-700"; do
     url=$(curl -s "https://fonts.googleapis.com/css2?family=${q%%|*}" | grep -o 'https://fonts.gstatic.com[^)]*')
     curl -s -o "/tmp/wjb-fonts/${q##*|}.ttf" "$url"
   done
   ```
3. `python3 scripts/brand/make_wordmark.py --fonts /tmp/wjb-fonts --out src/shared/brand/wordmark.svg`
4. **`splash.html`의 `.name` 안 SVG를 새 파일 내용으로 바꾼다**(스플래시는 스크립트 없이 그려야 해서 그림을 직접 품고 있다). `tests/unit/brand.test.ts`가 두 곳이 같은지 검사한다.

## 아이콘 다시 만들기
`src/shared/brand/icon.svg`(48px 이상)·`icon-small.svg`(16~32px)를 고친 뒤:
```bash
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/brand/render_icons.mjs /tmp/wjb-icons
python3 scripts/brand/pack_icons.py /tmp/wjb-icons src-tauri/icons
```
`icon.svg`를 바꿨다면 `splash.html`의 `.logo` 안 SVG도 같이 바꾼다(위와 같은 이유·같은 테스트).

## 설치 프로그램 그림(release-phase2-spec 3절 A안·5절 B3)

```bash
node scripts/brand/render_installer.mjs /tmp/inst      # 왼쪽 그림 164×314 · 머리 그림 150×57 PNG
python3 scripts/brand/pack_installer.py /tmp/inst      # → src-tauri/installer/sidebar.bmp · header.bmp(24비트)
```

- 왼쪽 그림 = 앱 아이콘 + 워드마크(시그니처 본문색) + 한 줄 소개 + 업무 색 세 줄 + 만든 이 sanbonjini M1(공식 SVG, 높이 40px).
- `tauri.conf.json` `bundle.windows.nsis.sidebarImage`·`headerImage`·`installerIcon`이 이 파일을 쓴다.
- macOS DMG 창 배경 660×400(macos-spec 3-6): 같은 명령이 `dmg-background.png`도 그린다 → `cp /tmp/inst/dmg-background.png src-tauri/installer/`. `tauri.macos.conf.json` `bundle.macOS.dmg.background`가 쓴다(앱 아이콘 (180,200) → 응용 프로그램 폴더 (480,200)).
