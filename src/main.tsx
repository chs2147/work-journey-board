import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./shared/tokens.css";
import { applyPaletteCssVars } from "./shared/palette";
import { App } from "./ui/App";

applyPaletteCssVars();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
