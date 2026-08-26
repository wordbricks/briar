import { Check, ChevronDown, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type SelectMenuOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: string | null;
  leading?: ReactNode;
};

type MenuPosition = {
  bottom?: number;
  left: number;
  maxHeight: number;
  portalContainer: HTMLElement;
  top?: number;
  width: number;
  zIndex: number;
};

const defaultMenuZIndex = 120;

function hasActiveCssValue(value: string | undefined) {
  return Boolean(value && value !== "none" && value !== "normal");
}

function createsFixedContainingBlock(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const contain = new Set((style.contain ?? "").split(/\s+/));
  const willChange = new Set(
    (style.willChange ?? "")
      .split(",")
      .map((property) => property.trim()),
  );

  return (
    hasActiveCssValue(style.transform) ||
    hasActiveCssValue(style.translate) ||
    hasActiveCssValue(style.rotate) ||
    hasActiveCssValue(style.scale) ||
    hasActiveCssValue(style.perspective) ||
    hasActiveCssValue(style.filter) ||
    hasActiveCssValue(style.backdropFilter) ||
    hasActiveCssValue(style.getPropertyValue("-webkit-backdrop-filter")) ||
    hasActiveCssValue(style.containerType) ||
    style.contentVisibility === "auto" ||
    contain.has("layout") ||
    contain.has("paint") ||
    contain.has("strict") ||
    contain.has("content") ||
    [
      "transform",
      "translate",
      "rotate",
      "scale",
      "perspective",
      "filter",
      "backdrop-filter",
      "contain",
    ].some((property) => willChange.has(property))
  );
}

function getFixedContainingBlock(element: HTMLElement) {
  let ancestor: HTMLElement | null = element;

  while (ancestor) {
    if (createsFixedContainingBlock(ancestor)) return ancestor;
    ancestor = ancestor.parentElement;
  }

  return null;
}

function OptionVisual({
  icon,
  iconClassName,
  leading,
  leadingClassName,
}: {
  icon?: string | null;
  iconClassName: string;
  leading?: ReactNode;
  leadingClassName: string;
}) {
  if (leading) {
    return (
      <span aria-hidden="true" className={leadingClassName}>
        {leading}
      </span>
    );
  }
  if (icon) {
    return <img alt="" className={iconClassName} src={icon} />;
  }
  return null;
}

function getMenuZIndex(trigger: HTMLElement) {
  let zIndex = defaultMenuZIndex;
  let ancestor = trigger.parentElement;

  while (ancestor) {
    const ancestorZIndex = Number.parseInt(
      window.getComputedStyle(ancestor).zIndex,
      10,
    );
    if (Number.isFinite(ancestorZIndex)) {
      zIndex = Math.max(zIndex, ancestorZIndex + 1);
    }
    ancestor = ancestor.parentElement;
  }

  return zIndex;
}

