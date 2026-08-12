const SUBMIT_CONTROL_SELECTOR = [
  "button:not([type])",
  'button[type="submit"]',
  'input[type="submit"]',
  'input[type="image"]',
].join(",");

/**
 * Cloudflare OS deliberately omits `allow-forms` from its sandbox. Keep the
 * sandbox closed while translating trusted in-app submit controls into a
 * cancellable submit event that React can handle over the RPC capability.
 */
export function installFormSubmitBridge(document: Document): () => void {
  const view = document.defaultView;
  if (!view) return () => undefined;

  const dispatchSubmit = (
    event: Event,
    control: HTMLButtonElement | HTMLInputElement,
  ) => {
    const form = control.form;
    if (!form || control.disabled) return;

    event.preventDefault();
    if (!form.noValidate && !control.formNoValidate && !form.reportValidity()) return;

    const submitEvent = new view.SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: control,
    });
    submitEvent.preventDefault();
    form.dispatchEvent(submitEvent);
  };

  const handleClick = (event: MouseEvent) => {
    if (event.button !== 0 || !(event.target instanceof view.Element)) return;

    const control = event.target.closest<HTMLButtonElement | HTMLInputElement>(
      SUBMIT_CONTROL_SELECTOR,
    );
    if (control) dispatchSubmit(event, control);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing || event.repeat ||
        !(event.target instanceof view.HTMLInputElement) || !event.target.form) return;

    const control = event.target.form.querySelector<HTMLButtonElement | HTMLInputElement>(
      SUBMIT_CONTROL_SELECTOR,
    );
    if (control) dispatchSubmit(event, control);
  };

  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
  return () => {
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
  };
}
