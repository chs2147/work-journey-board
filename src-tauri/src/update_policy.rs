//! 새 판 확인 응답 판정(improve-v20-spec 6절) — 순수 함수만(std만).
//! `update.rs`가 GitHub 응답 머리를 읽어 여기로 넘기고, 화면은 오류 글 앞의 꼬리표(`[update:…]`)로 종류를 안다.

/// 판 목록 확인이 실패한 종류
#[derive(Debug, PartialEq, Eq, Clone)]
pub enum CheckFailure {
    /// GitHub 비로그인 한도 초과(같은 인터넷 주소를 쓰는 PC가 많을 때) — 다시 될 시각(유닉스 초)
    RateLimited { reset_at: Option<u64> },
    /// 회사망·보안 장비 차단으로 보임(403인데 한도 머리 없음·연결 실패)
    Blocked,
    /// 그 밖의 응답
    Other(u16),
}

/// 응답 상태와 한도 머리(`X-RateLimit-Remaining`·`X-RateLimit-Reset`·`Retry-After`)로 실패 종류를 정한다
pub fn classify(
    status: u16,
    remaining: Option<&str>,
    reset: Option<&str>,
    retry_after: Option<&str>,
    now: u64,
) -> CheckFailure {
    let remaining = remaining.and_then(|v| v.trim().parse::<u64>().ok());
    let reset_at = reset
        .and_then(|v| v.trim().parse::<u64>().ok())
        .or_else(|| {
            retry_after
                .and_then(|v| v.trim().parse::<u64>().ok())
                .map(|s| now + s)
        });
    match status {
        // 429 = 늘 한도 · 403 = 남은 횟수 0 또는 Retry-After(2차 한도)일 때만 한도
        429 => CheckFailure::RateLimited { reset_at },
        403 if remaining == Some(0) || retry_after.is_some() => {
            CheckFailure::RateLimited { reset_at }
        }
        403 => CheckFailure::Blocked,
        s => CheckFailure::Other(s),
    }
}

/// 화면에 넘길 오류 글 — 앞의 꼬리표로 종류·다시 될 시각을 전한다(updateStore가 읽음)
pub fn failure_message(f: &CheckFailure) -> String {
    match f {
        CheckFailure::RateLimited { reset_at } => format!(
            "[update:rate:{}] GitHub 확인 횟수 한도에 걸렸습니다(같은 인터넷 주소를 쓰는 PC가 많을 때 생깁니다).",
            reset_at.map(|v| v.to_string()).unwrap_or_default()
        ),
        CheckFailure::Blocked => {
            "[update:blocked] 회사망·보안 장비에서 GitHub 접속이 막힌 것 같습니다.".to_string()
        }
        CheckFailure::Other(s) => format!("[update:other] GitHub 응답이 올바르지 않습니다({s})."),
    }
}

/// 연결 자체가 실패했을 때(프록시·차단·인증서) — 차단으로 본다
pub fn network_message(detail: &str) -> String {
    format!(
        "[update:blocked] 회사망·보안 장비에서 GitHub 접속이 막힌 것 같습니다({}).",
        detail.chars().take(160).collect::<String>()
    )
}

/// `releases/latest`의 이동 주소(Location)에서 판 번호만 — 이 저장소의 `…/releases/tag/vX.Y.Z`만 받는다(꼬리표 판·다른 저장소는 거부)
pub fn latest_version_from_location(location: &str) -> Option<String> {
    const ABS: &str = "https://github.com/chs2147/work-journey-board/releases/tag/v";
    const REL: &str = "/chs2147/work-journey-board/releases/tag/v";
    let rest = location
        .strip_prefix(ABS)
        .or_else(|| location.strip_prefix(REL))?;
    let parts: Vec<&str> = rest.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|p| p.is_empty() || p.len() > 6 || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    Some(rest.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_with_headers() {
        assert_eq!(
            classify(403, Some("0"), Some("1700003600"), None, 1_700_000_000),
            CheckFailure::RateLimited {
                reset_at: Some(1_700_003_600)
            }
        );
        assert_eq!(
            classify(429, None, None, Some("120"), 1_700_000_000),
            CheckFailure::RateLimited {
                reset_at: Some(1_700_000_120)
            }
        );
        assert_eq!(
            classify(429, None, None, None, 0),
            CheckFailure::RateLimited { reset_at: None }
        );
    }

    #[test]
    fn blocked_and_other() {
        // 403인데 한도 머리가 없음 = 보안 장비 차단으로 본다
        assert_eq!(classify(403, None, None, None, 0), CheckFailure::Blocked);
        // 한도가 남아 있는데 403 = 한도 문제가 아님
        assert_eq!(
            classify(403, Some("42"), Some("1700003600"), None, 0),
            CheckFailure::Blocked
        );
        assert_eq!(classify(500, None, None, None, 0), CheckFailure::Other(500));
    }

    #[test]
    fn messages_carry_tags() {
        assert!(
            failure_message(&CheckFailure::RateLimited { reset_at: Some(5) })
                .starts_with("[update:rate:5] ")
        );
        assert!(
            failure_message(&CheckFailure::RateLimited { reset_at: None })
                .starts_with("[update:rate:] ")
        );
        assert!(failure_message(&CheckFailure::Blocked).starts_with("[update:blocked] "));
        assert!(failure_message(&CheckFailure::Other(502)).contains("502"));
        assert!(network_message("timeout").starts_with("[update:blocked] "));
    }

    #[test]
    fn latest_location() {
        assert_eq!(
            latest_version_from_location(
                "https://github.com/chs2147/work-journey-board/releases/tag/v1.23.3"
            ),
            Some("1.23.3".into())
        );
        assert_eq!(
            latest_version_from_location("/chs2147/work-journey-board/releases/tag/v1.24.0"),
            Some("1.24.0".into())
        );
        for bad in [
            "https://github.com/chs2147/work-journey-board/releases/tag/v1.24.0-rc.1",
            "https://github.com/other/repo/releases/tag/v9.9.9",
            "https://github.com/chs2147/work-journey-board/releases/tag/v1.2",
            "https://github.com/chs2147/work-journey-board/releases/tag/v1.2.3/../../x",
            "https://evil.example/chs2147/work-journey-board/releases/tag/v1.2.3",
            "https://github.com/chs2147/work-journey-board/releases",
        ] {
            assert_eq!(latest_version_from_location(bad), None, "{bad}");
        }
    }
}
