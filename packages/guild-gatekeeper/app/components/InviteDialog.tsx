import { Send, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type {
  IssueInvitationInput,
  UiDirectory,
} from "../../src/management-types";
import { Notice } from "./Notice";
import { useI18n } from "../i18n";

export function InviteDialog({ directory, onClose, onIssue }: {
  directory: UiDirectory;
  onClose(): void;
  onIssue(input: IssueInvitationInput): Promise<void>;
}) {
  const { t } = useI18n();
  const firstRole = directory.roles[0]?.id ?? "";
  const [inviteeLabel, setInviteeLabel] = useState("");
  const [roleId, setRoleId] = useState(firstRole);
  const [spaceId, setSpaceId] = useState("");
  const [initialMembershipState, setInitialMembershipState] = useState<"preboarding" | "active">("preboarding");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeSpaces = useMemo(
    () => directory.spaces.filter((space) => space.status === "active"),
    [directory.spaces],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onIssue({
        inviteeLabel: inviteeLabel.trim(),
        roleId,
        spaceId: spaceId || null,
        initialMembershipState,
        expiresInDays,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <header className="dialog-header">
          <h2 id="invite-title">{t("people.inviteTitle")}</h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={submit}>
          <label>
            <span>{t("people.inviteeLabel")}</span>
            <input
              required
              autoFocus
              maxLength={200}
              placeholder={t("people.inviteePlaceholder")}
              value={inviteeLabel}
              onChange={(event) => setInviteeLabel(event.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              <span>{t("people.role")}</span>
              <select required value={roleId} onChange={(event) => setRoleId(event.target.value)}>
                {directory.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
            <label>
              <span>{t("people.space")}</span>
              <select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}>
                <option value="">{t("people.global")}</option>
                {activeSpaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
              </select>
            </label>
          </div>
          <fieldset>
            <legend>{t("people.initialState")}</legend>
            <div className="segmented-control">
              {(["preboarding", "active"] as const).map((state) => (
                <label key={state} className={initialMembershipState === state ? "segment segment-active" : "segment"}>
                  <input
                    type="radio"
                    name="initialMembershipState"
                    value={state}
                    checked={initialMembershipState === state}
                    onChange={() => setInitialMembershipState(state)}
                  />
                  <span>{t(state === "preboarding" ? "membership.preboarding" : "membership.active")}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            <span>{t("people.expiry")}</span>
            <div className="number-field">
              <input
                type="number"
                min={1}
                max={90}
                step={1}
                required
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(Number(event.target.value))}
              />
              <span>{t("common.days")}</span>
            </div>
          </label>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={submitting || !roleId}>
              <Send size={17} />
              <span>{t("people.issue")}</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
