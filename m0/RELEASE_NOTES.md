**Work Journey Board — I-M0 회사 PC 설치 검증용 최소 앱** (실제 일지 앱이 아닙니다)

| 파일 | 용도 |
|---|---|
| `WJB-M0-Probe_setup.exe` | 설치 파일(현재 사용자 전용, 관리자 권한 불필요 예정) |
| `WJB-M0-Probe_setup.zip` | exe 다운로드가 막힐 때 쓰는 같은 파일의 zip |
| `SHA256SUMS.txt` | 파일 무결성 확인용 해시 (`certutil -hashfile <파일> SHA256`) |

- 앱은 인터넷으로 아무것도 보내지 않습니다. 고른 폴더에 테스트 파일(`wjb-m0-test.txt`, `wjb-m0-test.db`, `backups/`)만 만듭니다.
- 진행 순서·판정 기준: 저장소 `docs/m0-install-check.md`
