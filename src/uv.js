const sub = (a, b) => a.map((v, i) => v - b[i]),
  dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  norm = (a) => Math.hypot(...a);
export const edgeKey = (a, b) => (a < b ? `${a}/${b}` : `${b}/${a}`);
export function edgesOf(mesh) {
  const edges = new Map();
  mesh.faces.forEach((f, fi) => {
    for (let j = 0; j < 3; j++) {
      const a = f[j],
        b = f[(j + 1) % 3],
        key = edgeKey(a, b);
      if (!edges.has(key))
        edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [] });
      edges.get(key).faces.push(fi);
    }
  });
  return edges;
}
export function makePreset(name = "Cube") {
  if (name === "Cylinder") {
    const n = 20,
      vertices = [],
      faces = [],
      seams = new Set();
    for (let y of [-1, 1])
      for (let i = 0; i < n; i++)
        vertices.push([
          Math.cos((i * 2 * Math.PI) / n),
          y,
          Math.sin((i * 2 * Math.PI) / n),
        ]);
    vertices.push([0, -1, 0], [0, 1, 0]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      faces.push(
        [i, n + i, n + j],
        [i, n + j, j],
        [2 * n, j, i],
        [2 * n + 1, n + i, n + j],
      );
      seams.add(edgeKey(i, j));
      seams.add(edgeKey(n + i, n + j));
    }
    seams.add(edgeKey(0, n));
    return { vertices, faces, seams };
  }
  if (name === "Folded ribbon") {
    const vertices = [],
      faces = [];
    for (let i = 0; i <= 14; i++) {
      const t = (i / 14) * Math.PI;
      for (let z of [-0.55, 0.55])
        vertices.push([
          Math.sin(t) * 1.8 - 1,
          0.45 * Math.cos(t * 1.5),
          z + (i / 14 - 0.5) * 0.65,
        ]);
    }
    for (let i = 0; i < 14; i++) {
      let a = i * 2;
      faces.push([a, a + 2, a + 1], [a + 1, a + 2, a + 3]);
    }
    return { vertices, faces, seams: new Set() };
  }
  const vertices = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
    quads = [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 4, 7, 3],
      [1, 2, 6, 5],
      [0, 1, 5, 4],
      [3, 7, 6, 2],
    ],
    faces = [],
    seams = new Set();
  for (const [a, b, c, d] of quads) {
    faces.push([a, b, c], [a, c, d]);
    for (const [e, f] of [
      [a, b],
      [b, c],
      [c, d],
      [d, a],
    ])
      seams.add(edgeKey(e, f));
  }
  return { vertices, faces, seams };
}
function cutCharts(mesh, seams) {
  const F = mesh.faces.length;
  if (F > 2000) throw Error("Unwrapping is limited to 2,000 triangles.");
  const parent = Int32Array.from({ length: F * 3 }, (_, i) => i),
    find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    },
    join = (a, b) => {
      a = find(a);
      b = find(b);
      if (a !== b) parent[b] = a;
    };
  const adjacency = Array.from({ length: F }, () => []);
  for (const [key, e] of edgesOf(mesh)) {
    if (e.faces.length > 2)
      throw Error("A nonmanifold edge needs repair before unwrapping.");
    if (e.faces.length !== 2 || seams.has(key)) continue;
    const [a, b] = e.faces;
    adjacency[a].push(b);
    adjacency[b].push(a);
    for (const v of [e.a, e.b])
      join(a * 3 + mesh.faces[a].indexOf(v), b * 3 + mesh.faces[b].indexOf(v));
  }
  const seen = new Set(),
    charts = [];
  for (let first = 0; first < F; first++) {
    if (seen.has(first)) continue;
    const faceIds = [],
      queue = [first];
    seen.add(first);
    for (let qi = 0; qi < queue.length; qi++) {
      const f = queue[qi];
      faceIds.push(f);
      for (const n of adjacency[f])
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
    }
    const ids = new Map(),
      vertices = [],
      faces = [],
      corners = [];
    for (const fi of faceIds) {
      const local = [];
      mesh.faces[fi].forEach((v, j) => {
        const key = find(fi * 3 + j);
        if (!ids.has(key)) {
          ids.set(key, vertices.length);
          vertices.push(mesh.vertices[v]);
        }
        local.push(ids.get(key));
      });
      faces.push(local);
      corners.push(fi);
    }
    charts.push({ vertices, faces, corners });
  }
  return charts;
}
function conjugateGradient(rows, b, n) {
  const diagonal = new Float64Array(n),
    rhs = new Float64Array(n);
  rows.forEach((row, i) => {
    for (const [k, c] of row) {
      diagonal[k] += c * c;
      rhs[k] += c * b[i];
    }
  });
  function mult(x) {
    const y = new Float64Array(n);
    for (const row of rows) {
      let s = 0;
      for (const [k, c] of row) s += c * x[k];
      for (const [k, c] of row) y[k] += c * s;
    }
    return y;
  }
  const x = new Float64Array(n),
    r = rhs.slice(),
    z = Float64Array.from(r, (v, i) => v / Math.max(diagonal[i], 1e-12)),
    p = z.slice();
  let rz = dot(r, z),
    iteration = 0;
  const initial = Math.max(norm(rhs), 1);
  for (; iteration < Math.max(100, n * 4) && iteration < 1600; iteration++) {
    if (norm(r) < initial * 1e-9) break;
    const ap = mult(p),
      den = dot(p, ap);
    if (Math.abs(den) < 1e-25) break;
    const alpha = rz / den;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * ap[i];
      z[i] = r[i] / Math.max(diagonal[i], 1e-12);
    }
    const next = dot(r, z),
      beta = next / rz;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rz = next;
  }
  return { x, iterations: iteration, residual: norm(r) / initial };
}
function flatten(chart) {
  const { vertices, faces } = chart,
    edgeMap = edgesOf(chart),
    boundary = new Set();
  for (const e of edgeMap.values())
    if (e.faces.length === 1) {
      boundary.add(e.a);
      boundary.add(e.b);
    }
  if (boundary.size < 2)
    throw Error(
      "A chart is still closed. Mark seams to open the surface, then unwrap again.",
    );
  let a = [...boundary][0];
  const farthest = (p) =>
    [...boundary].reduce(
      (best, v) =>
        norm(sub(vertices[v], vertices[p])) >
        norm(sub(vertices[best], vertices[p]))
          ? v
          : best,
      a,
    );
  a = farthest(a);
  const b = farthest(a),
    pins = new Map([
      [2 * a, 0],
      [2 * a + 1, 0],
      [2 * b, norm(sub(vertices[b], vertices[a]))],
      [2 * b + 1, 0],
    ]),
    free = new Map();
  for (let i = 0; i < vertices.length * 2; i++)
    if (!pins.has(i)) free.set(i, free.size);
  const rows = [],
    rhs = [];
  for (const f of faces) {
    const A = vertices[f[0]],
      ab = sub(vertices[f[1]], A),
      ac = sub(vertices[f[2]], A),
      l = norm(ab),
      xx = dot(ab, ac) / l,
      yy = norm(cross(ab, ac)) / l,
      D = l * yy;
    if (D < 1e-12)
      throw Error("A degenerate triangle cannot be parameterized.");
    const px = [0, l, xx],
      py = [0, 0, yy],
      weight = Math.sqrt(D / 2),
      gx = [],
      gy = [];
    for (let i = 0; i < 3; i++) {
      gx.push(((py[(i + 1) % 3] - py[(i + 2) % 3]) / D) * weight);
      gy.push(((px[(i + 2) % 3] - px[(i + 1) % 3]) / D) * weight);
    }
    for (let equation = 0; equation < 2; equation++) {
      const row = [];
      let fixed = 0;
      for (let i = 0; i < 3; i++)
        for (let component = 0; component < 2; component++) {
          const idx = 2 * f[i] + component,
            c =
              equation === 0
                ? component === 0
                  ? gx[i]
                  : -gy[i]
                : component === 0
                  ? gy[i]
                  : gx[i];
          if (pins.has(idx)) fixed += c * pins.get(idx);
          else row.push([free.get(idx), c]);
        }
      rows.push(row);
      rhs.push(-fixed);
    }
  }
  const solve = conjugateGradient(rows, rhs, free.size),
    uv = vertices.map((_, i) =>
      [0, 1].map((c) =>
        pins.has(i * 2 + c)
          ? pins.get(i * 2 + c)
          : solve.x[free.get(i * 2 + c)],
      ),
    );
  if (uv.some((p) => p.some((v) => !Number.isFinite(v))))
    throw Error("The chart could not be flattened. Try adding another seam.");
  const longest = [...edgeMap.values()]
      .filter((e) => e.faces.length === 1)
      .sort(
        (a, b) =>
          norm(sub(vertices[b.a], vertices[b.b])) -
          norm(sub(vertices[a.a], vertices[a.b])),
      )[0],
    angle = Math.atan2(
      uv[longest.b][1] - uv[longest.a][1],
      uv[longest.b][0] - uv[longest.a][0],
    ),
    cos = Math.cos(angle),
    sin = Math.sin(angle),
    aligned = uv.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos]);
  return {
    ...chart,
    uv: aligned,
    iterations: solve.iterations,
    residual: solve.residual,
  };
}
export function triangleStretch(p, uv) {
  const ab = sub(p[1], p[0]),
    ac = sub(p[2], p[0]),
    l = norm(ab),
    x = dot(ab, ac) / l,
    y = norm(cross(ab, ac)) / l;
  if (l * y < 1e-12) return Infinity;
  const u = uv[1][0] - uv[0][0],
    v = uv[1][1] - uv[0][1],
    s = uv[2][0] - uv[0][0],
    t = uv[2][1] - uv[0][1],
    A = u / l,
    B = (s - (u * x) / l) / y,
    C = v / l,
    D = (t - (v * x) / l) / y,
    trace = A * A + B * B + C * C + D * D,
    det = (A * D - B * C) ** 2,
    disc = Math.sqrt(Math.max(0, trace * trace - 4 * det)),
    max = (trace + disc) / 2,
    min = (trace - disc) / 2;
  return min < 1e-14 ? Infinity : Math.sqrt(max / min);
}
export function unwrap(mesh, seams = new Set()) {
  const charts = cutCharts(mesh, seams).map(flatten),
    columns = Math.ceil(Math.sqrt(charts.length)),
    rows = Math.ceil(charts.length / columns),
    cornerUV = Array(mesh.faces.length),
    stretch = Array(mesh.faces.length);
  charts.forEach((chart, index) => {
    const min = [0, 1].map((k) => Math.min(...chart.uv.map((p) => p[k]))),
      max = [0, 1].map((k) => Math.max(...chart.uv.map((p) => p[k]))),
      width = max[0] - min[0],
      height = max[1] - min[1],
      cw = 1 / columns,
      ch = 1 / rows,
      pad = 0.08 * Math.min(cw, ch),
      scale = Math.min(
        (cw - 2 * pad) / Math.max(width, 1e-9),
        (ch - 2 * pad) / Math.max(height, 1e-9),
      ),
      ox = (index % columns) * cw + (cw - width * scale) / 2,
      oy = Math.floor(index / columns) * ch + (ch - height * scale) / 2;
    chart.uv = chart.uv.map((p) => [
      (p[0] - min[0]) * scale + ox,
      (p[1] - min[1]) * scale + oy,
    ]);
    chart.faces.forEach((f, i) => {
      const fi = chart.corners[i];
      cornerUV[fi] = f.map((v) => chart.uv[v]);
      stretch[fi] = triangleStretch(
        f.map((v) => chart.vertices[v]),
        cornerUV[fi],
      );
    });
  });
  return {
    charts,
    cornerUV,
    stretch,
    maxStretch: Math.max(...stretch),
    meanStretch: stretch.reduce((a, b) => a + b, 0) / stretch.length,
  };
}
export function toOBJ(mesh, solution) {
  const out = [
    "# UV Unwrap Studio: per-corner UV coordinates",
    ...mesh.vertices.map((v) => `v ${v.join(" ")}`),
  ];
  for (const uv of solution.cornerUV.flat()) out.push(`vt ${uv.join(" ")}`);
  mesh.faces.forEach((f, i) =>
    out.push(`f ${f.map((v, j) => `${v + 1}/${i * 3 + j + 1}`).join(" ")}`),
  );
  return out.join("\n") + "\n";
}
/** A spherical surface-space brush stamped into every intersected UV triangle, including across seams. */
export function brushFootprints(
  mesh,
  solution,
  point,
  { radius = 0.12, size = 768 } = {},
) {
  const footprints = [];
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const f = mesh.faces[fi],
      p = f.map((i) => mesh.vertices[i]);
    if (
      [0, 1, 2].some(
        (k) =>
          point[k] < Math.min(...p.map((v) => v[k])) - radius ||
          point[k] > Math.max(...p.map((v) => v[k])) + radius,
      )
    )
      continue;
    const ab = sub(p[1], p[0]),
      ac = sub(p[2], p[0]),
      l = norm(ab),
      e1 = ab.map((v) => v / l),
      n = cross(ab, ac),
      nl = norm(n);
    if (nl < 1e-12) continue;
    const normal = n.map((v) => v / nl),
      e2 = cross(normal, e1),
      relative = sub(point, p[0]),
      distance = dot(relative, normal);
    if (Math.abs(distance) >= radius) continue;
    const cx = dot(relative, e1),
      cy = dot(relative, e2),
      x = dot(ac, e1),
      y = dot(ac, e2),
      uv = solution.cornerUV[fi].map(([u, v]) => [u * size, (1 - v) * size]),
      a = (uv[1][0] - uv[0][0]) / l,
      b = (uv[1][1] - uv[0][1]) / l,
      c = (uv[2][0] - uv[0][0] - a * x) / y,
      d = (uv[2][1] - uv[0][1] - b * x) / y;
    footprints.push({
      face: fi,
      triangle: uv,
      transform: [a, b, c, d, ...uv[0]],
      center: [cx, cy],
      radius: Math.sqrt(radius * radius - distance * distance),
    });
  }
  return footprints;
}
