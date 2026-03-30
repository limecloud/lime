/**
 * Extension.captureHighlightedViewport — Screenshot with element annotations.
 *
 * Takes a clean screenshot, then draws dashed rectangles and index labels
 * over interactive elements using OffscreenCanvas in the Service Worker.
 *
 * Color scheme follows Manus convention:
 *   button  → yellow, input → coral, select → pink, a → green,
 *   textarea → blue, default → red
 */

const TAG_COLORS = {
  button: '#FFFF00',
  input: '#FF7F50',
  select: '#FF4162',
  a: '#00FF00',
  textarea: '#0000FF',
}
const DEFAULT_COLOR = '#FF0000'

function colorForTag(tag) {
  return TAG_COLORS[tag] || DEFAULT_COLOR
}

/**
 * Render element annotations onto a screenshot.
 *
 * @param {string} base64Png — Clean screenshot as base64
 * @param {Array<{idx: number, tag: string, rect: {x: number, y: number, w: number, h: number}}>} elements
 * @param {number} width — Viewport width
 * @param {number} height — Viewport height
 * @returns {Promise<string>} Annotated screenshot as base64
 */
export async function renderHighlightedScreenshot(base64Png, elements, width, height) {
  const blob = await (await fetch(`data:image/png;base64,${base64Png}`)).blob()
  const bitmap = await createImageBitmap(blob)

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)

  const scaleX = bitmap.width / width
  const scaleY = bitmap.height / height

  const fontSize = Math.max(10, Math.min(20, Math.round(bitmap.width / 100)))
  ctx.font = `bold ${fontSize}px monospace`
  ctx.textBaseline = 'top'

  const DASH_LENGTH = 4 * scaleX
  const GAP_LENGTH = 8 * scaleX
  const LINE_WIDTH = 2 * scaleX
  const LABEL_PAD = 3 * scaleX

  for (const el of elements) {
    const color = colorForTag(el.tag)
    const x = el.rect.x * scaleX
    const y = el.rect.y * scaleY
    const w = el.rect.w * scaleX
    const h = el.rect.h * scaleY

    ctx.strokeStyle = color
    ctx.lineWidth = LINE_WIDTH
    ctx.setLineDash([DASH_LENGTH, GAP_LENGTH])
    ctx.strokeRect(x, y, w, h)
    ctx.setLineDash([])

    const label = String(el.idx)
    const metrics = ctx.measureText(label)
    const lw = metrics.width + LABEL_PAD * 2
    const lh = fontSize + LABEL_PAD * 2

    let lx = x - lw - 2
    let ly = y - 2
    if (lx < 0) lx = x + w + 2
    if (ly < 0) ly = y + h + 2
    if (lx + lw > bitmap.width) lx = x
    if (ly + lh > bitmap.height) ly = y

    ctx.fillStyle = color
    ctx.fillRect(lx, ly, lw, lh)
    ctx.fillStyle = '#000000'
    ctx.fillText(label, lx + LABEL_PAD, ly + LABEL_PAD)
  }

  const outBlob = await canvas.convertToBlob({ type: 'image/png' })
  const buffer = await outBlob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  const chunks = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)))
  }
  return btoa(chunks.join(''))
}
