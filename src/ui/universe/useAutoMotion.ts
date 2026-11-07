import { useEffect, useRef, useState } from "react";
import type { AutoMotionStyle } from "../../domain/universeAutoMotion";
import { V19 } from "../../shared/v19Strings";
import { toast } from "../board/boardStore";
import { useAppStore } from "../common/appStore";

export function useAutoMotion() {
  const [enabled, setEnabled] = useState(true);
  const [style, setStyle] = useState<AutoMotionStyle>("drift");
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const touched = useRef({ enabled: false, style: false });
  useEffect(() => {
    let active = true;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    void useAppStore
      .getState()
      .platform?.loadConfig()
      .then((c) => {
        if (!active) return;
        if (!touched.current.enabled && typeof c?.universeAutoMotion === "boolean")
          setEnabled(c.universeAutoMotion);
        if (!touched.current.style && c?.universeAutoStyle) setStyle(c.universeAutoStyle);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      media.removeEventListener("change", change);
    };
  }, []);
  return {
    enabled,
    style,
    reduced,
    toggle() {
      touched.current.enabled = true;
      const value = !enabled;
      setEnabled(value);
      void useAppStore
        .getState()
        .platform?.saveConfig({ universeAutoMotion: value })
        .catch(() => toast(V19.configError));
    },
    choose(value: AutoMotionStyle) {
      touched.current.style = true;
      setStyle(value);
      void useAppStore
        .getState()
        .platform?.saveConfig({ universeAutoStyle: value })
        .catch(() => toast(V19.configError));
    },
  };
}
