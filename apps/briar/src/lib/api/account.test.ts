import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { accountProfileUpdateToProto } from "../app-rpc/account";
import { SessionUserSchema } from "./account";

describe("Account Connect boundary", () => {
  it("represents nullable profile fields as explicit protobuf updates", () => {
    expect(accountProfileUpdateToProto({
      username: "jay_dev",
      name: "Jay",
      image: null,
    })).toEqual({
      usernameUpdate: { case: "username", value: "jay_dev" },
      name: "Jay",
      imageUpdate: { case: "clearImage", value: {} },
    });
    expect(accountProfileUpdateToProto({
      username: null,
      name: "Jay",
      image: "https://example.com/jay.png",
    })).toEqual({
      usernameUpdate: { case: "clearUsername", value: {} },
      name: "Jay",
      imageUpdate: {
        case: "image",
        value: "https://example.com/jay.png",
      },
    });
  });

  it("keeps the domain email invariant beyond protobuf scalar validation", () => {
    expect(() => Schema.decodeSync(SessionUserSchema)({
      id: "user-1",
      username: null,
      name: "Jay",
      email: "not-an-email",
      image: null,
    })).toThrow();
  });
});
