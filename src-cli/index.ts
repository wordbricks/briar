#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../package.json";
import { briarCommand } from "./cli-app";

briarCommand.pipe(
  Command.run({ version: packageJson.version }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
