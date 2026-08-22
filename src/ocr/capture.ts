import {
  Camera,
  CameraErrorCode,
  EncodingType,
  MediaTypeSelection,
} from '@capacitor/camera'

export type NativeCaptureSource = 'camera' | 'photos'

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

export async function captureNativeImage(source: NativeCaptureSource) {
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
    return result.uri
  }

  const result = await Camera.chooseFromGallery({
    mediaType: MediaTypeSelection.Photo,
    allowMultipleSelection: false,
  })
  const image = result.results[0]
  if (!image?.uri) throw new Error('相册没有返回可读取的图片')
  return image.uri
}
