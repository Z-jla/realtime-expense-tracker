# Third Party Notices

This project bundles local OCR runtime assets under `public/tesseract/` so the
Android APK can run OCR without downloading models at first use.

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
