import { HttpError } from "./http-response";
import { verifySlackRequest } from "./slack";

export async function readVerifiedSlackBody(request: Request, env: Env) {
  if (!env.SLACK_SIGNING_SECRET?.trim()) {
    throw new HttpError(503, "Slack integration is not configured");
  }
  const rawBody = await request.text();
  if (
    !(await verifySlackRequest(
      rawBody,
      request.headers,
      env.SLACK_SIGNING_SECRET,
    ))
  ) {
    throw new HttpError(401, "Invalid Slack signature");
  }
  return rawBody;
}
