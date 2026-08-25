import {
  Camera,
  CameraErrorCode,
  EncodingType,
  MediaTypeSelection,
} from '@capacitor/camera'

export type NativeCaptureSource = 'camera' | 'photos'

/** Each image costs a full offline OCR pass, so the picker is capped rather than left open. */
export const MAX_GALLERY_SELECTION = 9

type PluginError = {
  code?: string
  message?: string
}

export function isNativeCaptureCancellation(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = (error as PluginError).code
  return (
    code === CameraErrorCode.TakePhotoCancelled ||
    code === CameraErrorCode.ChooseMediaCancelled
  )
}

export function isNativeCapturePermissionDenied(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = (error as PluginError).code
  return (
    code === CameraErrorCode.CameraPermissionDenied ||
    code === CameraErrorCode.GalleryPermissionDenied
  )
}

/**
 * Returns every image the user picked, newest-first order preserved from the picker. A camera
 * capture is inherently one shot; the gallery is where a bill often spans several screenshots,
 * and forcing one round trip per screenshot was pure friction.
 */
export async function captureNativeImages(source: NativeCaptureSource) {
  if (source === 'camera') {
    const result = await Camera.takePhoto({
      quality: 92,
      targetWidth: 2400,
      targetHeight: 2400,
      correctOrientation: true,
      encodingType: EncodingType.JPEG,
      saveToGallery: false,
      includeMetadata: true,
    })
    if (!result.uri) throw new Error('相机没有返回可读取的图片')
    return [result.uri]
  }

  const result = await Camera.chooseFromGallery({
    mediaType: MediaTypeSelection.Photo,
    allowMultipleSelection: true,
    limit: MAX_GALLERY_SELECTION,
  })
  const uris = result.results.map((image) => image.uri).filter((uri): uri is string => Boolean(uri))
  if (uris.length === 0) throw new Error('相册没有返回可读取的图片')
  if (uris.length > MAX_GALLERY_SELECTION) {
    throw new Error(`一次最多选择 ${MAX_GALLERY_SELECTION} 张图片，请分批识别`)
  }
  return uris
}
