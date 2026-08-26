import { AtomRef } from "effect/unstable/reactivity";

export type KeyboardCommandMode = "normal" | "insert";

/**
 * Capture owns app-global chords and multi-key sequences. Bubble owns
 * contextual commands that must yield to a focused widget first.
 */
export type KeyboardCommandPhase = "capture" | "bubble";

export type KeyboardCommandModifiers = {
  readonly alt: boolean;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
};

export type KeyboardCommandPlainBinding = {
  readonly kind: "plain";
  readonly modes?: readonly KeyboardCommandMode[];
  readonly sequence: readonly [string, ...string[]];
};

export type KeyboardCommandModifiedBinding = {
  readonly code: string;
  readonly kind: "modified";
  readonly modes?: readonly KeyboardCommandMode[];
  readonly modifiers: KeyboardCommandModifiers;
};

export type KeyboardCommandBinding =
  | KeyboardCommandPlainBinding
  | KeyboardCommandModifiedBinding;

export type KeyboardCommandDefinition<CommandId extends string = string> = {
  readonly bindings: readonly [
    KeyboardCommandBinding,
    ...KeyboardCommandBinding[],
  ];
  readonly id: CommandId;
  readonly phase: KeyboardCommandPhase;
  readonly repeat?: "allow" | "ignore";
};

export type KeyboardCommandCatalog<CommandId extends string = string> = {
  readonly commands: readonly KeyboardCommandDefinition<CommandId>[];
  readonly commandById: ReadonlyMap<
    CommandId,
    KeyboardCommandDefinition<CommandId>
  >;
};

export type KeyboardCommandInput = {
  readonly altKey?: boolean;
  readonly code: string;
  readonly controlKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly defaultPrevented?: boolean;
  readonly isComposing?: boolean;
  readonly key?: string;
  readonly metaKey?: boolean;
  /** Transient adapter payload for DOM-aware handlers; never enters Atom state. */
  readonly nativeEvent?: KeyboardEvent;
  readonly repeat?: boolean;
  readonly shiftKey?: boolean;
};

export type KeyboardCommandPending<CommandId extends string = string> = {
  readonly candidateIds: readonly CommandId[];
  readonly sequence: readonly [string, ...string[]];
};

export type KeyboardCommandState<CommandId extends string = string> = {
  readonly mode: KeyboardCommandMode;
  readonly pending: KeyboardCommandPending<CommandId> | null;
};

export type KeyboardCommandIgnoredReason =
  | "composing"
  | "default-prevented"
  | "disposed"
  | "passed"
  | "repeat"
  | "unavailable"
  | "unmatched";

export type KeyboardCommandIgnoredDecision<CommandId extends string> = {
  readonly consumeEvent: false;
  readonly reason: KeyboardCommandIgnoredReason;
  readonly state: KeyboardCommandState<CommandId>;
  readonly status: "ignored";
};

export type KeyboardCommandConsumeDecision<CommandId extends string> = {
  readonly commandId?: CommandId;
  readonly consumeEvent: true;
  readonly reason: "cancelled" | "handler";
  readonly scopeId?: string;
  readonly state: KeyboardCommandState<CommandId>;
  readonly status: "consume";
};

export type KeyboardCommandPendingDecision<CommandId extends string> = {
  readonly consumeEvent: true;
  readonly state: KeyboardCommandState<CommandId> & {
    readonly pending: KeyboardCommandPending<CommandId>;
  };
  readonly status: "pending";
};

export type KeyboardCommandMatchedDecision<CommandId extends string> = {
  readonly commandId: CommandId;
  readonly consumeEvent: true;
  readonly scopeId?: string;
  readonly state: KeyboardCommandState<CommandId>;
  readonly status: "matched";
};

export type KeyboardCommandReduction<CommandId extends string> =
  | KeyboardCommandConsumeDecision<CommandId>
  | KeyboardCommandIgnoredDecision<CommandId>
  | KeyboardCommandMatchedDecision<CommandId>
  | KeyboardCommandPendingDecision<CommandId>;

export type KeyboardCommandHandlerResult =
  | "consume"
  | "handled"
  | "pass"
  | void;

export type KeyboardCommandHandlerContext<CommandId extends string> = {
  readonly commandId: CommandId;
  readonly input: KeyboardCommandInput;
  readonly mode: KeyboardCommandMode;
};

