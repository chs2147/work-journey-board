# 처음 설치와 저장 폴더

**언제 쓰나요** — 회사 PC·맥에 처음 설치할 때, 또는 PC를 바꿔 일지를 옮길 때.

### 설치 — Windows
- [최신 판 내려받기](https://github.com/chs2147/work-journey-board/releases/latest)에서 `WorkJourneyBoard_<판>_setup.exe`를 받아 실행합니다.
- 관리자 권한 없이 내 계정에만 설치됩니다.

### 설치 — macOS
- [최신 판 내려받기](https://github.com/chs2147/work-journey-board/releases/latest)에서 `WorkJourneyBoard_<판>_mac.dmg`를 받아 엽니다.
- 앱 아이콘을 **응용 프로그램** 폴더로 끌어 놓습니다.
- 처음 열면 "'Work Journey Board'을(를) 열지 않음" 창이 뜹니다 — 애플 개발자 서명이 없는 앱이라 macOS가 막는 것으로, 창에는 [휴지통으로 이동]·[완료]만 있습니다. 아래 순서로 **처음 한 번만** 허용합니다.

1. 창에서 **[완료]**를 누릅니다.
2. **시스템 설정 › 개인정보 보호 및 보안**을 열고 맨 아래 **보안** 칸으로 내립니다.
3. "'Work Journey Board'이(가) 차단되었습니다" 옆 **[그래도 열기]** → 암호(또는 Touch ID).
4. 앱을 다시 열고, 한 번 더 뜨는 창에서 **[그래도 열기]**를 누릅니다.

- 앱 안에서 받은 새 판은 다시 묻지 않습니다.

### 처음 켤 때

1. **저장 폴더**를 고릅니다. 추천 위치는 홈 폴더의 `WorkJourney`(Windows `C:\Users\<사용자>\WorkJourney` · macOS `~/WorkJourney`)입니다 — OneDrive·iCloud 같은 동기화 폴더는 안내가 뜹니다.
2. 기존 일지가 있으면 **기존 일지 열기**로 그 폴더를 고릅니다(`work-journey.db` 파일 하나가 일지 전체).
3. 보드가 뜨면 `+ 업무 추가`에 지금 하고 있는 업무 이름을 적고 `Enter`.

![첫 실행 — 저장 폴더 고르기](shots/01-setup.png)

**팁**
- 일지는 고른 폴더의 SQLite 파일 하나뿐이고, 앱은 기록을 어디에도 보내지 않습니다.
- Windows와 macOS는 같은 판·같은 기능입니다. 이 가이드의 단축키는 Windows 표기 옆 괄호에 맥 표기를 함께 적었습니다(예: `Alt+1`). → [부록](#s90)
- 저장 위치는 나중에 설정 › 데이터·백업 › 저장 위치에서 옮길 수 있습니다. → [12. 백업과 복원](#s12)
