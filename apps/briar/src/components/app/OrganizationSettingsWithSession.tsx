import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps } from "react";

import { tokenAtom, userAtom } from "../../state/session/atoms";
import { OrganizationSettings } from "../OrganizationSettings";

/**
 * `OrganizationSettings` wired to the session atoms. The organization itself
 * stays a prop: App resolves it from the settings target and needs the same
 * value to decide whether to render this screen at all.
 */
export function OrganizationSettingsWithSession(
  props: Omit<ComponentProps<typeof OrganizationSettings>, "token" | "userId">,
) {
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  return (
    <OrganizationSettings
      {...props}
      token={token ?? ""}
      userId={user?.id ?? ""}
    />
  );
}
