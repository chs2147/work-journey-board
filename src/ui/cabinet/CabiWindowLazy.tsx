import { lazy } from "react";
export const CabiWindowLazy = lazy(() =>
  import("./CabiWindowApp").then((m) => ({ default: m.CabiWindowApp })),
);
