interface Env {
  /** Optional until a GitHub App webhook is configured for this deployment. */
  GITHUB_WEBHOOK_SECRET?: string;
  /** GitHub App OAuth client ID (not the numeric App ID). */
  GITHUB_APP_CLIENT_ID?: string;
  /** GitHub App OAuth client secret. */
  GITHUB_APP_CLIENT_SECRET?: string;
  /** Public GitHub App slug used in /apps/{slug}/installations/new. */
  GITHUB_APP_SLUG?: string;
  /** Fixed public Worker origin registered in the GitHub App callback URLs. */
  GITHUB_CALLBACK_ORIGIN?: string;
}
