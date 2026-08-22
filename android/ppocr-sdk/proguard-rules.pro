-keep class com.paddle.ocr.** { *; }
-keep class ai.onnxruntime.** { *; }

# JNI binds native methods by the runtime class name (Java_org_opencv_core_Mat_n_1Mat), so a
# renamed OpenCV class fails to link at runtime rather than at build time. proguard-android.txt
# already keeps classes that declare native methods; this makes the requirement explicit and
# covers the pure-Java helpers those classes hand Mats to.
-keep class org.opencv.** { *; }
