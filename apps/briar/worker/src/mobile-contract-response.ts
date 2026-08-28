import {
  type AnyMobileOperation,
  validateMobileOperationResponse,
} from "@briar/mobile-contracts";
import { json } from "./http-response";

/** Validate a canonical mobile response while preserving its original JSON. */
export const mobileJson = (
  operation: AnyMobileOperation,
  body: unknown,
  status = operation.response.status,
) => {
  if (status === operation.response.status) {
    validateMobileOperationResponse(operation, body);
  }
  return json(body, status);
};
