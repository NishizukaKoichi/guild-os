import { useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(isVisible);
}

function closeControl(dialog: HTMLElement): HTMLButtonElement | null {
  return dialog.querySelector<HTMLButtonElement>("[data-dialog-close]") ??
    dialog.querySelector<HTMLButtonElement>(".dialog-header .icon-button:not([disabled])") ??
    dialog.querySelector<HTMLButtonElement>(".dialog-actions .secondary-button:not([disabled])");
}

/**
 * Existing Guild dialogs share a stable DOM convention but predate a shared dialog component.
 * This manager supplies one focus lifecycle without changing any authority or submit behavior.
 */
export function DialogAccessibilityManager() {
  useEffect(() => {
    let activeDialog: HTMLElement | null = null;
    let returnFocus: HTMLElement | null = null;
    let lastFocusOutsideDialog: HTMLElement | null = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    let focusFrame = 0;

    function topDialog(): HTMLElement | null {
      const dialogs = [...document.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true']")]
        .filter(isVisible);
      return dialogs.at(-1) ?? null;
    }

    function synchronizeDialog(): void {
      const nextDialog = topDialog();
      if (nextDialog === activeDialog) return;

      if (nextDialog) {
        if (!activeDialog) {
          const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          returnFocus = focused && !nextDialog.contains(focused) ? focused : lastFocusOutsideDialog;
        }
        activeDialog = nextDialog;
        document.body.classList.add("modal-open");
        window.cancelAnimationFrame(focusFrame);
        focusFrame = window.requestAnimationFrame(() => {
          if (!activeDialog || activeDialog.contains(document.activeElement)) return;
          const autofocus = activeDialog.querySelector<HTMLElement>("[autofocus]");
          const target = autofocus && isVisible(autofocus)
            ? autofocus
            : focusableElements(activeDialog)[0] ?? activeDialog;
          if (target === activeDialog && !activeDialog.hasAttribute("tabindex")) {
            activeDialog.setAttribute("tabindex", "-1");
          }
          target.focus({ preventScroll: true });
        });
        return;
      }

      activeDialog = null;
      document.body.classList.remove("modal-open");
      window.cancelAnimationFrame(focusFrame);
      const target = returnFocus?.isConnected
        ? returnFocus
        : document.querySelector<HTMLElement>("[data-page-title]") ??
          document.querySelector<HTMLElement>("#main-content");
      target?.focus({ preventScroll: true });
      returnFocus = null;
    }

    function rememberOutsideFocus(event: FocusEvent): void {
      if (!(event.target instanceof HTMLElement)) return;
      const dialog = topDialog();
      if (!dialog || !dialog.contains(event.target)) lastFocusOutsideDialog = event.target;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      const dialog = topDialog();
      if (!dialog) return;
      activeDialog = dialog;

      if (event.key === "Escape") {
        const close = closeControl(dialog);
        if (!close) return;
        event.preventDefault();
        event.stopPropagation();
        close.click();
        return;
      }

      if (event.key !== "Tab") return;
      const elements = focusableElements(dialog);
      if (!elements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = elements[0]!;
      const last = elements.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const root = document.getElementById("root") ?? document.body;
    const observer = new MutationObserver(synchronizeDialog);
    observer.observe(root, { childList: true, subtree: true });
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", rememberOutsideFocus, true);
    synchronizeDialog();

    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", rememberOutsideFocus, true);
      window.cancelAnimationFrame(focusFrame);
      document.body.classList.remove("modal-open");
    };
  }, []);

  return null;
}
