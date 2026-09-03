import * as Atom from "effect/unstable/reactivity/Atom";

import type { VelenInspection } from "../../generated/tauri";

/**
 * What the Velen CLI on this device reports: whether it is authenticated, which
 * organization it points at and which data sources that organization exposes.
 *
 * It is device state like the workspace atoms, not account state — a second
 * machine signed into the same account can have a different answer — which is
 * why it lives beside them rather than in team settings.
 */
export const velenAtom = Atom.make<VelenInspection | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("integrations/velen"),
);
