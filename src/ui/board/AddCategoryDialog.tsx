import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findTagByName, NO_TAG, normalizeTagName, tagNameProblem } from "../../domain/tags";
import { sameDir } from "../../domain/workspace";
import { useAppStore } from "../common/appStore";
import { STR } from "../../shared/strings";
import { addCategoryWithTags, setAddOpen, useBoard } from "./boardStore";
import { handleEnterCommit, isComposingKey } from "./helpers";
import { IconCategoryAdd } from "../common/icons";
import styles from "./AddCategoryDialog.module.css";

export function AddCategoryDialog() {
  const workspaces = useAppStore((s) => s.workspaces);
  const dir = useAppStore((s) => (s.journal.state === "ready" ? s.journal.dataDir : ""));
  const workspace = workspaces.find((w) => dir && sameDir(w.dir, dir));
  const tags = useBoard((s) => s.tags);
  const weekId = useBoard((s) => s.weekId);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>(() =>
    useBoard.getState().tagFilter.filter((t) => t !== NO_TAG),
  );
  const [draft, setDraft] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const controller = useRef(new AbortController());
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const locked = useRef(false);
  const text = STR.categoryCreate;
  useEffect(() => {
    const back = returnFocus.current;
    const abort = new AbortController();
    controller.current = abort;
    nameRef.current?.focus();
    return () => {
      abort.abort();
      if (back?.isConnected) back.focus();
    };
  }, []);
  const close = () => {
    if (!locked.current) setAddOpen(false);
  };
  const toggle = (id: string) =>
    setSelected((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  const prepare = (value = newTag) => {
    const n = normalizeTagName(value);
    const existing = findTagByName(tags, n);
    if (existing) {
      setSelected((s) => [...new Set([...s, existing.id])]);
      setNewTag("");
      setError("");
      return;
    }
    const problem = tagNameProblem(n, draft);
    if (problem) {
      setError(problem);
      return;
    }
    setDraft((v) => [...v, n]);
    setNewTag("");
    setError("");
  };
  const submit = async (again: boolean, value = name) => {
    if (locked.current || controller.current.signal.aborted) return;
    if (!value.trim()) {
      setError(text.required);
      return;
    }
    const pending = normalizeTagName(newTag);
    const existing = pending ? findTagByName(tags, pending) : undefined;
    const newTags = [...draft];
    if (pending && !existing && !draft.some((t) => t.toLowerCase() === pending.toLowerCase())) {
      const problem = tagNameProblem(pending, []);
      if (problem) {
        setError(problem);
        return;
      }
      newTags.push(pending);
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const ok = await addCategoryWithTags(
        value,
        existing ? [...new Set([...selected, existing.id])] : selected,
        newTags,
        controller.current.signal,
      );
      if (!ok || controller.current.signal.aborted) return;
      if (again) {
        const current = useBoard.getState().tags;
        setSelected([
          ...new Set([
            ...selected,
            ...(existing ? [existing.id] : []),
            ...newTags.flatMap((n) => {
              const t = findTagByName(current, n);
              return t ? [t.id] : [];
            }),
          ]),
        ]);
        setName("");
        setDraft([]);
        setNewTag("");
        requestAnimationFrame(() => nameRef.current?.focus());
      } else {
        setAddOpen(false);
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-category-id="${ok}"]`)
            ?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
      }
    } catch (e) {
      if (!controller.current.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      locked.current = false;
      if (!controller.current.signal.aborted) setBusy(false);
    }
  };
  return createPortal(
    <div
      className={styles.backdrop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !isComposingKey(e)) {
          e.preventDefault();
          close();
        }
        if (e.key === "Tab") {
          const els = [
            ...dialogRef.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled)",
            ),
          ];
          const target = e.shiftKey ? els.at(-1) : els[0];
          if (
            (e.shiftKey && document.activeElement === els[0]) ||
            (!e.shiftKey && document.activeElement === els.at(-1))
          ) {
            e.preventDefault();
            target?.focus();
          }
        }
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-create-title"
        data-testid="category-create"
      >
        <header>
          <h2 id="category-create-title">{text.title}</h2>
          <button type="button" disabled={busy} aria-label={text.close} onClick={close}>
            ×
          </button>
        </header>
        <p className={styles.context}>
          {workspace ? `${workspace.name} · ` : ""}
          {text.context(weekId)}
        </p>
        <fieldset disabled={busy}>
          <label className={styles.label} htmlFor="category-name">
            <span aria-hidden="true">01</span>
            {text.name}
          </label>
          <input
            ref={nameRef}
            id="category-name"
            aria-label={text.name}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) =>
              handleEnterCommit(e, (el) => {
                if (el.isConnected) void submit(false, el.value);
              })
            }
          />
          <p className={styles.hint}>{text.nameHint}</p>
          <div className={styles.label}>
            <span aria-hidden="true">02</span>
            {text.tags}
            <small>{text.optional}</small>
          </div>
          {tags.length > 8 && (
            <input
              aria-label={text.search}
              placeholder={text.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          <div className={styles.tags} role="group" aria-label={text.tags}>
            {tags
              .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={selected.includes(t.id)}
                  onClick={() => toggle(t.id)}
                >
                  {selected.includes(t.id) && <span aria-hidden="true">✓ </span>}
                  {t.name}
                </button>
              ))}
            {!tags.length && <small>{text.noTags}</small>}
          </div>
          <div className={styles.newTag}>
            <input
              aria-label={text.newTag}
              placeholder={text.newTag}
              value={newTag}
              maxLength={20}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) =>
                handleEnterCommit(e, (el) => {
                  if (el.isConnected) prepare(el.value);
                })
              }
            />
            <button type="button" onClick={() => prepare()}>
              {text.addTag}
            </button>
          </div>
          <div className={styles.drafts}>
            {draft.map((t) => (
              <span key={t}>
                {t} · {text.draft}
                <button
                  type="button"
                  aria-label={text.remove(t)}
                  onClick={() => setDraft((v) => v.filter((n) => n !== t))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <p className={styles.hint}>{text.hint}</p>
        </fieldset>
        <p role="alert" className={styles.error}>
          {error}
        </p>
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            {text.cancel}
          </button>
          <button type="button" disabled={busy || !name.trim()} onClick={() => void submit(true)}>
            {text.again}
          </button>
          <button
            className={styles.primary}
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void submit(false)}
          >
            <IconCategoryAdd />
            {busy ? text.busy : text.submit}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
