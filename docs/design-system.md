# Briar Design System

shadcn/ui (New York) + Tailwind CSS v4, with Briar’s warm paper surface and violet brand.

## Layout

| Path | Role |
|------|------|
| `src/styles/tokens.css` | Color, type, radius, elevation tokens |
| `src/styles/globals.css` | Tailwind theme bridge + base typography |
| `src/styles.css` | Legacy screen styles (consume tokens; migrate gradually) |
| `src/components/ui/*` | Primitives (Button, Input, Dialog, Typography, …) |
| `src/lib/utils.ts` | `cn()` class merger |
| `src/lib/typography.ts` | Type scale constants for TS |
| `components.json` | shadcn CLI config |

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
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  Typography,
} from "@/components/ui";
```

Add more with the shadcn CLI:

```bash
bunx shadcn@latest add select dropdown-menu popover avatar
```

## Product pages

Shared page layout primitives live in `src/components/layout/`:

| Export | Role |
|--------|------|
| `MainContent` | App main pane (`main-content` compatible) |
| `PageHeader` | Page titles with optional eyebrow/actions |
| `EmptyState` / `ErrorBanner` | Empty and error affordances |

Migrated product surfaces include Login, Inbox, Auto Hunt, Agents, Schedule,
Issue queue/dashboard, Organization create, Companion chrome, and settings.
Remaining dialogs/forms should prefer `@/components/ui` controls as they are touched.

Legacy `src/styles.css` is tokenized for type scale and common colors so older
class-based screens inherit the system even before full JSX rewrites.

## Settings surfaces (migrated)

Settings screens use shared layout primitives in `src/components/settings/`:

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
5. Do not invent new hex colors; extend `tokens.css` if a new semantic color is required.

## Fonts

- UI: **Inter**
- Mono / meters: **DM Mono**

Loaded in `index.html` from Google Fonts.
