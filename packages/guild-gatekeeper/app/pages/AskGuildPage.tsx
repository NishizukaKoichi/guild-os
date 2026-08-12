import {
  BookOpen,
  CheckCircle2,
  Lightbulb,
  ListTodo,
  LoaderCircle,
  Play,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import type { AskGuildResponse, GuildUiApi } from "../../src/management-types";
import type { AppPage } from "../components/AppShell";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

export function AskGuildPage({ api, onOpenCitation, onNavigate }: {
  api: GuildUiApi;
  onOpenCitation(memoryId: string, governed: boolean): void;
  onNavigate(page: AppPage): void;
}) {
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<"ask" | "plan" | "act">("ask");
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<AskGuildResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResponse(await api.askGuild({ question, locale }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={t("ask.title")} subtitle={t("ask.subtitle")} />
      <div className="ask-mode-control segmented-control" role="group" aria-label={t("ask.modeLabel")}>
        {(["ask", "plan", "act"] as const).map((value) => (
          <button className={mode === value ? "segment-active" : ""} type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
            {value === "ask" ? <Search size={16} /> : value === "plan" ? <Lightbulb size={16} /> : <Play size={16} />}
            <span>{t(`ask.mode.${value}`)}</span>
          </button>
        ))}
      </div>
      {mode === "ask" ? <form className="ask-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="ask-guild-question">{t("ask.question")}</label>
        <div className="ask-input-row">
          <Search size={19} aria-hidden="true" />
          <textarea
            id="ask-guild-question"
            required
            rows={3}
            maxLength={500}
            value={question}
            placeholder={t("ask.placeholder")}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="primary-button" type="submit" disabled={busy || !question.trim()}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
            <span>{t("ask.submit")}</span>
          </button>
        </div>
      </form> : mode === "plan" ? (
        <section className="ask-mode-panel">
          <div className="ask-mode-heading"><Lightbulb size={22} /><div><h2>{t("ask.planTitle")}</h2><p>{t("ask.planDescription")}</p></div></div>
          <div className="ask-mode-actions">
            <button type="button" onClick={() => onNavigate("activity")}><ListTodo size={20} /><span><strong>{t("ask.planActivity")}</strong><small>{t("ask.planActivityDescription")}</small></span></button>
            <button type="button" onClick={() => onNavigate("knowledge")}><BookOpen size={20} /><span><strong>{t("ask.planMemory")}</strong><small>{t("ask.planMemoryDescription")}</small></span></button>
            <button type="button" onClick={() => onNavigate("decisions")}><CheckCircle2 size={20} /><span><strong>{t("ask.planDecision")}</strong><small>{t("ask.planDecisionDescription")}</small></span></button>
          </div>
        </section>
      ) : (
        <section className="ask-mode-panel">
          <div className="ask-mode-heading"><ShieldCheck size={22} /><div><h2>{t("ask.actTitle")}</h2><p>{t("ask.actDescription")}</p></div></div>
          <Notice>{t("ask.actSafety")}</Notice>
          <div className="ask-mode-actions">
            <button type="button" onClick={() => onNavigate("members")}><Play size={20} /><span><strong>{t("ask.actRuns")}</strong><small>{t("ask.actRunsDescription")}</small></span></button>
            <button type="button" onClick={() => onNavigate("inbox")}><CheckCircle2 size={20} /><span><strong>{t("ask.actApprovals")}</strong><small>{t("ask.actApprovalsDescription")}</small></span></button>
          </div>
        </section>
      )}
      {mode === "ask" && error ? <Notice kind="error">{error}</Notice> : null}
      {mode === "ask" && !response ? (
        <div className="ask-empty">
          <BookOpen size={24} />
          <p>{t("ask.empty")}</p>
          <div className="ask-suggestions" aria-label={t("ask.suggestionsTitle")}>
            <span>{t("ask.suggestionsTitle")}</span>
            {[t("ask.suggestionOne"), t("ask.suggestionTwo"), t("ask.suggestionThree")].map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => setQuestion(suggestion)}>{suggestion}</button>
            ))}
          </div>
        </div>
      ) : mode === "ask" && response ? (
        <div className="ask-result">
          <section className="ask-answer" aria-live="polite">
            <h2>{t("ask.answer")}</h2>
            <p>{response.answer}</p>
            {response.inferred ? <Notice>{t("ask.inference")}</Notice> : null}
          </section>
          <aside className="ask-sources">
            <h2>{t("ask.sources")}</h2>
            {response.citations.length === 0 ? <p>{t("ask.noSources")}</p> : (
              <div className="ask-source-list">
                {response.citations.map((citation, index) => (
                  <button type="button" key={`${citation.memoryId}-${citation.version}`} onClick={() => onOpenCitation(citation.memoryId, citation.governed)}>
                    <span>M{index + 1}</span>
                    <div>
                      <strong>{citation.title}</strong>
                      <p>{citation.summary}</p>
                      <small>v{citation.version}</small>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}
