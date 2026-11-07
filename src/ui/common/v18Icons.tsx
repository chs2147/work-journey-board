const paths = {
  image: "M3 4h18v16H3zM3 16l6-6 5 5 3-3 4 4M16 8h1",
  import: "M4 3h13v18H4M11 8l5 4-5 4M8 12h12",
  toc: "M4 5h16M8 10h12M8 15h12M4 20h16",
  copy: "M9 8h12v13H9zM5 16H3V3h13v2",
  paste: "M9 4H5v17h15V4h-4M9 2h7v5H9zM9 12h7M9 16h7",
};
export function V18Icon({ kind }: { kind: keyof typeof paths }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={paths[kind]}
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
