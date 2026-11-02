# 처음 설치와 저장 폴더

**언제 쓰나요** — 회사 PC·맥에 처음 설치할 때, 또는 PC를 바꿔 일지를 옮길 때.

1. [최신 판 내려받기](https://github.com/chs2147/work-journey-board/releases/latest)에서 설치 파일을 받습니다.
   - **Windows** — `WorkJourneyBoard_<판>_setup.exe`를 실행합니다. 관리자 권한 없이 내 계정에만 설치됩니다.
   - **macOS** — `WorkJourneyBoard_<판>_mac.dmg`를 열고 앱을 **응용 프로그램** 폴더로 끌어 놓습니다. 처음 열 때 "확인되지 않은 개발자" 안내가 나오면 **시스템 설정 › 개인정보 보호 및 보안 › 그래도 열기**를 한 번 누릅니다.
2. 처음 켜면 **저장 폴더**를 고릅니다. 추천 위치는 홈 폴더의 `WorkJourney`(Windows `C:\Users\<사용자>\WorkJourney` · macOS `~/WorkJourney`)입니다 — OneDrive·iCloud 같은 동기화 폴더는 안내가 뜹니다.
3. 기존 일지가 있으면 **기존 일지 열기**로 그 폴더를 고릅니다(`work-journey.db` 파일 하나가 일지 전체).
4. 보드가 뜨면 `+ 업무 추가`에 지금 하고 있는 업무 이름을 적고 `Enter`.

![첫 실행 — 저장 폴더 고르기](shots/01-setup.png)

**팁**
- 일지는 고른 폴더의 SQLite 파일 하나뿐이고, 앱은 기록을 어디에도 보내지 않습니다.
- Windows와 macOS는 같은 판·같은 기능입니다. 맥에서는 단축키의 `Ctrl`이 `⌘`, `Alt`가 `⌥`, "탐색기"가 Finder입니다. → [부록](#s90)
- 저장 위치는 나중에 설정 › 데이터·백업 › 저장 위치에서 옮길 수 있습니다. → [12. 백업과 복원](#s12)
