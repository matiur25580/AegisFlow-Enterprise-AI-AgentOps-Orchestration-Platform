import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Bell, CheckCheck, Clock3, LockKeyhole, RefreshCw, ShieldAlert, Wallet } from "lucide-react";

type BudgetAlert = {
  _id: string;
  scopeType: "tenant" | "agent" | "model";
  scopeValue: string;
  periodStart: string;
  eventType: "warning" | "exceeded";
  thresholdPercent: number;
  observedSpendUsd: number;
  monthlyLimitUsd: number;
  utilizationPercent: number;
  readAt: string | null;
  createdAt: string;
};
type AlertResponse = { data: BudgetAlert[]; meta?: { unreadCount?: number; sampleSaturated?: boolean; createdDuringRead?: number } };
const API = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const dateTime = (value: string) => new Date(value).toLocaleString();

export default function BudgetAlerts() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [alerts, setAlerts] = useState<BudgetAlert[]>([]);
  const [unread, setUnread] = useState(0);
  const [sampleSaturated, setSampleSaturated] = useState(false);
  const [message, setMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", "Bearer " + token);
    let response = await fetch(API + path, { ...init, headers, credentials: "include" });
    if (response.status === 401 && token) {
      const refresh = await fetch(API + "/auth/refresh", { method: "POST", credentials: "include" });
      if (refresh.ok) {
        const body = await refresh.json() as { data?: { accessToken?: string } };
        if (body.data?.accessToken) {
          setToken(body.data.accessToken);
          headers.set("Authorization", "Bearer " + body.data.accessToken);
          response = await fetch(API + path, { ...init, headers, credentials: "include" });
        }
      }
    }
    const body = await response.json().catch(() => null) as { data?: unknown; meta?: AlertResponse["meta"]; error?: { message?: string } } | null;
    if (!response.ok) {
      if (response.status === 401) setToken("");
      throw new Error(body?.error?.message ?? "Request failed (" + response.status + ")");
    }
    return body;
  }, [token]);

  const load = useCallback(async () => {
    const response = await api("/budget-alerts?limit=100") as AlertResponse;
    setAlerts(response.data ?? []);
    setUnread(response.meta?.unreadCount ?? 0);
    setSampleSaturated(Boolean(response.meta?.sampleSaturated));
  }, [api]);

  useEffect(() => {
    if (token) load().catch(error => setMessage(error instanceof Error ? error.message : "Unable to load budget alerts."));
  }, [token, load]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setAuthError("");
    try {
      const response = await fetch(API + "/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ email, password })
      });
      const body = await response.json() as { data?: { accessToken?: string }; error?: { message?: string } };
      if (!response.ok || !body.data?.accessToken) throw new Error(body.error?.message ?? "Sign-in failed.");
      setToken(body.data.accessToken); setPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally { setBusy(false); }
  };

  const markRead = async (alert: BudgetAlert) => {
    setBusy(true); setMessage("");
    try {
      await api("/budget-alerts/" + alert._id + "/read", { method: "PATCH" });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update alert.");
    } finally { setBusy(false); }
  };

  if (!token) return <section className="budget-auth panel">
    <div className="approval-mark"><Wallet size={22}/></div><span className="eyebrow">GOVERNANCE / ALERT CENTER</span>
    <h1>Sign in to Budget Alerts</h1><p>Review persistent budget threshold events and acknowledge alerts for your workspace.</p>
    <form onSubmit={signIn} className="studio-login-form">
      <label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required /></label>
      <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>
      {authError && <div className="approval-error"><AlertCircle size={14}/>{authError}</div>}
      <button className="button-primary" type="submit" disabled={busy}><LockKeyhole size={15}/>{busy ? "Signing in…" : "Sign in securely"}</button>
    </form>
  </section>;

  return <section className="budget-alert-page">
    <div className="budget-heading">
      <div><span className="eyebrow">GOVERNANCE / SPENDING CONTROLS</span><h1>Budget alerts</h1><p>Persistent warning and exceeded events across your monthly budget policies.</p></div>
      <button className="button-secondary" onClick={() => load().catch(error => setMessage(error.message))} disabled={busy}><RefreshCw size={14}/> Refresh & evaluate</button>
    </div>
    <div className="budget-alert-summary">
      <article className="panel budget-metric"><span>Total alerts</span><strong>{alerts.length}</strong><small>Most recent 100 events</small></article>
      <article className="panel budget-metric"><span>Unread</span><strong>{unread}</strong><small>Awaiting acknowledgement</small></article>
      <article className="panel budget-metric"><span>Exceeded</span><strong>{alerts.filter(item => item.eventType === "exceeded").length}</strong><small>Monthly limit reached</small></article>
    </div>
    {message && <div className="budget-message" role="status"><AlertCircle size={14}/>{message}</div>}
    {sampleSaturated && <div className="budget-warning"><AlertCircle size={15}/> Usage reached the 5,000-run sample limit. New alerts were skipped because sampled spend may understate actual usage.</div>}
    <div className="panel budget-alert-list">
      <div className="panel-header"><div><h2><Bell size={16}/> Alert history</h2><p>UTC monthly budget period · estimated USD spend</p></div><span className="budget-count">{unread} unread</span></div>
      {alerts.length === 0 ? <div className="budget-empty"><CheckCheck size={25}/><strong>No budget alerts</strong><span>No enabled policy has crossed its warning threshold in the current month, or there are no policies to evaluate.</span></div> :
        alerts.map(alert => <article className={"budget-alert-card " + (alert.readAt ? "is-read" : "is-unread")} key={alert._id}>
          <span className={"budget-alert-icon " + alert.eventType}>{alert.eventType === "exceeded" ? <ShieldAlert size={18}/> : <AlertCircle size={18}/>}</span>
          <div className="budget-alert-main">
            <div className="budget-alert-title"><strong>{alert.eventType === "exceeded" ? "Monthly budget exceeded" : "Budget warning threshold reached"}</strong><span className={"budget-state " + (alert.eventType === "exceeded" ? "exceeded" : "warning")}>{alert.eventType}</span></div>
            <p>{alert.scopeType === "tenant" ? "Entire workspace" : alert.scopeType + " · " + alert.scopeValue}</p>
            <div className="budget-alert-facts"><span>Spend <strong>{money(alert.observedSpendUsd)}</strong></span><span>Limit <strong>{money(alert.monthlyLimitUsd)}</strong></span><span>Utilization <strong>{alert.utilizationPercent.toFixed(1)}%</strong></span></div>
            <small className="budget-alert-time"><Clock3 size={12}/> {dateTime(alert.createdAt)} · period starts {new Date(alert.periodStart).toLocaleDateString()}</small>
          </div>
          <div className="budget-alert-action">{alert.readAt ? <span className="budget-read-label"><CheckCheck size={13}/> Read</span> : <button className="button-secondary" onClick={() => markRead(alert)} disabled={busy}>Mark read</button>}</div>
        </article>)
      }
    </div>
    <p className="budget-disclaimer">Refresh evaluates current usage and persists any newly crossed threshold. Alert history is not real-time delivery; external email/webhook notifications and scheduled evaluation are not enabled.</p>
  </section>;
}
