//! TS backupIdentity.ts와 같은 새 백업 이름 허용 목록. 삭제/복원은 파일명 검사와 실제 파일 검사를 함께 사용한다.
fn digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}
fn number(s: &str) -> bool {
    digits(s) && (s == "0" || !s.starts_with('0'))
}
fn version(s: &str) -> bool {
    let mut builds = s.split('+');
    let core = builds.next().unwrap_or("");
    if let Some(build) = builds.next() {
        if !identifiers(build, false) {
            return false;
        }
    }
    if builds.next().is_some() {
        return false;
    }
    let (base, pre) = core
        .split_once('-')
        .map_or((core, None), |(a, b)| (a, Some(b)));
    let parts: Vec<_> = base.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| number(p)) && pre.is_none_or(|p| identifiers(p, true))
}
fn identifiers(s: &str, pre: bool) -> bool {
    s.split('.').all(|p| {
        !p.is_empty()
            && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            && (!pre || !digits(p) || number(p))
    })
}
pub fn date(s: &str) -> bool {
    let p: Vec<_> = s.split('-').collect();
    if p.len() != 3
        || p[0].len() != 4
        || p[1].len() != 2
        || p[2].len() != 2
        || !p.iter().all(|p| digits(p))
    {
        return false;
    }
    let y = p[0].parse::<u32>().unwrap_or(0);
    let m = p[1].parse::<usize>().unwrap_or(0);
    let d = p[2].parse::<u32>().unwrap_or(0);
    let days = [
        0,
        31,
        if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            29
        } else {
            28
        },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    y > 0 && m > 0 && m <= 12 && d > 0 && d <= days[m]
}
pub fn kind(name: &str) -> Option<&str> {
    let core = name.strip_prefix("work-journey_")?.strip_suffix(".db")?;
    let (stamp, rest) = core.split_once('_')?;
    if !date(stamp) {
        return None;
    }
    let (time, rest) = rest.split_once('_')?;
    if time.len() != 9
        || !digits(time)
        || time[..2].parse::<u32>().ok()? > 23
        || time[2..4].parse::<u32>().ok()? > 59
        || time[4..6].parse::<u32>().ok()? > 59
    {
        return None;
    }
    let (kind, rest) = rest.split_once("_app-v")?;
    if !matches!(
        kind,
        "daily" | "monthly" | "manual" | "pre-update" | "pre-import" | "before-restore"
    ) && !kind
        .strip_prefix("pre-migration-to-v")
        .is_some_and(|n| number(n) && n != "0")
    {
        return None;
    }
    let (app, db) = rest.split_once("_db-v")?;
    if !version(app) {
        return None;
    }
    let db = if let Some((schema, collision)) = db.split_once("_c") {
        if !number(collision) || collision == "0" {
            return None;
        }
        schema
    } else {
        db
    };
    if db == "unknown" {
        if kind != "before-restore" {
            return None;
        }
    } else if !number(db) || db == "0" || db.parse::<u64>().ok()? > 9_007_199_254_740_991 {
        return None;
    }
    Some(kind)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_names() {
        for kind_name in [
            "daily",
            "monthly",
            "manual",
            "pre-update",
            "pre-import",
            "before-restore",
            "pre-migration-to-v15",
        ] {
            let n =
                format!("work-journey_2026-11-05_143012123_{kind_name}_app-v1.17.0-rc.1_db-v14.db");
            assert_eq!(kind(&n), Some(kind_name));
        }
        assert!(kind("work-journey_2026-02-30_143012123_daily_app-v1.17.0_db-v14.db").is_none());
        assert!(kind("work-journey_2026-11-05_243012123_daily_app-v1.17.0_db-v14.db").is_none());
        assert!(kind("work-journey_2026-11-05_143012123_daily_app-v1.17.0-01_db-v14.db").is_none());
        assert_eq!(
            kind("work-journey_2026-11-05_143012123_before-restore_app-v1.17.0_db-vunknown_c1.db"),
            Some("before-restore")
        );
    }
}
