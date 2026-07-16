import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../../lib/cn";

export interface SelectOption {
  description?: string;
  disabled?: boolean;
  label: string;
  value: string;
}

interface SelectProps {
  "aria-label": string;
  align?: "left" | "right";
  buttonClassName?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  menuClassName?: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  side?: "bottom" | "top";
  size?: "sm" | "md";
  value: string;
  variant?: "field" | "inline";
}

const baseButtonClassName =
  "kerminal-focus-ring group inline-flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border text-left font-medium outline-none transition-[background-color,border-color,box-shadow,transform,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]";

const variantClassNames = {
  field: "kerminal-field-surface text-zinc-950 dark:text-zinc-100",
  inline:
    "border-transparent bg-transparent text-current shadow-none hover:bg-[var(--surface-hover)]",
};

const sizeClassNames = {
  md: "h-9 px-3 text-sm",
  sm: "h-8 px-2.5 text-xs",
};

export function Select({
  "aria-label": ariaLabel,
  align = "left",
  buttonClassName,
  className,
  disabled = false,
  id,
  menuClassName,
  onValueChange,
  options,
  placeholder = "请选择",
  side = "bottom",
  size = "md",
  value,
  variant = "field",
}: SelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const [highlightedIndex, setHighlightedIndex] = useState(
    Math.max(selectedIndex, 0),
  );
  const selectedOption =
    selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(Math.max(selectedIndex, 0));
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, selectedIndex]);

  const moveHighlight = (direction: 1 | -1) => {
    if (options.length === 0) {
      return;
    }

    let nextIndex = highlightedIndex;
    for (let attempt = 0; attempt < options.length; attempt += 1) {
      nextIndex = (nextIndex + direction + options.length) % options.length;
      if (!options[nextIndex]?.disabled) {
        setHighlightedIndex(nextIndex);
        return;
      }
    }
  };

  const selectValue = (nextValue: string) => {
    const nextOption = options.find((option) => option.value === nextValue);
    if (!nextOption || nextOption.disabled) {
      return;
    }

    onValueChange(nextValue);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlightedIndex(Math.max(selectedIndex, 0));
        return;
      }
      moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const highlightedOption = options[highlightedIndex];
      if (highlightedOption) {
        selectValue(highlightedOption.value);
      }
    }
  };

  return (
    <div className={cn("relative min-w-0", className)} ref={rootRef}>
      <button
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-valuetext={selectedOption?.label ?? placeholder}
        className={cn(
          baseButtonClassName,
          variantClassNames[variant],
          sizeClassNames[size],
          buttonClassName,
        )}
        data-value={value}
        disabled={disabled}
        id={id}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        role="combobox"
        type="button"
      >
        <span className="min-w-0 truncate">
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-150",
            open ? "rotate-180" : "",
          )}
          strokeWidth={1.8}
        />
      </button>

      {open ? (
        <div
          className={cn(
            "kerminal-floating-surface kerminal-floating-enter kerminal-layer-popover absolute min-w-full overflow-hidden rounded-[var(--radius-card)] border p-1 text-[13px] text-[var(--text-primary)]",
            side === "top"
              ? "bottom-[calc(100%+0.375rem)] top-auto"
              : "top-[calc(100%+0.375rem)]",
            align === "right" ? "right-0" : "left-0",
            menuClassName,
          )}
          data-side={side}
          id={listboxId}
          role="listbox"
        >
          <div className="max-h-64 overflow-y-auto">
            {options.map((option, index) => {
              const selected = option.value === value;
              const highlighted = highlightedIndex === index;
              return (
                <button
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-left transition-colors duration-150",
                    highlighted || selected
                      ? "bg-[var(--surface-selected)] text-[rgb(var(--app-accent))]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
                    option.disabled
                      ? "cursor-not-allowed opacity-45 hover:bg-transparent"
                      : "",
                  )}
                  disabled={option.disabled}
                  key={option.value}
                  onClick={() => selectValue(option.value)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  role="option"
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span className="mt-0.5 block text-xs leading-4 text-zinc-500 dark:text-zinc-400">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {selected ? (
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0"
                      strokeWidth={1.8}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface SelectFieldProps {
  align?: "left" | "right";
  buttonClassName?: string;
  className?: string;
  description?: ReactNode;
  disabled?: boolean;
  id: string;
  label: string;
  menuClassName?: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  selectClassName?: string;
  side?: "bottom" | "top";
  size?: "sm" | "md";
  value: string;
  variant?: "field" | "inline";
}

export function SelectField({
  align,
  buttonClassName,
  className,
  description,
  disabled,
  id,
  label,
  menuClassName,
  onValueChange,
  options,
  placeholder,
  selectClassName,
  side,
  size,
  value,
  variant,
}: SelectFieldProps) {
  return (
    <div className={cn("block", className)}>
      <label
        className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
        htmlFor={id}
      >
        {label}
      </label>
      <Select
        align={align}
        aria-label={label}
        buttonClassName={buttonClassName}
        className={cn("mt-1", selectClassName)}
        disabled={disabled}
        id={id}
        menuClassName={menuClassName}
        onValueChange={onValueChange}
        options={options}
        placeholder={placeholder}
        side={side}
        size={size}
        value={value}
        variant={variant}
      />
      {description ? (
        <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      ) : null}
    </div>
  );
}
