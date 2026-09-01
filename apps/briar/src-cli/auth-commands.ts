import type { User } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  fetchCurrentUser,
  isUnauthenticatedConnectError,
} from "./app-connect-client";
import { loadConfig } from "./command-support";

export type WhoamiDependencies = {
  loadAuthentication: () => Promise<{
    apiUrl: string;
    userToken?: string;
  }>;
  environmentToken: () => string | undefined;
  fetchCurrentUser: (apiUrl: string, userToken: string) => Promise<User>;
  writeLine: (line: string) => void;
};

const defaultDependencies: WhoamiDependencies = {
  loadAuthentication: loadConfig,
  environmentToken: () => process.env.BRIAR_USER_TOKEN,
  fetchCurrentUser,
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

  let currentUser: User;
  try {
    currentUser = await resolved.fetchCurrentUser(
      authentication.apiUrl,
      userToken,
    );
  } catch (error) {
    if (isUnauthenticatedConnectError(error)) {
      throw new Error(
        "Briar 로그인이 만료되었거나 유효하지 않습니다. `briar login`을 다시 실행하세요.",
      );
    }
    throw error;
  }

  resolved.writeLine(
    `${currentUser.name} (${currentUser.email}) 계정으로 로그인되어 있습니다.`,
  );
}
