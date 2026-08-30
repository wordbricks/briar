package app.briar.companion

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class BriarFirebaseMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    getSharedPreferences(BriarApplication.PUSH_PREFERENCES, MODE_PRIVATE)
      .edit()
      .putString(BriarApplication.PUSH_TOKEN, token)
      .apply()
  }

  override fun onMessageReceived(message: RemoteMessage) {
    // Android displays the notification payload while the app is backgrounded.
    // Foreground clients already receive the same Inbox revision over realtime.
  }
}
