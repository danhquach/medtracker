package app.medtracker.android;

import android.view.HapticFeedbackConstants;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tap feedback for buttons (MT-86). The system key-press haptic follows the phone's "Touch feedback"
 * setting and needs no vibrate permission, unlike a raw vibration.
 */
@CapacitorPlugin(name = "TapHaptics")
public class TapHapticsPlugin extends Plugin {

    @PluginMethod
    public void tap(PluginCall call) {
        getBridge().getWebView().post(() -> getBridge().getWebView().performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY));
        call.resolve();
    }
}
