import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const ActivePage = Schema.Literals([
  "lobby",
  "projects",
  "issues",
  "agents",
  "channels",
  "dms",
  "schedule",
  "inbox",
  "my-issues",
  "organization-create",
  "settings",
]);
export type ActivePage = typeof ActivePage.Type;

const ChannelNavigationPage = Schema.Literals(["channels", "dms"]);
export type ChannelNavigationPage = typeof ChannelNavigationPage.Type;

export const projectNavigationPages = [
  "lobby",
  "projects",
  "issues",
  "agents",
  "schedule",
] as const;
const ProjectNavigationPage = Schema.Literals(projectNavigationPages);
export type ProjectNavigationPage = typeof ProjectNavigationPage.Type;

export const AppSettingsSection = Schema.Literals([
  "account",
  "general",
  "appearance",
  "notifications",
  "keybindings",
  "usage",
  "providers",
  "browser",
  "source-control",
  "connections",
  "archive",
]);
export type AppSettingsSection = typeof AppSettingsSection.Type;
export const OrganizationSettingsSection = Schema.Literals([
  "general",
  "members",
  "agents",
  "workers",
  "integrations",
]);
export type OrganizationSettingsSection =
  typeof OrganizationSettingsSection.Type;
export const ProjectSettingsSection = Schema.Literals([
  "general",
  "tabs",
  "integrations",
  "issue-import",
  "agent-configuration",
  "execution",
  "workflow",
]);
export type ProjectSettingsSection = typeof ProjectSettingsSection.Type;

export const organizationNavigationPages = [
  "inbox",
  "my-issues",
] as const;
const OrganizationNavigationPage = Schema.Literals(organizationNavigationPages);
export type OrganizationNavigationPage = typeof OrganizationNavigationPage.Type;

export type SettingsNavigationTarget =
  | { readonly scope: "application"; readonly section: AppSettingsSection }
  | {
      readonly scope: "organization";
      readonly organizationId: string;
      readonly section: OrganizationSettingsSection;
    }
  | {
      readonly scope: "project";
      readonly projectId: string;
      readonly section: ProjectSettingsSection;
    };

export type AppNavigationLocation =
  | ActivePage
  | `projects/${string}/${ProjectNavigationPage}`
  | `issues/${string}/${string}`
  | `${ChannelNavigationPage}/${string}/${string}`
  | `${ChannelNavigationPage}/${string}/${string}/${string}`
  | `channel-pages/${ChannelNavigationPage}/${string}`
  | `channel-pages/${ChannelNavigationPage}/${string}/${string}`
  | `organizations/${string}/${OrganizationNavigationPage}`
  | `settings/application/${AppSettingsSection}`
  | `settings/organization/${string}/${OrganizationSettingsSection}`
  | `settings/project/${string}/${ProjectSettingsSection}`;

const NavigationId = Schema.NonEmptyString;
const EncodedIssueSegments = Schema.Tuple([
  Schema.Literal("issues"),
  NavigationId,
  NavigationId,
]);
const EncodedChannelSegments = Schema.Union([
  Schema.Tuple([ChannelNavigationPage, NavigationId, NavigationId]),
  Schema.Tuple([
    ChannelNavigationPage,
    NavigationId,
    NavigationId,
    NavigationId,
  ]),
]);
const EncodedChannelPageSegments = Schema.Union([
  Schema.Tuple([
    Schema.Literal("channel-pages"),
    ChannelNavigationPage,
    NavigationId,
  ]),
  Schema.Tuple([
    Schema.Literal("channel-pages"),
    ChannelNavigationPage,
    NavigationId,
    NavigationId,
  ]),
]);
const EncodedProjectSegments = Schema.Tuple([
  Schema.Literal("projects"),
  NavigationId,
  ProjectNavigationPage,
]);
const EncodedOrganizationSegments = Schema.Tuple([
  Schema.Literal("organizations"),
  NavigationId,
  OrganizationNavigationPage,
]);
const EncodedSettingsSegments = Schema.Union([
  Schema.Tuple([
    Schema.Literal("settings"),
    Schema.Literal("application"),
    AppSettingsSection,
  ]),
  Schema.Tuple([
    Schema.Literal("settings"),
    Schema.Literal("organization"),
    NavigationId,
    OrganizationSettingsSection,
  ]),
  Schema.Tuple([
    Schema.Literal("settings"),
    Schema.Literal("project"),
    NavigationId,
    ProjectSettingsSection,
  ]),
]);

