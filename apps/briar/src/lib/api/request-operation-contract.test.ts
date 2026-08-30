import {
  listProjectsOperation,
  type AnyMobileOperation,
} from "@briar/contracts";
import { describe, expect, it } from "vitest";
import type { MobileOperationAuthentication } from "./request";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type Assert<Condition extends true> = Condition;
type PublicOperation = Omit<typeof listProjectsOperation, "security"> & {
  readonly security: "public";
};
type AuthenticationTypeAssertions = readonly [
  Assert<Equal<
    MobileOperationAuthentication<typeof listProjectsOperation>,
    readonly [token: string]
  >>,
  Assert<Equal<
    MobileOperationAuthentication<PublicOperation>,
    readonly []
  >>,
  Assert<Equal<
    MobileOperationAuthentication<AnyMobileOperation>,
    readonly [never]
  >>,
];

const authenticationTypeAssertions: AuthenticationTypeAssertions = [
  true,
  true,
  true,
];

describe("mobile operation authentication types", () => {
  it("requires narrowing before executing mixed-security operations", () => {
    expect(authenticationTypeAssertions).toEqual([true, true, true]);
  });
});
