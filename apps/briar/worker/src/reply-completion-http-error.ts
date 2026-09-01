import { HttpError } from "./http-response";
import { ReplyCompletionApplicationError } from "./worker-reply-completion-application";
import { ReplyCompletionMappingError } from "./worker-reply-completion-mappers";

export function rethrowReplyCompletionHttpError(error: unknown): never {
  if (error instanceof ReplyCompletionMappingError) {
    throw new HttpError(400, error.message);
  }
  if (error instanceof ReplyCompletionApplicationError) {
    switch (error.reason) {
      case "invalid_request":
        throw new HttpError(400, error.message);
      case "invalid_capability":
        throw new HttpError(401, error.message);
      case "claim_conflict":
      case "replay_conflict":
        throw new HttpError(409, error.message);
    }
  }
  throw error;
}
