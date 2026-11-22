import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Activity, Check, CheckCircle2, CircleAlert, Clock3, LockKeyhole, LogIn, MessageSquare, RefreshCw, ShieldCheck, X } from "lucide-react";

type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";
type ApprovalItem = {
  _id: string; runId: string; workflowId: string; workflowVersion: number; graphHash: string;
  nodeId: string; nodeLabel: string; title: string; description: string; assigneeRole: string;
  assigneeUserId?: string | null; status: ApprovalStatus; dueAt: string; createdAt: string;
  decidedAt?: string | null; decisionComment?: string;
};
type ApprovalDetail = { approval: ApprovalItem; run: { status: string; workflowVersion: number; steps: Array<{ nodeId: string; label: string; status: string; output?: unknown }> } | null };
const API = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";

export default function ApprovalsInbox() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [status, setStatus] = useState("pending");
  const [selected, setSelected] = useState<ApprovalDetail | null>(null);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let response = await fetch(`${API}${path}`, { ...init, headers, credentials: "include" });
    if (response.status === 401 && token) {
      const refreshed = await fetch(`${API}/auth/refresh`, { method: "POST", credentials: "include" });
      if (refreshed.ok) {
        const body = await refreshed.json() as { data?: { accessToken?: string } };
        if (body.data?.accessToken) {
          setToken(body.data.accessToken);
          headers.set("Authorization", `Bearer ${body.data.accessToken}`);
          response = await fetch(`${API}${path}`, { ...init, headers, credentials: "include" });
        }
      }
    }
    const body = response.status === 204 ? null : await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
    if (!response.ok) {
      if (response.status === 401) setToken("");
      throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
    }
    return body?.data;
  }, [token]);

  const load = useCallback(async () => {
    const query = status ? `?status=${encodeURIComponent(status)}&limit=100` : "?limit=100";
    const result = await api(`/approvals${query}`) as { data: ApprovalItem[] };
    setItems(result.data ?? []);
  }, [api, status]);

  const open = async (id: string) => {
    try {
      const result = await api(`/approvals/${id}`) as ApprovalDetail;
      setSelected(result);
      setComment(result.approval.decisionComment ?? "");
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load approval."); }
  };

  useEffect(() => { if (token) load().catch(error => setMessage(error.message)); }, [token, load]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setAuthError("");
    try {
      const response = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email, password }) });
      const body = await response.json() as { data?: { accessToken?: string }; error?: { message?: string } };
      if (!response.ok || !body.data?.accessToken) throw new Error(body.error?.message ?? "Sign-in failed.");
      setToken(body.data.accessToken); setPassword("");
    } catch (error) { setAuthError(error instanceof Error ? error.message : "Unable to sign in."); }
    finally { setBusy(false); }
  };

  const decide = async (decision: "approve" | "reject") => {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      await api(`/approvals/${selected.approval._id}/decision`, { method: "POST", body: JSON.stringify({ decision, comment }) });
      setMessage(decision === "approve" ? "Approval recorded. The workflow has been queued to resume." : "Rejection recorded. The workflow run has failed.");
      setSelected(null);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Decision could not be recorded."); }
    finally { setBusy(false); }
  };

  if (!token) return <section className="approval-auth panel">
    <div className="approval-mark"><LockKeyhole size={22}/></div><span className="eyebrow">SECURE REVIEW WORKSPACE</span>
    <h1>Sign in to Approvals</h1><p>Review workflow requests assigned to your workspace role or identity.</p>
    <form onSubmit={signIn} className="studio-login-form">
      <label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required placeholder="you@company.com"/></label>
      <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required/></label>
      {authError && <div className="studio-error"><CircleAlert size={15}/>{authError}</div>}
      <button className="button-primary" disabled={busy}><LogIn size={15}/>{busy ? "Signing in…" : "Sign in securely"}</button>
    </form>
  </section>;

  return <div className="approval-page">
    <div className="approval-heading"><div><div className="eyebrow"><span className="live-dot"/> HUMAN-IN-THE-LOOP CONTROL</div><h1>Approval center</h1><p>Make accountable decisions before workflows continue.</p></div>
      <div className="approval-actions"><select aria-label="Approval status" value={status} onChange={event => { setStatus(event.target.value); setSelected(null); }}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option><option value="">All statuses</option></select><button className="button-secondary" onClick={() => load().catch(error => setMessage(error.message))}><RefreshCw size={14}/> Refresh</button><button className="button-secondary" onClick={async () => { try { await api("/auth/logout", { method: "POST" }); } finally { setToken(""); setItems([]); setSelected(null); } }}>Sign out</button></div>
    </div>
    <div className="approval-layout">
      <section className="panel approval-list">
        <div className="approval-list-head"><div><h2>Review queue</h2><p>{items.length} request{items.length === 1 ? "" : "s"} visible to your assignment</p></div><span className="approval-count"><ShieldCheck size={15}/>{items.filter(item => item.status === "pending").length} pending</span></div>
        {items.map(item => <button key={item._id} className={selected?.approval._id === item._id ? "approval-item selected" : "approval-item"} onClick={() => void open(item._id)}>
          <span className="approval-item-icon"><ShieldCheck size={17}/></span><span className="approval-item-copy"><strong>{item.title}</strong><small>{item.nodeLabel} · workflow v{item.workflowVersion}</small><small>Due {new Date(item.dueAt).toLocaleString()}</small></span><span className={`approval-status ${item.status}`}>{item.status.replace("_", " ")}</span>
        </button>)}
        {!items.length && <div className="approval-empty"><CheckCircle2 size={26}/><strong>No {status || ""} approvals</strong><span>New requests assigned to you will appear here.</span></div>}
      </section>
      <section className="panel approval-detail">
        {selected ? <>
          <div className="approval-detail-head"><div><span className="eyebrow">REQUEST DETAILS</span><h2>{selected.approval.title}</h2><p>{selected.approval.description || "No additional instructions provided."}</p></div><span className={`approval-status ${selected.approval.status}`}>{selected.approval.status}</span></div>
          <div className="approval-facts"><div><small>Assigned role</small><strong>{selected.approval.assigneeUserId ? "Specific reviewer" : selected.approval.assigneeRole}</strong></div><div><small>Deadline</small><strong>{new Date(selected.approval.dueAt).toLocaleString()}</strong></div><div><small>Workflow version</small><strong>v{selected.approval.workflowVersion}</strong></div><div><small>Run status</small><strong>{selected.run?.status ?? "Unavailable"}</strong></div></div>
          <div className="approval-context"><h3><Activity size={15}/> Execution context</h3><p>Run <code>{selected.approval.runId}</code></p><p>Graph fingerprint <code>{selected.approval.graphHash.slice(0, 20)}…</code></p><p>Approval node <code>{selected.approval.nodeId}</code></p></div>
          <label className="approval-comment"><span><MessageSquare size={15}/> Reviewer comment</span><textarea value={comment} onChange={event => setComment(event.target.value)} maxLength={2000} rows={4} placeholder="Document the evidence and rationale for your decision…"/></label>
          {selected.approval.status === "pending" && <div className="approval-decision-actions"><button className="button-secondary approval-reject" disabled={busy} onClick={() => void decide("reject")}><X size={15}/> Reject request</button><button className="button-primary" disabled={busy} onClick={() => void decide("approve")}><Check size={15}/> Approve & resume</button></div>}
          {selected.approval.status !== "pending" && <p className="approval-readonly"><Clock3 size={15}/> This request has already reached a terminal state.</p>}
        </> : <div className="approval-empty approval-detail-empty"><ShieldCheck size={30}/><strong>Select an approval request</strong><span>Review its immutable workflow context and record a reasoned decision.</span></div>}
      </section>
    </div>
    {message && <div className="studio-message" role="status"><Check size={15}/><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss message"><X size={14}/></button></div>}
  </div>;
}
