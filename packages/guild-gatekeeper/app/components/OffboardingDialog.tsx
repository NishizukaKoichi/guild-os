import { LogOut, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type {
  OffboardActorRequest,
  UiDirectory,
  UiDirectoryIdentity,
} from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

export function OffboardingDialog({ identity, directory, onClose, onOffboard }: {
  identity: UiDirectoryIdentity;
  directory: UiDirectory;
  onClose(): void;
  onOffboard(input: OffboardActorRequest): Promise<void>;
}) {
  const { t } = useI18n();
  const [successorActorId, setSuccessorActorId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const successors = useMemo(() => directory.identities.filter((candidate) =>
    candidate.id !== identity.id && candidate.status === "active" &&
    candidate.membershipState === "active"), [directory.identities, identity.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onOffboard({
        actorId: identity.id,
        successorActorId: successorActorId || null,
        reason: reason.trim(),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="offboarding-title">
        <header className="dialog-header">
          <div>
            <h2 id="offboarding-title">{t("offboarding.title")}</h2>
            <p>{identity.displayName}</p>
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={submit}>
          <Notice kind="warning">{t("offboarding.warning")}</Notice>
          <label>
            <span>{t("offboarding.successor")}</span>
            <select value={successorActorId} onChange={(event) => setSuccessorActorId(event.target.value)}>
              <option value="">{t("offboarding.noSuccessor")}</option>
              {successors.map((successor) => (
                <option key={successor.id} value={successor.id}>{successor.displayName}</option>
              ))}
            </select>
            <small>{t("offboarding.successorHelp")}</small>
          </label>
          <label>
            <span>{t("offboarding.reason")}</span>
            <textarea required maxLength={5_000} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("offboarding.reasonPlaceholder")} />
          </label>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="danger-button text-button" type="submit" disabled={submitting || !reason.trim()}>
              <LogOut size={17} />
              <span>{t("offboarding.confirm")}</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
