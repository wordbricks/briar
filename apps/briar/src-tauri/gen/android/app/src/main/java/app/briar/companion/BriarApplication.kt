package app.briar.companion

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging

class BriarApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    if (!firebaseConfigured()) return
    if (FirebaseApp.getApps(this).isEmpty()) {
      FirebaseApp.initializeApp(
        this,
        FirebaseOptions.Builder()
          .setApplicationId(BuildConfig.BRIAR_FIREBASE_APPLICATION_ID)
          .setApiKey(BuildConfig.BRIAR_FIREBASE_API_KEY)
          .setProjectId(BuildConfig.BRIAR_FIREBASE_PROJECT_ID)
          .setGcmSenderId(BuildConfig.BRIAR_FIREBASE_SENDER_ID)
          .build(),
      )
    }
    FirebaseMessaging.getInstance().token.addOnSuccessListener(::storePushToken)
  }

  private fun firebaseConfigured(): Boolean =
    BuildConfig.BRIAR_FIREBASE_APPLICATION_ID.isNotBlank() &&
      BuildConfig.BRIAR_FIREBASE_API_KEY.isNotBlank() &&
      BuildConfig.BRIAR_FIREBASE_PROJECT_ID.isNotBlank() &&
      BuildConfig.BRIAR_FIREBASE_SENDER_ID.isNotBlank()

  private fun storePushToken(token: String) {
    getSharedPreferences(PUSH_PREFERENCES, MODE_PRIVATE)
      .edit()
      .putString(PUSH_TOKEN, token)
      .apply()
  }

  companion object {
    const val PUSH_PREFERENCES = "briar.remote-push.v1"
    const val PUSH_TOKEN = "token"
  }
}
