import type { DescService } from "@bufbuild/protobuf";
import {
  createClient,
  type Client,
  type Interceptor,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

const bearerTokenInterceptor = (token: string): Interceptor =>
  (next) => async (request) => {
    request.header.set("Authorization", `Bearer ${token}`);
    return next(request);
  };

export const createAuthenticatedConnectClient = <Service extends DescService>(
  service: Service,
  apiUrl: string,
  token: string,
  options: { binary?: boolean } = {},
): Client<Service> => createClient(service, createConnectTransport({
  baseUrl: apiUrl.replace(/\/+$/u, ""),
  useBinaryFormat: options.binary ?? false,
  interceptors: [bearerTokenInterceptor(token)],
}));
