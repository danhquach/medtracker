package app.medtracker.android;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.content.Intent;
import android.os.Bundle;
import android.util.Size;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The label scan's camera (MT-122): a viewfinder with a box to put the DIN/NPN in. Reads the box (with a
 * margin) in each preview frame, one after another, and returns as soon as a frame has an 8-digit
 * number; the shutter reads one full-quality photo instead, number or not. Frames and photos stay in
 * memory. Result: RESULT_OK with EXTRA_BLOCKS (LabelReader's text), RESULT_CANCELED when closed,
 * NO_CAMERA when it can't use the camera.
 */
public class LabelCameraActivity extends AppCompatActivity {

    static final String EXTRA_BLOCKS = "blocks";
    static final int NO_CAMERA = RESULT_FIRST_USER;

    // The box: a strip for one line such as "DIN 0224 2963", most of the screen wide and a quarter as tall.
    private static final float BOX_WIDTH = 0.8f;
    private static final float BOX_HEIGHT = BOX_WIDTH / 4;

    private PreviewView preview;
    private Box box;
    private ImageCapture capture;
    private Button shutter;
    private TextView hint;

    // Tesseract runs here, one read at a time; `done` stops frame reads once a result is on its way.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private LabelReader reader;
    private volatile boolean done;
    // The numbers read in the previous frame: a frame only counts when it agrees, so a one-off misread
    // (an 8 read as a 6) doesn't end the scan.
    private Set<String> lastNumbers = Collections.emptySet();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        preview = new PreviewView(this);
        preview.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(preview, new FrameLayout.LayoutParams(-1, -1));
        box = new Box(this);
        root.addView(box, new FrameLayout.LayoutParams(-1, -1));

        hint = new TextView(this);
        hint.setText("Line up the DIN/NPN number inside the box. It reads by itself.");
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        hint.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams hintAt = new FrameLayout.LayoutParams(-1, -2, Gravity.TOP);
        hintAt.topMargin = dp(96);
        root.addView(hint, hintAt);

        shutter = new Button(this);
        shutter.setContentDescription("Take photo");
        GradientDrawable ring = new GradientDrawable();
        ring.setShape(GradientDrawable.OVAL);
        ring.setColor(Color.WHITE);
        ring.setStroke(dp(6), Color.argb(160, 0, 0, 0));
        shutter.setBackground(ring);
        FrameLayout.LayoutParams shutterAt = new FrameLayout.LayoutParams(dp(76), dp(76), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        shutterAt.bottomMargin = dp(48);
        root.addView(shutter, shutterAt);
        shutter.setOnClickListener((v) -> takePhoto());

        Button close = new Button(this);
        close.setText("Cancel");
        close.setAllCaps(false);
        close.setTextColor(Color.WHITE);
        close.setBackgroundColor(Color.TRANSPARENT);
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        FrameLayout.LayoutParams closeAt = new FrameLayout.LayoutParams(-2, dp(56), Gravity.BOTTOM | Gravity.START);
        closeAt.bottomMargin = dp(58);
        closeAt.leftMargin = dp(16);
        root.addView(close, closeAt);
        close.setOnClickListener((v) -> finishWith(RESULT_CANCELED));

        setContentView(root);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) start();
        else requestPermissions(new String[] { Manifest.permission.CAMERA }, 1);
    }

    @Override
    public void onRequestPermissionsResult(int code, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) start();
        else finishWith(NO_CAMERA);
    }

    private void start() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider camera = future.get();
                Preview p = new Preview.Builder().build();
                p.setSurfaceProvider(preview.getSurfaceProvider());
                capture = new ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build();
                // Frames about as sharp as a photo's box crop, so label print is big enough to read.
                ImageAnalysis frames = new ImageAnalysis.Builder()
                    .setResolutionSelector(new ResolutionSelector.Builder()
                        .setResolutionStrategy(new ResolutionStrategy(new Size(1920, 1440), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                        .build())
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .build();
                frames.setAnalyzer(worker, this::readFrame);
                camera.unbindAll();
                camera.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, p, capture, frames);
            } catch (Exception e) {
                finishWith(NO_CAMERA);
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void readFrame(ImageProxy frame) {
        Bitmap box = done ? null : boxOf(upright(frame));
        frame.close();
        if (box == null) return;
        List<String> blocks = read(box);
        if (blocks == null) return;
        Set<String> numbers = LabelReader.numbers(blocks);
        boolean agreed = !Collections.disjoint(numbers, lastNumbers);
        lastNumbers = numbers;
        if (agreed && !done) {
            done = true;
            runOnUiThread(() -> finishWith(blocks));
        }
    }

    private void takePhoto() {
        if (capture == null || done) return;
        done = true;
        shutter.setEnabled(false);
        hint.setText("Reading the label…");
        capture.takePicture(worker, new ImageCapture.OnImageCapturedCallback() {
            @Override
            public void onCaptureSuccess(@NonNull ImageProxy image) {
                Bitmap box = boxOf(upright(image));
                image.close();
                List<String> blocks = read(box);
                runOnUiThread(() -> {
                    if (blocks == null) finishWith(NO_CAMERA);
                    else finishWith(blocks);
                });
            }

            @Override
            public void onError(@NonNull ImageCaptureException e) {
                runOnUiThread(() -> {
                    done = false;
                    shutter.setEnabled(true);
                });
            }
        });
    }

    // On the worker thread. Null when Tesseract can't start.
    private List<String> read(Bitmap box) {
        try {
            if (reader == null) reader = new LabelReader(this);
            return reader.read(box);
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        done = true;
        worker.execute(() -> {
            if (reader != null) reader.close();
        });
        worker.shutdown();
    }

    private static Bitmap upright(ImageProxy image) {
        Bitmap bitmap = image.toBitmap();
        int degrees = image.getImageInfo().getRotationDegrees();
        if (degrees == 0) return bitmap;
        Matrix m = new Matrix();
        m.postRotate(degrees);
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), m, true);
    }

    // The box on screen, mapped onto the photo the preview shows (filled to the screen, centred), with a
    // margin of half the box's height on each side so a number held a little off still reads whole.
    private Bitmap boxOf(Bitmap photo) {
        RectF onScreen = box.rect();
        float scale = Math.max((float) preview.getWidth() / photo.getWidth(), (float) preview.getHeight() / photo.getHeight());
        float dx = (preview.getWidth() - photo.getWidth() * scale) / 2;
        float dy = (preview.getHeight() - photo.getHeight() * scale) / 2;
        float pad = onScreen.height() / 2;
        Rect r = new Rect(
            (int) ((onScreen.left - pad - dx) / scale),
            (int) ((onScreen.top - pad - dy) / scale),
            (int) ((onScreen.right + pad - dx) / scale),
            (int) ((onScreen.bottom + pad - dy) / scale)
        );
        if (!r.intersect(0, 0, photo.getWidth(), photo.getHeight())) return photo;
        return Bitmap.createBitmap(photo, r.left, r.top, r.width(), r.height());
    }

    private void finishWith(List<String> blocks) {
        setResult(RESULT_OK, new Intent().putStringArrayListExtra(EXTRA_BLOCKS, new ArrayList<>(blocks)));
        finish();
    }

    private void finishWith(int result) {
        setResult(result);
        finish();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /** Dims the screen outside the box and outlines it. */
    private static class Box extends View {

        private final Paint shade = new Paint();
        private final Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);

        Box(Context context) {
            super(context);
            shade.setColor(Color.argb(140, 0, 0, 0));
            edge.setColor(Color.WHITE);
            edge.setStyle(Paint.Style.STROKE);
            edge.setStrokeWidth(4 * context.getResources().getDisplayMetrics().density);
        }

        RectF rect() {
            float width = getWidth() * BOX_WIDTH;
            float height = getWidth() * BOX_HEIGHT;
            float left = (getWidth() - width) / 2;
            float top = (getHeight() - height) / 2;
            return new RectF(left, top, left + width, top + height);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            RectF r = rect();
            float corner = r.height() / 8;
            Path outside = new Path();
            outside.setFillType(Path.FillType.EVEN_ODD);
            outside.addRect(0, 0, getWidth(), getHeight(), Path.Direction.CW);
            outside.addRoundRect(r, corner, corner, Path.Direction.CW);
            canvas.drawPath(outside, shade);
            canvas.drawRoundRect(r, corner, corner, edge);
        }
    }
}
