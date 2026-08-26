# Keyboard command architecture

Briar treats keyboard input as commands, not as component-local key checks. The
architecture has one app-owned decision plane and lets mounted surfaces register
temporary command handlers with explicit priority.

## Mental model

Each layer answers one question:

1. **Model — what is a keyboard command?**
   `keyboard-command-model.ts` owns the immutable binding, mode, phase,
   modifier, and command-definition vocabulary. Bindings use non-empty Effect
   arrays, so an empty sequence is not representable after construction.
2. **Catalog and index — what can this key mean?**
   `app-keyboard-command-catalog.ts` maps physical key codes and configured
   chords to stable command IDs. Catalog construction validates conflicts,
   clones the definitions, then compiles plain sequences into an Effect `Trie`
   and modified strokes into an Effect `HashMap`. Mode and propagation phase
   select the index leaf before any handler is consulted.
3. **Controller — which command owns this event now?**
   `keyboard-command-controller.ts` is a synchronous reducer plus a scoped
   handler registry. It asks the compiled index for structural candidates,
   resolves availability only for those candidates, then reduces the input to
   an Effect tagged decision. Scope order is recomputed only when registrations
   change.
4. **AtomRef — what transient command state must React observe?**
   The root controller owns one Effect `AtomRef` containing only `mode` and the
   pending sequence. UI such as the shortcut HUD subscribes to that snapshot.
5. **DOM adapters — when may Briar decide?**
   One capture adapter owns app-global chords and sequences. One bubble adapter
   owns contextual navigation after a focused WAI-ARIA widget has had the first
   chance to handle the event.
6. **Scopes — who can execute the command?**
   The app shell, page, collection, and temporary surface register handlers.
   Higher-priority mounted scopes decide first and may deliberately pass to a
   lower scope.
7. **Controlled collection navigation — where does focus move?**
   A collection owns stable item IDs, a keyboard cursor, and selection. The
   reusable hook computes movement and projects an accepted cursor into a DOM
   ref; it never infers state from `document.activeElement` and never calls
   `element.click()`. `useAppCollectionKeyboardCommandScope` connects that
   movement to app commands while centralizing orientation, preference,
   overlay, repeat, and target-list ownership.

```text
physical key
    |
    v
capture adapter --> phase/mode index --> structural candidates
    |                                      |
    | pass                                 v
    |                              ordered scope routing
    |                                      |
    v                                      v
focused widget --------------------> tagged decision --> handler
    | pass                                 |
    v                                      v
bubble adapter ----------------> controlled cursor --> focus projection
```

## Effect boundary

Effect helpers describe domain semantics; they do not make the native keydown
path asynchronous. The controller must return before browser propagation
continues, so dispatch and command handlers remain synchronous functions.

- `Data.TaggedEnum` and exhaustive matching model reducer decisions and handler
  outcomes.
- `Array.NonEmptyReadonlyArray`, `Equivalence`, and `Schema.toEquivalence`
  preserve binding invariants and semantic equality without serialization.
- `Trie` handles physical-sequence prefixes. Sequence tokens use a
  length-framed encoding, so `A, BC` cannot collide with `AB, C` and token
  prefixes remain string prefixes.
- `HashMap` uses a private `Data.TaggedClass` modified-stroke key, giving fresh
  lookup values structural Effect equality and hashing.
- `Order` restores catalog declaration order after Trie lookup and orders
  scopes by priority then registration recency.
- `Option` stays local to safe index and native-map lookups. Observable Atom
  state uses plain nullable fields because that is the React-facing state
  contract.
- `Duration` is accepted at configuration boundaries and converted to
  milliseconds only at the browser scheduler boundary. `Equal` prevents
  semantic no-op Atom writes and timeout churn.

Do not introduce `Effect.gen`, services, or layers into dispatch merely to make
the code look more Effect-like. Add them only when command execution gains a
real effectful dependency or typed failure channel that benefits from runtime
composition.

## State ownership

The Effect atom is intentionally small. It contains serializable, app-wide,
observable state:

- `normal` or `insert` mode
- the pending multi-key sequence, its owning phase, and its frozen candidates

The following do **not** belong in the atom:

- `KeyboardEvent`, event targets, or DOM elements; these are transient handler
  input or callback refs.
- Handler functions and mounted component ownership; these live in the
  controller's tokenized registry.
- A list or board's cursor and selection; these remain controlled React state
  beside the data whose stable IDs define visual order.

This keeps Atom updates deterministic and inspectable without turning every
focus transition into global application state.

Candidate IDs are frozen when a prefix begins, so a command that becomes
available halfway through a chord cannot join it. Availability is still
re-evaluated for the frozen candidates on relevant later strokes. This cleanly
separates structural eligibility (catalog/index) from live ownership
(registered scopes).

## Mode and phase contracts

Bindings are `normal`-mode only unless they explicitly opt into `insert` mode.
Focus entering an editable element projects `insert`; leaving it projects
`normal`. A component that consumes Escape to finish editing must blur or move
focus so the shared adapter observes the mode transition.

Capture phase is for commands that must work before descendant propagation,
such as configured modifier chords and Vim-style sequences. Bubble phase is for
commands that should yield to local widgets, such as list movement and Settings
Escape. A command definition has exactly one phase so the same native event is
not executed twice.

Escape first cancels an active sequence. If nothing is pending, the relevant
bubble scope may use Escape to dismiss its surface. This makes `g`, `Escape`
different from an idle `Escape` and keeps sequence cancellation predictable.

## Collection rules

Collections use stable domain IDs, never array indexes, as cursor identity.
They must choose one selection behavior:

- `follow-cursor`: movement also changes preview/selection, as in Inbox.
- `manual`: movement changes focus only; Enter, Space, or click activates, as in
  the issue list and Kanban board.

Consumers provide current visible IDs and explicit item refs. Reordering keeps
the cursor on the same item. Filtering falls back to a visible selected item,
then to the directional edge. Movement clamps at boundaries and may refocus the
cursor, but a clamp never reactivates the item.

The collection scope is enabled only while its surface is active and its root
is connected. An event originating in another marked collection is passed to
that collection's scope. There is no app-global DOM-order fallback; pages must
declare which controlled collection owns outside-focus navigation.

## Adding a shortcut

1. Add a stable command ID and binding to the app catalog. Declare phase, modes,
   and repeat behavior explicitly.
2. Register behavior at the narrowest owner: temporary surface, collection,
   page, then app shell. Do not add another global keydown listener.
3. Use `isAvailable` for live preconditions and return `pass` when a lower owner
   should try. Return `handled` after executing; use `consume` only when browser
   behavior must be blocked without executing an action.
4. For a navigable collection, keep cursor and selection separate and use
   `useControlledCollectionNavigation` plus
   `useAppCollectionKeyboardCommandScope`. Synchronize the cursor from focus
   and pointer interactions without synthesizing clicks.
5. Add reducer tests for matching/ownership and a focused DOM test for mode,
   propagation phase, repeat, boundary, and activation behavior. Include a
   physical-code case whose `key` value comes from a non-Latin layout.

Local text editors, menus, listboxes, and other WAI-ARIA widgets may keep their
own key handlers for widget semantics. They should prevent the event when they
handle it; the bubble adapter will then leave it alone.
