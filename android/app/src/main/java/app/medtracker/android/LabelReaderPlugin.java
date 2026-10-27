package app.medtracker.android;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.ExifInterface;
import android.net.Uri;
import android.provider.MediaStore;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
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
 * DIN/NPN label scan (MT-105, MT-122): the phone's camera app takes one photo into the app cache (never
 * the gallery), LabelReader reads it on the phone, and the photo is deleted. Returns the text blocks;
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
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", photo);
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "photoTaken");
        } catch (ActivityNotFoundException e) {
            call.reject("No camera app", "NO_CAMERA");
        }
    }

    @ActivityCallback
    private void photoTaken(PluginCall call, ActivityResult result) {
        File photo = photo();
        if (call == null) {
            photo.delete();
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

    // Scaled down to at most 2400 px a side, which keeps label digits sharp and Tesseract quick, and
    // turned upright as the camera recorded it: Tesseract only reads text the right way up.
    private static Bitmap decode(File photo) {
        BitmapFactory.Options size = new BitmapFactory.Options();
        size.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(photo.getPath(), size);
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = 1;
        while (Math.max(size.outWidth, size.outHeight) / opts.inSampleSize > 2400) opts.inSampleSize *= 2;
        Bitmap bitmap = BitmapFactory.decodeFile(photo.getPath(), opts);
        if (bitmap == null) return null;
        return LabelReader.turned(bitmap, uprightDegrees(photo));
    }

    private static int uprightDegrees(File photo) {
        try {
            switch (new ExifInterface(photo.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                case ExifInterface.ORIENTATION_ROTATE_90: return 90;
                case ExifInterface.ORIENTATION_ROTATE_180: return 180;
                case ExifInterface.ORIENTATION_ROTATE_270: return 270;
                default: return 0;
            }
        } catch (IOException e) {
            return 0;
        }
    }
}
