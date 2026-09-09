import test from "node:test";
import assert from "node:assert/strict";
import { makePreset, unwrap, edgeKey, edgesOf, toOBJ } from "../src/uv.js";
test("cube seams produce six disjoint conformal square charts", () => {
  const m = makePreset("Cube"),
    r = unwrap(m, m.seams);
  assert.equal(r.charts.length, 6);
  assert.ok(r.maxStretch < 1.00001);
  for (const f of r.cornerUV)
    for (const uv of f) assert.ok(uv.every((v) => v > 0 && v < 1));
  assert.equal(toOBJ(m, r).match(/^vt /gm).length, 36);
});
test("closed charts are rejected rather than silently projected", () =>
  assert.throws(() => unwrap(makePreset("Cube")), /closed/));
test("changing seams changes actual chart connectivity", () => {
  const m = makePreset("Cube");
  m.seams.delete(edgeKey(0, 3));
  const r = unwrap(m, m.seams);
  assert.equal(r.charts.length, 5);
  assert.ok(r.maxStretch < 1.01);
});
test("cylinder unwrap has side strip and two conformal cap charts", () => {
  const m = makePreset("Cylinder"),
    r = unwrap(m, m.seams);
  assert.equal(r.charts.length, 3);
  assert.ok(r.maxStretch < 1.001, `${r.maxStretch}`);
  assert.ok(r.charts.every((c) => c.residual < 1e-6));
});
test("ribbon stays a continuous disk with finite distortion", () => {
  const m = makePreset("Folded ribbon"),
    r = unwrap(m, m.seams);
  assert.equal(r.charts.length, 1);
  assert.ok(r.maxStretch < 1.1);
  assert.equal(r.cornerUV.length, m.faces.length);
  assert.ok(edgesOf(m).size > 0);
});
test("surface brush crosses disconnected seam charts while preserving surface correspondence", async () => {
  const { brushFootprints } = await import("../src/uv.js");
  const m = makePreset("Cube"),
    r = unwrap(m, m.seams),
    point = [1, 1, 0.2],
    prints = brushFootprints(m, r, point, { radius: 0.18, size: 512 });
  const normals = prints.map((p) => m.faces[p.face].map((v) => m.vertices[v]));
  assert.ok(normals.some((f) => f.every((p) => p[0] === 1)));
  assert.ok(normals.some((f) => f.every((p) => p[1] === 1)));
  assert.ok(normals.every((f) => !f.every((p) => p[1] === -1)));
  for (const p of prints)
    assert.ok(p.transform.every(Number.isFinite) && p.radius > 0);
});