const decodeIssueSegments = Schema.decodeUnknownOption(EncodedIssueSegments);
const decodeChannelSegments = Schema.decodeUnknownOption(EncodedChannelSegments);
const decodeChannelPageSegments = Schema.decodeUnknownOption(
  EncodedChannelPageSegments,
);
const decodeProjectSegments = Schema.decodeUnknownOption(EncodedProjectSegments);
const decodeOrganizationSegments = Schema.decodeUnknownOption(
  EncodedOrganizationSegments,
);
const decodeSettingsSegments = Schema.decodeUnknownOption(
  EncodedSettingsSegments,
);
const decodeNavigationId = Schema.decodeSync(NavigationId);
const decodeUriComponent = Option.liftThrowable(decodeURIComponent);
export const isProjectNavigationPage = Schema.is(ProjectNavigationPage);

type ChannelSegments = {
  readonly page: ChannelNavigationPage;
  readonly organizationId: string;
  readonly channelId: string;
  readonly projectId: string | null;
};

type ChannelPageSegments = {
  readonly page: ChannelNavigationPage;
  readonly organizationId: string;
  readonly projectId: string | null;
};

function issueNavigationSegments(
  location: AppNavigationLocation,
): Option.Option<readonly [projectId: string, runId: string]> {
  return decodeIssueSegments(location.split("/")).pipe(
    Option.flatMap(([, projectId, runId]) =>
      Option.all([
        decodeUriComponent(projectId),
        decodeUriComponent(runId),
      ]),
    ),
  );
}

function channelNavigationSegments(
  location: AppNavigationLocation,
): Option.Option<ChannelSegments> {
  return decodeChannelSegments(location.split("/")).pipe(
    Option.flatMap(([page, organizationId, channelId, projectId]) =>
      Option.all({
        organizationId: decodeUriComponent(organizationId),
        channelId: decodeUriComponent(channelId),
        projectId: projectId
          ? decodeUriComponent(projectId).pipe(Option.map(Option.some))
          : Option.some(Option.none<string>()),
      }).pipe(
        Option.map((decoded) => ({
          page,
          organizationId: decoded.organizationId,
          channelId: decoded.channelId,
          projectId: Option.getOrNull(decoded.projectId),
        })),
      ),
    ),
  );
}

function channelPageNavigationSegments(
  location: AppNavigationLocation,
): Option.Option<ChannelPageSegments> {
  return decodeChannelPageSegments(location.split("/")).pipe(
    Option.flatMap(([, page, organizationId, projectId]) =>
      Option.all({
        organizationId: decodeUriComponent(organizationId),
        projectId: projectId
          ? decodeUriComponent(projectId).pipe(Option.map(Option.some))
          : Option.some(Option.none<string>()),
      }).pipe(
        Option.map((decoded) => ({
          page,
          organizationId: decoded.organizationId,
          projectId: Option.getOrNull(decoded.projectId),
        })),
      ),
    ),
  );
}

function projectNavigationSegments(
  location: AppNavigationLocation,
): Option.Option<readonly [projectId: string, page: ProjectNavigationPage]> {
  return decodeProjectSegments(location.split("/")).pipe(
    Option.flatMap(([, projectId, page]) =>
      decodeUriComponent(projectId).pipe(
        Option.map((decodedProjectId) => [decodedProjectId, page] as const),
      ),
    ),
  );
}

function organizationNavigationSegments(
  location: AppNavigationLocation,
): Option.Option<readonly [organizationId: string, page: OrganizationNavigationPage]> {
  return decodeOrganizationSegments(location.split("/")).pipe(
    Option.flatMap(([, organizationId, page]) =>
      decodeUriComponent(organizationId).pipe(
        Option.map((decodedOrganizationId) =>
          [decodedOrganizationId, page] as const
        ),
      ),
    ),
  );
}

export function projectNavigationLocation(
  page: ProjectNavigationPage,
  projectId: string,
): AppNavigationLocation {
  return `projects/${encodeURIComponent(decodeNavigationId(projectId))}/${page}`;
}

export function issueNavigationLocation(
  projectId: string,
  runId: string,
): AppNavigationLocation {
  return `issues/${encodeURIComponent(
    decodeNavigationId(projectId),
  )}/${encodeURIComponent(decodeNavigationId(runId))}`;
}

export function channelNavigationLocation(
  page: ChannelNavigationPage,
  organizationId: string,
  channelId: string,
  projectId?: string | null,
): AppNavigationLocation {
  const organization = encodeURIComponent(decodeNavigationId(organizationId));
  const channel = encodeURIComponent(decodeNavigationId(channelId));
  if (projectId !== undefined && projectId !== null) {
    return `${page}/${organization}/${channel}/${encodeURIComponent(
      decodeNavigationId(projectId),
    )}`;
  }
  return `${page}/${organization}/${channel}`;
}

export function channelPageNavigationLocation(
  page: ChannelNavigationPage,
  organizationId: string,
  projectId?: string | null,
): AppNavigationLocation {
  const organization = encodeURIComponent(decodeNavigationId(organizationId));
  if (projectId !== undefined && projectId !== null) {
    return `channel-pages/${page}/${organization}/${encodeURIComponent(
      decodeNavigationId(projectId),
    )}`;
  }
  return `channel-pages/${page}/${organization}`;
}

