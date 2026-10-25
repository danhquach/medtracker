package app.medtracker.android;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
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
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * DIN/NPN label scan (MT-105): the phone's camera app takes one photo into the app cache (never the
 * gallery), ML Kit's bundled text reader reads it on the phone, and the photo is deleted. Returns the
 * text blocks; picking the number out of them is the page's job.
 */
@CapacitorPlugin(name = "LabelScanner")
public class LabelScannerPlugin extends Plugin {

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
        TextRecognizer reader = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        reader
            .process(InputImage.fromBitmap(bitmap, 0))
            .addOnCompleteListener((task) -> {
                if (!task.isSuccessful()) {
                    reader.close();
                    call.reject("Couldn't read the photo", "READ_FAILED");
                    return;
                }
                JSArray blocks = new JSArray();
                for (Text.TextBlock block : task.getResult().getTextBlocks()) blocks.put(blockOf(block.getText(), block.getLines()));
                // The reader turns the photo to match most of its text, so a line printed upside down
                // against the rest (a DIN/NPN, on some bottles) comes back as letters ("NPN 80058511" read
                // as "LLG89008 NAN"). Read alone, a line is turned to match itself, so read each line
                // again on its own; each re-read is a block.
                List<Task<Text>> flipped = new ArrayList<>();
                for (Text.TextBlock block : task.getResult().getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        Bitmap strip = crop(bitmap, line.getBoundingBox());
                        if (strip != null) flipped.add(reader.process(InputImage.fromBitmap(strip, 180)));
                    }
                }
                Tasks.whenAllComplete(flipped).addOnCompleteListener((all) -> {
                    reader.close();
                    for (Task<Text> read : flipped) {
                        if (!read.isSuccessful()) continue;
                        for (Text.TextBlock block : read.getResult().getTextBlocks()) blocks.put(blockOf(block.getText(), block.getLines()));
                    }
                    JSObject ret = new JSObject();
                    ret.put("blocks", blocks);
                    call.resolve(ret);
                });
            });
    }

    private static JSObject blockOf(String text, List<Text.Line> lines) {
        JSArray texts = new JSArray();
        for (Text.Line line : lines) texts.put(line.getText());
        JSObject b = new JSObject();
        b.put("text", text);
        b.put("lines", texts);
        return b;
    }

    // The line's box with a margin of half its height, so the reader sees whole characters.
    private static Bitmap crop(Bitmap bitmap, Rect box) {
        if (box == null) return null;
        int pad = box.height() / 2;
        Rect r = new Rect(box.left - pad, box.top - pad, box.right + pad, box.bottom + pad);
        if (!r.intersect(0, 0, bitmap.getWidth(), bitmap.getHeight())) return null;
        return Bitmap.createBitmap(bitmap, r.left, r.top, r.width(), r.height());
    }

    // Scaled down to at most 4096 px a side, which keeps label digits sharp.
    private static Bitmap decode(File photo) {
        BitmapFactory.Options size = new BitmapFactory.Options();
        size.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(photo.getPath(), size);
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = 1;
        while (Math.max(size.outWidth, size.outHeight) / opts.inSampleSize > 4096) opts.inSampleSize *= 2;
        return BitmapFactory.decodeFile(photo.getPath(), opts);
    }
}
