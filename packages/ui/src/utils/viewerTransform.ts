// Pure math for the image viewer. No DOM access: every function takes plain
// numbers so the component can drive it from refs and the tests can pin it.
//
// Coordinate model: the image sits at the origin of the stage with
// `transform-origin: 0 0`, so a point (x, y) in image space lands on screen at
// (tx + scale * x, ty + scale * y).

export interface ViewerTransform {
  scale: number;
  tx: number;
  ty: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Breathing room kept left and right of the image at fit, in px. */
export const FIT_PADDING = 56;
/** Top and bottom room at fit: clears the control pill (bottom) and caption. */
export const FIT_PADDING_Y = 96;
/** Smallest scale allowed for images that already fit at 1:1. */
export const MIN_SMALL_SCALE = 0.25;
/** Floor for the zoom ceiling (800%). */
export const MAX_SCALE = 8;
/** The ceiling lets one image pixel cover at least this many screen pixels,
 *  enough to inspect a single pixel of a 6000px photo on a 4K screen. */
export const MAX_PIXEL_SPAN = 32;
/** ...and always allows at least this multiple of the fit scale, so a region
 *  of a very large image can be zoomed into repeatedly. */
export const MAX_FIT_MULTIPLE = 64;
/** Above this scale the viewer switches to nearest-neighbour rendering so
 *  zoomed pixels stay crisp instead of smearing. */
export const PIXELATED_FROM = 4;
/** Button / key zoom step. */
export const ZOOM_STEP = 1.25;

/** Scale that contains the image in the viewport with padding. Never upscales. */
export function fitScale(
  image: Size,
  viewport: Size,
  padX: number = FIT_PADDING,
  padY: number = FIT_PADDING_Y,
): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  const availW = Math.max(1, viewport.width - padX * 2);
  const availH = Math.max(1, viewport.height - padY * 2);
  return Math.min(1, availW / image.width, availH / image.height);
}

export function minScaleFor(fit: number): number {
  return fit < 1 ? fit : MIN_SMALL_SCALE;
}

export function maxScaleFor(fit: number): number {
  return Math.max(MAX_SCALE, MAX_PIXEL_SPAN, fit * MAX_FIT_MULTIPLE);
}

/**
 * Transform after the viewport changes size (e.g. entering or leaving full
 * screen). At fit it re-fits; otherwise the zoom level is kept and the image
 * point that sat at the viewport centre stays at the centre.
 */
export function resizeTransform(
  t: ViewerTransform,
  wasAtFit: boolean,
  image: Size,
  oldView: Size,
  nextView: Size,
): { transform: ViewerTransform; fit: number } {
  const fit = fitScale(image, nextView);
  if (wasAtFit) return { transform: centered(fit, image, nextView), fit };
  const scale = clampScale(t.scale, minScaleFor(fit), maxScaleFor(fit));
  const ratio = scale / t.scale;
  const cx = oldView.width / 2;
  const cy = oldView.height / 2;
  return {
    fit,
    transform: clampPan(
      {
        scale,
        tx: nextView.width / 2 - (cx - t.tx) * ratio,
        ty: nextView.height / 2 - (cy - t.ty) * ratio,
      },
      image,
      nextView,
    ),
  };
}

export function clampScale(scale: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, scale));
}

/**
 * Keep the image inside the viewport. An axis where the scaled image is
 * smaller than the viewport is centred; otherwise the image edge may not
 * leave a gap.
 */
export function clampPan(
  t: ViewerTransform,
  image: Size,
  viewport: Size,
): ViewerTransform {
  const sw = image.width * t.scale;
  const sh = image.height * t.scale;
  const tx =
    sw <= viewport.width
      ? (viewport.width - sw) / 2
      : Math.min(0, Math.max(viewport.width - sw, t.tx));
  const ty =
    sh <= viewport.height
      ? (viewport.height - sh) / 2
      : Math.min(0, Math.max(viewport.height - sh, t.ty));
  return { scale: t.scale, tx, ty };
}

/** Image centred in the viewport at the given scale. */
export function centered(
  scale: number,
  image: Size,
  viewport: Size,
): ViewerTransform {
  return clampPan({ scale, tx: 0, ty: 0 }, image, viewport);
}

/**
 * Change scale to `nextScale` while the screen point (ax, ay) keeps showing the
 * same image point. Result is clamped to [min, max] and to the viewport.
 */
export function zoomAt(
  t: ViewerTransform,
  nextScale: number,
  ax: number,
  ay: number,
  min: number,
  max: number,
  image: Size,
  viewport: Size,
): ViewerTransform {
  const scale = clampScale(nextScale, min, max);
  const ratio = scale / t.scale;
  return clampPan(
    {
      scale,
      tx: ax - (ax - t.tx) * ratio,
      ty: ay - (ay - t.ty) * ratio,
    },
    image,
    viewport,
  );
}

/** Wheel delta to a multiplicative zoom factor. `fine` is for ctrl / pinch. */
export function wheelFactor(
  deltaY: number,
  deltaMode: number,
  fine: boolean,
): number {
  const px =
    deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
  const clamped = Math.max(-60, Math.min(60, px));
  return Math.exp(-clamped * (fine ? 0.0015 : 0.0025));
}

export function formatPercent(scale: number): number {
  return Math.round(scale * 100);
}
