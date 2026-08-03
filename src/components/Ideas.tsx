import {
  ArrowLeft,
  Archive,
  FileText,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  convertIdeaPlan,
  createIdea,
  deleteIdea,
  generateIdeaPlan,
  listIdeas,
  loadIdea,
  retryIdeaJob,
  sendIdeaMessage,
  updateIdea,
  updateIdeaPlan,
} from "../lib/api";
import {
  agentModels,
  agentProviders,
  type AgentProvider,
} from "../lib/project-llm";
import type {
  IdeaDetail,
  IdeaIssuePlanItem,
  IdeaStatus,
  IdeaSummary,
} from "../lib/ideas-contract";

const statusLabels: Record<IdeaStatus, string> = {
  draft: "초안",
  refining: "구체화 중",
  ready: "준비됨",
  issues_created: "이슈 생성됨",
  archived: "보관됨",
};

export function Ideas({
  isSidebarOpen,
  projectId,
  token,
  onIssuesCreated,
}: {
  isSidebarOpen: boolean;
  projectId: string;
  token: string | null;
  onIssuesCreated?: (runIds: string[]) => void;
}) {
  const [ideas, setIdeas] = useState<IdeaSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [idea, setIdea] = useState<IdeaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [documentDraft, setDocumentDraft] = useState("");
  const [mobilePane, setMobilePane] = useState<"chat" | "document">("chat");
  const [planDraft, setPlanDraft] = useState<IdeaIssuePlanItem[] | null>(null);

  const refreshList = useCallback(async () => {
    if (!token) return;
    const result = await listIdeas(token, projectId);
    setIdeas(result.ideas);
  }, [projectId, token]);

  const refreshIdea = useCallback(async () => {
    if (!token || !selectedId) return;
    const result = await loadIdea(token, projectId, selectedId);
    setIdea(result.idea);
    setDocumentDraft(result.idea.documentMarkdown);
    setPlanDraft(result.idea.plan?.items ?? null);
  }, [projectId, selectedId, token]);

  useEffect(() => {
    setSelectedId(null);
    setIdea(null);
    setLoading(true);
    void refreshList()
      .catch((cause) => setError(describe(cause)))
      .finally(() => setLoading(false));
  }, [refreshList]);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    void refreshIdea()
      .catch((cause) => setError(describe(cause)))
      .finally(() => setLoading(false));
  }, [refreshIdea, selectedId]);

  useEffect(() => {
    if (
      !selectedId ||
      !idea?.activeJob ||
      !["queued", "running"].includes(idea.activeJob.status)
    ) return;
    const timer = window.setInterval(() => {
      void Promise.all([refreshIdea(), refreshList()]).catch((cause) =>
        setError(describe(cause)),
      );
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [idea?.activeJob, refreshIdea, refreshList, selectedId]);

  useEffect(() => {
    if (
      !token ||
      !idea?.canEdit ||
      (idea.activeJob && ["queued", "running"].includes(idea.activeJob.status)) ||
      idea.status === "archived" ||
      documentDraft === idea.documentMarkdown
    ) {
      return;
    }
    const expectedVersion = idea.version;
    const timer = window.setTimeout(() => {
      void updateIdea(token, projectId, idea.id, {
        expectedVersion,
        documentMarkdown: documentDraft,
      })
        .then((result) => {
          setIdea(result.idea);
          setIdeas((current) =>
            current.map((item) => item.id === result.idea.id ? result.idea : item),
          );
        })
        .catch((cause) => setError(describe(cause)));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [documentDraft, idea, projectId, token]);

  const create = async () => {
    if (!token) return;
    setWorking(true);
    setError(null);
    try {
      const result = await createIdea(token, projectId, {
        provider: "codex",
        model: null,
      });
      await refreshList();
      setSelectedId(result.idea.id);
      setIdea(result.idea);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setWorking(false);
    }
  };

  if (loading && ideas.length === 0 && !idea) {
    return <IdeasLoading isSidebarOpen={isSidebarOpen} />;
  }

  if (!selectedId || !idea) {
    return (
      <main className={`ideas-page${isSidebarOpen ? "" : " sidebar-hidden"}`}>
        <header className="ideas-list-header">
          <div>
            <span className="eyebrow">PROJECT IDEAS</span>
            <h1>아이디어</h1>
            <p>대화로 구체화하고 실행 가능한 이슈로 전환하세요.</p>
          </div>
          <button className="primary-button" disabled={!token || working} onClick={create}>
            {working ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
            새 아이디어
          </button>
        </header>
        {error ? <div className="ideas-error">{error}</div> : null}
        {ideas.length === 0 ? (
          <section className="ideas-empty">
            <Lightbulb size={34} strokeWidth={1.4} />
            <h2>첫 아이디어를 시작해보세요</h2>
            <p>빈 문서에서 메시지를 보내면 에이전트가 문서를 함께 작성합니다.</p>
            <button className="primary-button" disabled={!token || working} onClick={create}>
              <Plus size={16} /> 새 아이디어
            </button>
          </section>
        ) : (
          <section className="ideas-grid" aria-label="아이디어 문서 목록">
            {ideas.map((item) => (
              <button className="idea-card" key={item.id} onClick={() => setSelectedId(item.id)}>
                <span className={`idea-status status-${item.status}`}>{statusLabels[item.status]}</span>
                <h2>{item.title}</h2>
                <p>{excerpt(item.documentMarkdown) || "아직 작성된 문서가 없습니다."}</p>
                <footer>
                  <span>{item.author.name}</span>
                  <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
                  <span>이슈 {item.generatedIssueCount}</span>
                </footer>
              </button>
            ))}
          </section>
        )}
      </main>
    );
  }

  const isActiveJob = Boolean(
    idea.activeJob && ["queued", "running"].includes(idea.activeJob.status),
  );
  const isBusy = isActiveJob || working;
  const modelOptions = agentModels[idea.provider as AgentProvider];
  return (
    <main className={`idea-detail-page${isSidebarOpen ? "" : " sidebar-hidden"}`}>
      <header className="idea-detail-header">
        <button className="icon-button" aria-label="아이디어 목록" onClick={() => {
          setSelectedId(null);
          setIdea(null);
          void refreshList();
        }}>
          <ArrowLeft size={18} />
        </button>
        <input
          aria-label="아이디어 제목"
          disabled={!idea.canEdit || isBusy || idea.status === "archived"}
          value={idea.title}
          onChange={(event) => setIdea({ ...idea, title: event.target.value })}
          onBlur={() => void saveIdeaPatch({ title: idea.title })}
        />
        <span className={`idea-status status-${idea.status}`}>{statusLabels[idea.status]}</span>
        {idea.canEdit ? (
          <>
            <select
              aria-label="LLM provider"
              disabled={isBusy || idea.status === "archived"}
              value={idea.provider}
              onChange={(event) => void saveIdeaPatch({
                provider: event.target.value as AgentProvider,
                model: null,
              })}
            >
              {agentProviders.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
            <select
              aria-label="LLM model"
              disabled={isBusy || idea.status === "archived"}
              value={idea.model ?? ""}
              onChange={(event) => void saveIdeaPatch({ model: event.target.value || null })}
            >
              {modelOptions.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
            </select>
            {idea.status !== "ready" && idea.status !== "archived" ? (
              <button className="secondary-button" disabled={isBusy || !idea.documentMarkdown.trim()} onClick={() => void markReady()}>
                준비 완료
              </button>
            ) : null}
            {idea.status === "ready" ? (
              <button className="primary-button" disabled={isBusy} onClick={() => void makePlan()}>
                <Sparkles size={15} /> 이슈 계획
              </button>
            ) : null}
            {idea.status === "issues_created" ? (
              <button
                className="secondary-button"
                disabled={isBusy}
                onClick={() => void saveIdeaPatch({ status: "archived" })}
              >
                <Archive size={15} /> 보관
              </button>
            ) : null}
            <button className="danger-icon-button" aria-label="아이디어 삭제" disabled={isBusy} onClick={() => void remove()}>
              <Trash2 size={17} />
            </button>
          </>
        ) : <span className="read-only-badge">읽기 전용</span>}
      </header>

      <div className="idea-mobile-switch" role="tablist">
        <button className={mobilePane === "chat" ? "active" : ""} onClick={() => setMobilePane("chat")}>
          <MessageSquare size={15} /> 대화
        </button>
        <button className={mobilePane === "document" ? "active" : ""} onClick={() => setMobilePane("document")}>
          <FileText size={15} /> 문서
        </button>
      </div>

      {error ? <div className="ideas-error detail-error">{error}</div> : null}
      <div className="idea-split">
        <section className={`idea-chat-pane${mobilePane === "chat" ? " mobile-active" : ""}`}>
          <div className="idea-messages">
            {idea.messages.length === 0 ? (
              <div className="idea-chat-empty">
                <Sparkles size={26} />
                <strong>무엇을 만들고 싶은지 알려주세요</strong>
                <span>대화를 나눌 때마다 오른쪽 문서가 갱신됩니다.</span>
              </div>
            ) : idea.messages.map((item) => (
              <article className={`idea-message ${item.role}`} key={item.id}>
                <small>{item.role === "user" ? idea.author.name : idea.provider}</small>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.body}</ReactMarkdown>
              </article>
            ))}
            {idea.activeJob?.kind === "chat" && isActiveJob ? (
              <div className="idea-agent-typing"><LoaderCircle className="spin" size={15} /> 문서와 답변을 작성하고 있습니다…</div>
            ) : null}
            {idea.activeJob?.status === "failed" ? (
              <div className="ideas-error idea-job-error">
                <span>{idea.activeJob.error ?? "에이전트 작업에 실패했습니다."}</span>
                {idea.canEdit ? (
                  <button disabled={working} onClick={() => void retryFailedJob()}>
                    다시 시도
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {idea.canEdit && idea.status !== "archived" ? (
            <form className="idea-composer" onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}>
              <textarea
                aria-label="아이디어 메시지"
                disabled={isBusy}
                placeholder="아이디어를 설명하거나 다음 질문에 답해주세요…"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <button aria-label="메시지 보내기" disabled={isBusy || !message.trim()} type="submit">
                <Send size={17} />
              </button>
            </form>
          ) : null}
        </section>

        <section className={`idea-document-pane${mobilePane === "document" ? " mobile-active" : ""}`}>
          <div className="document-toolbar"><FileText size={15} /> Markdown 문서 <span>{documentDraft.length.toLocaleString()}자</span></div>
          <div className="document-workspace">
            <textarea
              aria-label="아이디어 Markdown 문서"
              disabled={!idea.canEdit || isBusy || idea.status === "archived"}
              placeholder="# 아이디어\n\n대화를 시작하면 문서가 작성됩니다."
              value={documentDraft}
              onChange={(event) => setDocumentDraft(event.target.value)}
            />
            <article className="idea-markdown-preview">
              {documentDraft.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{documentDraft}</ReactMarkdown>
              ) : <p className="muted">문서 미리보기</p>}
            </article>
          </div>
        </section>
      </div>

      {idea.activeJob?.kind === "issue_plan" && isActiveJob ? (
        <div className="idea-plan-overlay"><LoaderCircle className="spin" /> 저장소를 분석해 이슈 계획을 만들고 있습니다…</div>
      ) : null}
      {planDraft && !isActiveJob ? (
        <IdeaPlanReview
          items={planDraft}
          onCancel={() => setPlanDraft(null)}
          onChange={setPlanDraft}
          onConfirm={() => void confirmPlan()}
          onSave={() => void savePlan()}
          working={working}
        />
      ) : null}
    </main>
  );

  async function saveIdeaPatch(patch: {
    title?: string;
    status?: "refining" | "ready" | "archived";
    provider?: AgentProvider;
    model?: string | null;
  }) {
    if (!token || !idea?.canEdit) return;
    setWorking(true);
    try {
      const result = await updateIdea(token, projectId, idea.id, {
        expectedVersion: idea.version,
        ...patch,
      });
      setIdea(result.idea);
      setDocumentDraft(result.idea.documentMarkdown);
      await refreshList();
    } catch (cause) {
      setError(describe(cause));
      await refreshIdea().catch(() => undefined);
    } finally {
      setWorking(false);
    }
  }

  async function send() {
    if (!token || !idea || !message.trim() || isBusy) return;
    setWorking(true);
    setError(null);
    const body = message.trim();
    setMessage("");
    try {
      const result = await sendIdeaMessage(token, projectId, idea.id, body);
      setIdea(result.idea);
      await refreshList();
    } catch (cause) {
      setMessage(body);
      setError(describe(cause));
    } finally {
      setWorking(false);
    }
  }

  async function markReady() {
    await saveIdeaPatch({ status: "ready" });
  }

  async function makePlan() {
    if (!token || !idea) return;
    setWorking(true);
    setError(null);
    try {
      const result = await generateIdeaPlan(token, projectId, idea.id);
      setIdea(result.idea);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setWorking(false);
    }
  }

  async function retryFailedJob() {
    if (!token || !idea?.activeJob || idea.activeJob.status !== "failed") return;
    setWorking(true);
    setError(null);
    try {
      const result = await retryIdeaJob(
        token,
        projectId,
        idea.id,
        idea.activeJob.id,
      );
      setIdea(result.idea);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setWorking(false);
    }
  }

  async function savePlan() {
    if (!token || !idea?.plan || !planDraft) return;
    setWorking(true);
    try {
      const result = await updateIdeaPlan(token, projectId, idea.id, {
        expectedVersion: idea.plan.version,
        items: planDraft,
      });
      setIdea(result.idea);
      setPlanDraft(result.idea.plan?.items ?? null);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setWorking(false);
    }
  }

  async function confirmPlan() {
    if (!token || !idea?.plan || !planDraft) return;
    setWorking(true);
    try {
      let currentIdea = idea;
      if (JSON.stringify(planDraft) !== JSON.stringify(idea.plan.items)) {
        const saved = await updateIdeaPlan(token, projectId, idea.id, {
          expectedVersion: idea.plan.version,
          items: planDraft,
        });
        currentIdea = saved.idea;
        setIdea(saved.idea);
      }
      if (!currentIdea.plan) throw new Error("이슈 계획을 찾을 수 없습니다.");
      const result = await convertIdeaPlan(
        token,
        projectId,
        idea.id,
        currentIdea.plan.version,
      );
      setPlanDraft(null);
      await Promise.all([refreshIdea(), refreshList()]);
      onIssuesCreated?.(result.runIds);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    if (!token || !idea || !window.confirm("이 아이디어 문서와 대화를 삭제할까요? 생성된 이슈는 유지됩니다.")) return;
    setWorking(true);
    try {
      await deleteIdea(token, projectId, idea.id);
      setSelectedId(null);
      setIdea(null);
      await refreshList();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setWorking(false);
    }
  }
}

function IdeaPlanReview({
  items,
  onCancel,
  onChange,
  onConfirm,
  onSave,
  working,
}: {
  items: IdeaIssuePlanItem[];
  onCancel: () => void;
  onChange: (items: IdeaIssuePlanItem[]) => void;
  onConfirm: () => void;
  onSave: () => void;
  working: boolean;
}) {
  const update = (index: number, patch: Partial<IdeaIssuePlanItem>) =>
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return (
    <div className="idea-plan-backdrop" role="presentation">
      <section aria-label="이슈 계획 미리보기" className="idea-plan-dialog" role="dialog">
        <header>
          <div><span className="eyebrow">ISSUE PLAN</span><h2>이슈 계획 검토</h2></div>
          <span>{items.length}/5개</span>
        </header>
        <div className="idea-plan-items">
          {items.map((item, index) => (
            <article className="idea-plan-item" key={item.key}>
              <strong>{index + 1}</strong>
              <label>제목<input value={item.title} onChange={(event) => update(index, { title: event.target.value })} /></label>
              <label>설명<textarea value={item.description} onChange={(event) => update(index, { description: event.target.value })} /></label>
              <div className="idea-plan-fields">
                <label>우선순위<select value={item.priority ?? ""} onChange={(event) => update(index, { priority: event.target.value ? Number(event.target.value) : null })}>
                  <option value="">기본</option>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
                </select></label>
                <label>Provider<select value={item.provider ?? ""} onChange={(event) => update(index, { provider: (event.target.value || null) as AgentProvider | null, model: null })}>
                  <option value="">아이디어 설정</option>{agentProviders.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                </select></label>
              </div>
              {index > 0 ? <fieldset><legend>선행 이슈</legend>{items.filter((candidate) => candidate.key !== item.key).map((candidate) => (
                <label key={candidate.key}><input type="checkbox" checked={item.prerequisiteKeys.includes(candidate.key)} onChange={(event) => update(index, {
                  prerequisiteKeys: event.target.checked
                    ? [...item.prerequisiteKeys, candidate.key]
                    : item.prerequisiteKeys.filter((key) => key !== candidate.key),
                })} />{candidate.title}</label>
              ))}</fieldset> : null}
            </article>
          ))}
        </div>
        <footer>
          <button className="secondary-button" disabled={working} onClick={onCancel}>닫기</button>
          <button className="secondary-button" disabled={working} onClick={onSave}>계획 저장</button>
          <button className="primary-button" disabled={working} onClick={onConfirm}>{working ? <LoaderCircle className="spin" size={15} /> : null} 이슈로 만들기</button>
        </footer>
      </section>
    </div>
  );
}

function IdeasLoading({ isSidebarOpen }: { isSidebarOpen: boolean }) {
  return <main className={`ideas-page${isSidebarOpen ? "" : " sidebar-hidden"}`}><div className="ideas-loading"><LoaderCircle className="spin" /> 아이디어를 불러오는 중…</div></main>;
}

const excerpt = (markdown: string) => markdown.replace(/[#*_>`\[\]()~-]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 150);
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);
