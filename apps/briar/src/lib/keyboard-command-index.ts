import * as EffectArray from "effect/Array";
import * as Data from "effect/Data";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Trie from "effect/Trie";

import {
  modesForKeyboardCommandBinding,
  type KeyboardCommandDefinition,
  type KeyboardCommandMode,
  type KeyboardCommandModifiedBinding,
  type KeyboardCommandModifiers,
  type KeyboardCommandPhase,
  type KeyboardCommandPlainBinding,
} from "./keyboard-command-model";

class KeyboardCommandModifiedStroke extends Data.TaggedClass(
  "KeyboardCommandModifiedStroke",
)<{
  readonly alt: boolean;
  readonly code: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}> {}

export type KeyboardCommandPlainCandidate<CommandId extends string> = {
  readonly binding: KeyboardCommandPlainBinding;
  readonly command: KeyboardCommandDefinition<CommandId>;
  readonly order: number;
};

export type KeyboardCommandModifiedCandidate<CommandId extends string> = {
  readonly binding: KeyboardCommandModifiedBinding;
  readonly command: KeyboardCommandDefinition<CommandId>;
  readonly order: number;
};

type KeyboardCommandBindingIndexLeaf<CommandId extends string> = {
  readonly modified: HashMap.HashMap<
    KeyboardCommandModifiedStroke,
    KeyboardCommandModifiedCandidate<CommandId>
  >;
  readonly plain: Trie.Trie<KeyboardCommandPlainCandidate<CommandId>>;
};

export type KeyboardCommandBindingIndex<CommandId extends string> = Readonly<
  Record<
    KeyboardCommandPhase,
    Readonly<Record<KeyboardCommandMode, KeyboardCommandBindingIndexLeaf<CommandId>>>
  >
>;

type MutableKeyboardCommandBindingIndexLeaf<CommandId extends string> = {
  modified: HashMap.HashMap<
    KeyboardCommandModifiedStroke,
    KeyboardCommandModifiedCandidate<CommandId>
  >;
  plain: Trie.Trie<KeyboardCommandPlainCandidate<CommandId>>;
};

type MutableKeyboardCommandBindingIndex<CommandId extends string> = Record<
  KeyboardCommandPhase,
  Record<KeyboardCommandMode, MutableKeyboardCommandBindingIndexLeaf<CommandId>>
>;

const candidateOrder = Order.mapInput(
  Order.Number,
  (candidate: { readonly order: number }) => candidate.order,
);

function makeIndexLeaf<CommandId extends string>():
  MutableKeyboardCommandBindingIndexLeaf<CommandId> {
  return {
    modified: HashMap.empty(),
    plain: Trie.empty(),
  };
}

function modifiedStroke(
  code: string,
  modifiers: KeyboardCommandModifiers,
): KeyboardCommandModifiedStroke {
  return new KeyboardCommandModifiedStroke({ code, ...modifiers });
}

/**
 * Length framing makes token boundaries unambiguous while preserving the
 * useful Trie invariant: an encoded token sequence is a prefix of another
 * encoded sequence exactly when the original token sequence is a prefix.
 */
function encodeKeyboardCommandSequence(
  sequence: readonly string[],
): string {
  return EffectArray.join(
    EffectArray.map(sequence, (code) => `${code.length}:${code}`),
    "",
  );
}

export const compileKeyboardCommandBindingIndex: <CommandId extends string>(
  commands: readonly KeyboardCommandDefinition<CommandId>[],
) => KeyboardCommandBindingIndex<CommandId> = <CommandId extends string>(
  commands: readonly KeyboardCommandDefinition<CommandId>[],
) => {
  const index = {
    bubble: {
      insert: makeIndexLeaf<CommandId>(),
      normal: makeIndexLeaf<CommandId>(),
    },
    capture: {
      insert: makeIndexLeaf<CommandId>(),
      normal: makeIndexLeaf<CommandId>(),
    },
  } satisfies MutableKeyboardCommandBindingIndex<CommandId>;
  let order = 0;

  for (const command of commands) {
    for (const binding of command.bindings) {
      for (const mode of modesForKeyboardCommandBinding(binding)) {
        const leaf = index[command.phase][mode];
        if (binding.kind === "plain") {
          const candidate: KeyboardCommandPlainCandidate<CommandId> = {
            binding,
            command,
            order,
          };
          leaf.plain = Trie.insert(
            leaf.plain,
            encodeKeyboardCommandSequence(binding.sequence),
            candidate,
          );
        } else {
          const candidate: KeyboardCommandModifiedCandidate<CommandId> = {
            binding,
            command,
            order,
          };
          leaf.modified = HashMap.set(
            leaf.modified,
            modifiedStroke(binding.code, binding.modifiers),
            candidate,
          );
        }
      }
      order += 1;
    }
  }

  return index;
};

export function keyboardCommandPlainCandidatesWithPrefix<
  CommandId extends string,
>(
  index: KeyboardCommandBindingIndex<CommandId>,
  phase: KeyboardCommandPhase,
  mode: KeyboardCommandMode,
  sequence: readonly string[],
): readonly KeyboardCommandPlainCandidate<CommandId>[] {
  return EffectArray.sort(
    EffectArray.fromIterable(
      Trie.valuesWithPrefix(
        index[phase][mode].plain,
        encodeKeyboardCommandSequence(sequence),
      ),
    ),
    candidateOrder,
  );
}

export function keyboardCommandModifiedCandidate<CommandId extends string>(
  index: KeyboardCommandBindingIndex<CommandId>,
  phase: KeyboardCommandPhase,
  mode: KeyboardCommandMode,
  code: string,
  modifiers: KeyboardCommandModifiers,
): Option.Option<KeyboardCommandModifiedCandidate<CommandId>> {
  return HashMap.get(
    index[phase][mode].modified,
    modifiedStroke(code, modifiers),
  );
}
