import { useRef, useState, type PointerEvent } from "react";

interface Props {
  /** "vertical" divides left and right; "horizontal" divides top and bottom. */
  orientation: "vertical" | "horizontal";
  /** Called with the pointer position relative to the container, in pixels. */
  onDrag: (position: number, size: number) => void;
  label: string;
}

/** A 1px divider with a wider invisible grab area, dragged with the pointer. */
export function Splitter({ orientation, onDrag, label }: Props) {
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLElement | null>(null);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const parent = container.current;
    if (!dragging || !parent) return;
    const box = parent.getBoundingClientRect();
    const vertical = orientation === "vertical";
    onDrag(
      vertical ? event.clientX - box.left : event.clientY - box.top,
      vertical ? box.width : box.height,
    );
  };

  return (
    <div
      className={`splitter ${orientation}${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation={orientation === "vertical" ? "vertical" : "horizontal"}
      aria-label={label}
      onPointerDown={(event) => {
        container.current = event.currentTarget.parentElement;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
      }}
    />
  );
}
