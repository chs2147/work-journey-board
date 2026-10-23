//! 여러 SQL 문장을 하나의 트랜잭션으로 실행하는 명령(SqlDriver.batch의 실앱 구현).
//!
//! tauri-plugin-sql은 연결 풀이라 JS에서 BEGIN/COMMIT을 따로 보내면 서로 다른 연결로 갈 수 있고,
//! 중간 실패 시 트랜잭션이 열린 연결이 풀에 남아 이후 모든 쓰기가 막힌다(I-M1 S2에서 실측).
//! 여기서는 플러그인이 연 같은 풀에서 sqlx Transaction을 쓴다 — 커밋 전에 실패하면 자동 롤백된다.

use serde::Deserialize;
use serde_json::Value as JsonValue;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Deserialize)]
pub struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<JsonValue>,
}

type Query<'q> = sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>;

fn bind<'q>(q: Query<'q>, v: JsonValue) -> Query<'q> {
    match v {
        JsonValue::Null => q.bind(None::<String>),
        JsonValue::Bool(b) => q.bind(b),
        JsonValue::Number(n) => match n.as_i64() {
            Some(i) => q.bind(i),
            None => q.bind(n.as_f64().unwrap_or_default()),
        },
        JsonValue::String(s) => q.bind(s),
        other => q.bind(other.to_string()),
    }
}

/// `db`는 JS에서 Database.load에 넘긴 연결 문자열(예: `sqlite:D:\WorkJourney\work-journey.db`).
/// 영향받은 행 수 합계를 돌려준다.
#[tauri::command]
pub async fn db_batch(
    instances: State<'_, DbInstances>,
    db: String,
    statements: Vec<Statement>,
) -> Result<u64, String> {
    let map = instances.0.read().await;
    let pool = match map.get(&db) {
        Some(DbPool::Sqlite(pool)) => pool,
        _ => return Err(format!("열려 있지 않은 데이터베이스: {db}")),
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut changes = 0;
    for s in &statements {
        let mut q = sqlx::query(&s.sql);
        for v in s.params.iter().cloned() {
            q = bind(q, v);
        }
        changes += q.execute(&mut *tx).await.map_err(|e| e.to_string())?.rows_affected();
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(changes)
}
