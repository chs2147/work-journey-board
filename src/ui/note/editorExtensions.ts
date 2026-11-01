// 메모 상자 편집기 확장(weekly-note-spec 4-3). 허용 서식만 켜고, 글자 크기·색·형광펜은 **클래스로만** 그린다 —
// 실앱 CSP에서는 HTML 속 style="…" 속성이 막히기 때문(Tauri가 <style>에 nonce를 붙여 'unsafe-inline'이 무시됨).
import { Extension, Mark, mergeAttributes, type Extensions } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMDocNode } from "@tiptap/pm/model";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import { isOpenableUrl } from "../../domain/links";
import { FONT_SIZES, TEXT_COLORS } from "../../domain/note";
import { STR } from "../../shared/strings";
import { openLink } from "../common/openLink";

/** 글자 크기: 작게·보통·크게·아주 크게 — `<span data-size class="note-fs-l">` */
const FontSize = Mark.create({
  name: "fontSize",
  addAttributes() {
    return {
      size: {
        default: "m",
        parseHTML: (el) => {
          const v = el.getAttribute("data-size");
          return (FONT_SIZES as readonly string[]).includes(v ?? "") ? v : "m";
        },
        renderHTML: (a) => ({ "data-size": a.size, class: `note-fs-${a.size as string}` }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-size]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

/** 글자색(테마 토큰) — `<span data-color class="note-c-blue">` */
const TextColor = Mark.create({
  name: "textColor",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-color");
          return (TEXT_COLORS as readonly string[]).includes(v ?? "") ? v : null;
        },
        renderHTML: (a) => (a.color ? { "data-color": a.color, class: `note-c-${a.color as string}` } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-color]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

/** 형광펜(한 가지 색) — `<mark class="note-hl">` */
const Highlight = Mark.create({
  name: "highlight",
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML() {
    return ["mark", { class: "note-hl" }, 0];
  },
});

/** 취소선 단축키 Ctrl+Shift+X(스펙 4-3 — 워드·구글 문서와 같은 키). TipTap 기본 Ctrl+Shift+S도 그대로 동작 */
const StrikeKey = Extension.create({
  name: "strikeKey",
  addKeyboardShortcuts() {
    return { "Mod-Shift-x": () => this.editor.commands.toggleStrike() };
  },
});

/**
 * 글 속 링크 끝 ↗ 단추(improve-1101 #6): 링크 글자 뒤에 편집되지 않는 아이콘을 붙이고, 누르면 OS 기본 브라우저로 연다.
 * 글자 자체를 누르면 지금처럼 편집(Ctrl+클릭은 그대로 열기). 문서(JSON)에는 아무것도 저장되지 않는다(장식).
 */
function linkOpenDecorations(doc: PMDocNode): DecorationSet {
  const decos: Decoration[] = [];
  let run: { href: string; end: number } | null = null;
  const flush = () => {
    if (!run) return;
    const href = run.href;
    decos.push(
      Decoration.widget(
        run.end,
        () => {
          const b = document.createElement("span");
          b.className = "note-link-open";
          b.setAttribute("role", "button");
          b.setAttribute("contenteditable", "false");
          b.setAttribute("aria-label", STR.note.openLinkAria(href));
          b.title = STR.note.openLinkTitle(href);
          b.dataset.href = href;
          b.textContent = "↗";
          return b;
        },
        { side: -1, key: `lo-${run.end}-${href}`, ignoreSelection: true },
      ),
    );
    run = null;
  };
  doc.descendants((node, pos) => {
    if (!node.isText) {
      if (node.isBlock) flush();
      return true;
    }
    const mark = node.marks.find((m) => m.type.name === "link");
    const href = (mark?.attrs.href as string | undefined) ?? null;
    if (run && (href !== run.href || pos !== run.end)) flush();
    if (href) run = { href, end: pos + node.nodeSize };
    return false;
  });
  flush();
  return DecorationSet.create(doc, decos);
}

const LinkOpener = Extension.create({
  name: "linkOpener",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("linkOpener"),
        state: {
          init: (_, { doc }) => linkOpenDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? linkOpenDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleDOMEvents: {
            mousedown: (_view, ev) => {
              const el = (ev.target as Element | null)?.closest?.(".note-link-open") as HTMLElement | null;
              if (!el) return false;
              ev.preventDefault();
              void openLink(el.dataset.href ?? "");
              return true;
            },
          },
        },
      }),
    ];
  },
});

export function noteExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2] },
      // 허용 서식 밖(스펙 4-3)은 끈다 — 붙여넣기에서도 이 스키마 밖은 버려진다
      blockquote: false,
      code: false,
      codeBlock: false,
      // 글 속 링크(improve-1026-spec 9-1): http/https 주소만 링크로, 누르면 열지 않는다(Ctrl+클릭 = 기본 브라우저, NoteCanvas).
      // target·rel 속성 없이 클래스로만 그린다 — 앱 창 안에서 페이지가 열리지 않게
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        shouldAutoLink: (url) => /^https?:\/\//i.test(url),
        isAllowedUri: (url) => isOpenableUrl(url),
        HTMLAttributes: { class: "note-link", target: null, rel: null },
      },
      // 목록 뒤에 빈 문단을 늘 붙이는 동작 — 상자가 글보다 커 보여서 끈다(빈 목록 항목에서 Enter로 목록을 빠져나옴)
      trailingNode: false,
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node) => STR.note.taskCheck(node.textContent) },
    }),
    FontSize,
    TextColor,
    Highlight,
    StrikeKey,
    LinkOpener,
  ];
}
