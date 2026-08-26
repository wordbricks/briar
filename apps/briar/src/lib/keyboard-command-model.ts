import type * as EffectArray from "effect/Array";

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
  readonly sequence: EffectArray.NonEmptyReadonlyArray<string>;
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
  readonly bindings: EffectArray.NonEmptyReadonlyArray<KeyboardCommandBinding>;
  readonly id: CommandId;
  readonly phase: KeyboardCommandPhase;
  readonly repeat?: "allow" | "ignore";
};

export const keyboardCommandDefaultModes = ["normal"] as const;

export function modesForKeyboardCommandBinding(
  binding: KeyboardCommandBinding,
): readonly KeyboardCommandMode[] {
  return binding.modes ?? keyboardCommandDefaultModes;
}
