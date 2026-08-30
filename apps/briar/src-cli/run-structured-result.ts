import { fromJsonString } from "@bufbuild/protobuf";
import { StructuredRunResultSchema } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  decodeStructuredAgentResult,
  type StructuredAgentResult,
} from "../src/lib/agent-result";
import { structuredResultFromProto } from "../src/lib/app-rpc/mappers";

export function decodeRunStructuredResult(input: {
  domainJson: string | null;
  protoJson: string | null;
}): StructuredAgentResult | null {
  if (input.domainJson !== null && input.protoJson !== null) {
    throw new Error(
      "--structured-result and --structured-result-proto-json are mutually exclusive",
    );
  }
  if (input.protoJson !== null) {
    const domain = structuredResultFromProto(
      fromJsonString(StructuredRunResultSchema, input.protoJson),
    );
    if (domain === null) {
      throw new Error("Structured result ProtoJSON decoded without a result");
    }
    return decodeStructuredAgentResult(domain);
  }
  return input.domainJson === null
    ? null
    : decodeStructuredAgentResult(JSON.parse(input.domainJson));
}
