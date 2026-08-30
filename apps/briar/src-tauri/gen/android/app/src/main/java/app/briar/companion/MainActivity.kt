package app.briar.companion

import android.content.ActivityNotFoundException
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsIntent
import me.leolin.shortcutbadger.ShortcutBadger
import org.json.JSONObject
import java.security.MessageDigest

class MainActivity : TauriActivity() {
  private var appWebView: WebView? = null
  private var pendingAuthReturn = false
  private var pendingPushTarget: JSONObject? = null
  private val pushPreferences: SharedPreferences by lazy {
    getSharedPreferences(BriarApplication.PUSH_PREFERENCES, MODE_PRIVATE)
  }
  private val pushPreferenceListener =
    SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
      if (key == BriarApplication.PUSH_TOKEN) notifyPushTokenChanged()
    }
  private val navigationBackCallback =
    object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val webView = appWebView
        if (webView == null) {
          performDefaultBack()
          return
        }
        webView.post {
          webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('briar-navigation-back',{cancelable:true}));",
          ) { result ->
            if (result != "false") performDefaultBack()
          }
        }
      }
    }

  private val authTabLauncher =
    AuthTabIntent.registerActivityResultLauncher(this) { result ->
      notifyAuthReturn(result.resultCode == AuthTabIntent.RESULT_OK)
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    pendingPushTarget = pushTarget(intent)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(this, navigationBackCallback)
  }

  override fun onStart() {
    super.onStart()
    pushPreferences.registerOnSharedPreferenceChangeListener(pushPreferenceListener)
    notifyPushTokenChanged()
  }

  override fun onStop() {
    pushPreferences.unregisterOnSharedPreferenceChangeListener(pushPreferenceListener)
    super.onStop()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    appWebView = webView
    webView.addJavascriptInterface(BriarAndroidAuthBridge(), AUTH_BRIDGE)
    webView.addJavascriptInterface(BriarAndroidIconBridge(), ICON_BRIDGE)
    webView.addJavascriptInterface(BriarAndroidBadgeBridge(), BADGE_BRIDGE)
    webView.addJavascriptInterface(BriarAndroidPushBridge(), PUSH_BRIDGE)
    if (pendingAuthReturn) {
      notifyAuthReturn(true)
    }
    notifyPushTokenChanged()
    notifyPushOpen()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (isAuthReturn(intent.data)) {
      pendingAuthReturn = true
      notifyAuthReturn(true)
    }
    pushTarget(intent)?.let {
      pendingPushTarget = it
      notifyPushOpen()
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

  private fun performDefaultBack() {
    runOnUiThread {
      navigationBackCallback.isEnabled = false
      onBackPressedDispatcher.onBackPressed()
      navigationBackCallback.isEnabled = true
    }
  }

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

  inner class BriarAndroidPushBridge {
    @JavascriptInterface
    fun token(): String =
      pushPreferences.getString(BriarApplication.PUSH_TOKEN, "") ?: ""

    @JavascriptInterface
    fun configured(): Boolean =
      BuildConfig.BRIAR_FIREBASE_APPLICATION_ID.isNotBlank() &&
        BuildConfig.BRIAR_FIREBASE_PROJECT_ID.isNotBlank()

    @JavascriptInterface
    fun topic(): String = packageName

    @JavascriptInterface
    fun drainOpen(): String {
      val target = pendingPushTarget ?: return ""
      pendingPushTarget = null
      return target.toString()
    }

    @JavascriptInterface
    fun hasActiveInboxNotification(identity: String): Boolean =
      getSystemService(NotificationManager::class.java)
        .activeNotifications
        .any { notification -> notification.tag == remoteCollapseId(identity) }
  }

  private fun notifyPushTokenChanged() {
    appWebView?.post {
      appWebView?.evaluateJavascript(
        "window.dispatchEvent(new Event('briar-remote-push-token'));",
        null,
      )
    }
  }

  private fun notifyPushOpen() {
    val target = pendingPushTarget ?: return
    val webView = appWebView ?: return
    webView.post {
      webView.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('briar-remote-notification-open',{detail:$target}));",
        null,
      )
    }
  }

  private fun pushTarget(intent: Intent?): JSONObject? {
    if (intent?.action != PUSH_OPEN_ACTION) return null
    val messageId = intent.getStringExtra("messageId") ?: return null
    val messageVersion = intent.getStringExtra("messageVersion") ?: return null
    val notificationId = intent.getStringExtra("notificationId") ?: return null
    val projectId = intent.getStringExtra("projectId") ?: return null
    val targetId = intent.getStringExtra("targetId") ?: return null
    val kind = intent.getStringExtra("kind") ?: return null
    return JSONObject()
      .put("messageId", messageId)
      .put("messageVersion", messageVersion)
      .put("notificationId", notificationId)
      .put("projectId", projectId)
      .put("targetId", targetId)
      .put("kind", kind)
      .apply {
        intent.getStringExtra("conversationMessageId")
          ?.takeIf(String::isNotBlank)
          ?.let { put("conversationMessageId", it) }
        intent.getStringExtra("channelMessageId")
          ?.takeIf(String::isNotBlank)
          ?.let { put("channelMessageId", it) }
        intent.getStringExtra("rootMessageId")
          ?.takeIf(String::isNotBlank)
          ?.let { put("rootMessageId", it) }
      }
  }

  private fun remoteCollapseId(value: String): String {
    val bytes = value.toByteArray(Charsets.UTF_8)
    if (bytes.size <= 64) return value
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    return "briar-${Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)}"
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
    private const val PUSH_BRIDGE = "BriarAndroidPush"
    private const val PUSH_OPEN_ACTION = "BRIAR_INBOX_NOTIFICATION"
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
