import { useEffect, useRef } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { layoutUniverse3d } from "../../domain/universeLayout3d";
import { isDirected, type UGraph } from "../../domain/universe";
import { focusOn, select, setMode, useUniverse } from "./universeStore";
import styles from "./Universe.module.css";

let poseCache: { key: string; position: number[]; target: number[] } | null = null;
/** Local WebGL only. No loaders, textures, URLs or network services. */
export default function UniverseScene({ graph, onFailure }: { graph: UGraph; onFailure: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ zoom: (k: number) => void; fit: () => void } | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true });
    } catch {
      onFailure();
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor("#070d18");
    const cv = renderer.domElement;
    cv.tabIndex = 0;
    cv.setAttribute(
      "aria-label",
      "3D 연결 지도. 방향키 회전, Shift 방향키 이동, 플러스 마이너스 확대, Home 전체 보기",
    );
    cv.dataset.testid = "universe-3d-canvas";
    el.append(cv);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(45, 1, 1, 10000);
    const controls = new OrbitControls(camera, cv);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 70;
    controls.maxDistance = 4000;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = Math.PI - 0.35;
    const positions = layoutUniverse3d(graph);
    const vectors = graph.nodes.map((n) => {
      const p = positions.get(n.id)!;
      return new T.Vector3(p.x, p.y, p.z);
    });
    const bounds = new T.Box3().setFromPoints(vectors);
    const center = bounds.isEmpty() ? new T.Vector3() : bounds.getCenter(new T.Vector3());
    const radius = Math.max(180, bounds.isEmpty() ? 180 : bounds.getSize(new T.Vector3()).length() / 2);
    const fitDistance = radius * 2.8;
    controls.target.copy(center);
    camera.position.copy(center).add(new T.Vector3(0, radius * 0.3, fitDistance));
    const poseKey = [...new Set(graph.nodes.map((n) => n.ws))].sort().join("|");
    const restored = poseCache?.key === poseKey;
    if (restored && poseCache) {
      camera.position.fromArray(poseCache.position);
      controls.target.fromArray(poseCache.target);
    }
    controls.update();
    const geometry = new T.SphereGeometry(1, 10, 8),
      material = new T.MeshBasicMaterial();
    const mesh = new T.InstancedMesh(geometry, material, graph.nodes.length);
    const dummy = new T.Object3D(),
      color = new T.Color();
    const palette = ["#79dce5", "#b5a4ec", "#e4b47d", "#8ccda9", "#d297c4", "#edc977"];
    graph.nodes.forEach((n, i) => {
      dummy.position.copy(vectors[i]!);
      dummy.scale.setScalar(n.kind === "category" || n.kind === "workspace" ? 5 : 2.6);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.set(
        palette[
          Math.abs([...(n.ws + (n.categoryId ?? n.kind))].reduce((a, c) => a + c.charCodeAt(0), 0)) %
            palette.length
        ]!,
      );
      if (n.color) color.set(getComputedStyle(el).getPropertyValue(`--cat-${n.color}`).trim() || "#79dce5");
      mesh.setColorAt(i, color);
    });
    scene.add(mesh);
    const baseColors = graph.nodes.map((_, i) => {
      const c = new T.Color();
      mesh.getColorAt(i, c);
      return c;
    });
    const arrows: T.ArrowHelper[] = [];

    const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
    const lineData: number[] = [];
    graph.edges.forEach((e) => {
      const a = index.get(e.from),
        b = index.get(e.to);
      if (a !== undefined && b !== undefined)
        lineData.push(...vectors[a]!.toArray(), ...vectors[b]!.toArray());
    });
    graph.edges.forEach((e) => {
      if (!(e.rel && isDirected(e.rel.type)) && e.dir !== "one" && e.dir !== "both") return;
      const a = index.get(e.from),
        b = index.get(e.to);
      if (a === undefined || b === undefined) return;
      const delta = vectors[b]!.clone().sub(vectors[a]!);
      const len = delta.length();
      if (len < 1) return;
      const arrow = new T.ArrowHelper(delta.normalize(), vectors[a]!, len * 0.75, "#79dce5", 6, 3);
      scene.add(arrow);
      arrows.push(arrow);
      if (e.dir === "both") {
        const back = new T.ArrowHelper(delta.clone().negate(), vectors[b]!, len * 0.75, "#79dce5", 6, 3);
        scene.add(back);
        arrows.push(back);
      }
    });
    const linesGeo = new T.BufferGeometry();
    linesGeo.setAttribute("position", new T.Float32BufferAttribute(lineData, 3));
    const linesMat = new T.LineBasicMaterial({ color: "#5d8da7", transparent: true, opacity: 0.23 });
    scene.add(new T.LineSegments(linesGeo, linesMat));
    const ringGeo = new T.RingGeometry(8, 8.5, 48),
      ringMat = new T.MeshBasicMaterial({
        color: "#79dce5",
        transparent: true,
        opacity: 0.7,
        side: T.DoubleSide,
      });
    const ring = new T.Mesh(ringGeo, ringMat);
    scene.add(ring);
    const highlightsGeo = new T.BufferGeometry(),
      highlightsMat = new T.LineBasicMaterial({ color: "#79dce5", transparent: true, opacity: 0.75 });
    const highlights = new T.LineSegments(highlightsGeo, highlightsMat);
    scene.add(highlights);
    const labels = new Map<string, HTMLSpanElement>();
    const labelLayer = document.createElement("div");
    labelLayer.className = styles.spaceLabels ?? "";
    el.append(labelLayer);
    graph.nodes
      .filter((n) => n.kind === "category" || n.kind === "workspace")
      .slice(0, 40)
      .forEach((n) => {
        const label = document.createElement("span");
        label.textContent = n.title;
        labelLayer.append(label);
        labels.set(n.id, label);
      });
    const chosen = document.createElement("span");
    labelLayer.append(chosen);
    let paintedMode = "";
    let frame = 0,
      disposed = false,
      previousMode = restored ? useUniverse.getState().mode : "",
      previousSeed: string | null = restored ? useUniverse.getState().seed : null,
      previousSelected: string | null = null;
    let flight: {
      from: T.Vector3;
      to: T.Vector3;
      startTarget: T.Vector3;
      target: T.Vector3;
      start: number;
    } | null = null;
    let saved: { position: T.Vector3; target: T.Vector3 } | null = null;
    let zoomIntent = false;
    let gate = 0,
      pointerStart: { x: number; y: number } | null = null;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const fly = (target: T.Vector3, pos: T.Vector3) => {
      flight = {
        from: camera.position.clone(),
        to: pos,
        startTarget: controls.target.clone(),
        target,
        start: performance.now(),
      };
    };
    const fit = () => {
      setMode("galaxy");
      saved = null;
      fly(center.clone(), center.clone().add(new T.Vector3(0, radius * 0.3, fitDistance)));
    };
    const zoom = (k: number) => {
      zoomIntent = true;
      flight = null;
      camera.position.sub(controls.target).multiplyScalar(k).add(controls.target);
      controls.update();
    };
    api.current = { zoom, fit };
    const hit = (x: number, y: number) => {
      const r = cv.getBoundingClientRect();
      const ray = new T.Raycaster();
      ray.params.Points.threshold = 10;
      ray.setFromCamera(
        new T.Vector2(((x - r.left) / r.width) * 2 - 1, (-(y - r.top) / r.height) * 2 + 1),
        camera,
      );
      const h = ray.intersectObject(mesh)[0];
      return h?.instanceId !== undefined ? graph.nodes[h.instanceId]?.id : undefined;
    };
    const down = (e: PointerEvent) => {
      cv.focus({ preventScroll: true });
      pointerStart = { x: e.clientX, y: e.clientY };
      flight = null;
      controls.mouseButtons.LEFT = e.shiftKey ? T.MOUSE.PAN : T.MOUSE.ROTATE;
    };
    const up = (e: PointerEvent) => {
      if (pointerStart && Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) < 5) {
        const id = hit(e.clientX, e.clientY);
        if (id) select(id);
      }
      pointerStart = null;
    };
    const dbl = (e: MouseEvent) => {
      const id = hit(e.clientX, e.clientY);
      if (id) focusOn(id);
    };
    const wheel = (e: WheelEvent) => {
      zoomIntent = true;
      if (e.deltaY < 0) {
        const id = hit(e.clientX, e.clientY);
        if (id) select(id);
      }
      flight = null;
    };
    const key = (e: KeyboardEvent) => {
      if (
        !["+", "=", "-", "Home", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      )
        return;
      e.preventDefault();
      if (e.key === "Home") fit();
      else if (e.key === "Escape") setMode("galaxy");
      else if (e.key === "+" || e.key === "=") zoom(0.85);
      else if (e.key === "-") zoom(1.18);
      else {
        const x = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0,
          y = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
        if (e.shiftKey) {
          const v = new T.Vector3(x * 15, y * 15, 0).applyQuaternion(camera.quaternion);
          camera.position.add(v);
          controls.target.add(v);
        } else {
          const off = camera.position.clone().sub(controls.target);
          const sph = new T.Spherical().setFromVector3(off);
          sph.theta += x * 0.1;
          sph.phi = T.MathUtils.clamp(sph.phi - y * 0.1, 0.35, Math.PI - 0.35);
          camera.position.copy(controls.target).add(new T.Vector3().setFromSpherical(sph));
        }
        controls.update();
      }
    };
    const lost = (e: Event) => {
      e.preventDefault();
      onFailure();
    };
    const resize = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      renderer.setSize(r.width, r.height);
      camera.aspect = r.width / Math.max(r.height, 1);
      camera.updateProjectionMatrix();
    });
    resize.observe(el);
    cv.addEventListener("pointerdown", down, true);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("dblclick", dbl);
    cv.addEventListener("wheel", wheel, { passive: true });
    cv.addEventListener("keydown", key);
    cv.addEventListener("webglcontextlost", lost);
    const render = (now: number) => {
      if (disposed) return;
      if (document.hidden) return;
      frame = requestAnimationFrame(render);
      const state = useUniverse.getState();
      const seed = state.seed && index.has(state.seed) ? state.seed : null;
      if (previousMode !== state.mode || previousSeed !== seed) {
        if (state.mode === "focus" && seed) {
          if (previousMode !== "focus")
            saved = { position: camera.position.clone(), target: controls.target.clone() };
          const target = vectors[index.get(seed)!]!.clone();
          const direction = camera.position.clone().sub(controls.target).normalize();
          fly(target, target.clone().addScaledVector(direction, 200));
        } else if (state.mode === "galaxy" && saved) {
          fly(saved.target, saved.position);
          saved = null;
        }
        previousMode = state.mode;
        previousSeed = seed;
        gate = now + 850;
      }
      if (flight) {
        const p = reduced.matches ? 1 : Math.min(1, (now - flight.start) / 650),
          k = p * p * (3 - 2 * p);
        camera.position.lerpVectors(flight.from, flight.to, k);
        controls.target.lerpVectors(flight.startTarget, flight.target, k);
        if (p === 1) flight = null;
      }
      controls.update();
      if (zoomIntent && now > gate && !flight) {
        const ratio = camera.position.distanceTo(controls.target) / fitDistance;
        if (state.mode === "galaxy" && ratio < 0.42 && state.selected && index.has(state.selected)) {
          zoomIntent = false;
          focusOn(state.selected);
          gate = now + 850;
        } else if (state.mode === "focus" && ratio > 0.65) {
          zoomIntent = false;
          setMode("galaxy");
          gate = now + 850;
        }
      }
      const sel = state.selected ? index.get(state.selected) : undefined;
      ring.visible = sel !== undefined;
      if (sel !== undefined) {
        ring.position.copy(vectors[sel]!);
        ring.quaternion.copy(camera.quaternion);
        ring.scale.setScalar(reduced.matches ? 1 : 1 + Math.sin(now / 1000) * 0.03);
        chosen.textContent = graph.nodes[sel]!.title;
      }
      if (previousSelected !== state.selected || paintedMode !== state.mode) {
        const near = new Set([state.selected]);
        graph.edges.forEach((e) => {
          if (e.from === state.selected) near.add(e.to);
          if (e.to === state.selected) near.add(e.from);
        });
        graph.nodes.forEach((n, i) =>
          mesh.setColorAt(
            i,
            baseColors[i]!.clone().multiplyScalar(state.mode === "focus" && !near.has(n.id) ? 0.2 : 1),
          ),
        );
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        linesMat.opacity = state.mode === "focus" ? 0.07 : 0.23;
        paintedMode = state.mode;
        const data: number[] = [];
        graph.edges.forEach((e) => {
          if (e.from !== state.selected && e.to !== state.selected) return;
          const a = index.get(e.from),
            b = index.get(e.to);
          if (a !== undefined && b !== undefined)
            data.push(...vectors[a]!.toArray(), ...vectors[b]!.toArray());
        });
        highlightsGeo.setAttribute("position", new T.Float32BufferAttribute(data, 3));
        highlightsGeo.computeBoundingSphere();
        previousSelected = state.selected;
      }
      const positionLabel = (label: HTMLSpanElement, i: number | undefined) => {
        if (i === undefined) {
          label.hidden = true;
          return;
        }
        const p = vectors[i]!.clone().project(camera);
        label.hidden = p.z > 1 || p.z < -1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1;
        label.style.transform = `translate(${((p.x + 1) * el.clientWidth) / 2 + 10}px,${((1 - p.y) * el.clientHeight) / 2}px)`;
      };
      labels.forEach((l, id) => positionLabel(l, index.get(id)));
      positionLabel(chosen, sel);
      renderer.render(scene, camera);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !disposed) frame = requestAnimationFrame(render);
    };
    document.addEventListener("visibilitychange", visibility);
    frame = requestAnimationFrame(render);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      poseCache = { key: poseKey, position: camera.position.toArray(), target: controls.target.toArray() };
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      api.current = null;
      cv.removeEventListener("pointerdown", down, true);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("dblclick", dbl);
      cv.removeEventListener("wheel", wheel);
      cv.removeEventListener("keydown", key);
      cv.removeEventListener("webglcontextlost", lost);
      arrows.forEach((a) => a.dispose());
      geometry.dispose();
      material.dispose();
      linesGeo.dispose();
      linesMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      highlightsGeo.dispose();
      highlightsMat.dispose();
      renderer.dispose();
      cv.remove();
      labelLayer.remove();
    };
  }, [graph, onFailure]);
  return (
    <div className={styles.map} data-testid="universe-map">
      <div className={styles.mapInfo}>3D 연결 지도 · 드래그 회전 · Shift 드래그 이동 · 휠 확대/축소</div>
      <div className={styles.stage} ref={host} />
      <div className={styles.zoom}>
        <button onClick={() => api.current?.zoom(1.18)} aria-label="축소">
          −
        </button>
        <button onClick={() => api.current?.zoom(0.85)} aria-label="확대">
          ＋
        </button>
        <button onClick={() => api.current?.fit()}>전체 보기</button>
      </div>
    </div>
  );
}
