import { useCallback, useEffect } from "react";

export function useUnsavedChanges(dirty: boolean, message: string): () => boolean {
  useEffect(() => {
    if (!dirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [dirty]);

  return useCallback(() => !dirty || window.confirm(message), [dirty, message]);
}
