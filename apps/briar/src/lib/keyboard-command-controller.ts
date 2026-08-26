import * as EffectArray from "effect/Array";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";
import * as Equivalence from "effect/Equivalence";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import { AtomRef } from "effect/unstable/reactivity";

import {
  compileKeyboardCommandBindingIndex,
  keyboardCommandModifiedCandidate,
  keyboardCommandPlainCandidatesWithPrefix,
  type KeyboardCommandBindingIndex,
} from "./keyboard-command-index";
import {
  modesForKeyboardCommandBinding,
  type KeyboardCommandBinding,
  type KeyboardCommandDefinition,
  type KeyboardCommandMode,
  type KeyboardCommandModifiedBinding,
  type KeyboardCommandModifiers,
  type KeyboardCommandPhase,
  type KeyboardCommandPlainBinding,
} from "./keyboard-command-model";

export type {
  KeyboardCommandBinding,
  KeyboardCommandDefinition,
  KeyboardCommandMode,
  KeyboardCommandModifiedBinding,
  KeyboardCommandModifiers,
  KeyboardCommandPhase,
  KeyboardCommandPlainBinding,
} from "./keyboard-command-model";

export type KeyboardCommandCatalog<CommandId extends string = string> = {
  readonly bindingIndex: KeyboardCommandBindingIndex<CommandId>;
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
  readonly phase: KeyboardCommandPhase;
  readonly sequence: EffectArray.NonEmptyReadonlyArray<string>;
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

export type KeyboardCommandReduction<CommandId extends string> =
  Data.TaggedEnum<{
    Consumed: {
      readonly commandId?: CommandId;
      readonly reason: "cancelled" | "handler";
      readonly scopeId?: string;
      readonly state: KeyboardCommandState<CommandId>;
    };
    Ignored: {
      readonly reason: KeyboardCommandIgnoredReason;
      readonly state: KeyboardCommandState<CommandId>;
    };
    Matched: {
      readonly commandId: CommandId;
      readonly scopeId?: string;
      readonly state: KeyboardCommandState<CommandId>;
    };
    Pending: {
      readonly state: KeyboardCommandState<CommandId> & {
        readonly pending: KeyboardCommandPending<CommandId>;
      };
    };
  }>;

interface KeyboardCommandReductionDefinition extends
  Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: KeyboardCommandReduction<this["A"] & string>;
}

export const KeyboardCommandDecision =
  Data.taggedEnum<KeyboardCommandReductionDefinition>();

export type KeyboardCommandIgnoredDecision<CommandId extends string> =
  Data.TaggedEnum.Value<KeyboardCommandReduction<CommandId>, "Ignored">;

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
  readonly sequenceTimeout?: Duration.Input;
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

export const keyboardCommandSequenceTimeout = Duration.millis(1_500);

const sequenceEquivalence = Equivalence.Array(Equivalence.String);
const modifiersEquivalence = Equivalence.Struct({
  alt: Equivalence.Boolean,
  control: Equivalence.Boolean,
  meta: Equivalence.Boolean,
  shift: Equivalence.Boolean,
});
const modifiedBindingEquivalence = Equivalence.Struct({
  code: Equivalence.String,
  modifiers: modifiersEquivalence,
});

function modesOverlap(
  left: readonly KeyboardCommandMode[],
  right: readonly KeyboardCommandMode[],
): boolean {
  return EffectArray.some(left, (mode) => EffectArray.contains(right, mode));
}

function sameSequence(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return sequenceEquivalence(left, right);
}

function sequenceStartsWith(
  sequence: readonly string[],
  prefix: readonly string[],
): boolean {
  return sequence.length >= prefix.length &&
    sequenceEquivalence(EffectArray.take(sequence, prefix.length), prefix);
}

