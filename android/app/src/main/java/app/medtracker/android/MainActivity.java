package app.medtracker.android;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(TapHapticsPlugin.class);
        registerPlugin(LabelScannerPlugin.class);
        super.onCreate(savedInstanceState);
        ControlPress press = new ControlPress();
        bridge.getWebView().addJavascriptInterface(press, "MedTrackerPress");
        bridge.getWebView().setOnLongClickListener((v) -> press.onControl);
        if (bridge.getErrorUrl() != null) bridge.setWebViewClient(new OfflineAwareClient(bridge));
        getOnBackPressedDispatcher().addCallback(this, new WebBack());
    }

    /**
     * Back walks the app's own history like the in-app Back button (MT-110), so the page also hears it and
     * an open dialog can cancel instead. From the first screen Back leaves the app as usual.
     */
    class WebBack extends OnBackPressedCallback {

        WebBack() {
            super(true);
        }

        @Override
        public void handleOnBackPressed() {
            WebView web = bridge.getWebView();
            if (web.canGoBack()) {
                web.goBack();
                return;
            }
            setEnabled(false);
            getOnBackPressedDispatcher().onBackPressed();
            setEnabled(true);
        }
    }

    /**
     * Long press on a button or link (MT-96): the page reports where each touch press starts. Claiming the
     * long click on a control stops the WebView's link tooltip and keeps the touch going so the page sees
     * the release; presses on plain text keep the normal long press, so text stays selectable.
     */
    static class ControlPress {

        volatile boolean onControl;

        @JavascriptInterface
        public void start(boolean onControl) {
            this.onControl = onControl;
        }
    }

    /**
     * Live-site build (MT-69): Capacitor opens the error page on any main-frame error, but an offline
     * start reports one even when the service worker then serves the app from its cache. Show the
     * error page only when the WebView really ended up on its own error page.
     */
    static class OfflineAwareClient extends BridgeWebViewClient {

        private final Bridge bridge;

        OfflineAwareClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {}

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {}

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            view.evaluateJavascript("location.protocol", (protocol) -> {
                if (protocol != null && protocol.contains("chrome-error")) view.loadUrl(bridge.getErrorUrl());
            });
        }
    }
}
