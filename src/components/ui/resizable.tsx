import {
  Group,
  Panel,
  Separator,
  type GroupProps,
  type Orientation,
  type PanelProps,
  type SeparatorProps,
} from "react-resizable-panels";
import { cn } from "../../lib/cn";

type ResizableGroupProps = Omit<GroupProps, "orientation"> & {
  direction?: Orientation;
};

export function ResizablePanelGroup({
  className,
  direction = "horizontal",
  ...props
}: ResizableGroupProps) {
  return (
    <Group
      className={cn("flex h-full w-full", className)}
      orientation={direction}
      {...props}
    />
  );
}

export function ResizablePanel(props: PanelProps) {
  return <Panel {...props} />;
}

export function ResizableHandle({
  className,
  ...props
}: SeparatorProps) {
  return (
    <Separator
      className={cn(
        "group relative flex items-center justify-center bg-transparent outline-none transition focus-visible:ring-4 focus-visible:ring-sky-500/20",
        "h-full w-2 aria-[orientation=horizontal]:h-2 aria-[orientation=horizontal]:w-full aria-[orientation=vertical]:h-full aria-[orientation=vertical]:w-2",
        className,
      )}
      {...props}
    >
      <span className="block h-10 w-px rounded-full bg-white/12 transition group-hover:bg-sky-400/60 group-focus-visible:bg-sky-400 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-10 aria-[orientation=vertical]:h-10 aria-[orientation=vertical]:w-px" />
    </Separator>
  );
}
