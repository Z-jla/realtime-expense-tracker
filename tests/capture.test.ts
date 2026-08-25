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
  captureNativeImages,
  isNativeCapturePermissionDenied,
  MAX_GALLERY_SELECTION,
} from '../src/ocr/capture.ts'

beforeEach(() => vi.clearAllMocks())

describe('原生图片获取', () => {
  it('相册截图直接返回原始 URI，不要求 JPEG 重编码或缩放', async () => {
    mocks.chooseFromGallery.mockResolvedValue({
      results: [{ uri: 'content://gallery/payment.png' }],
    })

    await expect(captureNativeImages('photos')).resolves.toEqual([
      'content://gallery/payment.png',
    ])
    expect(mocks.chooseFromGallery).toHaveBeenCalledWith({
      mediaType: 'photo',
      allowMultipleSelection: true,
      limit: MAX_GALLERY_SELECTION,
    })
    expect(mocks.chooseFromGallery.mock.calls[0][0]).not.toHaveProperty('quality')
    expect(mocks.chooseFromGallery.mock.calls[0][0]).not.toHaveProperty('targetWidth')
    expect(mocks.chooseFromGallery.mock.calls[0][0]).not.toHaveProperty('targetHeight')
  })

  it('一次挑选多张截图时按顺序全部返回', async () => {
    mocks.chooseFromGallery.mockResolvedValue({
      results: [
        { uri: 'content://gallery/1.png' },
        { uri: 'content://gallery/2.png' },
        { uri: 'content://gallery/3.png' },
      ],
    })

    await expect(captureNativeImages('photos')).resolves.toEqual([
      'content://gallery/1.png',
      'content://gallery/2.png',
      'content://gallery/3.png',
    ])
  })

  it('跳过没有 URI 的条目，并拒绝静默截断超过上限的选择', async () => {
    mocks.chooseFromGallery.mockResolvedValue({
      results: [
        { uri: 'content://gallery/1.png' },
        { uri: undefined },
        ...Array.from({ length: MAX_GALLERY_SELECTION + 4 }, (_unused, index) => ({
          uri: `content://gallery/extra-${index}.png`,
        })),
      ],
    })

    await expect(captureNativeImages('photos')).rejects.toThrow(
      `一次最多选择 ${MAX_GALLERY_SELECTION} 张图片`,
    )
  })

  it('相册没有返回任何可读 URI 时报错', async () => {
    mocks.chooseFromGallery.mockResolvedValue({ results: [{ uri: undefined }] })
    await expect(captureNativeImages('photos')).rejects.toThrow('相册没有返回可读取的图片')
  })

  it('拍照始终只产生一张图片', async () => {
    mocks.takePhoto.mockResolvedValue({ uri: 'file:///tmp/shot.jpg' })
    await expect(captureNativeImages('camera')).resolves.toEqual(['file:///tmp/shot.jpg'])
  })

  it('能区分相机和相册权限被拒绝', () => {
    expect(isNativeCapturePermissionDenied({ code: 'camera-denied' })).toBe(true)
    expect(isNativeCapturePermissionDenied({ code: 'gallery-denied' })).toBe(true)
    expect(isNativeCapturePermissionDenied({ code: 'gallery-cancelled' })).toBe(false)
  })
})
