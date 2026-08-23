# Briar Design System

shadcn/ui (New York) + Tailwind CSS v4, with Briar’s warm paper surface and violet brand.

## Layout

| Path | Role |
|------|------|
| `apps/briar/src/styles/tokens.css` | Color, type, radius, elevation tokens |
| `apps/briar/src/styles/globals.css` | Tailwind theme bridge + base typography |
| `apps/briar/src/styles.css` | Legacy screen styles (consume tokens; migrate gradually) |
| `apps/briar/src/components/ui/*` | Primitives (Button, Input, Dialog, Typography, …) |
| `apps/briar/src/lib/utils.ts` | `cn()` class merger |
| `apps/briar/src/lib/typography.ts` | Type scale constants for TS |
| `apps/briar/components.json` | shadcn CLI config |

## Typography scale

Dense desktop product UI. Prefer semantic roles over raw pixel sizes.

| Role | Step | Size | Use |
|------|------|------|-----|
| `display` | 4xl | 34px | Rare hero |
| `title` | 3xl | 28px | Page titles |
| `heading` | 2xl | 22px | Panel headings |
| `subheading` | xl | 18px | Card titles |
| `bodyLg` | md | 14px | Emphasized body |
| `body` | base | 13px | Default body |
| `bodySm` / `label` | sm | 12px | Compact UI, labels |
| `caption` | xs | 11px | Helper text |
| `micro` | 2xs | 10px | Meta, meters, badges |

Font weights: **400 / 500 / 600 / 700** only (no 520–760).

```tsx
import { Typography } from "@/components/ui";

<Typography variant="title">Project settings</Typography>
<Typography variant="caption" tone="muted">
  Connected repositories and automation.
</Typography>
```

CSS utilities: `.text-title`, `.text-heading`, `.text-body`, `.text-caption`, `.text-micro`, …

## Colors

Semantic tokens (shadcn):

- `background` / `foreground` — app chrome
- `card` / `popover` — elevated surfaces
- `primary` — brand violet (`#6046b8`)
- `muted` + `muted-foreground` — soft surface + secondary text
- `accent` + `accent-foreground` — soft brand wash
- `destructive` / `success` / `warning`
- `status-{info,success,warning,destructive}-{surface,border,foreground,muted}` —
  derived, theme-aware feedback banner colors
- `border` / `input` / `ring`

Legacy aliases still work for `styles.css`: `--ink`, `--line`, `--surface`, `--faint`, `--mint`, `--rose`, `--brand`.

> **Note:** legacy `--muted` / `--accent` used to mean *text* / *solid brand*. Those meanings are now `--muted-foreground` and `--primary`.

## Components

```tsx
import {
  Button,
  Input,
  Label,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  ChoiceCard,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  Typography,
  StatusPanel,
  StatusPanelContent,
  StatusPanelDescription,
  StatusPanelIcon,
  StatusPanelTitle,
} from "@/components/ui";
```

### Feedback surfaces

Use `StatusPanel` for persistent status, warning, success, information, and
destructive surfaces. It owns theme-aware surface, border, foreground, and
muted colors through the `status-*` tokens. Compose it with its icon, content,
title, description, meta, and action slots instead of creating feature-specific
banner colors.

```tsx
<StatusPanel role="status" tone="success">
  <StatusPanelIcon><Check /></StatusPanelIcon>
  <StatusPanelContent>
    <StatusPanelTitle>Connected</StatusPanelTitle>
    <StatusPanelDescription>Last checked just now.</StatusPanelDescription>
  </StatusPanelContent>
</StatusPanel>
```

Use `ChoiceCard` for a button that presents a mutually exclusive setup or
creation path. Use `Card` for non-interactive content. Do not turn a neutral
`Card` into a status banner with one-off colors.

Add more with the shadcn CLI:

```bash
bunx shadcn@latest add select dropdown-menu popover avatar
```

## Product pages

Shared page layout primitives live in `apps/briar/src/components/layout/`:

| Export | Role |
|--------|------|
| `MainContent` | App main pane (`main-content` compatible) |
| `PageHeader` | Page titles with optional eyebrow/actions |
| `EmptyState` | Empty affordances |
| `StatusPanel` | Global feedback and status surface |

Migrated product surfaces include Login, Inbox, Auto Hunt, Agents, Schedule,
Issue queue/dashboard, Organization create, Companion chrome, and settings.
Remaining dialogs/forms should prefer `@/components/ui` controls as they are touched.

Legacy `apps/briar/src/styles.css` is tokenized for type scale and common colors so older
class-based screens inherit the system even before full JSX rewrites.

## Settings surfaces (migrated)

Settings screens use shared layout primitives in `apps/briar/src/components/settings/`:

| Export | Role |
|--------|------|
| `SettingsShell` / `SettingsSidebar` / `SettingsMain` | Two-pane chrome |
| `SettingsBackButton` / `SettingsSearch` / `SettingsNav*` | Sidebar chrome |
| `SettingsPageHeader` / `SettingsSection` / `SettingsCard` | Content structure |
| `ProviderRow` / `ProviderIcon` | Source control & AI provider rows |

Migrated screens:

- `AppSettings`
- `OrganizationSettings`
- `ProjectSettings` (shell + primary controls; some domain panels still use scoped CSS)
- `CompanionSettings`

## Migration guide

1. **New UI** — build only with `@/components/ui` + Tailwind utilities + tokens.
2. **Touching a screen** — replace one-off `font-size: 9px` / `11.5px` with `var(--text-*)` or semantic classes.
3. **Buttons / inputs / dialogs** — prefer primitives over duplicated CSS.
4. **Settings-like pages** — reuse `@/components/settings` layout primitives.
5. **Feedback** — use `StatusPanel`; do not duplicate banner surface colors.
6. **Choice cards** — use `ChoiceCard`; reserve `Card` for non-interactive content.
7. Do not invent new hex colors; extend `tokens.css` if a new semantic color is required.

## Fonts

- UI: **Inter**
- Mono / meters: **DM Mono**

Loaded in `apps/briar/index.html` from Google Fonts.
