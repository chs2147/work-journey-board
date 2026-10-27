# 릴리스 노트

버전마다 `v<버전>.md` 하나(예: `v0.2.16.md`). 판올림 커밋(package.json 버전 · README Version History와 **같은 커밋**)에서 쓴다.
main 빌드가 이 파일 + 설치 파일 표로 GitHub 릴리스 본문을 만들고, CI(`node scripts/release-notes.mjs check`)가 현재 버전의 노트가 없거나 `## 주의` 절이 빠지면 실패한다.
규칙: 공통 규칙 3-6(my-discussions `topics/8 common-vibe-coding-rules/common-claude-rules.md`) · 설계: [improve-1027v3-spec.md](../improve-1027v3-spec.md) 5절.

```markdown
# <한 줄 요약 — README Version History 제목과 같게>

## 새 기능
- 사용자가 보는 화면 이름 + 바뀐 점, 한 줄에 하나

## 고친 점
- 증상으로 적기("~하던 문제")

## 주의
- 데이터 형식: 변경 없음 | 마이그레이션 000N(실행 전 자동 백업)
- 되돌려 설치: 안전 | 주의(무엇이 사라지는지)
- 외부 통신: 없음 (바뀌면 반드시 적기)

## 설치 후 확인
- 회사 PC 확인표 7-N
```

- 빈 절은 지운다. **주의**는 항상 둔다.
- 사용자 말로 쓴다(코드·파일 이름 금지). 실제 업무 내용은 넣지 않는다(예시는 가상).
