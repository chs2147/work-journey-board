// Cabi.NET 줄 끝 단추(improve-v26-spec 5절 C안): 업무노트·폴더·링크가 같은 칸 순서·모양을 쓴다.
// ① 끌기 · ② 종류별(노트 복제 / 폴더 탐색기 / 링크 빈칸) · ③ 열기 · ④ ⋯ 을 한 묶음으로, ⑤ 삭제는 오른쪽에 따로.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import s from "./RowActions.module.css";

export const rowActStyles = s;

/** 종류 꼬리표 + 날짜(없으면 빈칸) — 세 종류 줄의 가운데 칸을 맞춘다 */
export function RowMeta({ tag, date }: { tag: string; date?: string | null }) {
  return (
    <>
      <span className={s.tag}>{tag}</span>
      <span className={s.date}>{date ?? ""}</span>
    </>
  );
}

export function RowActions({ children, del }: { children: ReactNode; del: ReactNode }) {
  return (
    <div className={s.acts} onDoubleClick={(e) => e.stopPropagation()}>
      <div className={s.group}>{children}</div>
      {del}
    </div>
  );
}

export function ActBtn({
  danger,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={[danger ? s.del : s.btn, className ?? ""].join(" ")}
      title={rest.title ?? rest["aria-label"]}
    />
  );
}

/** 이 종류에 없는 칸(링크의 ②) — 자리만 */
export const ActEmpty = () => <span className={`${s.btn} ${s.empty}`} aria-hidden="true" />;
