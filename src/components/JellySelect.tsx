import { useEffect, useRef } from "react";

type SelectElement = HTMLElement & {
  syncOptions: () => void;
  value: string;
};

export type JellySelectOption = {
  label: string;
  value: string;
};

export function JellySelect({
  className,
  label,
  onValueChange,
  options,
  placeholder,
  size = "medium",
  value,
}: {
  className?: string;
  label: string;
  onValueChange: (value: string) => void;
  options: JellySelectOption[];
  placeholder?: string;
  size?: "small" | "medium" | "large";
  value: string;
}) {
  const selectRef = useRef<SelectElement | null>(null);
  const onValueChangeRef = useRef(onValueChange);

  useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  useEffect(() => {
    const select = selectRef.current;
    if (!select) return;
    const handleChange = () => onValueChangeRef.current(select.value);
    select.addEventListener("change", handleChange);
    return () => select.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const select = selectRef.current;
    if (!select) return;
    const optionElements = select.querySelectorAll("jelly-option");
    optionElements.forEach((optionElement, index) => {
      const option = options[index];
      if (option) optionElement.setAttribute("value", option.value);
    });
    select.syncOptions();
    if (select.value !== value) select.value = value;
  });

  return (
    <jelly-select
      className={className}
      label={label}
      placeholder={placeholder}
      ref={selectRef}
      size={size}
    >
      {options.map((option) => (
        <jelly-option key={option.value}>
          {option.label}
        </jelly-option>
      ))}
    </jelly-select>
  );
}
