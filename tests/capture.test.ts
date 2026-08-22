import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  takePhoto: vi.fn(),
  chooseFromGallery: vi.fn(),
}))

vi.mock('@capacitor/camera', () => ({
  Camera: {
    takePhoto: mocks.takePhoto,
    chooseFromGallery: mocks.chooseFromGallery,
  },
  CameraErrorCode: {
    CameraPermissionDenied: 'camera-denied',
    GalleryPermissionDenied: 'gallery-denied',
    TakePhotoCancelled: 'camera-cancelled',
    ChooseMediaCancelled: 'gallery-cancelled',
  },
  EncodingType: { JPEG: 'jpeg' },
  MediaTypeSelection: { Photo: 'photo' },
}))

import {
  captureNativeImage,
  isNativeCapturePermissionDenied,
} from '../src/ocr/capture.ts'

beforeEach(() => vi.clearAllMocks())

describe('原生图片获取', () => {
  it('相册截图直接返回原始 URI，不要求 JPEG 重编码或缩放', async () => {
    mocks.chooseFromGallery.mockResolvedValue({
      results: [{ uri: 'content://gallery/payment.png' }],
    })

    await expect(captureNativeImage('photos')).resolves.toBe(
      'content://gallery/payment.png',
    )
    expect(mocks.chooseFromGallery).toHaveBeenCalledWith({
      mediaType: 'photo',
      allowMultipleSelection: false,
    })
    expect(mocks.chooseFromGallery.mock.calls[0][0]).not.toHaveProperty('quality')
    expect(mocks.chooseFromGallery.mock.calls[0][0]).not.toHaveProperty('targetWidth')
    expect(mocks.chooseFromGallery.mock.calls[0][0]).not.toHaveProperty('targetHeight')
  })

  it('能区分相机和相册权限被拒绝', () => {
    expect(isNativeCapturePermissionDenied({ code: 'camera-denied' })).toBe(true)
    expect(isNativeCapturePermissionDenied({ code: 'gallery-denied' })).toBe(true)
    expect(isNativeCapturePermissionDenied({ code: 'gallery-cancelled' })).toBe(false)
  })
})
