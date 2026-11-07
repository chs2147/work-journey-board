import { weekIdOf } from "../../domain/week";
import { dueView } from "../board/dueView";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { TextBox } from "../../domain/note";
import type { LiveSnapshot, LiveWidgetConfig } from "../../domain/liveWidget";
import { calendarDays, localToday } from "../../domain/liveWidget";
import { V17 } from "../../shared/v17Strings";
import { IconClock, IconNote, IconTrash } from "../common/icons";
import { cabiCall, cabiClient, useCabiChange } from "./cabiService";
import { onSelectedBoxKey, startBoxDrag, useBoxFrame } from "../note/boxShared";
import { EdgeKnobs } from "../note/EdgeBoxParts";
import {
  useNote,
  selectBox,
  deleteBox,
  duplicateBox,
  setWidgetConfig,
  beginGesture,
  endGesture,
  cancelGesture,
  resizeWidgetLive,
} from "../note/noteStore";
import { reportError, toast } from "../board/boardStore";
import { widgetSince, widgetTitle } from "./liveWidgetModel";
import styles from "./LiveWidget.module.css";
const cache = new Map<string, Promise<LiveSnapshot>>();
let cacheVersion = -1;
function useSnapshot(categoryId: string, w: LiveWidgetConfig, offset: number, query = "") {
  const version = useCabiChange((s) => s.version),
    disconnected = useCabiChange((s) => s.disconnected);
  const [clock, setClock] = useState(() => ({ today: localToday(), revision: 0 }));
  const [data, setData] = useState<LiveSnapshot | null>(null),
    [error, setError] = useState("");
  const key = JSON.stringify([
    categoryId,
    clock.today,
    widgetSince(w, clock.today),
    offset,
    w.milestoneEntryIds ?? [],
    version,
    clock.revision,
    query,
  ]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (document.hidden) return;
      setClock((c) => ({ today: localToday(), revision: c.revision + 1 }));
      clearTimeout(timer);
      const n = new Date();
      timer = setTimeout(
        refresh,
        new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime() + 100,
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (disconnected || document.hidden) return;
    if (cacheVersion !== version) {
      cache.clear();
      cacheVersion = version;
    }
    let request = cache.get(key);
    if (!request) {
      request = cabiClient().widgetSnapshot(
        categoryId,
        clock.today,
        widgetSince(w, clock.today),
        offset,
        w.milestoneEntryIds ?? [],
        query,
      );
      cache.set(key, request);
      if (cache.size > 50) cache.delete(cache.keys().next().value!);
    }
    void request
      .then((s) => {
        if (active) {
          setData(s);
          setError("");
        }
      })
      .catch((e) => {
        cache.delete(key);
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
    // key captures the complete request configuration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, disconnected]);
  return { data, error, retry: () => setClock((c) => ({ ...c, revision: c.revision + 1 })) };
}
export function LiveWidget({ box, selected }: { box: TextBox; selected: boolean }) {
  const ref = useRef<HTMLDivElement>(null),
    task = useNote((s) => s.task),
    multi = useNote((s) => s.multi.includes(box.id));
  const config = box.widget!;
  const [settings, setSettings] = useState(false),
    [choose, setChoose] = useState(false),
    [page, setPage] = useState(0),
    [pending, setPending] = useState<string | null>(null),
    [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>([]),
    [pickPage, setPickPage] = useState(0),
    [pickWeeks, setPickWeeks] = useState<LiveWidgetConfig["weeks"]>(0),
    [needle, setNeedle] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setNeedle(query);
      setPickPage(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  const snapshot = useSnapshot(
    task?.categoryId ?? "",
    config,
    page * (config.type === "important" ? 20 : 40),
  );
  const picker = useSnapshot(
    task?.categoryId ?? "",
    { ...config, weeks: pickWeeks },
    choose ? pickPage * 40 : 0,
    needle,
  );
  useBoxFrame(ref, box.id, selected);
  const update = (patch: Partial<LiveWidgetConfig>) => {
    setWidgetConfig(box.id, { ...config, ...patch });
    setPage(0);
  };
  const data = snapshot.data;
  const open = (id: string) => void cabiCall("widgetOpen", task?.categoryId, id).catch(reportError);
  async function complete(id: string) {
    if (pending) return;
    setPending(id);
    try {
      const result = await cabiCall<{ id: string; at: string; already: boolean }>(
        "widgetComplete",
        task?.categoryId,
        id,
      );
      if (result.already) toast(V17.already);
      else
        toast(V17.completed, {
          label: V17.undo,
          run: () => {
            void cabiCall("widgetUndo", task?.categoryId, id, result.at).catch(reportError);
          },
        });
      snapshot.retry();
    } catch (e) {
      reportError(e);
    } finally {
      setPending(null);
    }
  }
  function heightDrag(e: PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget,
      y = e.clientY,
      h = box.h ?? 250,
      zoom = useNote.getState().zoom,
      before = beginGesture();
    el.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => resizeWidgetLive(box.id, h + (ev.clientY - y) / zoom);
    const done = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", done);
      el.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      endGesture(before);
    };
    const cancel = () => {
      cancelGesture(before);
      done();
    };
    const key = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === "Escape") cancel();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", done);
    el.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
  }
  return (
    <div
      ref={ref}
      className={`${styles.widget} ${selected || multi ? styles.selected : ""}`}
      tabIndex={0}
      data-box-id={box.id}
      data-testid="live-widget"
      data-widget={config.type}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h ?? (config.type === "elapsed" ? 200 : config.variant === "milestones" ? 230 : 340),
        zIndex: settings || choose ? Math.max(100000, box.z) : box.z,
      }}
      onKeyDown={(e) => onSelectedBoxKey(e, box.id, () => setSettings(true))}
      onPointerDown={(e) => {
        if ((e.target as Element).closest("button,input,select,a,[role=dialog]")) return;
        selectBox(box.id);
        if ((e.target as Element).closest("header")) startBoxDrag(e, box, "move");
      }}
    >
      <header>
        <span>
          {config.type === "elapsed" ? (
            <IconClock />
          ) : config.type === "important" ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          ) : (
            <IconNote />
          )}
          {widgetTitle(config)}
        </span>
        <span className={styles.live}>{V17.live}</span>
        <button title={V17.settings} aria-label={V17.settings} onClick={() => setSettings(!settings)}>
          ⋯
        </button>
      </header>
      {settings && (
        <div className={styles.settings}>
          {config.type === "elapsed" && (
            <select
              aria-label={V17.start}
              value={config.basis ?? "start"}
              onChange={(e) => update({ basis: e.target.value as "start" | "recent" })}
            >
              <option value="start">{V17.start}</option>
              <option value="recent">{V17.recent}</option>
            </select>
          )}
          {config.type === "timeline" && (
            <>
              <select
                aria-label={V17.timeline}
                value={config.variant ?? "records"}
                onChange={(e) => update({ variant: e.target.value as LiveWidgetConfig["variant"] })}
              >
                {(["records", "milestones", "weeks"] as const).map((v) => (
                  <option key={v} value={v}>
                    {V17[v]}
                  </option>
                ))}
              </select>
              <select
                aria-label={V17.all}
                value={config.weeks ?? 8}
                onChange={(e) => update({ weeks: Number(e.target.value) as LiveWidgetConfig["weeks"] })}
              >
                <option value={0}>{V17.all}</option>
                {[4, 8, 12].map((n) => (
                  <option key={n} value={n}>
                    {V17.recentWeeks(n)}
                  </option>
                ))}
              </select>
            </>
          )}
          <button onClick={() => duplicateBox(box.id)} title={V17.duplicate}>
            ⧉
          </button>
          <button onClick={() => deleteBox(box.id)} aria-label={V17.deletePlacement}>
            <IconTrash />
          </button>
        </div>
      )}
      <div className={styles.body}>
        {snapshot.error ? (
          <p role="alert">
            {snapshot.error}
            <button onClick={snapshot.retry}>{V17.retry}</button>
          </p>
        ) : !data ? (
          <p>{V17.loading}</p>
        ) : (
          <>
            <div className={styles.caption}>{data.title}</div>
            {config.type === "elapsed" ? (
              <>
                <div className={styles.metric}>
                  {(() => {
                    const from = config.basis === "recent" ? data.recent : data.start;
                    return from
                      ? config.basis === "recent"
                        ? V17.afterRecord(calendarDays(from, data.today))
                        : V17.days(calendarDays(from, data.today))
                      : V17.missingDate;
                  })()}
                </div>
                <p>{config.basis === "recent" ? data.recent : data.start}</p>
              </>
            ) : config.type === "important" ? (
              <>
                {!data.important.length && <p>{V17.emptyImportant}</p>}
                {data.important.map((e) => (
                  <div className={styles.important} key={e.id}>
                    <button
                      className={styles.check}
                      disabled={!!pending}
                      aria-label={`${V17.complete}: ${e.text}`}
                      onClick={() => void complete(e.id)}
                    >
                      ✓
                    </button>
                    <div>
                      <button className={styles.source} onClick={() => open(e.id)}>
                        {e.text}
                      </button>
                      <small>
                        {e.dueDate && (
                          <span className={styles.due} data-urgency={dueView(data.today, e.dueDate).kind}>
                            {dueView(data.today, e.dueDate).chip}
                          </span>
                        )}
                        {e.date}
                      </small>
                    </div>
                  </div>
                ))}
                <PageNav page={page} setPage={setPage} count={data.importantCount} size={20} />
              </>
            ) : config.variant === "milestones" ? (
              <>
                <button
                  className={styles.manage}
                  onClick={() => {
                    setChosen(config.milestoneEntryIds ?? []);
                    setChoose(true);
                  }}
                >
                  {V17.choose}
                </button>
                {!config.milestoneEntryIds?.length ? (
                  <p>{V17.noneChosen}</p>
                ) : (
                  <div className={styles.horizontal}>
                    <div
                      className={styles.track}
                      style={{
                        gridTemplateColumns: `repeat(${config.milestoneEntryIds.length},minmax(120px,1fr))`,
                      }}
                    >
                      {[...data.selected]
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .map((e) => (
                          <button
                            key={e.id}
                            className={styles.milestone}
                            onClick={() => open(e.id)}
                            title={e.text}
                          >
                            <time>{e.date}</time>
                            <i />
                            <b>{e.text}</b>
                          </button>
                        ))}
                      {config.milestoneEntryIds
                        .filter((id) => !data.selected.some((e) => e.id === id))
                        .map((id) => (
                          <span key={id} className={styles.missing}>
                            {V17.missingSource}
                          </span>
                        ))}
                    </div>
                  </div>
                )}
                <small>{V17.equal}</small>
              </>
            ) : config.variant === "weeks" ? (
              <>
                <div className={styles.horizontal}>
                  <div
                    className={styles.track}
                    style={{
                      gridTemplateColumns: `repeat(${Math.max(1, data.weeks.length)},minmax(130px,1fr))`,
                    }}
                  >
                    {data.weeks.map((w) => (
                      <button
                        key={w.weekId}
                        className={styles.milestone}
                        onClick={() => open(w.entryId)}
                        title={w.text}
                      >
                        <time>{w.weekId}</time>
                        <i />
                        <b>{w.text}</b>
                        <small>{V17.weekCount(w.count)}</small>
                      </button>
                    ))}
                  </div>
                </div>
                {!data.weeks.length && <p>{V17.empty}</p>}
              </>
            ) : (
              <>
                {!data.records.length && <p>{V17.empty}</p>}
                {data.records.map((e, i) => {
                  const yearMonth = e.date.slice(0, 7),
                    prev = data.records[i - 1];
                  return (
                    <div key={e.id}>
                      {(!prev || prev.date.slice(0, 7) !== yearMonth) && <h3>{yearMonth}</h3>}
                      {(!prev ||
                        weekIdOf(prev.date) !== weekIdOf(e.date) ||
                        prev.date.slice(0, 7) !== yearMonth) && <h4>{weekIdOf(e.date)}</h4>}
                      <button className={styles.record} onClick={() => open(e.id)}>
                        <time>{e.date}</time>
                        {e.text}
                      </button>
                    </div>
                  );
                })}
                <PageNav page={page} setPage={setPage} count={data.recordCount} size={40} />
              </>
            )}
            <footer>{V17.asOf(data.today)}</footer>
          </>
        )}
      </div>
      <EdgeKnobs boxId={box.id} exposed={selected} />
      <button
        className={styles.widthGrip}
        aria-label={V17.width}
        onPointerDown={(e) => startBoxDrag(e, box, "resize")}
      />
      <button className={styles.heightGrip} aria-label={V17.height} onPointerDown={heightDrag} />
      {choose && (
        <div
          className={styles.modal}
          role="dialog"
          aria-label={V17.choose}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h2>{V17.choose}</h2>
          <p>{V17.chooseHint}</p>
          <input
            aria-label={V17.search}
            placeholder={V17.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label={V17.all}
            value={pickWeeks ?? 0}
            onChange={(e) => {
              setPickWeeks(Number(e.target.value) as LiveWidgetConfig["weeks"]);
              setPickPage(0);
            }}
          >
            <option value={0}>{V17.all}</option>
            {[4, 8, 12].map((n) => (
              <option key={n} value={n}>
                {V17.recentWeeks(n)}
              </option>
            ))}
          </select>
          {(config.milestoneEntryIds ?? [])
            .filter(
              (id) => chosen.includes(id) && picker.data && !picker.data.selected.some((e) => e.id === id),
            )
            .map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked
                  onChange={() => setChosen((ids) => ids.filter((x) => x !== id))}
                />
                <span>{V17.missingSource}</span>
              </label>
            ))}
          {picker.error ? (
            <p role="alert">{picker.error}</p>
          ) : (
            picker.data?.records.map((e) => (
              <label key={e.id}>
                <input
                  type="checkbox"
                  checked={chosen.includes(e.id)}
                  onChange={() =>
                    setChosen((ids) =>
                      ids.includes(e.id)
                        ? ids.filter((id) => id !== e.id)
                        : ids.length < 200
                          ? [...ids, e.id]
                          : ids,
                    )
                  }
                />
                <span>
                  {e.text}
                  <small>{e.date}</small>
                </span>
              </label>
            ))
          )}
          <PageNav page={pickPage} setPage={setPickPage} count={picker.data?.recordCount ?? 0} size={40} />
          <div>
            <button onClick={() => setChoose(false)}>{V17.cancel}</button>
            <button
              onClick={() => {
                update({ milestoneEntryIds: chosen });
                setChoose(false);
              }}
            >
              {V17.apply}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function PageNav({
  page,
  setPage,
  count,
  size,
}: {
  page: number;
  setPage: (n: number) => void;
  count: number;
  size: number;
}) {
  if (count <= size && page === 0) return null;
  return (
    <nav className={styles.pages}>
      <button disabled={page === 0} onClick={() => setPage(page - 1)}>
        {V17.previous}
      </button>
      <span>{V17.total(count)}</span>
      <button disabled={(page + 1) * size >= count} onClick={() => setPage(page + 1)}>
        {V17.next}
      </button>
    </nav>
  );
}
