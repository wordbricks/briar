export type NativeSelectOption = {
  label: string;
  value: string;
};

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
    <select
      aria-label={label}
      className={["native-select", className].filter(Boolean).join(" ")}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      value={value}
    >
      {placeholder || !value ? (
        <option disabled hidden value="">
          {placeholder ?? label}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
