import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Coins, LogIn, Plus, RefreshCw, XCircle } from "lucide-react";

type Rate = { provider: string; model: string; inputUsdPerMillionTokens: number; outputUsdPerMillionTokens: number; effectiveFrom: string; source: string };
type ModelCost = { provider: string; model: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number; unpricedSteps: number };
type Overview = { from: string; to: string; currency: string; estimatedCostUsd: number; inputTokens: number; outputTokens: number; pricedSteps: number; unpricedSteps: number; pricingCoveragePercent: number; byModel: ModelCost[]; sampled: boolean; estimateBasis: string };
const API = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(value);

export default function CostIntelligence() {
  const [token, setToken] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<"24h" | "7d" | "30d">("30d"); const [overview, setOverview] = useState<Overview | null>(null); const [rates, setRates] = useState<Rate[]>([]);
  const [provider, setProvider] = useState<"openai" | "anthropic" | "google">("openai"); const [model, setModel] = useState("");
  const [inputRate, setInputRate] = useState("2"); const [outputRate, setOutputRate] = useState("8"); const [source, setSource] = useState("");

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", "Bearer " + token);
    let response = await fetch(API + path, { ...init, headers, credentials: "include" });
    if (response.status === 401 && token) {
      const refresh = await fetch(API + "/auth/refresh", { method: "POST", credentials: "include" });
      if (refresh.ok) { const body = await refresh.json() as { data?: { accessToken?: string } }; if (body.data?.accessToken) { setToken(body.data.accessToken); headers.set("Authorization", "Bearer " + body.data.accessToken); response = await fetch(API + path, { ...init, headers, credentials: "include" }); } }
    }
    const body = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
    if (!response.ok) { if (response.status === 401) setToken(""); throw new Error(body?.error?.message ?? "Request failed (" + response.status + ")"); }
    return body?.data;
  }, [token]);

  const load = useCallback(async () => {
    const [summary, configured] = await Promise.all([
      api("/costs/overview?range=" + range) as Promise<Overview>,
      api("/costs/pricing") as Promise<Rate[]>
    ]);
    setOverview(summary); setRates(configured);
  }, [api, range]);
  useEffect(() => { if (token) load().catch(error => setMessage(error instanceof Error ? error.message : "Unable to load cost data.")); }, [token, load]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setAuthError("");
    try {
      const response = await fetch(API + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email, password }) });
      const body = await response.json() as { data?: { accessToken?: string }; error?: { message?: string } };
      if (!response.ok || !body.data?.accessToken) throw new Error(body.error?.message ?? "Sign-in failed.");
      setToken(body.data.accessToken); setPassword("");
    } catch (error) { setAuthError(error instanceof Error ? error.message : "Unable to sign in."); }
    finally { setBusy(false); }
  };

  const saveRate = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await api("/costs/pricing", { method: "PUT", body: JSON.stringify({ provider, model, inputUsdPerMillionTokens: Number(inputRate), outputUsdPerMillionTokens: Number(outputRate), source }) });
      setModel(""); setSource(""); await load(); setMessage("Pricing rate saved. Estimates use the configured USD rates.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save pricing rate."); }
    finally { setBusy(false); }
  };

  if (!token) return <section className="cost-auth panel"><div className="approval-mark"><Coins size={22}/></div><span className="eyebrow">COST INTELLIGENCE</span><h1>Sign in to Usage &amp; billing</h1><p>Review provider token usage and configure workspace model rates.</p><form onSubmit={signIn} className="studio-login-form"><label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} required/></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} required/></label>{authError && <div className="studio-error">{authError}</div>}<button className="button-primary" disabled={busy}><LogIn size={14}/> Sign in securely</button></form></section>;

  return <div className="cost-page">
    <div className="cost-heading"><div><div className="eyebrow">FINOPS · AI COST INTELLIGENCE</div><h1>Usage &amp; billing</h1><p>Estimate model spend from provider-reported tokens and workspace-configured rates.</p></div><div className="cost-actions"><select value={range} onChange={event => setRange(event.target.value as typeof range)} aria-label="Cost reporting range"><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select><button className="button-secondary" onClick={() => load().catch(error => setMessage(error.message))}><RefreshCw size={14}/> Refresh</button></div></div>
    {message && <div className="trace-message"><AlertCircle size={14}/>{message}<button onClick={() => setMessage("")} aria-label="Dismiss"><XCircle size={14}/></button></div>}
    {overview && <>
      {overview.sampled && <div className="trace-notice">This view is sampled from the latest 5,000 runs. Narrow the date range for a smaller sample.</div>}
      <section className="cost-metrics">
        <article className="panel cost-metric"><span>Estimated spend</span><strong>{money(overview.estimatedCostUsd)}</strong><small>USD · selected period</small></article>
        <article className="panel cost-metric"><span>Input tokens</span><strong>{overview.inputTokens.toLocaleString()}</strong><small>Provider-reported usage</small></article>
        <article className="panel cost-metric"><span>Output tokens</span><strong>{overview.outputTokens.toLocaleString()}</strong><small>Provider-reported usage</small></article>
        <article className="panel cost-metric"><span>Pricing coverage</span><strong>{overview.pricingCoveragePercent.toFixed(1)}%</strong><small>{overview.pricedSteps} priced · {overview.unpricedSteps} unpriced steps</small></article>
      </section>
      <section className="panel cost-breakdown"><div className="panel-header"><div><h2>Spend by model</h2><p>Token totals and estimated USD cost by provider/model</p></div><span className="trace-total">{overview.byModel.length} models</span></div>
        <div className="trace-table-wrap"><table className="trace-table"><thead><tr><th>Provider / model</th><th>Input tokens</th><th>Output tokens</th><th>Estimated cost</th><th>Unpriced steps</th></tr></thead><tbody>
          {overview.byModel.map(item => <tr key={item.provider + "/" + item.model}><td><strong>{item.provider}</strong><small className="cost-model">{item.model}</small></td><td>{item.inputTokens.toLocaleString()}</td><td>{item.outputTokens.toLocaleString()}</td><td>{money(item.estimatedCostUsd)}</td><td>{item.unpricedSteps}</td></tr>)}
          {!overview.byModel.length && <tr><td colSpan={5} className="trace-empty">No provider usage recorded in this period.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
    <section className="cost-lower">
      <div className="panel cost-rates"><div className="panel-header"><div><h2>Configured model rates</h2><p>Rates are USD per one million tokens.</p></div><span className="trace-total">{rates.length} rates</span></div>
        {rates.map(rate => <div className="cost-rate-row" key={rate.provider + "/" + rate.model}><div><strong>{rate.provider} · {rate.model}</strong><small>Input {money(rate.inputUsdPerMillionTokens)} / Output {money(rate.outputUsdPerMillionTokens)} per 1M</small><small>Effective {new Date(rate.effectiveFrom).toLocaleString()}</small></div></div>)}
        {!rates.length && <div className="approval-empty"><Coins size={22}/><strong>No model rates configured</strong><span>Add reviewed rates to estimate provider spend.</span></div>}
      </div>
      <form className="panel cost-rate-form" onSubmit={saveRate}><h2><Plus size={15}/> Configure model rate</h2><p>Use a reviewed provider pricing source. Unknown models remain unpriced.</p>
        <label>Provider<select value={provider} onChange={event => setProvider(event.target.value as typeof provider)}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="google">Google Gemini</option></select></label>
        <label>Model identifier<input value={model} onChange={event => setModel(event.target.value)} placeholder="e.g. gpt-4.1" required maxLength={120}/></label>
        <div className="cost-rate-pair"><label>Input USD / 1M tokens<input type="number" min="0" max="1000000" step="any" value={inputRate} onChange={event => setInputRate(event.target.value)} required/></label><label>Output USD / 1M tokens<input type="number" min="0" max="1000000" step="any" value={outputRate} onChange={event => setOutputRate(event.target.value)} required/></label></div>
        <label>Pricing source / review note<input value={source} onChange={event => setSource(event.target.value)} placeholder="Official pricing page, checked date" maxLength={300}/></label>
        <button className="button-primary" disabled={busy}><Plus size={14}/> Save pricing rate</button>
      </form>
    </section>
    <p className="cost-disclaimer">Estimates only, not invoices. Rates are tenant-configured and current pricing is applied to historical usage; historical rate snapshots, cached-token discounts, taxes, currency conversion, budgets and alerts are not included.</p>
  </div>;
}
