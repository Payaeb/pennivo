import { describe, it, expect } from "vitest";
import {
  centered,
  clampPan,
  clampScale,
  fitScale,
  maxScaleFor,
  resizeTransform,
  minScaleFor,
  wheelFactor,
  zoomAt,
} from "../viewerTransform";

const VIEW = { width: 1000, height: 800 };

describe("fitScale", () => {
  it("fits a landscape image by width", () => {
    // available 888 x 608 (56px sides, 96px top and bottom)
    expect(fitScale({ width: 2000, height: 1000 }, VIEW)).toBeCloseTo(0.444, 3);
  });
  it("fits a portrait image by height", () => {
    expect(fitScale({ width: 1000, height: 3000 }, VIEW)).toBeCloseTo(
      608 / 3000,
      5,
    );
  });
  it("leaves room for the control pill below a tall image", () => {
    const image = { width: 1000, height: 3000 };
    const t = centered(fitScale(image, VIEW), image, VIEW);
    expect(t.ty + image.height * t.scale).toBeLessThanOrEqual(VIEW.height - 96);
    expect(t.ty).toBeGreaterThanOrEqual(96 - 0.001);
  });
  it("never upscales a small image", () => {
    expect(fitScale({ width: 120, height: 80 }, VIEW)).toBe(1);
  });
  it("tolerates a zero-size image", () => {
    expect(fitScale({ width: 0, height: 0 }, VIEW)).toBe(1);
  });
});

describe("limits", () => {
  it("min is fit for large images and 25% for small ones", () => {
    expect(minScaleFor(0.3)).toBe(0.3);
    expect(minScaleFor(1)).toBe(0.25);
  });
  it("max covers 32 screen px per image pixel, or 64x fit if larger", () => {
    // 6000x4000 on a 1920x1080 view fits at ~0.16: 3200% dominates.
    expect(maxScaleFor(0.11)).toBe(32);
    expect(maxScaleFor(0.4)).toBe(32);
    // small image at fit 1: 64x fit = 6400%.
    expect(maxScaleFor(1)).toBe(64);
    expect(maxScaleFor(0.1)).toBeGreaterThanOrEqual(8);
  });
  it("clampScale clamps both ends", () => {
    expect(clampScale(0.01, 0.25, 8)).toBe(0.25);
    expect(clampScale(50, 0.25, 8)).toBe(8);
    expect(clampScale(2, 0.25, 8)).toBe(2);
  });
});

describe("clampPan", () => {
  const image = { width: 400, height: 300 };
  it("centres an axis when the image is smaller than the viewport", () => {
    const t = clampPan({ scale: 1, tx: -999, ty: 999 }, image, VIEW);
    expect(t.tx).toBe(300);
    expect(t.ty).toBe(250);
  });
  it("stops the edges at the viewport edges when larger", () => {
    const big = { width: 4000, height: 3000 };
    expect(clampPan({ scale: 1, tx: 50, ty: 50 }, big, VIEW)).toMatchObject({
      tx: 0,
      ty: 0,
    });
    expect(
      clampPan({ scale: 1, tx: -99999, ty: -99999 }, big, VIEW),
    ).toMatchObject({ tx: -3000, ty: -2200 });
  });
  it("centres only the axis that fits", () => {
    const wide = { width: 4000, height: 100 };
    const t = clampPan({ scale: 1, tx: -500, ty: 0 }, wide, VIEW);
    expect(t.tx).toBe(-500);
    expect(t.ty).toBe(350);
  });
});

