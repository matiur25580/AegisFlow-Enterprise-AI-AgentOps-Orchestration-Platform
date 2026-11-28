import { useState, type FormEvent } from "react";
import { ArrowRight, Command, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthContext";

export default function AuthScreen() {
  const { signIn, signUp, acceptInvitation } = useAuth();
  const invitationToken = new URLSearchParams(window.location.search).get("invite") ?? "";
  const [mode, setMode] = useState<"login" | "signup" | "invite">(invitationToken ? "invite" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [token, setToken] = useState(invitationToken);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await signIn(email, password);
      if (mode === "signup") await signUp({ organizationName, displayName, email, password });
      if (mode === "invite") await acceptInvitation(token.trim(), displayName, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't complete your request.");
    } finally { setBusy(false); }
  }

  return <main className="identity-auth-shell">
    <div className="identity-auth-glow" />
    <section className="identity-auth-card">
      <div className="identity-auth-brand"><span className="brand-mark"><Command size={20}/></span><span><strong>AegisFlow</strong><small>AGENT OPERATIONS</small></span></div>
      <div className="identity-auth-kicker"><ShieldCheck size={14}/> ENTERPRISE IDENTITY</div>
      <h1>{mode === "login" ? "Welcome back" : mode === "signup" ? "Create your workspace" : "Join your workspace"}</h1>
      <p className="identity-auth-intro">{mode === "login" ? "Sign in to securely manage your AI operations." : mode === "signup" ? "Set up your organization and become its first workspace owner." : "Accept your invitation to get secure access to AegisFlow."}</p>
      <div className="identity-auth-tabs">
        <button className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setError(""); }}>Sign in</button>
        <button className={mode === "signup" ? "selected" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
      </div>
      <form onSubmit={submit} className="identity-form">
        {mode === "signup" && <>
          <label>Full name<input required minLength={2} maxLength={80} autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name"/></label>
          <label>Organization name<input required minLength={2} maxLength={100} value={organizationName} onChange={e => setOrganizationName(e.target.value)} placeholder="Acme Corporation"/></label>
        </>}
        {mode === "invite" && <>
          <label>Invitation token<input required minLength={32} value={token} onChange={e => setToken(e.target.value)} placeholder="Paste your one-time invitation token"/></label>
          <label>Full name<input required minLength={2} maxLength={80} autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name"/></label>
        </>}
        {mode !== "invite" && <label>Work email<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com"/></label>}
        <label>Password<span className="identity-password-wrap"><input required type={showPassword ? "text" : "password"} minLength={mode === "login" ? 1 : 12} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "login" ? "Enter your password" : "At least 12 characters"}/><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>
        {mode !== "login" && <p className="identity-password-hint">Use at least 12 characters with uppercase, lowercase and a number.</p>}
        {error && <div className="identity-error" role="alert">{error}</div>}
        <button className="button-primary identity-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in securely" : mode === "signup" ? "Create workspace" : "Accept invitation"} <ArrowRight size={15}/></button>
      </form>
      {mode === "invite" ? <button className="identity-mode-link" onClick={() => { setMode("login"); setError(""); }}>Back to sign in</button> : <button className="identity-mode-link" onClick={() => { setMode("invite"); setError(""); }}>Have an invitation token? Accept it</button>}
      <div className="identity-auth-foot"><ShieldCheck size={13}/> Protected by tenant-scoped access controls</div>
    </section>
    <p className="identity-auth-caption">AegisFlow · Enterprise AI Agent Operations</p>
  </main>;
}
