import { Camera, ReceiptText, Upload } from 'lucide-react'
import type { ChangeEventHandler, RefObject } from 'react'
import type { NativeCaptureSource } from '../ocr/capture.ts'
import type { OcrUiState } from '../ocr/types.ts'

type Props = {
  ocr: OcrUiState
  galleryInputRef: RefObject<HTMLInputElement | null>
  cameraInputRef: RefObject<HTMLInputElement | null>
  onWebImage: ChangeEventHandler<HTMLInputElement>
  onOpenSource: (source: NativeCaptureSource) => void
}
export default function OcrCapturePanel({
  ocr,
  galleryInputRef,
  cameraInputRef,
  onWebImage,
  onOpenSource,
}: Props) {
  return (
    <section className="capture-panel">
      <input
        ref={galleryInputRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        onChange={onWebImage}
      />
      <input
        ref={cameraInputRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onWebImage}
      />
      <div className="capture-copy">
        <span className="panel-icon"><ReceiptText size={22} /></span>
        <div>
          <h2>智能识图入账</h2>
          <p>{ocr.message}</p>
          {ocr.engine && ocr.status !== 'reading' ? (
            <div className="ocr-engine-meta">
              <span>{ocr.engine}</span>
              {typeof ocr.confidence === 'number' ? (
                <span>置信度 {Math.round(ocr.confidence * 100)}%</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {ocr.status === 'reading' ? (
        <div className="progress-track">
          <span style={{ width: `${Math.round(ocr.progress * 100)}%` }} />
        </div>
      ) : null}
      <div className="capture-actions">
        <button
          className="primary-action"
          type="button"
          disabled={ocr.status === 'reading'}
          onClick={() => onOpenSource('photos')}
        >
          <Upload size={20} />从相册选择截图
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={ocr.status === 'reading'}
          onClick={() => onOpenSource('camera')}
        >
          <Camera size={20} />拍照识别
        </button>
      </div>
    </section>
  )
}
