import { ArrowRight, Bot, CheckCircle2, Link2Off, ShieldCheck, UserRound } from "lucide-react";
import { collectiveTemplate, type CollectiveTemplateKey } from "@guild-os/domain";
import type { UiMemberBootstrapState } from "../../src/management-types";
import { localizeTemplate } from "../collective-language";
import { useI18n } from "../i18n";

export function InitializationCompletePage({
  bootstrap,
  templateKey,
  customized,
  onContinue,
}: {
  bootstrap: UiMemberBootstrapState;
  templateKey: CollectiveTemplateKey;
  customized: boolean;
  onContinue(): void;
}) {
  const { locale, t } = useI18n();
  const template = localizeTemplate(collectiveTemplate(templateKey), locale);

  return (
    <main className="access-layout initialization-complete-layout">
      <header className="access-header">
        <div className="brand-mark" aria-hidden="true"><ShieldCheck size={22} /></div>
        <div>
          <span>{t("app.name")}</span>
          <strong>{bootstrap.guildName}</strong>
        </div>
      </header>
      <section className="access-panel initialization-complete-panel">
        <div className="access-symbol initialization-complete-symbol"><CheckCircle2 size={29} /></div>
        <h1>{t("initialization.completeTitle")}</h1>
        <p>{t("initialization.completeDescription")}</p>
        <dl className="initialization-receipt">
          <div>
            <UserRound size={18} aria-hidden="true" />
            <dt>{t("initialization.completeProfile")}</dt>
            <dd>{customized ? t("initialization.customProfileName") : template.name}</dd>
          </div>
          <div>
            <ShieldCheck size={18} aria-hidden="true" />
            <dt>{t("initialization.completeOwner")}</dt>
            <dd>{bootstrap.rootOwnerDisplayName}</dd>
          </div>
          <div>
            <Bot size={18} aria-hidden="true" />
            <dt>{t("initialization.completeAgent")}</dt>
            <dd>{template.suggestedAgent
              ? t("initialization.completeAgentReady")
              : t("initialization.completeAgentNone")}</dd>
          </div>
          <div>
            <Link2Off size={18} aria-hidden="true" />
            <dt>{t("initialization.completeConnections")}</dt>
            <dd>{t("initialization.completeConnectionsValue")}</dd>
          </div>
        </dl>
        <button className="primary-button initialization-complete-action" type="button" onClick={onContinue}>
          <span>{t("initialization.completeContinue")}</span><ArrowRight size={17} />
        </button>
      </section>
    </main>
  );
}
