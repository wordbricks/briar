import { create } from "@bufbuild/protobuf";
import {
  ClickActionSchema,
  ComputerUseActionSchema,
  ComputerUseArgsSchema,
  CoordinateSchema,
  DragActionSchema,
  KeyActionSchema,
  MouseButton,
  MouseMoveActionSchema,
  ScreenshotActionSchema,
  ScrollActionSchema,
  ScrollDirection,
  TypeActionSchema,
  WaitActionSchema,
  type ComputerUseAction,
  type ComputerUseArgs,
  type Coordinate,
} from "@briar/contracts/gen/agent/v1/computer_use_tool_pb";
import { z } from "zod";

export const COMPUTER_USE_MAX_WAIT_MS = 30_000;
export const COMPUTER_USE_MAX_FOLLOW_UP_ACTIONS = 9;
export const COMPUTER_ACTIONS = [
  "screenshot",
  "click",
  "move",
  "drag",
  "type",
  "key",
  "scroll",
  "wait",
] as const;
export const COMPUTER_FOLLOW_UP_ACTIONS = [
  "click",
  "move",
  "drag",
  "type",
  "key",
  "scroll",
  "wait",
] as const;

const CoordinateInput = z.object({ x: z.number().int(), y: z.number().int() });

export const computerActionFields = {
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  x2: z.number().int().optional(),
  y2: z.number().int().optional(),
  path: z.array(CoordinateInput).optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  button: z.enum(["left", "right", "middle"]).optional(),
  count: z.number().int().min(1).max(3).optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  amount: z.number().int().optional(),
  durationMs: z.number().int().min(0).max(COMPUTER_USE_MAX_WAIT_MS).optional(),
};

const validateDrag = (
  input: {
    readonly action: string;
    readonly x?: number;
    readonly y?: number;
    readonly x2?: number;
    readonly y2?: number;
    readonly path?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  },
  context: z.RefinementCtx,
) => {
  if (input.action !== "drag") return;
  if (input.path !== undefined && input.path.length >= 2) return;
  if (
    input.x !== undefined
    && input.y !== undefined
    && input.x2 !== undefined
    && input.y2 !== undefined
  ) return;
  context.addIssue({
    code: "custom",
    path: ["path"],
    message: "Drag requires x, y, x2, and y2 or a path with at least 2 points",
  });
};

export const ComputerActionInput = z.object({
  action: z.enum(COMPUTER_ACTIONS),
  ...computerActionFields,
}).superRefine(validateDrag);

export const ComputerFollowUpActionInput = z.object({
  action: z.enum(COMPUTER_FOLLOW_UP_ACTIONS),
  ...computerActionFields,
}).superRefine(validateDrag);

const computerToolInputFields = {
  action: z.enum(COMPUTER_ACTIONS),
  ...computerActionFields,
  then: z.array(ComputerFollowUpActionInput)
    .min(1)
    .max(COMPUTER_USE_MAX_FOLLOW_UP_ACTIONS)
    .optional(),
  description: z.string().optional(),
};

export const ComputerToolInput = z.object(computerToolInputFields)
  .superRefine(validateDrag);

export type ComputerActionInput = z.infer<typeof ComputerActionInput>;
export type ComputerToolInput = z.infer<typeof ComputerToolInput>;

export interface ComputerViewport {
  readonly width: number;
  readonly height: number;
}

export class ComputerToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputerToolInputError";
  }
}

export const decodeComputerToolInput = (value: unknown): ComputerToolInput =>
  ComputerToolInput.parse(value);

const coordinate = (
  x: number | undefined,
  y: number | undefined,
): Coordinate | undefined => x === undefined || y === undefined
  ? undefined
  : create(CoordinateSchema, { x, y });

const mouseButtons = {
  left: MouseButton.LEFT,
  right: MouseButton.RIGHT,
  middle: MouseButton.MIDDLE,
} satisfies Record<"left" | "right" | "middle", MouseButton>;

const scrollDirections = {
  up: ScrollDirection.UP,
  down: ScrollDirection.DOWN,
  left: ScrollDirection.LEFT,
  right: ScrollDirection.RIGHT,
} satisfies Record<"up" | "down" | "left" | "right", ScrollDirection>;

