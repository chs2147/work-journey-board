// 메모 상자 편집기 확장(weekly-note-spec 4-3). 허용 서식만 켜고, 글자 크기·색·형광펜은 **클래스로만** 그린다 —
// 실앱 CSP에서는 HTML 속 style="…" 속성이 막히기 때문(Tauri가 <style>에 nonce를 붙여 'unsafe-inline'이 무시됨).
import { Extension, Mark, mergeAttributes, type Extensions } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import { FONT_SIZES, TEXT_COLORS } from "../../domain/note";
import { STR } from "../../shared/strings";

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

export function noteExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2] },
      // 허용 서식 밖(스펙 4-3)은 끈다 — 붙여넣기에서도 이 스키마 밖은 버려진다
      blockquote: false,
      code: false,
      codeBlock: false,
      link: false,
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
  ];
}
