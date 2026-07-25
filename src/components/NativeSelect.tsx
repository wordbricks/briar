import { SelectMenu, type SelectMenuOption } from "./SelectMenu";

export type NativeSelectOption = SelectMenuOption;

export function NativeSelect({
  className,
  label,
  onValueChange,
  options,
  placeholder,
  value,
}: {
  className?: string;
  label: string;
  onValueChange: (value: string) => void;
  options: NativeSelectOption[];
  placeholder?: string;
  value: string;
}) {
  return (
    <SelectMenu
      className={["native-select", className].filter(Boolean).join(" ")}
      label={label}
      onValueChange={onValueChange}
      options={options}
      placeholder={placeholder}
      size="large"
      value={value}
    />
  );
}
