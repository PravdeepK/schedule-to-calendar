/**
 * Browser-side image downscaling, applied before an upload leaves the page.
 *
 * A phone camera produces far more pixels than the model can use, and every one
 * of them makes the trip twice — browser to API route, then API route to the
 * model. Measured on a 4032x3024 photo: 4748 input tokens and ~2.0MB of base64,
 * against 3896 tokens and ~0.9MB once capped at the ceiling below. The token
 * saving is modest; halving the bytes on a phone network is the real win.
 *
 * This module touches canvas and createImageBitmap, so it is client-only.
 */

/**
 * Long-edge ceiling. Deliberately the same figure as `TARGET_LONG_EDGE_PX` in
 * `lib/pdf.ts`: an uploaded photo of a timetable is the same kind of content as
 * a rendered PDF page, and that module found the hour gridlines — what block
 * start and end times are read against — need this much resolution to survive.
 * Anything lower trades accuracy for speed, which is the wrong trade here.
 */
const MAX_EDGE = 2000;

/**
 * Formats we re-encode to. Each image keeps its original format: screenshots of
 * timetables are usually PNG, where a JPEG round-trip would soften exactly the
 * thin gridlines and small text the extraction depends on. GIF is absent
 * deliberately — canvas cannot re-encode one, and flattening an animation to a
 * still is a surprising thing to do to someone's upload.
 */
const RESIZABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Returns a smaller version of `file`, or `file` itself when it is already
 * within the ceiling, is a format we do not re-encode, or cannot be decoded.
 *
 * Never throws: a failure here should cost the upload some speed, not block it,
 * since the original file is always still a valid thing to send.
 */
export async function downscaleImage(file: File): Promise<File> {
  if (!RESIZABLE_TYPES.has(file.type) || typeof createImageBitmap !== 'function') {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= MAX_EDGE) {
      return file;
    }

    const scale = MAX_EDGE / longEdge;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, file.type, 0.92);
    });

    // A re-encode can come out larger than a well-compressed original even at
    // fewer pixels, and the point of this is to send less.
    if (!blob || blob.size >= file.size) {
      return file;
    }

    return new File([blob], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