export function organizationNavigationLocation(
  organizationId: string,
  page: OrganizationNavigationPage = "inbox",
): AppNavigationLocation {
  return `organizations/${encodeURIComponent(
    decodeNavigationId(organizationId),
  )}/${page}`;
}

export function settingsNavigationLocation(
  target: SettingsNavigationTarget,
): AppNavigationLocation {
  if (target.scope === "application") {
    return `settings/application/${target.section}`;
  }
  if (target.scope === "organization") {
    return `settings/organization/${encodeURIComponent(
      decodeNavigationId(target.organizationId),
    )}/${target.section}`;
  }
  return `settings/project/${encodeURIComponent(
    decodeNavigationId(target.projectId),
  )}/${target.section}`;
}

export function settingsTargetFromNavigationLocation(
  location: AppNavigationLocation,
): SettingsNavigationTarget | null {
  return decodeSettingsSegments(location.split("/")).pipe(
    Option.flatMap((segments) => {
      if (segments[1] === "application") {
        return Option.some({
          scope: "application" as const,
          section: segments[2],
        });
      }
      const [, scope, encodedId, section] = segments;
      return decodeUriComponent(encodedId).pipe(
        Option.map((id): SettingsNavigationTarget =>
          scope === "organization"
            ? { scope, organizationId: id, section }
            : { scope, projectId: id, section },
        ),
      );
    }),
    Option.getOrNull,
  );
}

export function pageFromNavigationLocation(
  location: AppNavigationLocation,
): ActivePage {
  return issueNavigationSegments(location).pipe(
    Option.as<ActivePage>("issues"),
    Option.orElse(() =>
      channelNavigationSegments(location).pipe(
        Option.map(({ page }) => page),
      ),
    ),
    Option.orElse(() =>
      channelPageNavigationSegments(location).pipe(
        Option.map(({ page }) => page),
      ),
    ),
    Option.orElse(() =>
      projectNavigationSegments(location).pipe(
        Option.map(([, page]) => page),
      ),
    ),
    Option.orElse(() =>
      organizationNavigationSegments(location).pipe(
        Option.map(([, page]) => page),
      ),
    ),
    Option.orElse(() =>
      Option.fromNullishOr(settingsTargetFromNavigationLocation(location)).pipe(
        Option.as<ActivePage>("settings"),
      ),
    ),
    Option.orElse(() => Schema.decodeUnknownOption(ActivePage)(location)),
    Option.getOrElse((): ActivePage => "lobby"),
  );
}

export function runIdFromNavigationLocation(
  location: AppNavigationLocation,
): string | null {
  return issueNavigationSegments(location).pipe(
    Option.map(([, runId]) => runId),
    Option.getOrNull,
  );
}

export function projectIdFromNavigationLocation(
  location: AppNavigationLocation,
): string | null {
  return issueNavigationSegments(location).pipe(
    Option.map(([projectId]) => projectId),
    Option.orElse(() =>
      projectNavigationSegments(location).pipe(
        Option.map(([projectId]) => projectId),
      ),
    ),
    Option.orElse(() =>
      channelNavigationSegments(location).pipe(
        Option.flatMap(({ projectId }) => Option.fromNullishOr(projectId)),
      ),
    ),
    Option.orElse(() =>
      channelPageNavigationSegments(location).pipe(
        Option.flatMap(({ projectId }) => Option.fromNullishOr(projectId)),
      ),
    ),
    Option.orElse(() =>
      Option.fromNullishOr(settingsTargetFromNavigationLocation(location)).pipe(
        Option.flatMap((target) =>
          target.scope === "project"
            ? Option.some(target.projectId)
            : Option.none(),
        ),
      ),
    ),
    Option.getOrNull,
  );
}

export function channelIdFromNavigationLocation(
  location: AppNavigationLocation,
): string | null {
  return channelNavigationSegments(location).pipe(
    Option.map(({ channelId }) => channelId),
    Option.getOrNull,
  );
}

export function organizationIdFromNavigationLocation(
  location: AppNavigationLocation,
): string | null {
  return channelNavigationSegments(location).pipe(
    Option.map(({ organizationId }) => organizationId),
    Option.orElse(() =>
      channelPageNavigationSegments(location).pipe(
        Option.map(({ organizationId }) => organizationId),
      ),
    ),
    Option.orElse(() =>
      organizationNavigationSegments(location).pipe(
        Option.map(([organizationId]) => organizationId),
      ),
    ),
    Option.orElse(() =>
      Option.fromNullishOr(settingsTargetFromNavigationLocation(location)).pipe(
        Option.flatMap((target) =>
          target.scope === "organization"
            ? Option.some(target.organizationId)
            : Option.none(),
        ),
      ),
    ),
    Option.getOrNull,
  );
}
