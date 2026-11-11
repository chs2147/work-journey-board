# V2 Native Isolation

사용자가 별도 **Connected Preview 검증판**을 선택한 뒤 작성한 독립 Rust 라이브러리다. 정식 V2의 최종 이름/배포 채널을 확정한 것이 아니다. Classic Tauri 앱에 링크하거나 설치판을 만들지 않았다.

- `profiles.tsv`: Node/Rust 공통 프로필 정본.
- `src/policy.rs`: 명시적 profile·DEV/PROD project·별도 설정/registry/cache 경로와 원본 보호 검사.
- `src/vault.rs`: Preview+online에서만 만드는 계정/기기별 refresh token 저장 경계. secret은 Debug에서 가리고 소유 버퍼를 drop 때 지운다.
- `src/system_vault.rs`: Windows Credential Manager/macOS Keychain 호출 소스. Linux에서는 UnsupportedPlatform, 파일 저장 fallback 없음.
- `preview-bootstrap-contract.json`: 현재 준비 상태 기록. **실행 가능한 Tauri 설정/설치 프로그램이 아니다.**

```sh
cargo test --offline --manifest-path poc/v2-native/Cargo.toml
cargo check --offline --manifest-path poc/v2-native/Cargo.toml --features check-os-bindings
```

외부 Rust 의존성이 없으며 검사는 fake vault와 임시 가상 폴더만 사용한다. `check-os-bindings`는 OS 함수 소스를 호스트에서 타입 검사하는 용도다. 그 OS의 backend를 선택하거나 Windows/macOS SDK·링크·실동작을 검증하지 않는다. 실제 OS 검증과 Tauri/bootstrap·단일 인스턴스·WebView/설정 경계 연결은 다음 단계다.

Rust가 없는 클라우드에서는 공식 `rust:1.85-slim` 컨테이너를 현재 사용자로 실행해 `--network none` 상태에서 검사했다. 제품 Cargo/설정/빌드 워크플로는 바꾸지 않았다.

상세 계약과 재개 지점: [73. Connected Preview 네이티브 격리](../../docs/v2-design/73-connected-preview-native-isolation.md).
