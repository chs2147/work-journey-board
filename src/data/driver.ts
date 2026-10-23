// 저장소 계층이 의존하는 유일한 SQL 인터페이스(data-spec 8-1).
// 실앱은 tauri-plugin-sql, 개발·테스트·브라우저 모드는 sql.js — 같은 스키마·같은 SQL을 쓴다.
// 자리표시자는 위치 기반 `?`만 쓴다(sql.js·sqlx 양쪽에서 동일하게 동작).

export type SqlParam = string | number | null;

export interface SqlStatement {
  sql: string;
  params?: SqlParam[];
}

export interface SqlDriver {
  /** 화면·로그 표시용 설명(예: "브라우저 모드(sql.js 메모리)") */
  readonly label: string;
  execute(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  select<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /**
   * 여러 문장을 하나의 트랜잭션으로 실행한다(전부 성공 또는 전부 취소). 영향받은 행 수 합계를 돌려준다.
   * BEGIN/COMMIT을 execute로 따로 보내지 않는다 — 실앱은 연결 풀이라 서로 다른 연결로 갈 수 있고,
   * 실패 시 트랜잭션이 열린 채 연결이 남아 이후 모든 쓰기가 막힌다(S2에서 실측).
   */
  batch(statements: SqlStatement[]): Promise<number>;
  close(): Promise<void>;
}

/** 연결 직후 공통 설정. journal_mode는 파일에 저장되는 설정이라 한 번이면 된다(data-spec 3-1). */
export async function prepareConnection(driver: SqlDriver): Promise<void> {
  await driver.select("PRAGMA journal_mode = DELETE");
  const [fk] = await driver.select<{ foreign_keys: number }>("PRAGMA foreign_keys");
  if (fk?.foreign_keys !== 1) throw new Error("외래 키 검사가 꺼져 있습니다");
}
