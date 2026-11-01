// Cabinet 아이콘(features-1102-spec F5): 제목 앞 📁 폴더 / 🔗 링크 구분, 폴더 창 파일 종류.
import type { FileKind } from "../../domain/cabinet";

export const FolderIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M1.5 4.2c0-.7.5-1.2 1.2-1.2h3.4l1.4 1.5h5.8c.7 0 1.2.5 1.2 1.2v6.6c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z"
      fill="var(--cab-folder)"
      stroke="var(--cab-folder-line)"
      strokeWidth="0.8"
    />
  </svg>
);

export const LinkIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="var(--cab-link)"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9" />
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9" />
  </svg>
);

/** 레일: 서랍장(Cabinet) */
export const CabinetRailIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <rect x="3.5" y="2" width="11" height="14" rx="1.6" />
    <path d="M3.5 6.7h11M3.5 11.3h11M7.6 4.4h2.8M7.6 9h2.8M7.6 13.6h2.8" />
  </svg>
);

const FILE_COLORS: Record<FileKind, string> = {
  folder: "var(--cab-folder)",
  sheet: "#1d7a45",
  doc: "#2b5cab",
  slide: "#c4532b",
  pdf: "#b3261e",
  image: "#8a5aa8",
  text: "var(--text-3)",
  archive: "#8a6d1f",
  other: "var(--text-3)",
};

const FILE_MARK: Partial<Record<FileKind, string>> = {
  sheet: "X",
  doc: "W",
  slide: "P",
  pdf: "PDF",
  image: "",
  text: "",
  archive: "Z",
};

export function FileKindIcon({ kind }: { kind: FileKind }) {
  if (kind === "folder") return <FolderIcon />;
  const c = FILE_COLORS[kind];
  const mark = FILE_MARK[kind] ?? "";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 1.5h6l3 3v10h-9z" fill="var(--surface-card)" stroke={c} strokeWidth="1" />
      <path d="M9.5 1.5v3h3" fill="none" stroke={c} strokeWidth="1" />
      {kind === "image" && <path d="M5 12l2-2.5 1.5 1.6L10 9.5l1.5 2.5z" fill={c} />}
      {kind === "text" && <path d="M5.5 7.5h5M5.5 9.5h5M5.5 11.5h3" stroke={c} strokeWidth="0.9" />}
      {mark && (
        <text
          x="8"
          y="12.2"
          textAnchor="middle"
          fontSize={mark.length > 1 ? 4.2 : 6}
          fontWeight="700"
          fill={c}
          fontFamily="Segoe UI, sans-serif"
        >
          {mark}
        </text>
      )}
    </svg>
  );
}
