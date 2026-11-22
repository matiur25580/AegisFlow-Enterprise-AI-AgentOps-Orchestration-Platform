import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Gauge, LockKeyhole, Plus, RefreshCw, Save, Trash2, Wallet } from "lucide-react";

type Budget = {
  _id: string;
  scopeType: "tenant" | "agent" | "model";
  scopeValue: string;
  monthlyLimitUsd: number;
  warningThresholdPercent: number;
  enforcement: "soft" | "hard";
  enabled: boolean;
  spentUsd: number;
  remainingUsd: number;
  utilizationPercent: number;
  warning: boolean;
  exceeded: boolean;
  periodStart: string;
};
type BudgetResponse = { data: Budget[]; meta?: { sampled?: boolean; currency?: string; estimateBasis?: string } };
const API = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);

export default function BudgetManagement() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [sampled, setSampled] = useState(false);
  const [estimateBasis, setEstimateBasis] = useState("");
  const [message, setMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scopeType, setScopeType] = useState<Budget["scopeType"]>("tenant");
  const [scopeValue, setScopeValue] = useState("*");
  const [limit, setLimit] = useState("500");
  const [threshold, setThreshold] = useState("80");
  const [enforcement, setEnforcement] = useState<Budget["enforcement"]>("soft");
  const [enabled, setEnabled] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);

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
    if (response.status === 204) return null;
    const body = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
    if (!response.ok) {
      if (response.status === 401) setToken("");
      throw new Error(body?.error?.message ?? "Request failed (" + response.status + ")");
    }
    return body;
  }, [token]);

  const load = useCallback(async () => {
    const response = await api("/budgets") as BudgetResponse;
    setBudgets(response.data ?? []);
    setSampled(Boolean(response.meta?.sampled));
    setEstimateBasis(response.meta?.estimateBasis ?? "");
  }, [api]);

  useEffect(() => {
    if (token) load().catch(error => setMessage(error instanceof Error ? error.message : "Unable to load budgets."));
  }, [token, load]);

  const signIn = async (event: FormEvent) => {
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

  const resetForm = () => {
    setEditing(null); setScopeType("tenant"); setScopeValue("*"); setLimit("500");
    setThreshold("80"); setEnforcement("soft"); setEnabled(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await api("/budgets", { method: "PUT", body: JSON.stringify({
        scopeType, scopeValue: scopeType === "tenant" ? "*" : scopeValue.trim(),
        monthlyLimitUsd: Number(limit), warningThresholdPercent: Number(threshold), enforcement, enabled
      }) });
      resetForm(); await load(); setMessage("Budget policy saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save budget.");
    } finally { setBusy(false); }
  };

  const edit = (budget: Budget) => {
    setEditing(budget.scopeType + ":" + budget.scopeValue);
    setScopeType(budget.scopeType); setScopeValue(budget.scopeValue);
    setLimit(String(budget.monthlyLimitUsd)); setThreshold(String(budget.warningThresholdPercent));
    setEnforcement(budget.enforcement); setEnabled(budget.enabled);
    setMessage("");
  };

  const remove = async (budget: Budget) => {
    if (!window.confirm("Delete this budget policy?")) return;
    setBusy(true); setMessage("");
    try {
      await api("/budgets/" + budget.scopeType + "?scopeValue=" + encodeURIComponent(budget.scopeValue), { method: "DELETE" });
      if (editing === budget.scopeType + ":" + budget.scopeValue) resetForm();
      await load(); setMessage("Budget policy deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete budget.");
    } finally { setBusy(false); }
  };

  if (!token) return <section className="budget-auth panel">
    <div className="approval-mark"><Wallet size={22}/></div><span className="eyebrow">BUDGET GOVERNANCE</span>
    <h1>Sign in to Budget Management</h1><p>Review monthly spend limits and configure workspace governance policies.</p>
    <form onSubmit={signIn} className="studio-login-form">
      <label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required /></label>
      <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>
      {authError && <div className="approval-error"><AlertCircle size={14}/>{authError}</div>}
      <button className="button-primary" type="submit" disabled={busy}><LockKeyhole size={15}/>{busy ? "Signing in…" : "Sign in securely"}</button>
    </form>
  </section>;

  const totalLimit = budgets.filter(item => item.enabled).reduce((sum, item) => sum + item.monthlyLimitUsd, 0);
  const warningCount = budgets.filter(item => item.warning).length;
  const exceededCount = budgets.filter(item => item.exceeded).length;

  return <section className="budget-page">
    <div className="budget-heading">
      <div><span className="eyebrow">GOVERNANCE / SPENDING CONTROLS</span><h1>Budget management</h1><p>Set monthly spending guardrails across your workspace, agents, and models.</p></div>
      <button className="button-secondary" onClick={() => load().catch(error => setMessage(error.message))}><RefreshCw size={14}/> Refresh</button>
    </div>
    <div className="budget-metrics">
      <article className="panel budget-metric"><span>Configured policies</span><strong>{budgets.length}</strong><small>Across all budget scopes</small></article>
      <article className="panel budget-metric"><span>Enabled monthly limits</span><strong>{money(totalLimit)}</strong><small>Sum across scopes; not a unique tenant cap</small></article>
      <article className="panel budget-metric"><span>Warnings</span><strong>{warningCount}</strong><small>Policies at or above threshold</small></article>
      <article className="panel budget-metric"><span>Limits exceeded</span><strong>{exceededCount}</strong><small>Estimated spend reached configured cap</small></article>
    </div>
    {message && <div className="budget-message" role="status"><AlertCircle size={14}/>{message}</div>}
    {sampled && <div className="budget-warning"><AlertCircle size={15}/> Usage totals reached the 5,000-run accounting sample. Treat these estimates as incomplete; hard admission fails closed.</div>}
    <div className="budget-layout">
      <div className="panel budget-list">
        <div className="panel-header"><div><h2>Monthly policies</h2><p>UTC calendar month · estimated USD spend</p></div><span className="budget-count">{budgets.length} policies</span></div>
        {budgets.length === 0 ? <div className="budget-empty"><Gauge size={24}/><strong>No budget policies yet</strong><span>Create a tenant-wide policy to start tracking your monthly guardrails.</span></div> :
          budgets.map(budget => <article className="budget-card" key={budget._id}>
            <div className="budget-card-top">
              <div><span className="budget-scope">{budget.scopeType} scope</span><strong>{budget.scopeType === "tenant" ? "Entire workspace" : budget.scopeValue}</strong></div>
              <span className={"budget-state " + (budget.exceeded ? "exceeded" : budget.warning ? "warning" : "healthy")}>{budget.exceeded ? "Exceeded" : budget.warning ? "Warning" : budget.enabled ? "On track" : "Disabled"}</span>
            </div>
            <div className="budget-amounts"><span><small>Estimated spend</small><strong>{money(budget.spentUsd)}</strong></span><span><small>Monthly limit</small><strong>{money(budget.monthlyLimitUsd)}</strong></span><span><small>Remaining</small><strong>{money(budget.remainingUsd)}</strong></span></div>
            <div className="budget-progress" role="progressbar" aria-label={"Budget utilization " + budget.scopeValue} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, budget.utilizationPercent)}><i className={budget.exceeded ? "exceeded" : budget.warning ? "warning" : ""} style={{ width: Math.min(100, Math.max(0, budget.utilizationPercent)) + "%" }}/></div>
            <div className="budget-card-foot"><span>{budget.utilizationPercent.toFixed(1)}% used · Alert at {budget.warningThresholdPercent}% · {budget.enforcement} enforcement</span><span><button type="button" onClick={() => edit(budget)}>Edit</button><button type="button" className="danger" onClick={() => remove(budget)} disabled={busy}><Trash2 size={12}/> Delete</button></span></div>
          </article>)
        }
        <p className="budget-disclaimer">{estimateBasis || "Spend is estimated from provider-reported token usage and current model pricing."} Estimates are not provider invoices.</p>
      </div>
      <form className="panel budget-form" onSubmit={save}>
        <h2><Plus size={16}/>{editing ? "Edit budget policy" : "Create budget policy"}</h2>
        <p>Policies are evaluated against current-month estimated usage. Owner/admin permissions are enforced by the API.</p>
        <label>Budget scope<select value={scopeType} onChange={event => { const next = event.target.value as Budget["scopeType"]; setScopeType(next); setScopeValue(next === "tenant" ? "*" : ""); }}><option value="tenant">Entire workspace</option><option value="agent">Specific agent</option><option value="model">Specific model</option></select></label>
        {scopeType !== "tenant" && <label>{scopeType === "agent" ? "Agent MongoDB ID" : "Provider / model identifier"}<input value={scopeValue} onChange={event => setScopeValue(event.target.value)} placeholder={scopeType === "agent" ? "24-character agent ID" : "openai/gpt-4.1"} required /></label>}
        <label>Monthly limit (USD)<input type="number" min="0.01" max="100000000" step="0.01" value={limit} onChange={event => setLimit(event.target.value)} required /></label>
        <label>Warning threshold (%)<input type="number" min="1" max="99" step="1" value={threshold} onChange={event => setThreshold(event.target.value)} required /></label>
        <label>Enforcement mode<select value={enforcement} onChange={event => setEnforcement(event.target.value as Budget["enforcement"])}><option value="soft">Soft — warn only</option><option value="hard">Hard — block new runs at limit</option></select></label>
        <label className="budget-toggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/> Enable this policy</label>
        <div className="budget-form-actions"><button className="button-primary" type="submit" disabled={busy}><Save size={14}/>{busy ? "Saving…" : editing ? "Save changes" : "Create policy"}</button>{editing && <button className="button-secondary" type="button" onClick={resetForm}>Cancel</button>}</div>
      </form>
    </div>
    <p className="budget-disclaimer">Hard enforcement is a best-effort admission gate, not a guaranteed billing ceiling. Concurrent admissions and in-flight provider calls can still exceed a limit until atomic spend reservations are implemented.</p>
  </section>;
}
