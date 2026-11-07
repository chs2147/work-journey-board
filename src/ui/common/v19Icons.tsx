const paths = {
  drift: "M3 12c0-4 3-7 7-7s7 3 7 7-3 7-7 7-7-3-7-7ZM1 12h4m12 0h4M10 3v4m0 10v4",
  orbit: "M5 6a8 8 0 1 1-1 11M5 2v5H1M9 12h6m-3-3v6",
  pause: "M8 5v14M16 5v14",
  play: "m8 4 12 8-12 8Z",
};
export function V19Icon({ kind }: { kind: keyof typeof paths }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
