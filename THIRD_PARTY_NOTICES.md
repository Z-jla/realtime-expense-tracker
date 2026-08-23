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
- OpenCV Android (`org.opencv:opencv:4.12.0`), Apache-2.0 License; official artifact from https://central.sonatype.com/artifact/org.opencv/opencv/4.12.0.
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
- Source: `naptha/tessdata`, branch `gh-pages`, directory `4.0.0_best_int`.
- Upstream: https://github.com/naptha/tessdata/tree/gh-pages/4.0.0_best_int
- License: Apache-2.0 (https://github.com/naptha/tessdata/blob/gh-pages/LICENSE)
- `chi_sim.traineddata` SHA-256: `9784F7C917C546424B690FCDE708CE1F604A4393D08BB51DDAB146D7D7C794E6`
- `eng.traineddata` SHA-256: `5DC5D8D640A212C9D6184921BA103B186F50E0FED9EE716C53E6B312B400D747`
- The repository stores the decompressed files; the hashes above were verified against the decompressed upstream `.gz` assets.

## Capacitor Official Plugins

- `@capacitor/camera` is used to obtain native image URIs without transferring base64 images through the JavaScript bridge.
- `@capacitor/filesystem` writes Android backups to the public Documents directory.
- `@capacitor/share` opens the native share sheet for backup files.
- License: MIT.
