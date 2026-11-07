# 로컬 글꼴

GowunDodum-Regular.woff2: 앱 화면용 기존 번들.
GowunDodum-Regular.ttf: PDF용 정적 TrueType 원본. Google Fonts `ofl/gowundodum/GowunDodum-Regular.ttf`에서 2026-11-07 취득. 저작권/라이선스는 `public/licenses/GowunDodum-OFL-1.1.txt`(SIL OFL 1.1)와 동일하다.

출처: https://github.com/google/fonts/blob/main/ofl/gowundodum/GowunDodum-Regular.ttf

PDF는 TTF를 전체 포함한다. WOFF2 포함은 빈 페이지, TTF의 fontkit 부분 포함은 일부 글자 누락을 재현했으므로 단순 파일 크기/텍스트 추출 대신 실제 페이지 렌더링으로 회귀를 검사한다. 실행 중 외부 글꼴을 다운로드하지 않는다.
a6e457933227483a11758fd0947bc74422a106d46f0bf057fdaa5af94a30067d  src/shared/fonts/GowunDodum-Regular.ttf
