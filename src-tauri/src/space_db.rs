//! E-1 온라인 공간 이 기기 일지(Connected Preview 빌드 전용, docs/v2-design/88).
//! - 파일 경로는 **Rust가 정한다**: Preview 폴더 `online-cache/<계정>/<공간>/journal.db`. 화면은 공간 ID만 넘긴다
//!   (정식판 SQLite 플러그인은 Preview에 없다 — 아무 경로나 여는 길을 만들지 않음).
//! - 연결은 공간마다 하나(트랜잭션·저장점이 한 연결에서만 맞음), `journal_mode=DELETE`(파일 1개), 외래 키 켬.
//! - 다른 파일에 쓰는 문(ATTACH·VACUUM INTO·확장 불러오기)은 거절 — 백업 사본은 `space_db_export`(같은 폴더 임시 파일 → 바이트)만.
//! - 정식판·DEV 일지·설정과 무관(경로가 Preview 폴더 안으로 고정).
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use sqlx::{Column, Row, TypeInfo, ValueRef};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;

pub const JOURNAL: &str = "journal.db";
const EXPORT_TMP: &str = "journal.export.tmp";
const CREATE_TMP: &str = "journal.db.tmp";
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";
/// 한 공간 일지 크기 한도(그림 포함 일지 — 서버 한도보다 넉넉히)
pub const MAX_JOURNAL_BYTES: usize = 1024 * 1024 * 1024;

#[derive(Deserialize, Clone)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

/// 다른 파일을 만들거나 붙이는 문은 거절(대소문자·공백·주석 무시하고 낱말로 본다)
pub fn refused(sql: &str) -> bool {
    let mut words = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    while let Some(c) = chars.next() {
        // 주석 건너뛰기(-- 줄, /* */)
        if c == '-' && chars.peek() == Some(&'-') {
            for n in chars.by_ref() {
                if n == '\n' {
                    break;
                }
            }
            words.push(' ');
            continue;
        }
        if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            let mut prev = ' ';
            for n in chars.by_ref() {
                if prev == '*' && n == '/' {
                    break;
                }
                prev = n;
            }
            words.push(' ');
            continue;
        }
        words.push(if c.is_alphanumeric() || c == '_' {
            c.to_ascii_lowercase()
        } else {
            ' '
        });
    }
    let w: Vec<&str> = words.split_whitespace().collect();
    w.iter().any(|x| {
        matches!(
            *x,
            "attach" | "detach" | "load_extension" | "writable_schema"
        )
    }) || w.windows(2).any(|p| p[0] == "vacuum" && p[1] == "into")
        || w.windows(3).any(|p| p[0] == "vacuum" && p[2] == "into")
}

type Query<'q> = sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>;
fn bind<'q>(q: Query<'q>, v: Value) -> Query<'q> {
    match v {
        Value::Null => q.bind(None::<String>),
        Value::Bool(b) => q.bind(b),
        Value::Number(n) => match n.as_i64() {
            Some(i) => q.bind(i),
            None => q.bind(n.as_f64().unwrap_or_default()),
        },
        Value::String(s) => q.bind(s),
        other => q.bind(other.to_string()),
    }
}
fn cell(v: sqlx::sqlite::SqliteValueRef<'_>) -> Value {
    use sqlx::Value as _;
    if v.is_null() {
        return Value::Null;
    }
    let owned = ValueRef::to_owned(&v);
    match v.type_info().name() {
        "INTEGER" | "NUMERIC" | "BOOLEAN" => owned
            .try_decode::<i64>()
            .map(Value::from)
            .or_else(|_| owned.try_decode::<f64>().map(Value::from))
            .unwrap_or(Value::Null),
        "REAL" => owned
            .try_decode::<f64>()
            .map(Value::from)
            .unwrap_or(Value::Null),
        "BLOB" => owned
            .try_decode::<Vec<u8>>()
            .map(|b| Value::Array(b.into_iter().map(Value::from).collect()))
            .unwrap_or(Value::Null),
        _ => owned
            .try_decode::<String>()
            .map(Value::String)
            .unwrap_or(Value::Null),
    }
}

