package app.medtracker.android;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

/**
 * DIN/NPN label scan (MT-105, MT-122): LabelCameraActivity reads the box on its screen with Tesseract,
 * on the phone, and hands back the text; no photo is saved. Returns the text blocks; picking the number
 * out of them is the page's job. A new name, not MT-105's ML Kit "LabelScanner", so the page only
 * offers Scan on an APK that sends nothing to Google.
 */
@CapacitorPlugin(name = "LabelReader")
public class LabelReaderPlugin extends Plugin {

    @PluginMethod
    public void scan(PluginCall call) {
        startActivityForResult(call, new Intent(getContext(), LabelCameraActivity.class), "labelRead");
    }

    @ActivityCallback
    private void labelRead(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() == LabelCameraActivity.NO_CAMERA) {
            call.reject("No camera", "NO_CAMERA");
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject("Cancelled", "CANCELLED");
            return;
        }
        ArrayList<String> read = data.getStringArrayListExtra(LabelCameraActivity.EXTRA_BLOCKS);
        if (read == null) {
            call.reject("Couldn't read the photo", "READ_FAILED");
            return;
        }
        JSArray blocks = new JSArray();
        for (String text : read) {
            JSArray lines = new JSArray();
            for (String line : text.split("\n")) lines.put(line);
            JSObject b = new JSObject();
            b.put("text", text);
            b.put("lines", lines);
            blocks.put(b);
        }
        JSObject ret = new JSObject();
        ret.put("blocks", blocks);
        call.resolve(ret);
    }
}
