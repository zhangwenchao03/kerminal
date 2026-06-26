import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MachineSidebar } from "./MachineSidebar";
import {
  mockElementFromPoint,
  remoteSidebarGroups,
} from "./__tests__/support/MachineSidebar.testSupport";

describe("MachineSidebar external drag target", () => {
  it("lets an external target consume a dragged machine without moving groups", () => {
    const onExternalMachineDrag = vi.fn(() => ({
      hint: "松开分屏到右侧",
    }));
    const onExternalMachineDragEnd = vi.fn();
    const onExternalMachineDrop = vi.fn(() => true);
    const onMoveMachine = vi.fn();
    const restoreElementFromPoint = mockElementFromPoint(document.body);

    try {
      render(
        <MachineSidebar
          groups={remoteSidebarGroups}
          onExternalMachineDrag={onExternalMachineDrag}
          onExternalMachineDragEnd={onExternalMachineDragEnd}
          onExternalMachineDrop={onExternalMachineDrop}
          onMoveMachine={onMoveMachine}
          onSearchChange={vi.fn()}
          onSelectMachine={vi.fn()}
          search=""
          selectedMachineId="ubuntu-dev"
        />,
      );

      fireEvent.pointerDown(screen.getByRole("button", { name: /ubuntu-dev/i }), {
        button: 0,
        clientX: 12,
        clientY: 12,
        pointerId: 1,
      });
      fireEvent.pointerMove(window, {
        clientX: 120,
        clientY: 48,
        pointerId: 1,
      });

      expect(screen.getByRole("status", { name: "正在拖动主机" })).toHaveTextContent(
        "松开分屏到右侧",
      );

      fireEvent.pointerUp(window, {
        clientX: 120,
        clientY: 48,
        pointerId: 1,
      });

      expect(onExternalMachineDrag).toHaveBeenCalledWith(
        expect.objectContaining({ clientX: 120, machine: expect.objectContaining({ id: "ubuntu-dev" }) }),
      );
      expect(onExternalMachineDrop).toHaveBeenCalledWith(
        expect.objectContaining({ clientY: 48, machine: expect.objectContaining({ id: "ubuntu-dev" }) }),
      );
      expect(onExternalMachineDragEnd).toHaveBeenCalled();
      expect(onMoveMachine).not.toHaveBeenCalled();
    } finally {
      restoreElementFromPoint();
    }
  });
});
