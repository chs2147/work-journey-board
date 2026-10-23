// 저장소 계층이 의존하는 유일한 SQL 인터페이스(data-spec 8-1).
// 실앱은 tauri-plugin-sql, 개발·테스트·브라우저 모드는 sql.js — 같은 스키마·같은 SQL을 쓴다.
// 자리표시자는 위치 기반 `?`만 쓴다(sql.js·sqlx 양쪽에서 동일하게 동작).

export type SqlParam = string | number | null;

export interface SqlDriver {
  /** 화면·로그 표시용 설명(예: "sql.js 메모리") */
  readonly label: string;
  execute(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  select<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  close(): Promise<void>;
}
