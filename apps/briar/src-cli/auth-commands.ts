import * as Schema from "effect/Schema";
import { HttpRequestError } from "./execution-metrics-upload";
import { loadConfig, request } from "./command-support";

const CurrentUserResponse = Schema.Struct({
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
  }),
}).annotate({
  parseOptions: { onExcessProperty: "preserve" },
});

const decodeCurrentUserResponse = Schema.decodeUnknownSync(CurrentUserResponse);

export type WhoamiDependencies = {
  loadAuthentication: () => Promise<{
    apiUrl: string;
    userToken?: string;
  }>;
  environmentToken: () => string | undefined;
  fetchCurrentUser: (apiUrl: string, userToken: string) => Promise<unknown>;
  writeLine: (line: string) => void;
};

const defaultDependencies: WhoamiDependencies = {
  loadAuthentication: loadConfig,
  environmentToken: () => process.env.BRIAR_USER_TOKEN,
  fetchCurrentUser: (apiUrl, userToken) =>
    request<unknown>(apiUrl, "/me", userToken),
  writeLine: console.log,
};

export async function whoami(
  dependencies: Partial<WhoamiDependencies> = {},
) {
  const resolved = { ...defaultDependencies, ...dependencies };
  const authentication = await resolved.loadAuthentication();
  const userToken =
    resolved.environmentToken()?.trim() || authentication.userToken?.trim();
  if (!userToken) {
    throw new Error(
      "Briar에 로그인되어 있지 않습니다. `briar login`을 실행하세요.",
    );
  }

  let response: unknown;
  try {
    response = await resolved.fetchCurrentUser(
      authentication.apiUrl,
      userToken,
    );
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 401) {
      throw new Error(
        "Briar 로그인이 만료되었거나 유효하지 않습니다. `briar login`을 다시 실행하세요.",
      );
    }
    throw error;
  }

  const currentUser = decodeCurrentUserResponse(response).user;
  resolved.writeLine(
    `${currentUser.name} (${currentUser.email}) 계정으로 로그인되어 있습니다.`,
  );
}
