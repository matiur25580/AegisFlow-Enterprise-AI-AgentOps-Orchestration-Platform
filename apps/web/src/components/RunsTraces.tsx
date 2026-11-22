import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Activity, AlertCircle, CheckCircle2, Clock3, LogIn, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type RunStatus = "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled";
type RunItem = { _id: string; workflowId: string; workflowVersion: number; status: RunStatus; createdAt: string; startedAt?: string | null; completedAt?: string | null; lastError?: string | null };
type Overview = {
  range: string;
  totals: { total: number; succeeded: number; failed: number; waitingApproval: number; running: number; queued: number; cancelled: number };
  successRate: number;
  averageDurationMs: number | null;
  pendingApprovals: number;
  sampled: boolean;
  throughput: Array<{ start: string; total: number; succeeded: number; failed: number; waitingApproval: number; running: number; queued: number }>;
};
type Trace = { runId: string; workflowVersion: number; graphHash: string; status: string; createdAt: string; startedAt?: string | null; completedAt?: string | null; totalDurationMs: number | null; lastErrorCode: string | null; steps: Array<{ nodeId: string; nodeType: string; label: string; status: string; attempt: number; startedAt: string; completedAt?: string | null; durationMs: number | null; errorCode: string | null }> };
const API = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
const fmtDuration = (ms: number | null) => ms === null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
const fmtTime = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";

