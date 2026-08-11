import { BookOpenCheck, Database, Fingerprint, History, ShieldCheck, UserRoundCheck, Users } from "lucide-react";
import type { UiBootstrapState, UiDirectory } from "../../src/management-types";
import { PageHeader } from "../components/PageHeader";
import { membershipTranslationKey, useI18n } from "../i18n";

export function HomePage({ bootstrap, directory }: {
  bootstrap: UiBootstrapState;
  directory: UiDirectory | null;
}) {
  const { t } = useI18n();
  const pendingInvitations = directory?.invitations.filter((invitation) => invitation.state === "pending").length ?? 0;
  const next = bootstrap.membershipState === "preboarding"
    ? t("home.nextPreboarding")
    : t("home.nextActive");

  return (
    <>
      <PageHeader title={t("home.title")} subtitle={t("home.subtitle")} />

      <section className="metric-strip" aria-label={t("home.title")}>
        <div>
          <Fingerprint size={18} />
          <span>{t("home.membership")}</span>
          <strong>{t(membershipTranslationKey(bootstrap.membershipState))}</strong>
        </div>
        <div>
          <UserRoundCheck size={18} />
          <span>{t("home.rootOwner")}</span>
          <strong>{bootstrap.rootOwner ? t("home.rootOwnerYes") : t("home.rootOwnerNo")}</strong>
        </div>
        {directory ? (
          <>
            <div><Users size={18} /><span>{t("home.memberCount")}</span><strong>{directory.identities.length}</strong></div>
            <div><BookOpenCheck size={18} /><span>{t("home.pendingInvites")}</span><strong>{pendingInvitations}</strong></div>
          </>
        ) : null}
      </section>

      <section className="content-section">
        <h2>{t("home.nextTitle")}</h2>
        <p className="lead-row"><ShieldCheck size={20} />{next}</p>
      </section>

      <section className="content-section">
        <div className="definition-list">
          <div>
            <Database size={18} />
            <dt>{t("home.guildBoundary")}</dt>
            <dd>{t("home.guildBoundaryValue")}</dd>
          </div>
          <div>
            <History size={18} />
            <dt>{t("home.history")}</dt>
            <dd>{t("home.historyValue")}</dd>
          </div>
        </div>
      </section>
    </>
  );
}
