//! 앱 닫기 안전장치(1.40.1, docs/release-notes/v1.40.1.md). 메인 창 닫기 요청 뒤 화면이 아예 멈춰 창을 닫지 못하면
//! 일정 시간 뒤 프로세스를 끝낸다(일지는 DELETE 저장 방식이라 끝나지 않은 트랜잭션은 다음에 열 때 되돌려진다).
//! 화면이 저장 실패로 창을 남길 때는 `exit_guard_cancel`로 푼다(고친 내용이 강제로 사라지지 않게).
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

pub const GUARD: Duration = Duration::from_secs(60);
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// 닫기 요청마다 새로 건다 — 그 사이 풀거나 다시 걸면 앞의 것은 아무것도 하지 않는다
pub fn arm() -> u64 {
    let g = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(GUARD);
        if fires(g) {
            std::process::exit(0);
        }
    });
    g
}
pub fn fires(generation: u64) -> bool {
    GENERATION.load(Ordering::SeqCst) == generation
}
pub fn cancel() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// 저장 실패로 창을 남길 때 화면이 부른다
#[tauri::command]
pub fn exit_guard_cancel() {
    cancel();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancel_or_rearm_disables_earlier_guard() {
        let g = GENERATION.fetch_add(1, Ordering::SeqCst) + 1; // 스레드 없이 같은 규칙만
        assert!(fires(g));
        cancel();
        assert!(!fires(g));
        let g2 = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        assert!(fires(g2) && !fires(g));
    }
}
