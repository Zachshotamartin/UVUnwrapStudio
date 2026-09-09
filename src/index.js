import {
  brushFootprints,
  makePreset,
  edgesOf,
  edgeKey,
  unwrap,
  toOBJ,
} from "./uv.js";
export const metadata = {
  id: "uv-unwrap-studio",
  title: "UV Unwrap Studio",
  description:
    "Cut a surface into charts, flatten it with least-squares conformal maps, and paint on the model or its texture atlas.",
  technique:
    "Seam topology, least-squares conformal maps, and texture-space painting",
  instructions: [
    "In Seams mode, click an edge and toggle it. Coral edges are cuts.",
    "Unwrap solves the charts again; a closed surface needs enough seams to open it.",
    "Switch to Paint and draw directly on the model or the atlas below. Export the atlas and OBJ together.",
  ],
  limitations: [
    "Presets contain at most 80 triangles; the solver accepts at most 2,000.",
    "Charts use two boundary pins and a rectangular grid packer, not an optimal production atlas packer.",
    "Highly curved or poorly cut charts can overlap or fold. Stretch colors reveal local angular distortion, not a guarantee of an injective map.",
    "The 3D brush uses a small spherical footprint: it spans UV seams but may also touch nearby surfaces on very thin geometry.",
  ],
};
export function createExperiment(ctx) {
  const { THREE, root, ui } = ctx;
  let name = "Cylinder",
    mesh = makePreset(name),
    seams = new Set(mesh.seams),
    solution = unwrap(mesh, seams),
    selected = 0,
    mode = "Seams",
    brushSize = 12,
    ink = "#cd7855",
    showStretch = false,
    object,
    line;
  const texCanvas = document.createElement("canvas");
  texCanvas.width = texCanvas.height = 768;
  const inkCtx = texCanvas.getContext("2d"),
    texture = new THREE.CanvasTexture(texCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(
    8,
    ctx.renderer.capabilities.getMaxAnisotropy(),
  );
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.62,
    side: THREE.DoubleSide,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
  const info = ui.note("");
  function resetPaint() {
    const S = texCanvas.width;
    inkCtx.fillStyle = "#efe9d8";
    inkCtx.fillRect(0, 0, S, S);
    const step = 48;
    for (let y = 0; y < S; y += step)
      for (let x = 0; x < S; x += step) {
        inkCtx.fillStyle = ((x + y) / step) % 2 ? "#d9e3d0" : "#f4eddf";
        inkCtx.fillRect(x, y, step, step);
      }
    inkCtx.strokeStyle = "#a8bbaa";
    inkCtx.lineWidth = 1;
    for (let x = 0; x <= S; x += step) {
      inkCtx.beginPath();
      inkCtx.moveTo(x, 0);
      inkCtx.lineTo(x, S);
      inkCtx.stroke();
      inkCtx.beginPath();
      inkCtx.moveTo(0, x);
      inkCtx.lineTo(S, x);
      inkCtx.stroke();
    }
    texture.needsUpdate = true;
  }
  function drawAtlas() {
    const c = atlas.getContext("2d"),
      S = atlas.width;
    c.clearRect(0, 0, S, S);
    c.drawImage(texCanvas, 0, 0, S, S);
    for (let fi = 0; fi < mesh.faces.length; fi++) {
      const uvs = solution.cornerUV[fi];
      c.beginPath();
      uvs.forEach(([u, v], j) =>
        c[j ? "lineTo" : "moveTo"](u * S, (1 - v) * S),
      );
      c.closePath();
      if (showStretch) {
        const t = Math.min(1, Math.max(0, (solution.stretch[fi] - 1) / 0.7));
        c.fillStyle = `rgba(209,${Math.round(150 - 100 * t)},70,.25)`;
        c.fill();
      }
      c.strokeStyle = "rgba(32,54,45,.5)";
      c.lineWidth = 1;
      c.stroke();
    }
  }
  function rebuild() {
    if (object) {
      root.remove(object);
      object.geometry.dispose();
    }
    if (line) {
      root.remove(line);
      line.geometry.dispose();
    }
    const positions = [],
      uv = [],
      colors = [];
    mesh.faces.forEach((f, fi) => {
      const distortion = Math.min(
          1,
          Math.max(0, (solution.stretch[fi] - 1) / 0.8),
        ),
        color = new THREE.Color(showStretch ? 0xc6805f : 0xffffff);
      if (showStretch) color.lerp(new THREE.Color(0xb23337), distortion);
      for (let j = 0; j < 3; j++) {
        positions.push(...mesh.vertices[f[j]]);
        uv.push(...solution.cornerUV[fi][j]);
        colors.push(color.r, color.g, color.b);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    object = new THREE.Mesh(geo, material);
    object.castShadow = true;
    root.add(object);
    rebuildLines();
    drawAtlas();
    info.textContent = `${solution.charts.length} charts · ${mesh.faces.length} triangles · ${seams.size} seam edges · maximum stretch ${solution.maxStretch.toFixed(3)}×`;
    ctx.invalidate();
  }
  function rebuildLines() {
    if (line) {
      root.remove(line);
      line.geometry.dispose();
    }
    const points = [],
      colors = [],
      edges = [...edgesOf(mesh)];
    selected = Math.min(selected, edges.length - 1);
    edges.forEach(([key, e], i) => {
      const color = new THREE.Color(
        i === selected ? 0xffd489 : seams.has(key) ? 0xcd7957 : 0x577067,
      );
      points.push(...mesh.vertices[e.a], ...mesh.vertices[e.b]);
      for (let j = 0; j < 2; j++) colors.push(color.r, color.g, color.b);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    line = new THREE.LineSegments(geo, lineMaterial);
    line.visible = mode === "Seams";
    root.add(line);
    ctx.invalidate();
  }
  function solve() {
    try {
      solution = unwrap(mesh, seams);
      rebuild();
      ctx.setStatus(
        `Unwrapped ${solution.charts.length} charts. ${solution.maxStretch < 1.03 ? "The flattening is nearly angle-preserving." : "Inspect stretch before painting."}`,
      );
    } catch (error) {
      ctx.setStatus(error.message);
    }
  }
  ui.select("Surface", ["Cube", "Cylinder", "Folded ribbon"], name, (v) => {
    name = v;
    mesh = makePreset(v);
    seams = new Set(mesh.seams);
    selected = 0;
    solution = unwrap(mesh, seams);
    resetPaint();
    rebuild();
    ctx.fit();
    ctx.setStatus(`${v} loaded with suggested seams.`);
  });
  const interactionSelect = ui.select(
    "Interaction",
    ["Seams", "Paint"],
    mode,
    (v) => {
      endPainting();
      mode = v;
      line.visible = v === "Seams";
      updateCursor();
      ctx.invalidate();
    },
  );
  ui.section("Seam selection");
  ui.button("Previous edge", () => {
    const n = edgesOf(mesh).size;
    selected = (selected + n - 1) % n;
    rebuildLines();
  });
  ui.button("Next edge", () => {
    selected = (selected + 1) % edgesOf(mesh).size;
    rebuildLines();
  });
  ui.button("Toggle selected seam", () => {
    const key = [...edgesOf(mesh).keys()][selected];
    seams.has(key) ? seams.delete(key) : seams.add(key);
    rebuildLines();
    ctx.setStatus(`${seams.size} marked seam edges. Unwrap to apply the cuts.`);
  });
  ui.button("Unwrap surface", solve, { primary: true });
  ui.button("Restore suggested seams", () => {
    seams = new Set(mesh.seams);
    solve();
  });
  ui.button("Clear seams", () => {
    seams.clear();
    rebuildLines();
    ctx.setStatus(
      "Seams cleared. Closed surfaces need new cuts before unwrapping.",
    );
  });
  ui.toggle("Show conformal stretch", false, (v) => {
    showStretch = v;
    rebuild();
  });
  ui.section("Texture painting");
  ui.select(
    "Ink",
    [
      { label: "Terracotta", value: "#cd7855" },
      { label: "Forest", value: "#294e3e" },
      { label: "Cobalt", value: "#406c94" },
      { label: "Cream", value: "#fff5dd" },
    ],
    ink,
    (v) => (ink = v),
  );
  ui.range("Brush radius", {
    min: 3,
    max: 40,
    step: 1,
    value: brushSize,
    onChange: (v) => (brushSize = v),
  });
  ui.button("Reset texture", () => {
    resetPaint();
    drawAtlas();
    ctx.invalidate();
  });
  ui.button("Export texture PNG", () =>
    texCanvas.toBlob((blob) => ctx.download("uv-atlas.png", blob, "image/png")),
  );
  ui.button("Export UV OBJ", () =>
    ctx.download("unwrapped-model.obj", toOBJ(mesh, solution)),
  );
  const h = ui.section("Texture atlas"),
    atlas = document.createElement("canvas");
  atlas.width = atlas.height = 512;
  atlas.style.cssText =
    "display:block;width:100%;height:auto;aspect-ratio:1;border:1px solid #607565;border-radius:8px;touch-action:none;cursor:crosshair";
  atlas.setAttribute("aria-label", "Paintable UV texture atlas");
  atlas.setAttribute("role", "img");
  h.parentElement.append(atlas);
  interactionSelect.parentElement.after(h, atlas);
  atlas.style.gridColumn = "1 / -1";
  ui.note(
    "Atlas coordinates match the mesh UVs. Stretch 1.000× means no angular distortion.",
  );
  function surfacePaint(hit) {
    const point = object.worldToLocal(hit.point.clone()).toArray(),
      radius = brushSize / 90;
    for (const p of brushFootprints(mesh, solution, point, {
      radius,
      size: 768,
    })) {
      inkCtx.save();
      inkCtx.beginPath();
      p.triangle.forEach(([x, y], i) => inkCtx[i ? "lineTo" : "moveTo"](x, y));
      inkCtx.closePath();
      inkCtx.clip();
      inkCtx.transform(...p.transform);
      inkCtx.fillStyle = ink;
      inkCtx.beginPath();
      inkCtx.arc(...p.center, p.radius, 0, Math.PI * 2);
      inkCtx.fill();
      inkCtx.restore();
    }
    texture.needsUpdate = true;
    drawAtlas();
    ctx.invalidate();
  }
  function paint(u, v) {
    inkCtx.fillStyle = ink;
    inkCtx.beginPath();
    inkCtx.arc(u * 768, (1 - v) * 768, brushSize, 0, Math.PI * 2);
    inkCtx.fill();
    texture.needsUpdate = true;
    drawAtlas();
    ctx.invalidate();
  }
  let surfacePointer = null,
    atlasPointer = null,
    restoreControls = null,
    down = null;
  function updateCursor() {
    ctx.canvas.style.cursor = mode === "Paint" ? "crosshair" : "";
  }
  // Strokes already drawn into the texture remain committed. Only transient
  // input ownership ends when a pointer is canceled or this tool is hidden.
  function endPainting() {
    const surface = surfacePointer,
      flat = atlasPointer;
    surfacePointer = atlasPointer = null;
    down = null;
    if (restoreControls !== null) {
      ctx.controls.enabled = restoreControls;
      restoreControls = null;
    }
    if (surface !== null && ctx.canvas.hasPointerCapture(surface))
      ctx.canvas.releasePointerCapture(surface);
    if (flat !== null && atlas.hasPointerCapture(flat))
      atlas.releasePointerCapture(flat);
  }
  const release = (event) => {
    if (event.pointerId !== surfacePointer && event.pointerId !== atlasPointer)
      return;
    endPainting();
    if (event.type === "pointerup")
      ctx.setStatus(
        "Texture painted. Export the PNG atlas with the OBJ to keep it.",
      );
  };
  ctx.listen(
    ctx.canvas,
    "pointerdown",
    (e) => {
      if (e.button !== 0 || !e.isPrimary) return;
      down = [e.clientX, e.clientY];
      if (mode !== "Paint") return;
      const hit = ctx.pick(e, [object])[0];
      if (!hit?.uv) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      endPainting();
      surfacePointer = e.pointerId;
      restoreControls = ctx.controls.enabled;
      ctx.controls.enabled = false;
      ctx.canvas.setPointerCapture(e.pointerId);
      surfacePaint(hit);
    },
    { capture: true },
  );
  ctx.listen(
    ctx.canvas,
    "pointermove",
    (e) => {
      if (surfacePointer !== e.pointerId) return;
      if (e.buttons === 0) {
        endPainting();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const hit = ctx.pick(e, [object])[0];
      if (hit?.uv) surfacePaint(hit);
    },
    { capture: true },
  );
  for (const event of ["pointerup", "pointercancel"])
    ctx.listen(window, event, release, { capture: true });
  ctx.listen(ctx.canvas, "lostpointercapture", release);
  ctx.listen(window, "blur", endPainting);
  ctx.listen(ctx.canvas, "click", (e) => {
    if (
      mode !== "Seams" ||
      !down ||
      Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5
    )
      return;
    const hit = ctx.pick(e, [object])[0];
    if (!hit) return;
    const fi = hit.faceIndex,
      f = mesh.faces[fi],
      p = object.worldToLocal(hit.point.clone());
    let best = null,
      dist = Infinity;
    for (let i = 0; i < 3; i++) {
      const a = new THREE.Vector3(...mesh.vertices[f[i]]),
        b = new THREE.Vector3(...mesh.vertices[f[(i + 1) % 3]]),
        q = new THREE.Line3(a, b).closestPointToPoint(
          p,
          true,
          new THREE.Vector3(),
        ),
        d = q.distanceTo(p);
      if (d < dist) {
        dist = d;
        best = edgeKey(f[i], f[(i + 1) % 3]);
      }
    }
    selected = [...edgesOf(mesh).keys()].indexOf(best);
    rebuildLines();
    ctx.setStatus(
      `Edge ${selected + 1} selected. ${seams.has(best) ? "It is a seam." : "It is currently joined."}`,
    );
  });
  const paintAt = (e) => {
    const r = atlas.getBoundingClientRect();
    paint((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
  };
  ctx.listen(atlas, "pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    endPainting();
    atlasPointer = e.pointerId;
    atlas.setPointerCapture(e.pointerId);
    paintAt(e);
  });
  ctx.listen(atlas, "pointermove", (e) => {
    if (atlasPointer !== e.pointerId) return;
    if (e.buttons === 0) {
      endPainting();
      return;
    }
    paintAt(e);
  });
  ctx.listen(atlas, "lostpointercapture", release);
  resetPaint();
  rebuild();
  ctx.fit();
  ctx.setStatus(
    "Three charts unwrap the cylinder. Mark seams, solve, then paint on either view.",
  );
  updateCursor();
  return {
    deactivate() {
      endPainting();
      ctx.canvas.style.cursor = "";
    },
    activate() {
      updateCursor();
    },
    dispose() {
      endPainting();
      ctx.canvas.style.cursor = "";
      texture.dispose();
    },
  };
}