function assertValidBinding(
  commandId: string,
  binding: KeyboardCommandBinding,
): void {
  const modes = modesForKeyboardCommandBinding(binding);
  if (modes.length === 0) {
    throw new Error(`Keyboard command ${commandId} has no active modes`);
  }
  if (EffectArray.dedupe(modes).length !== modes.length) {
    throw new Error(`Keyboard command ${commandId} repeats an active mode`);
  }
  if (binding.kind === "plain") {
    if (
      binding.sequence.length === 0 ||
      EffectArray.some(binding.sequence, (code) => code.length === 0)
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
  if (
    !modesOverlap(
      modesForKeyboardCommandBinding(left),
      modesForKeyboardCommandBinding(right),
    )
  ) {
    return false;
  }
  if (left.kind === "plain" && right.kind === "plain") {
    return sameSequence(left.sequence, right.sequence);
  }
  if (left.kind === "modified" && right.kind === "modified") {
    return modifiedBindingEquivalence(left, right);
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
    modesOverlap(
      modesForKeyboardCommandBinding(left),
      modesForKeyboardCommandBinding(right),
    ) &&
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

  const flattened = EffectArray.flatMap(commandDefinitions, (command) =>
    EffectArray.map(command.bindings, (binding) => ({
      binding,
      commandId: command.id,
      phase: command.phase,
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

  const cloneBinding = Match.type<KeyboardCommandBinding>().pipe(
    Match.discriminatorsExhaustive("kind")({
      modified: (binding): KeyboardCommandModifiedBinding => ({
        ...binding,
        modes: binding.modes && [...binding.modes],
        modifiers: { ...binding.modifiers },
      }),
      plain: (binding): KeyboardCommandPlainBinding => ({
        ...binding,
        modes: binding.modes && [...binding.modes],
        sequence: EffectArray.map(binding.sequence, (code) => code),
      }),
    }),
  );
  const commands = EffectArray.map(commandDefinitions, (command) => ({
    ...command,
    bindings: EffectArray.map(command.bindings, cloneBinding),
  } satisfies KeyboardCommandDefinition<CommandId>));
  const commandById = new Map(EffectArray.map(commands, (command) => [
    command.id,
    command,
  ] as const));
  return {
    bindingIndex: compileKeyboardCommandBindingIndex(commands),
    commandById,
    commands,
  };
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

function uniqueIds<CommandId extends string>(
  ids: readonly CommandId[],
): readonly CommandId[] {
  return EffectArray.dedupe(ids);
}

function commandIdsForKeyboardInput<CommandId extends string>(
  state: KeyboardCommandState<CommandId>,
  catalog: KeyboardCommandCatalog<CommandId>,
  input: KeyboardCommandInput,
  phase: KeyboardCommandPhase,
): readonly CommandId[] {
  if (
    input.defaultPrevented === true ||
    input.isComposing === true ||
    (state.pending !== null && state.pending.phase !== phase)
  ) {
    return [];
  }

  const modifiers = inputModifiers(input);
  if (
    state.pending !== null &&
    input.code === "Escape" &&
    !hasModifier(modifiers)
  ) {
    return [];
  }
  if (hasModifier(modifiers)) {
    const modifiedIds = EffectArray.map(
      Option.toArray(
        keyboardCommandModifiedCandidate(
          catalog.bindingIndex,
          phase,
          state.mode,
          input.code,
          modifiers,
        ),
      ),
      ({ command }) => command.id,
    );
    return state.pending !== null && input.repeat === true
      ? uniqueIds(
        EffectArray.appendAll(state.pending.candidateIds, modifiedIds),
      )
      : modifiedIds;
  }
  if (state.pending !== null && input.repeat === true) {
    return state.pending.candidateIds;
  }

  const sequence = state.pending === null
    ? [input.code]
    : EffectArray.append(state.pending.sequence, input.code);
  const frozenIds = state.pending === null
    ? null
    : new Set(state.pending.candidateIds);
  return uniqueIds(
    EffectArray.map(
      EffectArray.filter(
        keyboardCommandPlainCandidatesWithPrefix(
          catalog.bindingIndex,
          phase,
          state.mode,
          sequence,
        ),
        ({ command }) => frozenIds === null || frozenIds.has(command.id),
      ),
      ({ command }) => command.id,
    ),
  );
}

function ignored<CommandId extends string>(
  state: KeyboardCommandState<CommandId>,
  reason: KeyboardCommandIgnoredReason,
): KeyboardCommandIgnoredDecision<CommandId> {
  return KeyboardCommandDecision.Ignored({
    reason,
    state,
  });
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
  if (state.pending !== null && state.pending.phase !== phase) {
    return ignored(state, "unmatched");
  }

  const activeIds = new Set(activeCommandIds);
  const modifiers = inputModifiers(input);
  const pendingIds = state.pending === null
    ? null
    : new Set(state.pending.candidateIds);
  const activePendingDefinitions = state.pending === null
    ? []
    : EffectArray.filter(
      EffectArray.flatMap(
        state.pending.candidateIds,
        (commandId) =>
          Option.toArray(
            Option.fromUndefinedOr(catalog.commandById.get(commandId)),
          ),
      ),
      (command) =>
        activeIds.has(command.id) && command.phase === phase,
    );

  if (
    state.pending !== null &&
    input.code === "Escape" &&
    !hasModifier(modifiers)
  ) {
    const nextState = cancelPendingKeyboardCommand(state);
    return KeyboardCommandDecision.Consumed({
      reason: "cancelled",
      state: nextState,
    });
  }

  if (
    input.repeat === true &&
    state.pending !== null &&
    EffectArray.every(
      activePendingDefinitions,
      (command) => command.repeat !== "allow",
    )
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
    const nextSequence = EffectArray.append(
      state.pending.sequence,
      input.code,
    );
    const matching = EffectArray.filter(
      keyboardCommandPlainCandidatesWithPrefix(
        catalog.bindingIndex,
        phase,
        state.mode,
        nextSequence,
      ),
      ({ command }) =>
        activeIds.has(command.id) &&
        (pendingIds === null || pendingIds.has(command.id)) &&
        repeatEligible(command),
    );
    const exact = EffectArray.findFirst(
      matching,
      ({ binding }) => binding.sequence.length === nextSequence.length,
    );
    if (Option.isSome(exact)) {
      return KeyboardCommandDecision.Matched({
        commandId: exact.value.command.id,
        state: cancelPendingKeyboardCommand(state),
      });
    }
    if (matching.length === 0) {
      return ignored(cancelPendingKeyboardCommand(state), "unmatched");
    }
    const pending: KeyboardCommandPending<CommandId> = {
      candidateIds: uniqueIds(
        EffectArray.map(matching, ({ command }) => command.id),
      ),
      phase,
      sequence: nextSequence,
    };
    const nextState = { ...state, pending };
    return KeyboardCommandDecision.Pending({
      state: nextState,
    });
  }

  if (hasModifier(modifiers)) {
    const candidate = keyboardCommandModifiedCandidate(
      catalog.bindingIndex,
      phase,
      state.mode,
      input.code,
      modifiers,
    );
    if (
      Option.isSome(candidate) &&
      activeIds.has(candidate.value.command.id) &&
      repeatEligible(candidate.value.command)
    ) {
      return KeyboardCommandDecision.Matched({
        commandId: candidate.value.command.id,
        state,
      });
    }
    const deniedRepeat = input.repeat === true &&
      Option.isSome(candidate) &&
      activeIds.has(candidate.value.command.id) &&
      candidate.value.command.repeat !== "allow";
    return ignored(state, deniedRepeat ? "repeat" : "unmatched");
  }

  const structuralCandidates = keyboardCommandPlainCandidatesWithPrefix(
    catalog.bindingIndex,
    phase,
    state.mode,
    [input.code],
  );
  const matching = EffectArray.filter(
    structuralCandidates,
    ({ command }) => activeIds.has(command.id) && repeatEligible(command),
  );
  const exact = EffectArray.findFirst(
    matching,
    ({ binding }) => binding.sequence.length === 1,
  );
  if (Option.isSome(exact)) {
    return KeyboardCommandDecision.Matched({
      commandId: exact.value.command.id,
      state,
    });
  }
  if (matching.length === 0) {
    const deniedRepeat = input.repeat === true && EffectArray.some(
      structuralCandidates,
      ({ command }) =>
        activeIds.has(command.id) && command.repeat !== "allow",
    );
    return ignored(state, deniedRepeat ? "repeat" : "unmatched");
  }
  const pending: KeyboardCommandPending<CommandId> = {
    candidateIds: uniqueIds(
      EffectArray.map(matching, ({ command }) => command.id),
    ),
    phase,
    sequence: [input.code],
  };
  const nextState = { ...state, pending };
  return KeyboardCommandDecision.Pending({
    state: nextState,
  });
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
  let orderedScopes: readonly RegisteredScope<CommandId>[] = [];

  const scopeOrder = Order.mapInput(
    Order.Tuple([
      Order.flip(Order.Number),
      Order.flip(Order.Number),
    ]),
    (registration: RegisteredScope<CommandId>) => [
      registration.scope.priority,
      registration.order,
    ] as const,
  );
  const refreshOrderedScopes = () => {
    orderedScopes = EffectArray.sort(registrations.values(), scopeOrder);
  };

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
    if (Equal.equals(nextState, currentState)) return;
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
        Duration.toMillis(
          options.sequenceTimeout ?? keyboardCommandSequenceTimeout,
        ),
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
      const routesByCommand = new Map<CommandId, CommandRoutes<CommandId>>();
      const activeCommandIds: CommandId[] = [];
      const candidateIds = commandIdsForKeyboardInput(
        stateRoot.value,
        catalog,
        input,
        phase,
      );
      for (const commandId of candidateIds) {
        const resolved = routesFor(commandId, orderedScopes);
        routesByCommand.set(commandId, resolved);
        if (resolved.routes.length > 0) {
          activeCommandIds.push(commandId);
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
      if (!KeyboardCommandDecision.$is("Matched")(reduction)) {
        return reduction;
      }

      const resolved = routesByCommand.get(reduction.commandId);
      if (!resolved) return ignored(stateRoot.value, "unavailable");
      for (const route of resolved.routes) {
        const outcome = route.handler.run({
          commandId: reduction.commandId,
          input,
          mode: stateRoot.value.mode,
        });
        if (outcome === "pass") continue;
        if (outcome === "consume") {
          return KeyboardCommandDecision.Consumed({
            commandId: reduction.commandId,
            reason: "handler",
            scopeId: route.scopeId,
            state: stateRoot.value,
          });
        }
        return KeyboardCommandDecision.Matched({
          commandId: reduction.commandId,
          scopeId: route.scopeId,
          state: stateRoot.value,
        });
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
      refreshOrderedScopes();
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
      refreshOrderedScopes();
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
    unregisterScope: (token) => {
      const deleted = registrations.delete(token);
      if (deleted) refreshOrderedScopes();
      return deleted;
    },
    updateScope: (token, scope) => {
      const current = registrations.get(token);
      if (!current) return false;
      validateScope(scope);
      registrations.set(token, { ...current, scope });
      refreshOrderedScopes();
      return true;
    },
  };
  return controller;
}
