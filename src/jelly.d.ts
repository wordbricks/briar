import type { HTMLAttributes, Key, RefAttributes } from "react";

type JellyElementProps = HTMLAttributes<HTMLElement> & RefAttributes<HTMLElement> & {
  key?: Key;
  block?: boolean;
  checked?: boolean;
  disabled?: boolean;
  label?: string;
  mode?: "light" | "dark" | "auto";
  name?: string;
  placeholder?: string;
  selected?: boolean;
  shape?: "pill" | "square";
  size?: "small" | "medium" | "large";
  type?: "button" | "submit" | "reset" | string;
  value?: string;
  variant?: "white" | "rose" | "amber" | "azure" | "mint" | "platinum" | "graphite";
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "jelly-alert": JellyElementProps;
      "jelly-badge": JellyElementProps;
      "jelly-button": JellyElementProps;
      "jelly-card": JellyElementProps;
      "jelly-input": JellyElementProps;
      "jelly-option": JellyElementProps;
      "jelly-progress": JellyElementProps & { max?: string | number };
      "jelly-select": JellyElementProps;
      "jelly-spinner": JellyElementProps;
      "jelly-switch": JellyElementProps;
      "jelly-theme": JellyElementProps;
    }
  }
}
