---
name: thermo-nuclear-code-quality-review
description: Run an extremely strict review of the current branch's changes for structural simplification, maintainability, abstraction quality, giant files, and spaghetti-condition growth. Use for a thermo-nuclear code quality review, thermonuclear review, deep code quality audit, or especially harsh maintainability review.
---

# Thermo-Nuclear Code Quality Review

Perform an unusually strict review focused on implementation quality, maintainability, abstraction
quality, and codebase health. Search for "code judo" moves: behavior-preserving restructurings that
make the implementation dramatically simpler, smaller, more direct, and more elegant.

## Respect the requested scope

- For a review-only request, inspect and report findings without editing code.
- When the user explicitly asks to improve or fix the code, implement justified restructurings and
  verify that behavior is preserved.
- Follow repository instructions and distinguish authored code from generated, vendored, migration,
  fixture, or declarative files before applying size and decomposition heuristics.

## Review workflow

1. Read the repository instructions and determine the intended comparison base.
2. Inspect the complete diff and enough surrounding architecture to understand ownership, existing
   abstractions, canonical helpers, and type boundaries.
3. Identify meaningful changed files and check whether the change crosses important size boundaries,
   especially from below 1,000 lines to above 1,000 lines.
4. Trace new branches, flags, modes, fallbacks, casts, wrappers, and orchestration through their
   callers and consumers. Do not judge them only in isolation.
5. Look for a simpler framing that deletes concepts or control flow rather than merely relocating
   them.
6. Validate each finding against the actual code and tests. Prefer a few high-confidence structural
   findings over speculative or cosmetic comments.
7. Report findings in priority order with precise locations, consequences, and actionable remedies.

## Core prompt

Use this baseline:

> Perform a deep code quality audit of the current branch's changes.
> Rethink how to structure or implement the changes to meaningfully improve code quality without
> impacting behavior. Improve abstractions and modularity, reduce spaghetti code, and improve
> succinctness and legibility. Be ambitious: when authorized to change code and there is a clear
> path to a better implementation that requires restructuring part of the codebase, take it.
> Be extremely thorough and rigorous. Measure twice, cut once.

## Non-negotiable standards

### 1. Pursue structural simplification

- Do not stop at "this could be a bit cleaner."
- Look for ways to make whole branches, helpers, modes, conditionals, or layers disappear.
- Prefer the solution that feels inevitable in hindsight.
- Assume a code-judo move may exist that uses the architecture more effectively.
- Push to delete complexity instead of merely rearranging it.

### 2. Challenge files crossing 1,000 lines

- Treat a change that pushes a file from below 1,000 lines to above 1,000 lines as a strong smell.
- Prefer extracting helpers, subcomponents, modules, or focused abstractions.
- Explicitly ask whether the code should be decomposed before accepting the threshold crossing.
- Waive this only for a compelling structural reason when the resulting file remains clearly
  organized.

Treat 1,000 lines as a strong heuristic, not a blind rule. Apply it carefully to generated,
vendored, migration, fixture, and declarative files.

### 3. Reject spaghetti growth

- Be highly suspicious of ad hoc conditionals, scattered special cases, and one-off branches added
  to unrelated flows.
- Treat "weird if statements in random places" as a design problem, not a style nit.
- Push logic into a dedicated abstraction, helper, state machine, policy object, or separate module
  when that makes ownership clearer.
- Call out changes that make surrounding code harder to reason about even when they work.

### 4. Clean the design instead of accepting working code

- Push for a meaningfully cleaner structure when behavior can stay the same.
- Do not approve an implementation merely because it works.
- Prefer simplifications that remove moving pieces over refactors that spread the same complexity
  around.

### 5. Prefer direct, boring, maintainable code

- Treat brittle, ad hoc, or magical behavior as a code-quality problem.
- Question generic mechanisms that hide simple data-shape assumptions.
- Flag thin abstractions, identity wrappers, and pass-through helpers that add indirection without
  clarity.

### 6. Keep type and boundary contracts clean

- Question unnecessary optionality, `unknown`, `any`, and cast-heavy code when a clearer boundary is
  possible.
- Prefer explicit typed models or shared contracts over loosely shaped ad hoc objects.
- When silent fallback hides an unclear invariant, make the boundary explicit instead.

Apply these principles through the repository's own type system; do not assume TypeScript-specific
constructs exist in every project.

### 7. Keep logic in the canonical layer

- Call out feature logic leaking into shared paths or implementation details leaking through APIs.
- Reuse canonical utilities and helpers instead of introducing bespoke near-duplicates.
- Move code toward the package, service, or module that owns the concept.

### 8. Question sequential and non-atomic orchestration

- Ask whether obviously independent work should run in parallel.
- Push related updates toward an atomic structure when partial application can leave invalid state.
- Avoid micro-optimization comments; focus on orchestration that is needlessly brittle or complex.

## Primary review questions

For every meaningful change, ask:

