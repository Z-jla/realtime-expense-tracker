# 实时记账

手机优先的个人支出记账应用。支持手动记账、微信/支付宝/银行卡消费截图 OCR 自动入账、月度分类统计，并可打包成 Android APK。

## 功能

- 手动记账：金额、分类、日期、备注、支付方式。
- 智能识图：Android 使用离线 PP-OCRv6 tiny，Web/PWA 使用 Tesseract.js 兼容引擎。
- 坐标化解析：结合文字框位置、识别置信度和“实付/合计”等语义锚点提取金额。
- 安全入账：高置信度支出自动记录；金额冲突、收入、退款和低置信度结果先进入人工确认。
- 账单列表：一次识别多笔支出，过滤收入和退款后支持勾选批量入账。
- 本地保存：数据保存在浏览器或 Android WebView 的 `localStorage`。
- 统计看板：今日支出、本月支出、日均、分类占比、最近记录。
- 离线 OCR：APK 内置 PP-OCRv6 ONNX 模型及 Tesseract 兼容资源，首次识别无需下载模型。
- PWA 支持：网页端可添加到手机主屏幕。

## 技术栈

- React 19
- TypeScript
- Vite
- Tesseract.js
- PaddleOCR PP-OCRv6 tiny
- ONNX Runtime Android
- OpenCV Android
- Capacitor Android
- vite-plugin-pwa
- oxlint

## 目录结构

```text
.
├── android/              # Capacitor Android 工程
│   └── ppocr-sdk/        # 固定版本的 PaddleOCR Android SDK 与离线模型
├── public/               # 静态资源和离线 OCR 资源
│   └── tesseract/
├── scripts/              # 打包与 OCR 调试脚本
├── src/                  # React 应用源码
├── capacitor.config.ts
├── environment.yml       # Conda 环境
├── package.json
└── vite.config.ts
```

## 环境准备

推荐使用 Conda：

```powershell
conda env create -f environment.yml
conda activate spend-app
npm install
```

也可以不用激活环境，直接通过 `conda run` 执行命令：

```powershell
conda run -n spend-app npm install
```

## 本地开发

```powershell
conda run -n spend-app npm run dev
```

如果需要手机在同一局域网访问：

```powershell
conda run -n spend-app npm run dev -- --host 0.0.0.0
```

## 构建网页版本

```powershell
conda run -n spend-app npm run lint
conda run -n spend-app npm run build
```

构建结果输出到 `dist/`。

## 构建 Android APK

1. 安装 Android SDK。
2. 设置环境变量 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT` 指向 Android SDK 目录。
3. 确保当前环境能使用 JDK 21。
4. 目标设备为 Android 8.0（API 26）或更高版本。

同步 Android 工程并构建 debug APK：

```powershell
conda run -n spend-app npm run android:sync
conda run -n spend-app npm run android:debug
conda run -n spend-app npm run android:copy-debug-apk
```

输出文件：

```text
实时记账-debug.apk
android/app/build/outputs/apk/debug/app-debug.apk
```

debug APK 可以直接安装到 Android 手机。安装时如果系统提示未知来源应用，需要允许当前文件管理器或浏览器安装应用。

## OCR 调试

运行字段解析回归测试：

```powershell
conda run -n spend-app npm run test:ocr
```

可以用本地脚本查看截图的文字框、置信度和结构化交易候选：

```powershell
conda run -n spend-app node scripts/probe-ocr.mjs "C:\path\to\screenshot.jpg" chi_sim+eng
```

## 数据说明

- 所有账单数据只保存在本机 `localStorage`。
- 当前版本没有账号系统、云同步和服务器。
- 卸载应用、清除应用数据或清理浏览器站点数据会删除本地账单。

## 开源前注意

- 不要提交 `node_modules/`、`dist/`、Android 构建产物、APK、日志文件和本机 Android SDK 路径。
- `android/ppocr-sdk/` 固定到 PaddleOCR 上游提交并内置 PP-OCRv6 tiny 模型；`public/tesseract/` 是 Web/PWA 与原生异常时的离线降级资源。
- 正式发布到应用商店前，应配置 release 签名、版本号、隐私政策和更完整的备份/导出策略。

## License

MIT
