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
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * The label scan's camera (MT-122): a viewfinder with a box to put the DIN/NPN in. Takes one photo in
 * memory, keeps only the box (with a margin), and writes it to the file the caller names, upright.
 * Result: RESULT_OK with the photo, RESULT_CANCELED when closed, NO_CAMERA when it can't use the camera.
 */
public class LabelCameraActivity extends AppCompatActivity {

    static final String EXTRA_OUTPUT = "output";
    static final int NO_CAMERA = RESULT_FIRST_USER;

    // The box: most of the screen width, square, so a label read across or along the bottle fits.
    private static final float BOX_WIDTH = 0.8f;

    private PreviewView preview;
    private Box box;
    private ImageCapture capture;
    private Button shutter;

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

        TextView hint = new TextView(this);
        hint.setText("Fit the DIN/NPN inside the box");
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
                camera.unbindAll();
                camera.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, p, capture);
            } catch (Exception e) {
                finishWith(NO_CAMERA);
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void takePhoto() {
        if (capture == null) return;
        shutter.setEnabled(false);
        capture.takePicture(ContextCompat.getMainExecutor(this), new ImageCapture.OnImageCapturedCallback() {
            @Override
            public void onCaptureSuccess(@NonNull ImageProxy image) {
                Bitmap photo = upright(image);
                image.close();
                try (FileOutputStream out = new FileOutputStream((File) getIntent().getSerializableExtra(EXTRA_OUTPUT))) {
                    boxOf(photo).compress(Bitmap.CompressFormat.JPEG, 95, out);
                    finishWith(RESULT_OK);
                } catch (IOException | RuntimeException e) {
                    finishWith(NO_CAMERA);
                }
            }

            @Override
            public void onError(@NonNull ImageCaptureException e) {
                shutter.setEnabled(true);
            }
        });
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
    // margin of a quarter of the box on each side so a label held a little off still reads whole.
    private Bitmap boxOf(Bitmap photo) {
        RectF onScreen = box.rect();
        float scale = Math.max((float) preview.getWidth() / photo.getWidth(), (float) preview.getHeight() / photo.getHeight());
        float dx = (preview.getWidth() - photo.getWidth() * scale) / 2;
        float dy = (preview.getHeight() - photo.getHeight() * scale) / 2;
        float pad = onScreen.width() / 4;
        Rect r = new Rect(
            (int) ((onScreen.left - pad - dx) / scale),
            (int) ((onScreen.top - pad - dy) / scale),
            (int) ((onScreen.right + pad - dx) / scale),
            (int) ((onScreen.bottom + pad - dy) / scale)
        );
        if (!r.intersect(0, 0, photo.getWidth(), photo.getHeight())) return photo;
        return Bitmap.createBitmap(photo, r.left, r.top, r.width(), r.height());
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
            float side = getWidth() * BOX_WIDTH;
            float left = (getWidth() - side) / 2;
            float top = (getHeight() - side) / 2;
            return new RectF(left, top, left + side, top + side);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            RectF r = rect();
            float corner = r.width() / 20;
            Path outside = new Path();
            outside.setFillType(Path.FillType.EVEN_ODD);
            outside.addRect(0, 0, getWidth(), getHeight(), Path.Direction.CW);
            outside.addRoundRect(r, corner, corner, Path.Direction.CW);
            canvas.drawPath(outside, shade);
            canvas.drawRoundRect(r, corner, corner, edge);
        }
    }
}
