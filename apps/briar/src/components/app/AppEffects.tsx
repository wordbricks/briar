import { useActiveOrganizationPersistence } from "../../state/organization/useActiveOrganizationPersistence";

/**
 * Mount point for the domain effect hooks that were `useEffect` blocks inside
 * `useBriar`. Rendering nothing keeps their re-render cost off the app shell:
 * a hook here subscribes to the atoms it needs, and only this component
 * re-renders when they change.
 */
export function AppEffects() {
  useActiveOrganizationPersistence();
  return null;
}
