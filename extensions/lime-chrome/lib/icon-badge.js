/**
 * Dynamic icon badge — draws a small colored dot on the extension icon.
 *
 * Uses OffscreenCanvas (available in MV3 service workers) to composite
 * the base icon with a status indicator dot in the bottom-right corner.
 */

const ICON_SIZES = [16, 32]

/** @type {Map<number, ImageBitmap>} */
const iconCache = new Map()

async function loadIcon(size) {
  if (iconCache.has(size)) return iconCache.get(size)
  const url = chrome.runtime.getURL(`icons/icon${size}.png`)
  const resp = await fetch(url)
  const blob = await resp.blob()
  const bmp = await createImageBitmap(blob)
  iconCache.set(size, bmp)
  return bmp
}

/**
 * Set the extension icon with an optional colored status dot.
 * @param {string|null} dotColor — CSS color for the dot, or null to remove it
 */
export async function setIconWithDot(dotColor) {
  if (!dotColor) {
    await chrome.action.setIcon({
      path: { '16': 'icons/icon16.png', '32': 'icons/icon32.png', '48': 'icons/icon48.png', '128': 'icons/icon128.png' },
    })
    // Clear any leftover badge text
    void chrome.action.setBadgeText({ text: '' })
    return
  }

  /** @type {Record<string, ImageData>} */
  const imageData = {}

  for (const size of ICON_SIZES) {
    const bmp = await loadIcon(size)
    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bmp, 0, 0, size, size)

    const dotRadius = Math.round(size * 0.20)
    const cx = size - dotRadius - 1
    const cy = size - dotRadius - 1

    ctx.beginPath()
    ctx.arc(cx, cy, dotRadius + 1, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    ctx.beginPath()
    ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = dotColor
    ctx.fill()

    imageData[String(size)] = ctx.getImageData(0, 0, size, size)
  }

  await chrome.action.setIcon({ imageData })
  void chrome.action.setBadgeText({ text: '' })
}
