package app.medtracker.android;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
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
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.io.File;
import java.io.IOException;

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
        InputImage image;
        try {
            // Decodes the photo into memory (EXIF rotation applied), so the file can go right away.
            image = InputImage.fromFilePath(getContext(), Uri.fromFile(photo));
        } catch (IOException e) {
            call.reject("Couldn't read the photo", "READ_FAILED");
            return;
        } finally {
            photo.delete();
        }
        TextRecognizer reader = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        reader
            .process(image)
            .addOnCompleteListener((task) -> {
                reader.close();
                if (!task.isSuccessful()) {
                    call.reject("Couldn't read the photo", "READ_FAILED");
                    return;
                }
                JSArray blocks = new JSArray();
                for (Text.TextBlock block : task.getResult().getTextBlocks()) {
                    JSArray lines = new JSArray();
                    for (Text.Line line : block.getLines()) lines.put(line.getText());
                    JSObject b = new JSObject();
                    b.put("text", block.getText());
                    b.put("lines", lines);
                    blocks.put(b);
                }
                JSObject ret = new JSObject();
                ret.put("blocks", blocks);
                call.resolve(ret);
            });
    }
}