export type KeyboardCommandHandler<CommandId extends string> = {
  readonly isAvailable?: () => boolean;
  readonly run: (
    context: KeyboardCommandHandlerContext<CommandId>,
  ) => KeyboardCommandHandlerResult;
};

export type KeyboardCommandScope<CommandId extends string> = {
  readonly fallthrough: boolean;
  readonly handlers: Readonly<
    Partial<Record<CommandId, KeyboardCommandHandler<CommandId>>>
  >;
  readonly id: string;
  readonly priority: number;
};

export type KeyboardCommandRegistrationToken = {
  readonly id: number;
  readonly type: "KeyboardCommandRegistrationToken";
};

export type KeyboardCommandScheduleTimeout = (
  callback: () => void,
  delayMs: number,
) => () => void;

export type KeyboardCommandControllerOptions<CommandId extends string> = {
  readonly catalog: KeyboardCommandCatalog<CommandId>;
  readonly initialMode?: KeyboardCommandMode;
  readonly scheduleSequenceTimeout?: KeyboardCommandScheduleTimeout;
  readonly sequenceTimeoutMs?: number;
};

export type KeyboardCommandController<CommandId extends string> = {
  readonly cancelPending: () => void;
  readonly dispatch: (
    input: KeyboardCommandInput,
    phase: KeyboardCommandPhase,
  ) => KeyboardCommandReduction<CommandId>;
  readonly dispose: () => void;
  readonly registerScope: (
    scope: KeyboardCommandScope<CommandId>,
  ) => KeyboardCommandRegistrationToken;
  readonly setCatalog: (catalog: KeyboardCommandCatalog<CommandId>) => void;
  readonly setMode: (mode: KeyboardCommandMode) => void;
  readonly snapshot: AtomRef.ReadonlyRef<KeyboardCommandState<CommandId>>;
  readonly unregisterScope: (
    token: KeyboardCommandRegistrationToken,
  ) => boolean;
  readonly updateScope: (
    token: KeyboardCommandRegistrationToken,
    scope: KeyboardCommandScope<CommandId>,
  ) => boolean;
};

export const keyboardCommandSequenceTimeoutMs = 1_500;

const normalModeOnly = ["normal"] as const;

function phaseForCommand(
  command: KeyboardCommandDefinition,
): KeyboardCommandPhase {
  return command.phase;
}

function modesForBinding(
  binding: KeyboardCommandBinding,
): readonly KeyboardCommandMode[] {
  return binding.modes ?? normalModeOnly;
}

function modesOverlap(
  left: readonly KeyboardCommandMode[],
  right: readonly KeyboardCommandMode[],
): boolean {
  return left.some((mode) => right.includes(mode));
}

