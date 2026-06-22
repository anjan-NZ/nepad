export interface DragReorderOptions {
  handleSelector?: string;
  orientation?: "vertical" | "horizontal";
}

export function enableDragReorder(
  container: HTMLElement,
  itemSelector: string,
  getId: (el: HTMLElement) => string,
  onReorder: (orderedIds: string[]) => void,
  options: DragReorderOptions = {},
): void {
  const { handleSelector, orientation = "vertical" } = options;
  const isHorizontal = orientation === "horizontal";

  const pos = (rect: DOMRect) => (isHorizontal ? rect.left : rect.top);
  const end = (rect: DOMRect) => (isHorizontal ? rect.right : rect.bottom);
  const coord = (e: PointerEvent) => (isHorizontal ? e.clientX : e.clientY);

  const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));

  for (const item of items) {
    const handle = (handleSelector && item.querySelector<HTMLElement>(handleSelector)) || item;
    handle.style.touchAction = "none";

    handle.addEventListener("pointerdown", (downEvent) => {
      if (downEvent.button !== 0) return;

      const pointerId = downEvent.pointerId;
      const startCoord = coord(downEvent);
      const DRAG_THRESHOLD = 4;
      let moved = false;

      function onMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        if (!moved) {
          if (Math.abs(coord(moveEvent) - startCoord) < DRAG_THRESHOLD) return;
          handle.setPointerCapture(pointerId);
          item.classList.add("dragging");
          moved = true;
        }

        const cursor = coord(moveEvent);
        const siblings = Array.from(
          container.querySelectorAll<HTMLElement>(itemSelector),
        ).filter((el) => el !== item);

        for (const sib of siblings) {
          const rect = sib.getBoundingClientRect();
          if (cursor < pos(rect) || cursor > end(rect)) continue;
          const itemRect = item.getBoundingClientRect();
          if (cursor < pos(itemRect)) sib.before(item);
          else sib.after(item);
          break;
        }
      }

      function onUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) return;
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        item.classList.remove("dragging");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (moved) {
          const ordered = Array.from(
            container.querySelectorAll<HTMLElement>(itemSelector),
          ).map(getId);
          onReorder(ordered);
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }
}
