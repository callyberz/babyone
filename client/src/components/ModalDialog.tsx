import { useEffect, useRef } from "react";
import type { FormHTMLAttributes } from "react";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function keepFocusInDialog(
  event: KeyboardEvent,
  dialog: HTMLElement | null,
): void {
  if (event.key !== "Tab" || !dialog) return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
  );
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (!dialog.contains(active) || !focusable.includes(active as HTMLElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

type ModalDialogProps = Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "aria-modal" | "role"
> & {
  busy: boolean;
  onClose: () => void;
};

export function ModalDialog({
  busy,
  onClose,
  className = "modal",
  tabIndex = -1,
  ...formProps
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  busyRef.current = busy;
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      keepFocusInDialog(event, dialogRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busyRef.current) {
          onCloseRef.current();
        }
      }}
    >
      <form
        {...formProps}
        className={className}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={tabIndex}
      />
    </div>
  );
}
