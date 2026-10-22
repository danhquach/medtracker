package app.medtracker.android;

import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge.getErrorUrl() != null) bridge.setWebViewClient(new OfflineAwareClient(bridge));
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
