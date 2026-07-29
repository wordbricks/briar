package app.briar.companion

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsIntent
import me.leolin.shortcutbadger.ShortcutBadger

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
    webView.addJavascriptInterface(BriarAndroidIconBridge(), ICON_BRIDGE)
    webView.addJavascriptInterface(BriarAndroidBadgeBridge(), BADGE_BRIDGE)
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

  inner class BriarAndroidIconBridge {
    @JavascriptInterface
    fun current(): String = currentAppIcon()

    @JavascriptInterface
    fun set(icon: String): Boolean {
      if (icon !in ICON_ALIASES) return false
      return try {
        switchAppIcon(icon)
        true
      } catch (_: RuntimeException) {
        false
      }
    }
  }

  inner class BriarAndroidBadgeBridge {
    @JavascriptInterface
    fun set(count: Int): Boolean {
      if (count < 0) return false
      return try {
        ShortcutBadger.applyCount(this@MainActivity, count)
      } catch (_: RuntimeException) {
        false
      }
    }
  }

  private fun currentAppIcon(): String {
    for (icon in listOf("gray", "pink", "green")) {
      val alias = ICON_ALIASES.getValue(icon)
      if (
        packageManager.getComponentEnabledSetting(iconComponent(alias)) ==
          PackageManager.COMPONENT_ENABLED_STATE_ENABLED
      ) {
        return icon
      }
    }
    return "purple"
  }

  private fun switchAppIcon(icon: String) {
    val selectedAlias = ICON_ALIASES.getValue(icon)
    packageManager.setComponentEnabledSetting(
      iconComponent(selectedAlias),
      if (icon == "purple") {
        PackageManager.COMPONENT_ENABLED_STATE_DEFAULT
      } else {
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED
      },
      PackageManager.DONT_KILL_APP,
    )

    ICON_ALIASES
      .filterKeys { it != icon }
      .forEach { (otherIcon, alias) ->
        packageManager.setComponentEnabledSetting(
          iconComponent(alias),
          if (otherIcon == "purple") {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
          } else {
            PackageManager.COMPONENT_ENABLED_STATE_DEFAULT
          },
          PackageManager.DONT_KILL_APP,
        )
      }
  }

  private fun iconComponent(alias: String): ComponentName =
    ComponentName(this, "$packageName.$alias")

  companion object {
    private const val AUTH_BRIDGE = "BriarAndroidAuth"
    private const val BADGE_BRIDGE = "BriarAndroidBadge"
    private const val ICON_BRIDGE = "BriarAndroidIcon"
    private const val AUTH_RETURN_HOST = "auth-complete"
    private const val AUTH_RETURN_SCHEME = "briar-companion"
    private val ICON_ALIASES =
      mapOf(
        "purple" to "MainActivityPurple",
        "gray" to "MainActivityGray",
        "pink" to "MainActivityPink",
        "green" to "MainActivityGreen",
      )
  }
}
