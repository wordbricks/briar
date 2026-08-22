import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import {
  defaulted,
  integerBetween,
  UuidString,
} from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";

const CoercedLimit = Schema.Unknown.pipe(
  Schema.decodeTo(
    integerBetween(1, 100),
    SchemaTransformation.transform<number, unknown>({
      decode: (value) => Number(value),
      encode: (value) => value,
    }),
  ),
);

const messageQuery = (defaultLimit: number) => Schema.Struct({
  limit: defaulted(CoercedLimit, defaultLimit),
  cursor: defaulted(Schema.NullOr(UuidString), null),
  parentMessageId: defaulted(Schema.NullOr(UuidString), null),
});

export const ChannelMessageQuery = messageQuery(50);
export const ProjectChannelMessageQuery = messageQuery(20);

export const decodeChannelMessageQuery = decodeRequestSync(
  ChannelMessageQuery,
);
export const decodeProjectChannelMessageQuery = decodeRequestSync(
  ProjectChannelMessageQuery,
);
export const decodeMessageLimit = decodeRequestSync(CoercedLimit);
export const decodeUuidOption = Schema.decodeUnknownOption(UuidString);