describe("zoomAt", () => {
  const image = { width: 4000, height: 3000 };
  it("keeps the anchor point fixed on screen", () => {
    const start = { scale: 1, tx: -1200, ty: -900 };
    const ax = 400;
    const ay = 300;
    const imgX = (ax - start.tx) / start.scale;
    const imgY = (ay - start.ty) / start.scale;
    const next = zoomAt(start, 2.5, ax, ay, 0.25, 8, image, VIEW);
    expect(next.scale).toBe(2.5);
    expect(next.tx + imgX * next.scale).toBeCloseTo(ax, 6);
    expect(next.ty + imgY * next.scale).toBeCloseTo(ay, 6);
  });
  it("clamps to max and min", () => {
    const start = { scale: 1, tx: -1200, ty: -900 };
    expect(zoomAt(start, 99, 0, 0, 0.25, 8, image, VIEW).scale).toBe(8);
    expect(zoomAt(start, 0.001, 0, 0, 0.25, 8, image, VIEW).scale).toBe(0.25);
  });
  it("re-centres when zooming out until the image fits", () => {
    const small = { width: 400, height: 300 };
    const out = zoomAt(
      { scale: 2, tx: -100, ty: -50 },
      1,
      500,
      400,
      0.25,
      8,
      small,
      VIEW,
    );
    expect(out.tx).toBe(300);
    expect(out.ty).toBe(250);
  });
});

describe("centered + wheelFactor", () => {
  it("centres at a given scale", () => {
    expect(centered(0.5, { width: 1000, height: 800 }, VIEW)).toEqual({
      scale: 0.5,
      tx: 250,
      ty: 200,
    });
  });
  it("wheel up zooms in, down zooms out, ctrl is finer", () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(-100, 0, true)).toBeLessThan(
      wheelFactor(-100, 0, false),
    );
  });
});

describe("zoomAt repeated zoom into one region", () => {
  it("keeps the anchor fixed across many steps well past 800%", () => {
    const image = { width: 6000, height: 4000 };
    const view = { width: 1920, height: 1080 };
    const fit = fitScale(image, view);
    // Start at 1:1: while the image is smaller than the viewport an axis
    // is centred by design, so the anchor can only hold once it overflows.
    let t = centered(1, image, view);
    const ax = 1400;
    const ay = 300;
    const imgX = (ax - t.tx) / t.scale;
    const imgY = (ay - t.ty) / t.scale;
    const max = maxScaleFor(fit);
    for (let i = 0; i < 40; i++) {
      t = zoomAt(t, t.scale * 1.25, ax, ay, minScaleFor(fit), max, image, view);
      expect(t.tx + imgX * t.scale).toBeCloseTo(ax, 4);
      expect(t.ty + imgY * t.scale).toBeCloseTo(ay, 4);
    }
    expect(t.scale).toBe(max);
    expect(t.scale).toBeGreaterThan(8);
  });

  it("clamping at the maximum keeps edges inside the viewport", () => {
    const image = { width: 6000, height: 4000 };
    const view = { width: 1920, height: 1080 };
    const t = clampPan({ scale: 32, tx: 5000, ty: -9e9 }, image, view);
    expect(t.tx).toBe(0);
    expect(t.ty).toBe(view.height - 4000 * 32);
  });
});

describe("resizeTransform", () => {
  const image = { width: 6000, height: 4000 };
  const small = { width: 1280, height: 720 };
  const big = { width: 1920, height: 1080 };

  it("re-fits when the user was at fit", () => {
    const fit = fitScale(image, small);
    const r = resizeTransform(
      centered(fit, image, small),
      true,
      image,
      small,
      big,
    );
    expect(r.fit).toBeCloseTo(fitScale(image, big), 8);
    expect(r.transform.scale).toBeCloseTo(r.fit, 8);
  });

  it("keeps zoom level and the centre focal point when zoomed in", () => {
    const t = { scale: 6, tx: -9000, ty: -7000 };
    const cx = (small.width / 2 - t.tx) / t.scale;
    const cy = (small.height / 2 - t.ty) / t.scale;
    const r = resizeTransform(t, false, image, small, big);
    expect(r.transform.scale).toBe(6);
    expect(r.transform.tx + cx * 6).toBeCloseTo(big.width / 2, 6);
    expect(r.transform.ty + cy * 6).toBeCloseTo(big.height / 2, 6);
  });

  it("returns to the same view after a round trip", () => {
    const t = { scale: 6, tx: -9000, ty: -7000 };
    const there = resizeTransform(t, false, image, small, big).transform;
    const back = resizeTransform(there, false, image, big, small).transform;
    expect(back.tx).toBeCloseTo(t.tx, 6);
    expect(back.ty).toBeCloseTo(t.ty, 6);
    expect(back.scale).toBe(6);
  });
});