export default function RunsTraces() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [trace, setTrace] = useState<Trace | null>(null);
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
    const [metrics, recent] = await Promise.all([
      api(`/observability/overview?range=${range}`) as Promise<Overview>,
      api("/runs?limit=50") as Promise<RunItem[]>
    ]);
    setOverview(metrics);
    setRuns(recent);
  }, [api, range]);

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

  const openTrace = async (runId: string) => {
    setMessage(""); setTrace(null);
    try { setTrace(await api(`/observability/runs/${runId}/trace`) as Trace); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load trace."); }
  };

  if (!token) return <section className="trace-auth panel">
    <div className="approval-mark"><Activity size={22}/></div><span className="eyebrow">EXECUTION INTELLIGENCE</span>
    <h1>Sign in to Runs &amp; traces</h1><p>Inspect tenant-scoped workflow health, throughput and node-level execution timelines.</p>
    <form onSubmit={signIn} className="studio-login-form">
      <label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required placeholder="you@company.com"/></label>
      <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required/></label>
      {authError && <div className="studio-error"><AlertCircle size={15}/>{authError}</div>}
      <button className="button-primary" disabled={busy}><LogIn size={15}/>{busy ? "Signing in…" : "Sign in securely"}</button>
    </form>
  </section>;

  return <div className="trace-page">
    <div className="trace-heading"><div><div className="eyebrow"><span className="live-dot"/> EXECUTION OBSERVABILITY</div><h1>Runs &amp; traces</h1><p>Operational metrics derived from durable workflow execution records.</p></div>
      <div className="trace-actions"><select value={range} onChange={event => setRange(event.target.value as typeof range)} aria-label="Metrics time range"><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select><button className="button-secondary" onClick={() => load().catch(error => setMessage(error.message))}><RefreshCw size={14}/> Refresh</button></div>
    </div>
    {message && <div className="trace-message"><AlertCircle size={15}/>{message}<button onClick={() => setMessage("")} aria-label="Dismiss"><XCircle size={15}/></button></div>}
    {overview && <>
      {overview.sampled && <div className="trace-notice">Metrics are based on the latest 5,000 runs in this time range. Narrow the range for exact totals.</div>}
      <section className="trace-metrics">
        <article className="panel trace-metric"><span>Total runs</span><strong>{overview.totals.total.toLocaleString()}</strong><small>Created in selected range</small></article>
        <article className="panel trace-metric"><span>Success rate</span><strong>{overview.successRate.toFixed(2)}%</strong><small>{overview.totals.succeeded} successful runs</small></article>
        <article className="panel trace-metric"><span>Average duration</span><strong>{fmtDuration(overview.averageDurationMs)}</strong><small>Completed runs with timestamps</small></article>
        <article className="panel trace-metric"><span>Pending approvals</span><strong>{overview.pendingApprovals.toLocaleString()}</strong><small>Current workspace queue</small></article>
      </section>
      <section className="panel trace-throughput">
        <div className="panel-header"><div><h2>Execution throughput</h2><p>Runs created per interval</p></div><span className="trace-total">{overview.totals.failed} failed · {overview.totals.running + overview.totals.queued} in progress</span></div>
        <div className="trace-bars" role="img" aria-label="Execution throughput histogram">
          {overview.throughput.map((bucket, index) => <div className="trace-bar-slot" key={bucket.start} title={`${bucket.total} runs · ${fmtTime(bucket.start)}`}><div className="trace-bar" style={{ height: `${Math.max(3, bucket.total / Math.max(1, ...overview.throughput.map(item => item.total)) * 100)}%` }}><i style={{ height: `${bucket.total ? bucket.succeeded / bucket.total * 100 : 0}%` }}/></div>{(index === 0 || index === overview.throughput.length - 1 || index % (overview.throughput.length > 10 ? 6 : 1) === 0) && <small>{new Date(bucket.start).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: range === "24h" ? "2-digit" : undefined })}</small>}</div>)}
        </div>
        <div className="trace-legend"><span><i className="trace-legend-success"/> Successful</span><span><i className="trace-legend-total"/> Total volume</span><span><i className="trace-legend-failed"/> Failed: {overview.totals.failed}</span></div>
      </section>
      <section className="panel trace-runs">
        <div className="panel-header"><div><h2>Recent workflow runs</h2><p>Select a run to inspect its sanitized node timeline.</p></div><span className="trace-total">{runs.length} recent</span></div>
        <div className="trace-table-wrap"><table className="trace-table"><thead><tr><th>Run</th><th>Status</th><th>Workflow version</th><th>Created</th><th>Duration</th></tr></thead><tbody>
          {runs.map(run => <tr key={run._id} className={trace?.runId === run._id ? "selected" : ""} onClick={() => void openTrace(run._id)}><td><code>{run._id.slice(-10)}</code></td><td><span className={`trace-status ${run.status}`}>{run.status.replace("_", " ")}</span></td><td>v{run.workflowVersion}</td><td>{fmtTime(run.createdAt)}</td><td>{fmtDuration(run.startedAt && run.completedAt ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime() : null)}</td></tr>)}
          {!runs.length && <tr><td colSpan={5} className="trace-empty">No workflow runs found in this workspace.</td></tr>}
        </tbody></table></div>
      </section>
      {trace && <section className="panel trace-detail">
        <div className="panel-header"><div><h2>Execution trace</h2><p>Run {trace.runId} · workflow version {trace.workflowVersion} · {trace.status}</p></div><button className="trace-close" onClick={() => setTrace(null)} aria-label="Close trace"><XCircle size={17}/></button></div>
        <div className="trace-facts"><span><small>Graph fingerprint</small><code>{trace.graphHash}</code></span><span><small>Total duration</small><strong>{fmtDuration(trace.totalDurationMs)}</strong></span><span><small>Failure code</small><strong>{trace.lastErrorCode ?? "None"}</strong></span></div>
        <ol className="trace-steps">{trace.steps.map((step, index) => <li key={`${step.nodeId}-${index}`}><span className={`trace-step-marker ${step.status}`}>{step.status === "succeeded" ? <CheckCircle2 size={15}/> : step.status === "failed" ? <XCircle size={15}/> : step.status === "waiting_approval" ? <ShieldCheck size={15}/> : <Clock3 size={15}/>}</span><div><strong>{step.label}</strong><small>{step.nodeType} · attempt {step.attempt} · {fmtDuration(step.durationMs)}</small>{step.errorCode && <em>{step.errorCode}</em>}</div><time>{fmtTime(step.startedAt)}</time></li>)}</ol>
      </section>}
    </>}
  </div>;
}
