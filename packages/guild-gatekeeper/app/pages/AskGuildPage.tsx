import { BookOpen, LoaderCircle, Search, Send } from "lucide-react";
import { useState } from "react";
import type { AskGuildResponse, GuildUiApi } from "../../src/management-types";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

export function AskGuildPage({ api, onOpenKnowledge }: {
  api: GuildUiApi;
  onOpenKnowledge(knowledgeId: string): void;
}) {
  const { locale, t } = useI18n();
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
      <form className="ask-form" onSubmit={(event) => void submit(event)}>
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
      </form>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {!response ? (
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
      ) : (
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
                  <button type="button" key={`${citation.knowledgeId}-${citation.version}`} onClick={() => onOpenKnowledge(citation.knowledgeId)}>
                    <span>K{index + 1}</span>
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
      )}
    </>
  );
}
