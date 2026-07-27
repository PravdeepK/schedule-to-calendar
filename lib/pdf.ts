/**
 * Longest edge, in pixels, of a rendered page. Claude reads images up to 2576px
 * on the long edge; staying just under that keeps the hour gridlines sharp,
 * which is what block start/end times are read against.
 */
const TARGET_LONG_EDGE_PX = 2000;

export interface RenderedPage {
  /** PNG bytes. */
  data: Uint8Array;
  pageNumber: number;
}

/**
 * Rasterizes each page of a PDF to a PNG.
 *
 * Sending the PDF directly is the obvious approach and was measurably worse:
 * block end times came back different on repeated runs of the same file,
 * because the vector content gives no strong visual cue for where a shaded
 * block stops relative to the hour scale. Rendering to a high-resolution image
 * gives the model the same pixels a person would look at.
 *
 * `mupdf` is a WebAssembly build with no native dependencies, so it works in a
 * serverless runtime where node-canvas would not. It is ESM-only with top-level
 * await, hence the dynamic import.
 */
export async function renderPdfPages(bytes: Uint8Array): Promise<RenderedPage[]> {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pageCount = doc.countPages();
  const pages: RenderedPage[] = [];

  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.loadPage(index);
    const [x0, y0, x1, y1] = page.getBounds();
    const longEdge = Math.max(x1 - x0, y1 - y0);
    // Never upscale: enlarging a small page adds pixels but no detail.
    const scale = Math.min(TARGET_LONG_EDGE_PX / longEdge, 4);

    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );

    pages.push({ data: pixmap.asPNG(), pageNumber: index + 1 });
  }

  return pages;
}