pub async fn open_pool(path: &Path) -> Result<SqlitePool, String> {
    let opts = SqliteConnectOptions::from_str(&format!("sqlite:{}", path.display()))
        .map_err(|_| "STORE".to_string())?
        .filename(path)
        .create_if_missing(false)
        .journal_mode(SqliteJournalMode::Delete)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(5));
    SqlitePoolOptions::new()
        .max_connections(1)
        .min_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
        .connect_with(opts)
        .await
        .map_err(|e| format!("DB_OPEN: {e}"))
}

/// 결과 = { columns:[이름…], rows:[[값…]…] } — 열 순서를 지키고 이름을 한 번만 보낸다
pub async fn select(pool: &SqlitePool, sql: &str, params: Vec<Value>) -> Result<Value, String> {
    if refused(sql) {
        return Err("SQL_REFUSED".into());
    }
    let mut q = sqlx::query(sql);
    for v in params {
        q = bind(q, v);
    }
    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    let columns: Vec<String> = rows
        .first()
        .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
        .unwrap_or_default();
    let out: Vec<Value> = rows
        .iter()
        .map(|r| {
            Value::Array(
                (0..r.columns().len())
                    .map(|i| r.try_get_raw(i).map(cell).unwrap_or(Value::Null))
                    .collect(),
            )
        })
        .collect();
    Ok(json!({ "columns": columns, "rows": out }))
}
pub async fn execute(pool: &SqlitePool, sql: &str, params: Vec<Value>) -> Result<u64, String> {
    if refused(sql) {
        return Err("SQL_REFUSED".into());
    }
    let mut q = sqlx::query(sql);
    for v in params {
        q = bind(q, v);
    }
    Ok(q.execute(pool)
        .await
        .map_err(|e| e.to_string())?
        .rows_affected())
}
/// 여러 문을 한 트랜잭션으로(하나라도 실패하면 전부 되돌림)
pub async fn batch(pool: &SqlitePool, statements: Vec<Statement>) -> Result<u64, String> {
    if statements.iter().any(|s| refused(&s.sql)) {
        return Err("SQL_REFUSED".into());
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut changes = 0;
    for s in statements {
        let mut q = sqlx::query(&s.sql);
        for v in s.params {
            q = bind(q, v);
        }
        changes += q
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
            .rows_affected();
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(changes)
}
/// 지금 일지의 일관된 사본 바이트(앱의 백업 사본용) — 같은 폴더 임시 파일에 VACUUM INTO → 읽고 지움
pub async fn export(pool: &SqlitePool, dir: &Path) -> Result<Vec<u8>, String> {
    let tmp = dir.join(EXPORT_TMP);
    let _ = fs::remove_file(&tmp);
    let target = tmp.to_string_lossy().replace('\'', "''");
    sqlx::query(&format!("VACUUM INTO '{target}'"))
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    let bytes = fs::read(&tmp).map_err(|_| "STORE".to_string());
    let _ = fs::remove_file(&tmp);
    bytes
}
/// 처음 만들기: 파일이 없을 때만, SQLite 파일 모양만, 임시 이름 → 이름 바꾸기
pub fn create(dir: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 100 || !bytes.starts_with(SQLITE_MAGIC) || bytes.len() > MAX_JOURNAL_BYTES {
        return Err("INVALID_JOURNAL".into());
    }
    let path = dir.join(JOURNAL);
    if path.exists() {
        return Err("JOURNAL_EXISTS".into());
    }
    fs::create_dir_all(dir).map_err(|_| "STORE".to_string())?;
    let tmp = dir.join(CREATE_TMP);
    fs::write(&tmp, bytes).map_err(|_| "STORE".to_string())?;
    fs::rename(&tmp, &path).map_err(|_| "STORE".to_string())
}

/// 공간마다 열린 연결(키 = 공간 폴더 경로 — 계정이 바뀌면 다른 키)
#[derive(Default)]
pub struct SpaceDbState(tauri::async_runtime::Mutex<HashMap<PathBuf, SqlitePool>>);

impl SpaceDbState {
    pub async fn close(&self, dir: &Path) {
        if let Some(p) = self.0.lock().await.remove(dir) {
            p.close().await;
        }
    }
    async fn pool(&self, dir: &Path) -> Result<SqlitePool, String> {
        self.0
            .lock()
            .await
            .get(dir)
            .cloned()
            .ok_or_else(|| "DB_NOT_OPEN".to_string())
    }
}

// ── Tauri 명령(Preview 빌드만) ──
use crate::migration::owner;
use crate::online_space::space_dir;
use tauri::{AppHandle, State};

fn dir_of(app: &AppHandle, ws: &str) -> Result<PathBuf, String> {
    let store = crate::online::app_store(app)?;
    space_dir(store.root(), &owner(&store)?, ws)
}
#[tauri::command]
pub fn space_db_exists(app: AppHandle, workspace_id: String) -> Result<bool, String> {
    Ok(dir_of(&app, &workspace_id)?.join(JOURNAL).is_file())
}
#[tauri::command]
/// 본문 = 일지 바이트 그대로(IPC raw), 머리 x-wjb-workspace
pub fn space_db_create(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("INVALID_REQUEST".into());
    };
    let ws = request
        .headers()
        .get("x-wjb-workspace")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    create(&dir_of(&app, ws)?, bytes)
}
#[tauri::command]
pub async fn space_db_open(
    app: AppHandle,
    state: State<'_, SpaceDbState>,
    workspace_id: String,
) -> Result<(), String> {
    let dir = dir_of(&app, &workspace_id)?;
    let path = dir.join(JOURNAL);
    if !path.is_file() {
        return Err("JOURNAL_MISSING".into());
    }
    let mut map = state.0.lock().await;
    if !map.contains_key(&dir) {
        map.insert(dir, open_pool(&path).await?);
    }
    Ok(())
}
#[tauri::command]
pub async fn space_db_close(
    app: AppHandle,
    state: State<'_, SpaceDbState>,
    workspace_id: String,
) -> Result<(), String> {
    state.close(&dir_of(&app, &workspace_id)?).await;
    Ok(())
}
#[tauri::command]
pub async fn space_db_select(
    app: AppHandle,
    state: State<'_, SpaceDbState>,
    workspace_id: String,
    sql: String,
    params: Vec<Value>,
) -> Result<Value, String> {
    let pool = state.pool(&dir_of(&app, &workspace_id)?).await?;
    select(&pool, &sql, params).await
}
#[tauri::command]
pub async fn space_db_execute(
    app: AppHandle,
    state: State<'_, SpaceDbState>,
    workspace_id: String,
    sql: String,
    params: Vec<Value>,
) -> Result<u64, String> {
    let pool = state.pool(&dir_of(&app, &workspace_id)?).await?;
    execute(&pool, &sql, params).await
}
#[tauri::command]
pub async fn space_db_batch(
    app: AppHandle,
    state: State<'_, SpaceDbState>,
    workspace_id: String,
    statements: Vec<Statement>,
) -> Result<u64, String> {
    let pool = state.pool(&dir_of(&app, &workspace_id)?).await?;
    batch(&pool, statements).await
}
#[tauri::command]
pub async fn space_db_export(
    app: AppHandle,
    state: State<'_, SpaceDbState>,
    workspace_id: String,
) -> Result<tauri::ipc::Response, String> {
    let dir = dir_of(&app, &workspace_id)?;
    let pool = state.pool(&dir).await?;
    Ok(tauri::ipc::Response::new(export(&pool, &dir).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_other_files() {
        for s in [
            "ATTACH DATABASE '/tmp/x.db' AS x",
            "attach '/tmp/x' as y",
            "  DETACH x",
            "VACUUM INTO '/tmp/out.db'",
            "vacuum main into '/tmp/out.db'",
            "VACUUM/* c */INTO 'x'",
            "VACUUM -- c\n INTO 'x'",
            "SELECT load_extension('evil')",
            "PRAGMA writable_schema = 1",
        ] {
            assert!(refused(s), "{s}");
        }
        // 따옴표 안 낱말도 낱말로 본다(안전 쪽) — 앱은 값을 늘 매개변수로 넘긴다
        assert!(refused("SELECT 'attach file'"));
        assert!(!refused("VACUUM"));
        assert!(!refused("SELECT attachment FROM x"));
        assert!(!refused("INSERT INTO t(a) VALUES (?)"));
    }

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("wjb-spacedb-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }
    async fn fresh_journal(dir: &Path) -> SqlitePool {
        // 빈 SQLite 파일을 만든 뒤 create()로 놓는다
        let src = dir.join("src.db");
        let opts = SqliteConnectOptions::new()
            .filename(&src)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Delete);
        let p = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE t(id INTEGER PRIMARY KEY, a TEXT, b REAL, c BLOB)")
            .execute(&p)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE child(id INTEGER PRIMARY KEY, t_id INTEGER REFERENCES t(id))")
            .execute(&p)
            .await
            .unwrap();
        p.close().await;
        let bytes = fs::read(&src).unwrap();
        let space = dir.join("space");
        create(&space, &bytes).unwrap();
        assert_eq!(create(&space, &bytes).unwrap_err(), "JOURNAL_EXISTS");
        open_pool(&space.join(JOURNAL)).await.unwrap()
    }

    #[test]
    fn create_rejects_non_sqlite() {
        let d = tmp();
        assert_eq!(create(&d, b"hello").unwrap_err(), "INVALID_JOURNAL");
        assert_eq!(create(&d, &[0u8; 200]).unwrap_err(), "INVALID_JOURNAL");
        assert!(!d.join(JOURNAL).exists());
        fs::remove_dir_all(d).ok();
    }

    #[test]
    fn select_execute_batch_export() {
        tauri::async_runtime::block_on(select_execute_batch_export_run());
    }
    async fn select_execute_batch_export_run() {
        let d = tmp();
        let pool = fresh_journal(&d).await;
        // 저장 모드 = DELETE, 외래 키 켬
        let jm = select(&pool, "PRAGMA journal_mode", vec![]).await.unwrap();
        assert_eq!(jm["rows"][0][0], json!("delete"));
        let fk = select(&pool, "PRAGMA foreign_keys", vec![]).await.unwrap();
        assert_eq!(fk["rows"][0][0], json!(1));
        assert_eq!(
            execute(
                &pool,
                "INSERT INTO t(id,a,b,c) VALUES(?,?,?,?)",
                vec![json!(1), json!("가"), json!(1.5), Value::Null]
            )
            .await
            .unwrap(),
            1
        );
        let r = select(&pool, "SELECT id, a, b, c FROM t", vec![])
            .await
            .unwrap();
        assert_eq!(r["columns"], json!(["id", "a", "b", "c"]));
        assert_eq!(r["rows"], json!([[1, "가", 1.5, null]]));
        // 묶음 중 하나가 실패하면 전부 되돌림(외래 키 위반)
        let bad = batch(
            &pool,
            vec![
                Statement {
                    sql: "INSERT INTO t(id,a) VALUES(2,'x')".into(),
                    params: vec![],
                },
                Statement {
                    sql: "INSERT INTO child(id,t_id) VALUES(1,99)".into(),
                    params: vec![],
                },
            ],
        )
        .await;
        assert!(bad.is_err());
        let n = select(&pool, "SELECT COUNT(*) AS n FROM t", vec![])
            .await
            .unwrap();
        assert_eq!(n["rows"][0][0], json!(1));
        // 저장점(앱의 묶음 밖 저장점 사용)도 한 연결이라 맞는다
        execute(&pool, "SAVEPOINT s1", vec![]).await.unwrap();
        execute(&pool, "INSERT INTO t(id,a) VALUES(3,'y')", vec![])
            .await
            .unwrap();
        execute(&pool, "ROLLBACK TO s1", vec![]).await.unwrap();
        execute(&pool, "RELEASE s1", vec![]).await.unwrap();
        let n = select(&pool, "SELECT COUNT(*) AS n FROM t", vec![])
            .await
            .unwrap();
        assert_eq!(n["rows"][0][0], json!(1));
        // 다른 파일 쓰기 거절
        assert_eq!(
            execute(&pool, "VACUUM INTO '/tmp/wjb-x.db'", vec![])
                .await
                .unwrap_err(),
            "SQL_REFUSED"
        );
        assert_eq!(
            select(&pool, "ATTACH 'x' AS y", vec![]).await.unwrap_err(),
            "SQL_REFUSED"
        );
        // 사본 = SQLite 파일, 임시 파일은 남지 않음
        let space = d.join("space");
        let bytes = export(&pool, &space).await.unwrap();
        assert!(bytes.starts_with(SQLITE_MAGIC));
        assert!(!space.join(EXPORT_TMP).exists());
        pool.close().await;
        fs::remove_dir_all(d).ok();
    }
}
