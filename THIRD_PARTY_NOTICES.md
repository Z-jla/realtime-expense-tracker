# Third Party Notices

This project bundles local OCR runtime assets under `public/tesseract/` for the
Web/PWA build. Android builds exclude that directory and use the bundled
PP-OCRv6 ONNX models instead.

## PaddleOCR Android SDK

- Project: PaddlePaddle/PaddleOCR
- License: Apache-2.0
- Source commit: `2661c7c0ef5c613e8f93c6e93b2e052399f0f854`
- Vendored path: `android/ppocr-sdk/src/main/java/com/paddle/ocr/`
- Upstream: https://github.com/PaddlePaddle/PaddleOCR

## PP-OCRv6 tiny ONNX Models

- License: Apache-2.0
- Detection model: https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx
- Recognition model: https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx
- Detection SHA-256: `193BAB7A04FCA699A6C82E6ABB5B81BDB28177F0ABD4062552B04908DAFB19F8`
- Recognition SHA-256: `9EF676D6ED3C88256A2D92C640C44F25B0C40947E111B14B8BE8F594091563E6`
- Recognition config SHA-256: `66170210BAD538E83FFF3C4A3867E547D6BF20B50D64B20347C4B913F3034EA1`

## Native OCR Runtime Dependencies

- ONNX Runtime Android (`com.microsoft.onnxruntime:onnxruntime-android:1.21.1`), MIT License.
- OpenCV Android (`com.quickbirdstudios:opencv:4.5.3`), Apache-2.0 License.
- Kotlin Coroutines Android (`org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0`), Apache-2.0 License.

## Tesseract.js

- Package: `tesseract.js`
- License: Apache-2.0
- Used for browser-side OCR worker orchestration.

## Tesseract.js Core

- Package: `tesseract.js-core`
- License: Apache-2.0
- Used for WebAssembly OCR runtime files.

## Tesseract OCR Language Data

- Files: `chi_sim.traineddata`, `eng.traineddata`
- Used for Simplified Chinese and English OCR.
- These files come from the Tesseract OCR language data ecosystem. Before
  redistribution in a published app or package, review and preserve the
  upstream notices that apply to the specific model files you ship.

## Capacitor Official Plugins

- `@capacitor/camera` is used to obtain native image URIs without transferring base64 images through the JavaScript bridge.
- `@capacitor/filesystem` writes Android backups to the public Documents directory.
- `@capacitor/share` opens the native share sheet for backup files.
- License: MIT.
