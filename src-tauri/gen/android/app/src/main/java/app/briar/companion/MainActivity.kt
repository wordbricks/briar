package app.briar.companion

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsIntent

class MainActivity : TauriActivity() {
  private var appWebView: WebView? = null
  private var pendingAuthReturn = false

  private val authTabLauncher =
    AuthTabIntent.registerActivityResultLauncher(this) { result ->
      notifyAuthReturn(result.resultCode == AuthTabIntent.RESULT_OK)
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    appWebView = webView
    webView.addJavascriptInterface(BriarAndroidAuthBridge(), AUTH_BRIDGE)
    if (pendingAuthReturn) {
      notifyAuthReturn(true)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (isAuthReturn(intent.data)) {
      pendingAuthReturn = true
      notifyAuthReturn(true)
    }
  }

  private fun openAuth(url: String) {
    val uri = Uri.parse(url)
    if (uri.scheme != "https") return

    runOnUiThread {
      try {
        AuthTabIntent.Builder()
          .setColorScheme(CustomTabsIntent.COLOR_SCHEME_SYSTEM)
          .build()
          .launch(authTabLauncher, uri, AUTH_RETURN_SCHEME)
      } catch (_: ActivityNotFoundException) {
        CustomTabsIntent.Builder()
          .setColorScheme(CustomTabsIntent.COLOR_SCHEME_SYSTEM)
          .setShowTitle(true)
          .build()
          .launchUrl(this, uri)
      }
    }
  }

  private fun notifyAuthReturn(completed: Boolean) {
    pendingAuthReturn = false
    val completedValue = if (completed) "true" else "false"
    appWebView?.post {
      appWebView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('briar-auth-return',{detail:{completed:$completedValue}}));",
        null,
      )
    }
  }

  private fun isAuthReturn(uri: Uri?): Boolean =
    uri?.scheme == AUTH_RETURN_SCHEME && uri.host == AUTH_RETURN_HOST

  inner class BriarAndroidAuthBridge {
    @JavascriptInterface
    fun open(url: String) {
      openAuth(url)
    }
  }

  companion object {
    private const val AUTH_BRIDGE = "BriarAndroidAuth"
    private const val AUTH_RETURN_HOST = "auth-complete"
    private const val AUTH_RETURN_SCHEME = "briar-companion"
  }
}
