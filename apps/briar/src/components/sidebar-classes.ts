import { cn } from "../lib/utils";

/*
  Class strings shared across the sidebar tree. These replace the descendant
  selectors that `styles.css` used to hang off `.sidebar-channel-context-menu`
  and friends — the sharing is now an import instead of a selector, so renaming
  one is a type error rather than a silently unstyled element.
*/

export const sidebarFocusRing =
  "focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sidebar-focus";

/* Nested rows (a team's Projects / Channels sections) sit one indent in and
   drop to the compact type size. */
export const sidebarNestedToggleClass = "gap-2 pl-9 text-sm/[20px] font-normal";

/* Unread pip: a dot with a soft ring, pushed to the end of its row unless the
   row's own layout places it (the DM meta column overrides the auto margin). */
export const sidebarUnreadDotClass = cn(
  "ml-auto size-[7px] shrink-0 grow-0 basis-[7px] rounded-full",
  "bg-sidebar-icon-accent shadow-[0_0_0_3px_var(--sidebar-icon-accent-ring)]",
);

/* Workspace switcher popover, anchored under the brand button. */
export const sidebarWorkspaceMenuClass = cn(
  "absolute top-[39px] left-1.5 z-25 w-[calc(100%-12px)] origin-top-left",
  "rounded-[14px] border border-sidebar-border p-[7px]",
  "bg-sidebar-popover text-sidebar-popover-foreground",
  "shadow-[0_16px_44px_rgba(0,0,0,.22)] backdrop-blur-[20px] backdrop-saturate-150",
  "animate-[sidebar-menu-in_.14s_cubic-bezier(.2,.8,.2,1)] motion-reduce:animate-none",
  "reduced-transparency:bg-card reduced-transparency:backdrop-filter-none",
);

export const sidebarWorkspaceMenuItemClass = cn(
  "grid h-[38px] w-full cursor-pointer grid-cols-[18px_minmax(0,1fr)_16px] items-center gap-2",
  "rounded-[9px] bg-transparent px-[11px] text-left",
  "text-sm/[20px] tracking-[-.01em] text-sidebar-popover-foreground",
  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-[.985]",
  "focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground",
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-focus",
  "[&>span]:truncate",
);

/* Segmented DMs/Work switch in the sidebar header. */
export const sidebarModeOptionClass = cn(
  "relative grid h-[26px] w-[30px] cursor-pointer place-items-center rounded-[7px] p-0",
  "bg-transparent text-sidebar-foreground-muted",
  "transition-[color,background-color,box-shadow,transform] duration-150 ease-[ease]",
  "hover:text-sidebar-accent-foreground active:scale-95",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sidebar-focus",
);

export const sidebarModeOptionActiveClass = cn(
  "cursor-default bg-sidebar-popover text-sidebar-foreground-strong",
  "shadow-[0_1px_2px_rgba(0,0,0,.12),0_0_0_1px_var(--sidebar-border)]",
);

export const sidebarContextMenuClass = cn(
  "z-80 min-w-[174px] rounded-[11px] border border-sidebar-border p-[5px]",
  "bg-sidebar-popover text-sidebar-popover-foreground backdrop-blur-[16px]",
  "shadow-[0_16px_45px_rgba(0,0,0,.22)]",
  "animate-[sidebar-menu-in_.12s_cubic-bezier(.2,.8,.2,1)] motion-reduce:animate-none",
);

export const sidebarContextMenuItemClass = cn(
  "flex h-8.5 cursor-pointer items-center gap-[9px] rounded-[7px] px-[9px] text-xs outline-0",
  "data-highlighted:bg-sidebar-accent data-highlighted:text-sidebar-accent-foreground",
  "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-focus",
  "[&>span]:min-w-0 [&>span]:truncate [&>svg]:text-sidebar-icon-accent",
);

export const sidebarContextMenuDangerClass = cn(
  "text-destructive [&>svg]:text-current",
  "data-highlighted:bg-destructive data-highlighted:text-destructive-foreground",
);

export const sidebarContextMenuSeparatorClass = "mx-1 my-1 h-px bg-sidebar-border";

/* Trailing chevron/check in a context menu item, pinned to the row's end. */
export const sidebarContextMenuAffixClass = "ml-auto flex-none";
