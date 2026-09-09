import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  cacheDir: ".vite",
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/lifecycle.html`,
  );
  await page.waitForFunction(() => window.lab);
  const viewport = page.locator(".graphics-workbench__viewport canvas");
  const atlas = page.getByRole("img", { name: "Paintable UV texture atlas" });
  const texture = () => atlas.evaluate((c) => c.toDataURL());
  const enabled = () => page.evaluate(() => window.uvContext.controls.enabled);
  const point = async (locator, x, y) => {
    await locator.scrollIntoViewIfNeeded();
    const r = await locator.boundingBox();
    return { x: r.x + r.width * x, y: r.y + r.height * y };
  };
  await page
    .getByRole("combobox", { name: "Interaction", exact: true })
    .selectOption("Paint");
  const clean = await texture();
  let p = await point(viewport, 0.5, 0.5);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  assert.equal(
    await enabled(),
    false,
    "A surface paint stroke owns camera input.",
  );
  assert.notEqual(
    await texture(),
    clean,
    "The stroke changes real atlas pixels.",
  );
  await page.evaluate(() => window.switchAway());
  assert.equal(
    await viewport.evaluate((c) => c.hasPointerCapture(1)),
    false,
    "Switching releases surface pointer capture.",
  );
  await page.mouse.up();
  await page.evaluate(() => window.switchBack());
  assert.equal(
    await enabled(),
    true,
    "Returning after switching during surface painting restores orbit controls.",
  );
  const completed = await texture();
  p = await point(viewport, 0.56, 0.44);
  await page.mouse.move(p.x, p.y, { steps: 12 });
  assert.equal(
    await texture(),
    completed,
    "Hovering on return does not resume an abandoned surface stroke.",
  );
  assert.notEqual(completed, clean, "Switching keeps completed paint.");
  console.log(
    "Surface painting stops on cached tool switches and keeps completed pixels.",
  );

  await page
    .getByRole("button", { name: "Reset texture", exact: true })
    .click();
  const cleanAtlas = await texture();
  p = await point(atlas, 0.22, 0.28);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 18, p.y + 15, { steps: 4 });
  assert.notEqual(
    await texture(),
    cleanAtlas,
    "Atlas stroke changes real pixels.",
  );
  await page.evaluate(() => window.switchAway());
  assert.equal(
    await page.evaluate(
      () =>
        window.uvContext.ui &&
        document.querySelector('[aria-label="Paintable UV texture atlas"]') !==
          null,
    ),
    false,
    "The inactive atlas is detached.",
  );
  await page.mouse.up();
  await page.evaluate(() => window.switchBack());
  const atlasCompleted = await texture();
  p = await point(atlas, 0.72, 0.68);
  await page.mouse.move(p.x, p.y, { steps: 12 });
  assert.equal(
    await texture(),
    atlasCompleted,
    "Hovering after switching does not resume an abandoned atlas stroke.",
  );
  console.log(
    "Atlas painting and its pointer capture stop when switching tools.",
  );

  for (const target of [viewport, atlas]) {
    p = await point(target, 0.48, 0.48);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await target.dispatchEvent("pointercancel", {
      pointerId: 1,
      bubbles: true,
    });
    await page.mouse.up();
    const afterCancel = await texture();
    await page.mouse.move(p.x + 32, p.y - 18, { steps: 8 });
    assert.equal(
      await texture(),
      afterCancel,
      "A canceled pointer cannot keep painting.",
    );
    assert.equal(await enabled(), true, "Cancellation restores controls.");
  }
  console.log(
    "Surface and atlas pointer cancellation preserve completed paint and release input.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  p = await point(viewport, 0.5, 0.48);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: p.x, y: p.y, id: 7 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: p.x + 12, y: p.y + 6, id: 7 }],
  });
  await page.evaluate(() => window.switchAway());
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.evaluate(() => window.switchBack());
  assert.equal(
    await enabled(),
    true,
    "A canceled mobile stroke restores the camera too.",
  );
  console.log("390px layout and real touch switching pass.");
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.lab.dispose());
  assert.equal(
    await page.locator("#lab").evaluate((e) => e.childElementCount),
    0,
  );
} finally {
  await browser?.close();
  await server.close();
}