export function SelectMenu({
  align = "start",
  className,
  disabled = false,
  hideChevron = false,
  id,
  label,
  leadingIcon,
  onValueChange,
  options,
  placeholder,
  searchEmptyMessage = "No results found.",
  searchPlaceholder = "Search options",
  searchable = false,
  size = "medium",
  title,
  value,
}: {
  align?: "start" | "end";
  className?: string;
  disabled?: boolean;
  hideChevron?: boolean;
  id?: string;
  label: string;
  leadingIcon?: ReactNode;
  onValueChange: (value: string) => void;
  options: SelectMenuOption[];
  placeholder?: string;
  searchEmptyMessage?: string;
  searchPlaceholder?: string;
  searchable?: boolean;
  size?: "small" | "medium" | "large";
  title?: string;
  value: string;
}) {
  const generatedId = useId().replaceAll(":", "");
  const controlId = id ?? `select-menu-${generatedId}`;
  const listboxId = `${controlId}-listbox`;
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const initialFocusRef = useRef<string | null>(null);
  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!searchable || !query) return options;
    return options.filter((option) =>
      [option.label, option.value, option.description]
        .filter(Boolean)
        .some((candidate) =>
          candidate!.toLocaleLowerCase().includes(query)
        )
    );
  }, [options, searchQuery, searchable]);
  const enabledOptions = useMemo(
    () => filteredOptions.filter((option) => !option.disabled),
    [filteredOptions],
  );

  const focusOption = useCallback((optionValue: string) => {
    optionRefs.current.get(optionValue)?.focus();
  }, []);

  const closeMenu = useCallback((returnFocus = false) => {
    setIsOpen(false);
    setSearchQuery("");
    if (returnFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 10;
    const gap = 7;
    const estimatedRows = filteredOptions.reduce(
      (height, option) => height + (option.description ? 52 : 40),
      searchable ? 66 : 14,
    );
    const desiredHeight = Math.min(estimatedRows, 320);
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
    const spaceAbove = rect.top - gap - viewportPadding;
    const placeAbove = spaceBelow < Math.min(desiredHeight, 180) && spaceAbove > spaceBelow;
    const desiredWidth = Math.max(rect.width, options.some((option) => option.description) ? 250 : 210);
    const width = Math.min(desiredWidth, window.innerWidth - viewportPadding * 2);
    const preferredLeft = align === "end" ? rect.right - width : rect.left;
    const viewportLeft = Math.min(
      Math.max(viewportPadding, preferredLeft),
      window.innerWidth - width - viewportPadding,
    );
    const availableHeight = Math.max(
      96,
      Math.min(320, placeAbove ? spaceAbove : spaceBelow),
    );
    // Radix modal dialogs trap focus and pointer interaction inside their
    // content. Keep the menu in that DOM boundary instead of portaling it to
    // document.body. A fixed-position descendant only uses local coordinates
    // when an ancestor actually establishes a fixed containing block; custom
    // dialogs such as Create Agent continue to use viewport coordinates.
    const portalContainer =
      trigger.closest<HTMLElement>('[role="dialog"]') ?? document.body;
    const containingBlock = getFixedContainingBlock(portalContainer);
    const containingBlockRect = containingBlock?.getBoundingClientRect() ?? null;

    setMenuPosition({
      ...(placeAbove
        ? {
            bottom: containingBlockRect
              ? containingBlockRect.bottom - rect.top + gap
              : window.innerHeight - rect.top + gap,
          }
        : { top: rect.bottom + gap - (containingBlockRect?.top ?? 0) }),
      left: viewportLeft - (containingBlockRect?.left ?? 0),
      maxHeight: availableHeight,
      portalContainer,
      width,
      zIndex: getMenuZIndex(trigger),
    });
  }, [align, filteredOptions, searchable]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();

    const frame = window.requestAnimationFrame(() => {
      if (searchable) {
        searchInputRef.current?.focus();
        return;
      }
      const target = initialFocusRef.current ??
        (selectedOption && !selectedOption.disabled
          ? selectedOption.value
          : enabledOptions[0]?.value);
      initialFocusRef.current = null;
      if (target !== undefined) focusOption(target);
    });
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [
    enabledOptions,
    focusOption,
    isOpen,
    searchable,
    selectedOption,
    updateMenuPosition,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        rootRef.current?.contains(event.target) ||
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      closeMenu();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [closeMenu, isOpen]);

  useEffect(() => {
    if (disabled) closeMenu();
  }, [closeMenu, disabled]);

  const openMenu = (edge?: "first" | "last") => {
    if (disabled || enabledOptions.length === 0) return;
    const option = edge === "first"
      ? enabledOptions[0]
      : edge === "last"
        ? enabledOptions.at(-1)
        : undefined;
    initialFocusRef.current = option?.value ?? null;
    setIsOpen(true);
  };

  const moveFocus = (currentValue: string, direction: 1 | -1) => {
    const currentIndex = enabledOptions.findIndex(
      (option) => option.value === currentValue,
    );
    const nextIndex =
      currentIndex < 0
        ? 0
        : (currentIndex + direction + enabledOptions.length) %
          enabledOptions.length;
    const next = enabledOptions[nextIndex];
    if (next) focusOption(next.value);
  };

  const selectValue = (nextValue: string) => {
    if (nextValue !== value) onValueChange(nextValue);
    closeMenu(true);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(event.key === "ArrowDown" ? "first" : "last");
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      openMenu(event.key === "Home" ? "first" : "last");
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closeMenu();
    }
  };

  const onOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    optionValue: string,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(optionValue, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const option = event.key === "Home"
        ? enabledOptions[0]
        : enabledOptions.at(-1);
      if (option) focusOption(option.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu();
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      const currentIndex = enabledOptions.findIndex(
        (option) => option.value === optionValue,
      );
      const ordered = [
        ...enabledOptions.slice(currentIndex + 1),
        ...enabledOptions.slice(0, currentIndex + 1),
      ];
      const match = ordered.find((option) =>
        option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()),
      );
      if (match) focusOption(match.value);
    }
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const option = event.key === "ArrowDown"
        ? enabledOptions[0]
        : enabledOptions.at(-1);
      if (option) focusOption(option.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    }
  };

  const menuStyle = menuPosition
    ? ({
        "--select-menu-max-height": `${menuPosition.maxHeight}px`,
        bottom: menuPosition.bottom,
        left: menuPosition.left,
        top: menuPosition.top,
        width: menuPosition.width,
        zIndex: menuPosition.zIndex,
      } as CSSProperties)
    : undefined;

  return (
    <div
      className={["select-menu", `select-menu-${size}`, className]
        .filter(Boolean)
        .join(" ")}
      data-open={isOpen || undefined}
      ref={rootRef}
    >
      <button
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={label}
        className="select-menu-trigger"
        disabled={disabled}
        id={controlId}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        ref={triggerRef}
        role="combobox"
        title={title}
        type="button"
      >
        <span className="select-menu-trigger-copy">
          {leadingIcon ? (
            <span aria-hidden="true" className="select-menu-leading-icon">
              {leadingIcon}
            </span>
          ) : null}
          <OptionVisual
            icon={selectedOption?.icon}
            iconClassName="select-menu-trigger-icon"
            leading={selectedOption?.leading}
            leadingClassName="select-menu-trigger-leading"
          />
          <span
            className={`select-menu-value${selectedOption ? "" : " is-placeholder"}`}
          >
            {selectedOption?.label ?? placeholder ?? label}
          </span>
        </span>
        {hideChevron ? null : (
          <ChevronDown
            aria-hidden="true"
            className="select-menu-chevron"
            size={15}
            strokeWidth={1.9}
          />
        )}
      </button>
      {isOpen && menuPosition
        ? createPortal(
            <div
              className={`select-menu-popover select-menu-popover-${size}`}
              ref={menuRef}
              style={menuStyle}
            >
              {searchable ? (
                <label className="select-menu-search">
                  <Search aria-hidden="true" size={15} strokeWidth={1.9} />
                  <input
                    aria-label={searchPlaceholder}
                    autoComplete="off"
                    onChange={(event) => setSearchQuery(event.currentTarget.value)}
                    onKeyDown={onSearchKeyDown}
                    placeholder={searchPlaceholder}
                    ref={searchInputRef}
                    type="search"
                    value={searchQuery}
                  />
                </label>
              ) : null}
              <div
                aria-label={label}
                className="select-menu-options"
                id={listboxId}
                role="listbox"
              >
                {filteredOptions.map((option) => (
                  <button
                    aria-disabled={option.disabled || undefined}
                    aria-selected={option.value === value}
                    className="select-menu-option"
                    data-value={option.value}
                    disabled={option.disabled}
                    key={option.value}
                    onClick={() => selectValue(option.value)}
                    onKeyDown={(event) => onOptionKeyDown(event, option.value)}
                    ref={(node) => {
                      if (node) optionRefs.current.set(option.value, node);
                      else optionRefs.current.delete(option.value);
                    }}
                    role="option"
                    type="button"
                  >
                    <OptionVisual
                      icon={option.icon}
                      iconClassName="select-menu-option-icon"
                      leading={option.leading}
                      leadingClassName="select-menu-option-leading"
                    />
                    <span className="select-menu-option-copy">
                      <strong>{option.label}</strong>
                      {option.description ? <small>{option.description}</small> : null}
                    </span>
                    <Check
                      aria-hidden="true"
                      className="select-menu-check"
                      size={15}
                      strokeWidth={1.9}
                    />
                  </button>
                ))}
                {filteredOptions.length === 0 ? (
                  <p className="select-menu-empty">{searchEmptyMessage}</p>
                ) : null}
              </div>
            </div>,
            menuPosition.portalContainer,
          )
        : null}
    </div>
  );
}
