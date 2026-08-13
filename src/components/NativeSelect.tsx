import { SelectMenu, type SelectMenuOption } from "./SelectMenu";

export type NativeSelectOption = SelectMenuOption;

export function NativeSelect({
  className,
  disabled,
  label,
  onValueChange,
  options,
  placeholder,
  searchEmptyMessage,
  searchPlaceholder,
  searchable,
  value,
}: {
  className?: string;
  disabled?: boolean;
  label: string;
  onValueChange: (value: string) => void;
  options: NativeSelectOption[];
  placeholder?: string;
  searchEmptyMessage?: string;
  searchPlaceholder?: string;
  searchable?: boolean;
  value: string;
}) {
  return (
    <SelectMenu
      className={["native-select", className].filter(Boolean).join(" ")}
      disabled={disabled}
      label={label}
      onValueChange={onValueChange}
      options={options}
      placeholder={placeholder}
      searchEmptyMessage={searchEmptyMessage}
      searchPlaceholder={searchPlaceholder}
      searchable={searchable}
      size="large"
      value={value}
    />
  );
}