- Is there a code-judo move that makes this dramatically simpler?
- Can fewer concepts, branches, or helper layers express the change?
- Does the change improve or worsen the local architecture?
- Did the diff add branching complexity where a better abstraction should exist?
- Did a cohesive module become more coupled, stateful, or difficult to scan?
- Does the logic live in the correct file and layer?
- Did a file or component grow past a healthy size boundary?
- Do repeated conditionals reveal a missing model or helper?
- Is the implementation direct and legible, or driven by special cases and incidental control flow?
- Does each abstraction earn its indirection?
- Do casts, optionality, or ad hoc object shapes obscure the real invariant?
- Did implementation details leak across an architectural boundary?
- Is orchestration more sequential or less atomic than necessary?

## Flag aggressively

Escalate findings for:

- Complicated implementations where reframing could delete whole categories of complexity.
- Refactors that move code without reducing the concepts a reader must hold in mind.
- Files crossing 1,000 lines when new code could be split out.
- New conditionals bolted onto unrelated paths.
- One-off booleans, nullable modes, or flags that complicate control flow.
- Feature-specific logic leaking into general-purpose modules.
- Generic magic that hides simple structure.
- Thin wrappers or identity abstractions that add indirection.
- Unnecessary casts, `any`, `unknown`, or optional parameters that muddy the contract.
- Copy-pasted logic instead of a shared helper.
- Edge-case handling inserted into an already busy function.
- Refactors that pass tests while reducing modularity or legibility.
- Temporary branching likely to become permanent debt.
- Bespoke helpers duplicating a canonical utility.
- Logic placed in the wrong layer or package.
- Sequential async flows whose independent work can remain clearer in parallel.
- Partial updates that make state less atomic.

## Prefer these remedies

- Delete a layer of indirection instead of polishing it.
- Reframe the state model so conditionals disappear.
- Change the ownership boundary so the feature naturally extends an existing abstraction.
- Turn special-case logic into a default flow with fewer exceptions.
- Extract a focused helper or pure function.
- Split a large file into smaller, cohesive modules.
- Place feature-specific logic behind a dedicated abstraction.
- Replace condition chains with a typed model or explicit dispatcher.
- Separate orchestration from business logic.
- Collapse duplicate branches into one direct flow.
- Delete wrappers that do not clarify the API.
- Reuse the canonical helper.
- Make type boundaries explicit enough to simplify control flow.
- Move logic to the layer that owns the concept.
- Parallelize independent work when it also simplifies orchestration.
- Make related updates atomic when partial state is difficult to reason about.

Do not settle for naming feedback when the real issue is structural. Do not propose a merely cleaner
version of the same messy idea when a substantially simpler model is plausible.

## Review tone

Be direct, serious, demanding, and respectful. State clearly when a change makes the codebase
messier or misses a major simplification opportunity. Do not soften blockers into minor suggestions.

Useful phrasing includes:

- `this pushes the file past 1k lines. can we decompose this first?`
- `this adds another special-case branch to an already busy flow. can we put it behind its own abstraction?`
- `this works, but it makes the surrounding code more spaghetti. keep the behavior and restructure the implementation.`
- `this feels like feature logic leaking into a shared path. can we isolate it?`
- `this abstraction adds indirection without clarity. can we keep the flow direct?`
- `why is a cast or optional value needed here? can we make the boundary explicit?`
- `this duplicates an existing capability. can we reuse the canonical helper?`
- `there is a code-judo move here. can we reframe the model so these branches disappear?`
- `this refactor moves complexity around but does not delete it. can the model itself become simpler?`

## Output expectations

Prioritize findings in this order:

1. Structural code-quality regressions.
2. Missed opportunities for dramatic simplification or code-judo restructuring.
3. Spaghetti and branching-complexity increases.
4. Boundary, abstraction, and type-contract problems.
5. File-size and decomposition concerns.
6. Modularity and abstraction issues.
7. Legibility and maintainability concerns.

For each finding, provide:

- A concise severity-bearing title.
- The narrowest useful file and line reference.
- The concrete maintainability consequence.
- A specific structural remedy, including the simpler framing when one is visible.

Do not flood the review with low-value nits when larger structural issues exist. Prefer a smaller
number of high-confidence findings over a long list of cosmetic notes. If no qualifying findings
remain, say so explicitly and mention any residual validation gaps.

## Approval bar

Do not approve merely because behavior appears correct. Require:

- No clear structural regression.
- No obvious missed opportunity for a dramatic simplification.
- No unjustified file-size explosion.
- No special-case spaghetti growth.
- No hacky or magical abstraction that obscures the design.
- No unnecessary wrapper, cast, or optionality churn.
- No architectural boundary leak or canonical-helper duplication.
- No missed decomposition that would materially improve maintainability.

Treat these as presumptive blockers unless clearly justified:

- Preserving incidental complexity when a plausible code-judo move can delete it.
- Pushing a file from below 1,000 lines to above 1,000 lines.
- Adding ad hoc branching that tangles an existing flow.
- Scattering feature checks across shared code.
- Adding an unnecessary abstraction, wrapper, or cast-heavy contract.
- Duplicating an existing helper or placing logic outside its canonical home.

Leave explicit, actionable feedback and push for cleaner decomposition whenever the approval bar is
not met.