const dragPath = (input: ComputerActionInput): Coordinate[] => {
  if (input.path !== undefined && input.path.length >= 2) {
    return input.path.map((point) => create(CoordinateSchema, point));
  }
  const start = coordinate(input.x, input.y);
  const end = coordinate(input.x2, input.y2);
  if (start === undefined || end === undefined) {
    throw new ComputerToolInputError(
      "Drag requires x, y, x2, and y2 or a path with at least 2 points",
    );
  }
  return [start, end];
};

export const toComputerUseAction = (
  input: ComputerActionInput,
): ComputerUseAction => {
  switch (input.action) {
    case "screenshot":
      return create(ComputerUseActionSchema, {
        action: {
          case: "screenshot",
          value: create(ScreenshotActionSchema),
        },
      });
    case "click":
      return create(ComputerUseActionSchema, {
        action: {
          case: "click",
          value: create(ClickActionSchema, {
            coordinate: coordinate(input.x, input.y),
            button: mouseButtons[input.button ?? "left"],
            count: input.count ?? 1,
          }),
        },
      });
    case "move":
      return create(ComputerUseActionSchema, {
        action: {
          case: "mouseMove",
          value: create(MouseMoveActionSchema, {
            coordinate: coordinate(input.x, input.y),
          }),
        },
      });
    case "drag":
      return create(ComputerUseActionSchema, {
        action: {
          case: "drag",
          value: create(DragActionSchema, {
            path: dragPath(input),
            button: mouseButtons[input.button ?? "left"],
          }),
        },
      });
    case "type":
      return create(ComputerUseActionSchema, {
        action: {
          case: "type",
          value: create(TypeActionSchema, { text: input.text ?? "" }),
        },
      });
    case "key":
      return create(ComputerUseActionSchema, {
        action: {
          case: "key",
          value: create(KeyActionSchema, { key: input.key ?? "" }),
        },
      });
    case "scroll":
      return create(ComputerUseActionSchema, {
        action: {
          case: "scroll",
          value: create(ScrollActionSchema, {
            coordinate: coordinate(input.x, input.y),
            direction: scrollDirections[input.direction ?? "down"],
            amount: input.amount ?? 3,
          }),
        },
      });
    case "wait":
      return create(ComputerUseActionSchema, {
        action: {
          case: "wait",
          value: create(WaitActionSchema, {
            durationMs: input.durationMs ?? 1_000,
          }),
        },
      });
  }
};

const assertCoordinate = (
  value: number | undefined,
  maximum: number,
  label: string,
): void => {
  if (value === undefined) return;
  if (value < 0 || value >= maximum) {
    throw new ComputerToolInputError(
      `${label} must be between 0 and ${maximum - 1}`,
    );
  }
};

const assertActionWithinViewport = (
  action: ComputerActionInput,
  viewport: ComputerViewport,
): void => {
  assertCoordinate(action.x, viewport.width, "x");
  assertCoordinate(action.x2, viewport.width, "x2");
  assertCoordinate(action.y, viewport.height, "y");
  assertCoordinate(action.y2, viewport.height, "y2");
  for (const [index, point] of (action.path ?? []).entries()) {
    assertCoordinate(point.x, viewport.width, `path[${index}].x`);
    assertCoordinate(point.y, viewport.height, `path[${index}].y`);
  }
};

export const buildComputerUseArgs = (input: {
  readonly raw: unknown;
  readonly toolCallId: string;
  readonly viewport: ComputerViewport;
  readonly bindUnmappedCharacters?: boolean;
}): ComputerUseArgs => {
  if (
    !Number.isInteger(input.viewport.width)
    || input.viewport.width <= 0
    || !Number.isInteger(input.viewport.height)
    || input.viewport.height <= 0
  ) {
    throw new ComputerToolInputError("Computer viewport must have positive integer dimensions");
  }
  const parsed = decodeComputerToolInput(input.raw);
  const { then, description, ...primary } = parsed;
  const sequence: ComputerActionInput[] = [primary, ...(then ?? [])];
  for (const action of sequence) assertActionWithinViewport(action, input.viewport);

  const actions = sequence.map(toComputerUseAction);
  if (sequence.at(-1)?.action !== "screenshot") {
    actions.push(toComputerUseAction({ action: "screenshot" }));
  }
  const trimmedDescription = description?.trim();
  return create(ComputerUseArgsSchema, {
    toolCallId: input.toolCallId,
    actions,
    description: trimmedDescription === "" ? undefined : trimmedDescription,
    bindUnmappedCharacters: input.bindUnmappedCharacters === true
      ? true
      : undefined,
  });
};