function sameSequence(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function sequenceStartsWith(
  sequence: readonly string[],
  prefix: readonly string[],
): boolean {
  return sequence.length >= prefix.length &&
    prefix.every((value, index) => sequence[index] === value);
}

function modifiedBindingKey(binding: KeyboardCommandModifiedBinding): string {
  const { alt, control, meta, shift } = binding.modifiers;
  return `${binding.code}:${Number(alt)}${Number(control)}${Number(meta)}${Number(shift)}`;
}

function assertValidBinding(
  commandId: string,
  binding: KeyboardCommandBinding,
): void {
  const modes = modesForBinding(binding);
  if (modes.length === 0) {
    throw new Error(`Keyboard command ${commandId} has no active modes`);
  }
  if (new Set(modes).size !== modes.length) {
    throw new Error(`Keyboard command ${commandId} repeats an active mode`);
  }
  if (binding.kind === "plain") {
    if (
      binding.sequence.length === 0 ||
      binding.sequence.some((code) => code.length === 0)
    ) {
      throw new Error(`Keyboard command ${commandId} has an empty physical code`);
    }
    return;
  }
  if (binding.code.length === 0) {
    throw new Error(`Keyboard command ${commandId} has an empty physical code`);
  }
  const { alt, control, meta, shift } = binding.modifiers;
  if (!alt && !control && !meta && !shift) {
    throw new Error(
      `Keyboard command ${commandId} has a modified binding without a modifier`,
    );
  }
}

function bindingsConflict(
  left: KeyboardCommandBinding,
  leftPhase: KeyboardCommandPhase,
  right: KeyboardCommandBinding,
  rightPhase: KeyboardCommandPhase,
): boolean {
  if (leftPhase !== rightPhase) return false;
  if (!modesOverlap(modesForBinding(left), modesForBinding(right))) {
    return false;
  }
  if (left.kind === "plain" && right.kind === "plain") {
    return sameSequence(left.sequence, right.sequence);
  }
  if (left.kind === "modified" && right.kind === "modified") {
    return modifiedBindingKey(left) === modifiedBindingKey(right);
  }
  return false;
}

function bindingShadows(
  left: KeyboardCommandBinding,
  leftPhase: KeyboardCommandPhase,
  right: KeyboardCommandBinding,
  rightPhase: KeyboardCommandPhase,
): boolean {
  if (leftPhase !== rightPhase) return false;
  return left.kind === "plain" &&
    right.kind === "plain" &&
    modesOverlap(modesForBinding(left), modesForBinding(right)) &&
    left.sequence.length < right.sequence.length &&
    sequenceStartsWith(right.sequence, left.sequence);
}

export function createKeyboardCommandCatalog<const CommandId extends string>(
  commandDefinitions: readonly KeyboardCommandDefinition<CommandId>[],
): KeyboardCommandCatalog<CommandId> {
  const commandIds = new Set<CommandId>();
  for (const command of commandDefinitions) {
    if (commandIds.has(command.id)) {
      throw new Error(`Keyboard command id ${command.id} conflicts with itself`);
    }
    commandIds.add(command.id);
    if (command.bindings.length === 0) {
      throw new Error(`Keyboard command ${command.id} has no bindings`);
    }
    for (const binding of command.bindings) {
      assertValidBinding(command.id, binding);
    }
  }

  const flattened = commandDefinitions.flatMap((command) =>
    command.bindings.map((binding) => ({
      binding,
      commandId: command.id,
      phase: phaseForCommand(command),
    }))
  );
  for (let leftIndex = 0; leftIndex < flattened.length; leftIndex += 1) {
    const left = flattened[leftIndex];
    if (!left) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < flattened.length;
      rightIndex += 1
    ) {
      const right = flattened[rightIndex];
      if (!right) continue;
      if (
        bindingsConflict(
          left.binding,
          left.phase,
          right.binding,
          right.phase,
        )
      ) {
        throw new Error(
          `Keyboard command ${left.commandId} conflicts with ${right.commandId}`,
        );
      }
      if (
        bindingShadows(
          left.binding,
          left.phase,
          right.binding,
          right.phase,
        )
      ) {
        throw new Error(
          `Keyboard command ${left.commandId} shadows ${right.commandId}`,
        );
      }
      if (
        bindingShadows(
          right.binding,
          right.phase,
          left.binding,
          left.phase,
        )
      ) {
        throw new Error(
          `Keyboard command ${right.commandId} shadows ${left.commandId}`,
        );
      }
    }
  }

  const commands = commandDefinitions.map((command) => ({
    ...command,
    bindings: command.bindings.map((binding) =>
      binding.kind === "plain"
        ? { ...binding, modes: binding.modes && [...binding.modes], sequence: [...binding.sequence] }
        : { ...binding, modes: binding.modes && [...binding.modes], modifiers: { ...binding.modifiers } }
    ),
  })) as unknown as readonly KeyboardCommandDefinition<CommandId>[];
  const commandById = new Map(commands.map((command) => [
    command.id,
    command,
  ]));
  return { commandById, commands };
}

export function makeKeyboardCommandState<CommandId extends string = string>(
  mode: KeyboardCommandMode = "normal",
): KeyboardCommandState<CommandId> {
  return { mode, pending: null };
}

export function cancelPendingKeyboardCommand<CommandId extends string>(
  state: KeyboardCommandState<CommandId>,
): KeyboardCommandState<CommandId> {
  return state.pending === null ? state : { ...state, pending: null };
}

export function setKeyboardCommandMode<CommandId extends string>(
  state: KeyboardCommandState<CommandId>,
  mode: KeyboardCommandMode,
): KeyboardCommandState<CommandId> {
  return state.mode === mode && state.pending === null
    ? state
    : { mode, pending: null };
}

