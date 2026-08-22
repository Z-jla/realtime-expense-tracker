const MAX_IMAGE_SIDE = 2400

export type NormalizedImage = {
  blob: Blob
  width: number
  height: number
}

export async function normalizeImage(file: File): Promise<NormalizedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })

  if (!context) {
    bitmap.close()
    throw new Error('当前设备无法处理这张图片')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const screenshotLike = file.type === 'image/png' || file.type === 'image/webp'
  const mimeType = screenshotLike ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, screenshotLike ? undefined : 0.94)
  })

  if (!blob) throw new Error('图片预处理失败')
  return { blob, width, height }
}
