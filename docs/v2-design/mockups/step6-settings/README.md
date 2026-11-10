# A안 · 설정 화면 연결 검토

A안은 사용자 선택으로 확정했다. 화면 controller와 별도 SQLite registry/실행 분기 reference를 연결한 **가상 데이터 전용 PoC**다. 제품 UI·Tauri native 구현이 아니다.

```sh
node poc/v2-runtime/settings-review-server.mjs
# http://127.0.0.1:14621
PW_CHROMIUM_PATH=/usr/bin/chromium node docs/v2-design/mockups/step6-settings/verify.mjs
```

정적 파일만 여는 대신 위 실행기를 사용한다. 실제 원본·계정·Cloud를 읽지 않는다. 생성/로그인/받기는 후속 단계까지 비활성이고 온라인 열기는 제품용 증표 미완료로 차단한다. 가상 저장 실패 조건과 연결 표시 상태를 펼쳐 확인할 수 있다.

[일반](a-settings.png) · [다크](a-settings-dark.png) · [좁은 창](a-settings-narrow.png) · [저장 실패](a-save-failure.png) · [온라인 열기 차단](a-online-gated.png) · [설계/제약/다음 단계](../../70-a-settings-bridge-integration.md)