function inputModifiers(input: KeyboardCommandInput): KeyboardCommandModifiers {
  return {
    alt: input.altKey === true,
    control: input.controlKey === true || input.ctrlKey === true,
    meta: input.metaKey === true,
    shift: input.shiftKey === true,
  };
}

function hasModifier(modifiers: KeyboardCommandModifiers): boolean {
  return modifiers.alt || modifiers.control || modifiers.meta || modifiers.shift;
}

function bindingIncludesMode(
  binding: KeyboardCommandBinding,
  mode: KeyboardCommandMode,
): boolean {
  return modesForBinding(binding).includes(mode);
}

function uniqueIds<CommandId extends string>(
  ids: readonly CommandId[],
): readonly CommandId[] {
  return [...new Set(ids)];
}

function ignored<CommandId extends string>(
  state: KeyboardCommandState<CommandId>,
  reason: KeyboardCommandIgnoredReason,
): KeyboardCommandIgnoredDecision<CommandId> {
  return { consumeEvent: false, reason, state, status: "ignored" };
}

export function reduceKeyboardCommandState<CommandId extends string>(
  state: KeyboardCommandState<CommandId>,
  catalog: KeyboardCommandCatalog<CommandId>,
  activeCommandIds: readonly CommandId[],
  input: KeyboardCommandInput,
  phase: KeyboardCommandPhase = "capture",
): KeyboardCommandReduction<CommandId> {
  if (input.defaultPrevented === true) {
    return ignored(state, "default-prevented");
  }
  if (input.isComposing === true) return ignored(state, "composing");

  const activeIds = new Set(activeCommandIds);
  const modifiers = inputModifiers(input);
  const pendingIds = state.pending === null
    ? null
    : new Set(state.pending.candidateIds);
  const definitions = catalog.commands.filter((command) =>
    activeIds.has(command.id) &&
    phaseForCommand(command) === phase &&
    (pendingIds === null || pendingIds.has(command.id))
  );

  if (
    state.pending !== null &&
    input.code === "Escape" &&
    !hasModifier(modifiers)
  ) {
    const nextState = cancelPendingKeyboardCommand(state);
    return {
      consumeEvent: true,
      reason: "cancelled",
      state: nextState,
      status: "consume",
    };
  }

  if (
    input.repeat === true &&
    state.pending !== null &&
    definitions.every((command) => command.repeat !== "allow")
  ) {
    return ignored(state, "repeat");
  }

  const repeatEligible = (command: KeyboardCommandDefinition<CommandId>) =>
    input.repeat !== true || command.repeat === "allow";

  if (state.pending !== null) {
    if (hasModifier(modifiers)) {
      return reduceKeyboardCommandState(
        cancelPendingKeyboardCommand(state),
        catalog,
        activeCommandIds,
        input,
        phase,
      );
    }
    const nextSequence = [
      ...state.pending.sequence,
      input.code,
    ] as [string, ...string[]];
    const matching = definitions.flatMap((command) =>
      repeatEligible(command)
        ? command.bindings.flatMap((binding) =>
          binding.kind === "plain" &&
            bindingIncludesMode(binding, state.mode) &&
            sequenceStartsWith(binding.sequence, nextSequence)
            ? [{ binding, command }]
            : []
        )
        : []
    );
    const exact = matching.find(({ binding }) =>
      binding.kind === "plain" &&
      binding.sequence.length === nextSequence.length
    );
    if (exact) {
      return {
        commandId: exact.command.id,
        consumeEvent: true,
        state: cancelPendingKeyboardCommand(state),
        status: "matched",
      };
    }
    if (matching.length === 0) {
      return ignored(cancelPendingKeyboardCommand(state), "unmatched");
    }
    const pending: KeyboardCommandPending<CommandId> = {
      candidateIds: uniqueIds(matching.map(({ command }) => command.id)),
      sequence: nextSequence,
    };
    const nextState = { ...state, pending };
    return { consumeEvent: true, state: nextState, status: "pending" };
  }

  if (hasModifier(modifiers)) {
    const exact = definitions.find((command) =>
      repeatEligible(command) &&
      command.bindings.some((binding) =>
        binding.kind === "modified" &&
        bindingIncludesMode(binding, state.mode) &&
        binding.code === input.code &&
        modifiedBindingKey(binding) === `${input.code}:${Number(modifiers.alt)}${Number(modifiers.control)}${Number(modifiers.meta)}${Number(modifiers.shift)}`
      )
    );
    if (exact) {
      return {
        commandId: exact.id,
        consumeEvent: true,
        state,
        status: "matched",
      };
    }
    const deniedRepeat = input.repeat === true && definitions.some((command) =>
      command.repeat !== "allow" &&
      command.bindings.some((binding) =>
        binding.kind === "modified" &&
        bindingIncludesMode(binding, state.mode) &&
        binding.code === input.code &&
        modifiedBindingKey(binding) === `${input.code}:${Number(modifiers.alt)}${Number(modifiers.control)}${Number(modifiers.meta)}${Number(modifiers.shift)}`
      )
    );
    return ignored(state, deniedRepeat ? "repeat" : "unmatched");
  }

  const matching = definitions.flatMap((command) =>
    repeatEligible(command)
      ? command.bindings.flatMap((binding) =>
        binding.kind === "plain" &&
          bindingIncludesMode(binding, state.mode) &&
          binding.sequence[0] === input.code
          ? [{ binding, command }]
          : []
      )
      : []
  );
  const exact = matching.find(({ binding }) =>
    binding.kind === "plain" && binding.sequence.length === 1
  );
  if (exact) {
    return {
      commandId: exact.command.id,
      consumeEvent: true,
      state,
      status: "matched",
    };
  }
  if (matching.length === 0) {
    const deniedRepeat = input.repeat === true && definitions.some((command) =>
      command.repeat !== "allow" &&
      command.bindings.some((binding) =>
        binding.kind === "plain" &&
        bindingIncludesMode(binding, state.mode) &&
        binding.sequence[0] === input.code
      )
    );
    return ignored(state, deniedRepeat ? "repeat" : "unmatched");
  }
  const pending: KeyboardCommandPending<CommandId> = {
    candidateIds: uniqueIds(matching.map(({ command }) => command.id)),
    sequence: [input.code],
  };
  const nextState = { ...state, pending };
  return { consumeEvent: true, state: nextState, status: "pending" };
}

