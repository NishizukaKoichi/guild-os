import {
  Bot,
  BookOpen,
  ListTodo,
  Scale,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { CollectiveTemplate } from "@guild-os/domain";
import {
  activityTypeLabel,
  decisionMethodLabel,
  memoryTypeLabel,
} from "../collective-language";
import { useI18n } from "../i18n";

export function ContextProfilePreview({
  template,
  showDescription = true,
}: {
  template: CollectiveTemplate;
  showDescription?: boolean;
}) {
  const { locale, t } = useI18n();

  return (
    <section className="context-profile-preview" aria-label={t("collective.profilePreview")}>
      <header>
        <div>
          <span>{t("collective.profilePreview")}</span>
          <h3>{template.name}</h3>
        </div>
        {showDescription ? <p>{template.description}</p> : null}
      </header>
      <dl className="context-profile-grid">
        <div>
          <dt><ShieldCheck size={16} />{t("collective.initialRoles")}</dt>
          <dd>{template.roles.map((role) => <span key={role.name}>{role.name}</span>)}</dd>
        </div>
        <div>
          <dt><ListTodo size={16} />{t("collective.activityTypes")}</dt>
          <dd>{template.activityTypes.map((type) => (
            <span key={type}>{activityTypeLabel(type, locale)}</span>
          ))}</dd>
        </div>
        <div>
          <dt><BookOpen size={16} />{t("collective.memoryTypes")}</dt>
          <dd>{template.memoryTypes.map((type) => (
            <span key={type}>{memoryTypeLabel(type, locale)}</span>
          ))}</dd>
        </div>
        <div>
          <dt><Scale size={16} />{t("collective.decisionMethods")}</dt>
          <dd>{template.decisionMethods.map((method) => (
            <span key={method}>{decisionMethodLabel(method, locale)}</span>
          ))}</dd>
        </div>
        <div>
          <dt><Workflow size={16} />{t("collective.workflows")}</dt>
          <dd>{template.workflows.length
            ? template.workflows.map((workflow) => <span key={workflow.key}>{workflow.name}</span>)
            : <span>{t("collective.noWorkflow")}</span>}</dd>
        </div>
        <div>
          <dt><Bot size={16} />{t("collective.suggestedAgent")}</dt>
          <dd><span>{template.suggestedAgent ?? t("collective.noSuggestedAgent")}</span></dd>
        </div>
      </dl>
    </section>
  );
}
