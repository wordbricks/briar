/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BRIAR_API_URL?: string;
  readonly VITE_BRIAR_COMPANION?: string;
  readonly VITE_BRIAR_DEMO?: string;
  readonly VITE_BRIAR_WEB?: string;
  readonly VITE_BRIAR_INTRO_PREVIEW?: string;
  readonly VITE_BRIAR_FEATURE_IDEAS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  BriarAndroidAuth?: {
    open(url: string): void;
  };
}
