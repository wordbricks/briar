import type { DescMethod } from "@bufbuild/protobuf";
import type { UniversalHandler } from "@connectrpc/connect/protocol";

export const requireConnectHandler = (
  handlers: readonly UniversalHandler[],
  method: DescMethod,
): UniversalHandler => {
  const handler = handlers.find((candidate) =>
    candidate.method.parent.typeName === method.parent.typeName &&
    candidate.method.name === method.name
  );
  if (handler === undefined) {
    throw new Error(
      `Missing Connect handler for ${method.parent.typeName}/${method.name}`,
    );
  }
  return handler;
};

export const requireConnectHandlerForRequest = (
  handlers: readonly UniversalHandler[],
  request: Request,
): UniversalHandler => {
  const pathname = new URL(request.url).pathname;
  const handler = handlers.find((candidate) =>
    candidate.requestPath === pathname
  );
  if (handler === undefined) {
    throw new Error(`Missing Connect handler for ${pathname}`);
  }
  return handler;
};