type RegisteredScope<CommandId extends string> = {
  readonly order: number;
  readonly scope: KeyboardCommandScope<CommandId>;
  readonly token: KeyboardCommandRegistrationToken;
};

type HandlerRoute<CommandId extends string> = {
  readonly handler: KeyboardCommandHandler<CommandId>;
  readonly scopeId: string;
};

type CommandRoutes<CommandId extends string> = {
  readonly hasUnavailable: boolean;
  readonly routes: readonly HandlerRoute<CommandId>[];
};

export function createKeyboardCommandController<CommandId extends string>(
  options: KeyboardCommandControllerOptions<CommandId>,
): KeyboardCommandController<CommandId> {
  const stateRoot = AtomRef.make<KeyboardCommandState<CommandId>>(
    makeKeyboardCommandState(options.initialMode),
  );
  const registrations = new Map<
    KeyboardCommandRegistrationToken,
    RegisteredScope<CommandId>
  >();
  let nextRegistrationId = 0;
  let nextRegistrationOrder = 0;
  let cancelSequenceTimeout: (() => void) | null = null;
  let catalog = options.catalog;
  let disposed = false;

  const sortedScopes = () => [...registrations.values()].sort((left, right) =>
    right.scope.priority - left.scope.priority || right.order - left.order
  );

  const routesFor = (
    commandId: CommandId,
    scopes: readonly RegisteredScope<CommandId>[],
  ): CommandRoutes<CommandId> => {
    const routes: HandlerRoute<CommandId>[] = [];
    let hasUnavailable = false;
    for (const registration of scopes) {
      const handler = registration.scope.handlers[commandId];
      if (!handler) {
        if (!registration.scope.fallthrough) break;
        continue;
      }
      if (handler.isAvailable?.() === false) {
        hasUnavailable = true;
        if (!registration.scope.fallthrough) break;
        continue;
      }
      routes.push({ handler, scopeId: registration.scope.id });
    }
    return { hasUnavailable, routes };
  };

  const clearScheduledTimeout = () => {
    const cancel = cancelSequenceTimeout;
    cancelSequenceTimeout = null;
    cancel?.();
  };

  const replaceState = (nextState: KeyboardCommandState<CommandId>) => {
    const currentState = stateRoot.value;
    if (nextState === currentState) return;
    clearScheduledTimeout();
    stateRoot.set(nextState);
    if (
      nextState.pending !== null &&
      options.scheduleSequenceTimeout !== undefined
    ) {
      cancelSequenceTimeout = options.scheduleSequenceTimeout(
        () => {
          replaceState(cancelPendingKeyboardCommand(stateRoot.value));
        },
        options.sequenceTimeoutMs ?? keyboardCommandSequenceTimeoutMs,
      );
    }
  };

  const validateScope = (scope: KeyboardCommandScope<CommandId>) => {
    for (const commandId of Object.keys(scope.handlers)) {
      if (!catalog.commandById.has(commandId as CommandId)) {
        throw new Error(
          `Keyboard scope ${scope.id} registered unknown command ${commandId}`,
        );
      }
    }
  };

  const controller: KeyboardCommandController<CommandId> = {
    cancelPending: () => {
      replaceState(cancelPendingKeyboardCommand(stateRoot.value));
    },
    dispatch: (input, phase) => {
      if (disposed) return ignored(stateRoot.value, "disposed");
      const scopes = sortedScopes();
      const routesByCommand = new Map<CommandId, CommandRoutes<CommandId>>();
      const activeCommandIds: CommandId[] = [];
      for (const command of catalog.commands) {
        const resolved = routesFor(command.id, scopes);
        routesByCommand.set(command.id, resolved);
        if (resolved.routes.length > 0) {
          activeCommandIds.push(command.id);
        }
      }
      const reduction = reduceKeyboardCommandState(
        stateRoot.value,
        catalog,
        activeCommandIds,
        input,
        phase,
      );
      replaceState(reduction.state);
      if (reduction.status !== "matched") return reduction;

      const resolved = routesByCommand.get(reduction.commandId);
      if (!resolved) return ignored(stateRoot.value, "unavailable");
      for (const route of resolved.routes) {
        const result = route.handler.run({
          commandId: reduction.commandId,
          input,
          mode: stateRoot.value.mode,
        });
        if (result === "pass") continue;
        if (result === "consume") {
          return {
            commandId: reduction.commandId,
            consumeEvent: true,
            reason: "handler",
            scopeId: route.scopeId,
            state: stateRoot.value,
            status: "consume",
          };
        }
        return {
          ...reduction,
          scopeId: route.scopeId,
          state: stateRoot.value,
        };
      }
      return ignored(
        stateRoot.value,
        resolved.hasUnavailable ? "unavailable" : "passed",
      );
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearScheduledTimeout();
      registrations.clear();
      stateRoot.set(cancelPendingKeyboardCommand(stateRoot.value));
    },
    registerScope: (scope) => {
      if (disposed) throw new Error("Keyboard command controller is disposed");
      validateScope(scope);
      const token: KeyboardCommandRegistrationToken = {
        id: nextRegistrationId++,
        type: "KeyboardCommandRegistrationToken",
      };
      registrations.set(token, {
        order: nextRegistrationOrder++,
        scope,
        token,
      });
      return token;
    },
    setCatalog: (nextCatalog) => {
      if (disposed || nextCatalog === catalog) return;
      for (const registration of registrations.values()) {
        for (const commandId of Object.keys(registration.scope.handlers)) {
          if (!nextCatalog.commandById.has(commandId as CommandId)) {
            throw new Error(
              `Keyboard scope ${registration.scope.id} registered unknown command ${commandId}`,
            );
          }
        }
      }
      catalog = nextCatalog;
      replaceState(cancelPendingKeyboardCommand(stateRoot.value));
    },
    setMode: (mode) => {
      if (disposed) return;
      replaceState(setKeyboardCommandMode(stateRoot.value, mode));
    },
    snapshot: stateRoot,
    unregisterScope: (token) => registrations.delete(token),
    updateScope: (token, scope) => {
      const current = registrations.get(token);
      if (!current) return false;
      validateScope(scope);
      registrations.set(token, { ...current, scope });
      return true;
    },
  };
  return controller;
}
