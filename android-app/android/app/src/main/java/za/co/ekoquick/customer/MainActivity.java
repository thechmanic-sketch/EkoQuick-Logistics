package za.co.ekoquick.customer;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

/**
 * Stamps a marker onto the WebView's user-agent so the remote pages can
 * reliably detect "I am running inside the Ekoquick app" even when the
 * Capacitor JS bridge isn't attached in time (or at all, since this app
 * loads a fully remote server.url rather than bundled local assets).
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebSettings settings = this.bridge.getWebView().getSettings();
        String existingUA = settings.getUserAgentString();
        settings.setUserAgentString(existingUA + " EkoquickNativeApp/1.0");
    }
}
