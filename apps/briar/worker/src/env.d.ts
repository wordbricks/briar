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
  /** Emergency switch for new managed-computer applications. */
  MANAGED_COMPUTER_APPLICATIONS_ENABLED?: string;
  /** Separate emergency switch for end-user remote desktop sessions. */
  MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED?: string;
  /** Comma-separated web origins allowed to create and connect sessions. */
  MANAGED_COMPUTER_REMOTE_DESKTOP_ALLOWED_ORIGINS?: string;
  MANAGED_COMPUTER_REMOTE_DESKTOP_TOKEN_TTL_SECONDS?: string;
  MANAGED_COMPUTER_REMOTE_DESKTOP_MAX_SESSION_MINUTES?: string;
  MANAGED_COMPUTER_REMOTE_DESKTOP_ORGANIZATION_SESSION_LIMIT?: string;
  MANAGED_COMPUTER_REMOTE_DESKTOP_FLEET_SESSION_LIMIT?: string;
  MANAGED_COMPUTER_REMOTE_DESKTOP_RATE_LIMIT?: string;
  /** Server-only pilot promotion code; never exposed by product metadata. */
  MANAGED_COMPUTER_PROMOTION_CODE?: string;
  MANAGED_COMPUTER_ORGANIZATION_LIMIT?: string;
  MANAGED_COMPUTER_FLEET_LIMIT?: string;
  MANAGED_COMPUTER_LIFETIME_DAYS?: string;
  MANAGED_COMPUTER_STOPPED_RETENTION_DAYS?: string;
  MANAGED_COMPUTER_ENROLLMENT_TTL_MINUTES?: string;
  MANAGED_COMPUTER_AWS_REGION?: string;
  MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_ID?: string;
  MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_VERSION?: string;
  MANAGED_COMPUTER_INSTANCE_TYPE?: string;
  MANAGED_COMPUTER_VOLUME_GIB?: string;
  MANAGED_COMPUTER_VCPU?: string;
  MANAGED_COMPUTER_MEMORY_GIB?: string;
  MANAGED_COMPUTER_API_ORIGIN?: string;
  /** HMAC key for deterministic, retry-safe one-time enrollment material. */
  MANAGED_COMPUTER_ENROLLMENT_SECRET?: string;
  /** Region-matched AWS RSA public key used to verify EC2 identity documents. */
  MANAGED_COMPUTER_AWS_IDENTITY_PUBLIC_KEY?: string;
  MANAGED_COMPUTER_AWS_ACCESS_KEY_ID?: string;
  MANAGED_COMPUTER_AWS_SECRET_ACCESS_KEY?: string;
  MANAGED_COMPUTER_AWS_SESSION_TOKEN?: string;
  MANAGED_COMPUTER_PROVISIONING: Workflow<{
    managedComputerId: string;
    provisioningJobId: string;
    previousInstanceId?: string | null;
    previousInstanceRegion?: string | null;
  }>;
  MANAGED_COMPUTER_REMOTE: DurableObjectNamespace<
    import("./managed-computer-remote-relay").ManagedComputerRemoteSessionHub
  >;
}
