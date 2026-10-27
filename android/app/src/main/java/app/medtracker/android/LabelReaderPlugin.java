package app.medtracker.android;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * DIN/NPN label scan (MT-105, MT-122): LabelCameraActivity takes one photo of the box on its screen into
 * the app cache (never the gallery), LabelReader reads it on the phone, and the photo is deleted. Returns the text blocks;
 * picking the number out of them is the page's job. A new name, not MT-105's ML Kit "LabelScanner", so
 * the page only offers Scan on an APK that sends nothing to Google.
 */
@CapacitorPlugin(name = "LabelReader")
public class LabelReaderPlugin extends Plugin {

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    // One fixed name, so a photo left by a killed app is replaced and deleted by the next scan.
    private File photo() {
        return new File(getContext().getCacheDir(), "label-scan.jpg");
    }
    @PluginMethod
    public void scan(PluginCall call) {
        File photo = photo();
        photo.delete();
        Intent intent = new Intent(getContext(), LabelCameraActivity.class).putExtra(LabelCameraActivity.EXTRA_OUTPUT, photo);
        startActivityForResult(call, intent, "photoTaken");
    }

    @ActivityCallback
    private void photoTaken(PluginCall call, ActivityResult result) {
        File photo = photo();
        if (call == null) {
            photo.delete();
            return;
        }
        if (result.getResultCode() == LabelCameraActivity.NO_CAMERA) {
            photo.delete();
            call.reject("No camera", "NO_CAMERA");
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || photo.length() == 0) {
            photo.delete();
            call.reject("Cancelled", "CANCELLED");
            return;
        }
        // Decodes the photo into memory, so the file can go right away.
        Bitmap bitmap = decode(photo);
        photo.delete();
        if (bitmap == null) {
            call.reject("Couldn't read the photo", "READ_FAILED");
            return;
        }
        worker.execute(() -> {
            try {
                JSArray blocks = new JSArray();
                for (LabelReader.Block block : new LabelReader(getContext()).read(bitmap)) blocks.put(blockOf(block));
                JSObject ret = new JSObject();
                ret.put("blocks", blocks);
                call.resolve(ret);
            } catch (IOException | RuntimeException e) {
                call.reject("Couldn't read the photo", "READ_FAILED");
            }
        });
    }

    private static JSObject blockOf(LabelReader.Block block) {
        JSArray lines = new JSArray();
        for (String line : block.lines) lines.put(line);
        JSObject b = new JSObject();
        b.put("text", block.text);
        b.put("lines", lines);
        return b;
    }

    // Scaled down to at most 2400 px a side, which keeps label digits sharp and Tesseract quick.
    private static Bitmap decode(File photo) {
        BitmapFactory.Options size = new BitmapFactory.Options();
        size.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(photo.getPath(), size);
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = 1;
        while (Math.max(size.outWidth, size.outHeight) / opts.inSampleSize > 2400) opts.inSampleSize *= 2;
        return BitmapFactory.decodeFile(photo.getPath(), opts);
    }
}
