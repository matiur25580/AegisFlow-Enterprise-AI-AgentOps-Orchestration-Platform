import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, MailPlus, RefreshCw, Shield, ShieldCheck, UserRound, Users, XCircle } from "lucide-react";
import { useAuth } from "./AuthContext";

type Member = { _id: string; role: "owner" | "admin" | "operator" | "viewer"; status: "active" | "suspended"; userId: { _id: string; email: string; displayName: string; status: string } | null };
type Invitation = { _id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; createdAt: string };
type Session = { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; current: boolean; userAgent: string | null };
type Tab = "members" | "invitations" | "sessions";

export default function IdentityCenter() {
  const { api, role, user } = useAuth();
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "operator" | "viewer">("operator");
  const [createdToken, setCreatedToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const canManage = role === "owner" || role === "admin";

  const load = useCallback(async () => {
    setError("");
    try {
      const [memberResult, invitationResult, sessionResult] = await Promise.all([
        api<Member[]>("/workspace/members"),
        api<Invitation[]>("/workspace/invitations"),
        api<Session[]>("/auth/sessions")
      ]);
      setMembers(memberResult);
      setInvitations(invitationResult);
      setSessions(sessionResult);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load identity data."); }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage(""); setCreatedToken("");
    try {
      const result = await api<{ id: string; email: string; invitationToken: string; expiresAt: string }>("/workspace/invitations", {
        method: "POST", body: JSON.stringify({ email, role: inviteRole })
      });
      setCreatedToken(result.invitationToken);
      setEmail("");
      setMessage("Invitation created. Copy the one-time token now; it will not be shown again.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create invitation."); }
    finally { setBusy(false); }
  }

  async function updateMember(member: Member, change: { role?: string; status?: string }) {
    setError(""); setMessage("");
    try {
      await api(`/workspace/members/${member._id}/${change.role ? "role" : "status"}`, {
        method: "PATCH", body: JSON.stringify(change)
      });
      setMessage("Membership updated.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update membership."); }
  }

  async function revokeInvitation(id: string) {
    setError(""); setMessage("");
    try { await api(`/workspace/invitations/${id}/revoke`, { method: "POST" }); setMessage("Invitation revoked."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to revoke invitation."); }
  }

  async function revokeSession(id: string) {
    setError(""); setMessage("");
    try { await api(`/auth/sessions/${id}`, { method: "DELETE" }); setMessage("Session revoked."); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to revoke session."); }
  }

  async function revokeOtherSessions() {
    setError(""); setMessage("");
    try {
      const result = await api<{ revokedCount: number }>("/auth/sessions/revoke-others", { method: "POST" });
      setMessage(`${result.revokedCount} other session(s) revoked.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to revoke other sessions."); }
  }

  const pendingInvites = invitations.filter(item => !item.acceptedAt && !item.revokedAt && new Date(item.expiresAt) > new Date()).length;
  const activeMembers = members.filter(member => member.status === "active").length;

  return <section className="identity-center">
    <div className="identity-page-heading">
      <div><div className="eyebrow"><span className="live-dot"/> GOVERNANCE & SECURITY</div><h1>Identity & access</h1><p>Manage workspace membership, invitations and active sessions.</p></div>
      <button className="button-secondary" onClick={() => void load()}><RefreshCw size={14}/> Refresh</button>
    </div>
    <div className="identity-stats">
      <article className="panel"><span><Users size={16}/> Workspace members</span><strong>{members.length}</strong><small>{activeMembers} active</small></article>
      <article className="panel"><span><MailPlus size={16}/> Pending invitations</span><strong>{pendingInvites}</strong><small>Expire after seven days</small></article>
      <article className="panel"><span><KeyRound size={16}/> Active sessions</span><strong>{sessions.filter(item => !item.revokedAt && new Date(item.expiresAt) > new Date()).length}</strong><small>Current user · this workspace</small></article>
    </div>
    {error && <div className="identity-error" role="alert">{error}</div>}
    {message && <div className="identity-success" role="status"><Check size={14}/>{message}</div>}
    <div className="panel identity-workspace-panel">
      <div className="identity-panel-heading"><div><h2><ShieldCheck size={17}/> Workspace access</h2><p>Signed in as {user?.email} · your role is <strong>{role}</strong></p></div><span className="identity-secure-label"><Shield size={13}/> Tenant scoped</span></div>
      <div className="identity-tabs" role="tablist" aria-label="Identity management sections">
        <button className={tab === "members" ? "selected" : ""} onClick={() => setTab("members")}><Users size={14}/> Members</button>
        <button className={tab === "invitations" ? "selected" : ""} onClick={() => setTab("invitations")}><MailPlus size={14}/> Invitations</button>
        <button className={tab === "sessions" ? "selected" : ""} onClick={() => setTab("sessions")}><KeyRound size={14}/> Sessions</button>
      </div>
      {tab === "members" && <>
        <div className="identity-table-head"><span>MEMBER</span><span>ROLE</span><span>STATUS</span><span>ACTIONS</span></div>
        {members.map(member => {
          const isSelf = member.userId?._id === user?.id;
          const protectedMember = member.role === "owner" || isSelf;
          return <div className="identity-table-row" key={member._id}>
            <div className="identity-member-cell"><span className="identity-member-avatar"><UserRound size={15}/></span><span><strong>{member.userId?.displayName ?? "Unknown user"}{isSelf ? " (you)" : ""}</strong><small>{member.userId?.email ?? "Account unavailable"}</small></span></div>
            <div>{member.role === "owner" || (member.role === "admin" && role !== "owner") ? <span className="identity-role-pill">{member.role}</span> : <select aria-label={`Role for ${member.userId?.email ?? "member"}`} value={member.role} disabled={!canManage || protectedMember} onChange={e => void updateMember(member, { role: e.target.value })}><option value="admin">Admin</option><option value="operator">Operator</option><option value="viewer">Viewer</option></select>}</div>
            <span className={`identity-status ${member.status}`}>{member.status}</span>
            <div>{!protectedMember && canManage && (role === "owner" || member.role !== "admin") ? <button className="identity-row-action" onClick={() => void updateMember(member, { status: member.status === "active" ? "suspended" : "active" })}>{member.status === "active" ? "Suspend" : "Reactivate"}</button> : <span className="identity-muted">Protected</span>}</div>
          </div>;
        })}
        {members.length === 0 && <div className="identity-empty">No workspace members were returned.</div>}
      </>}
      {tab === "invitations" && <>
        {canManage && <form className="identity-invite-form" onSubmit={createInvitation}>
          <label>Invite a teammate<input type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@company.com"/></label>
          <label>Workspace role<select value={inviteRole} onChange={e => setInviteRole(e.target.value as typeof inviteRole)}><option value="operator">Operator</option><option value="viewer">Viewer</option>{role === "owner" && <option value="admin">Admin</option>}</select></label>
          <button className="button-primary" type="submit" disabled={busy}><MailPlus size={14}/>{busy ? "Creating…" : "Create invitation"}</button>
        </form>}
        {createdToken && <div className="identity-token-panel"><div><strong>One-time invitation token</strong><small>Copy this now. The token is shown only once and is not emailed automatically.</small></div><code>{createdToken}</code><button className="button-secondary" onClick={() => void navigator.clipboard.writeText(createdToken)}><Copy size={13}/> Copy token</button></div>}
        <div className="identity-table-head invite-head"><span>EMAIL</span><span>ROLE</span><span>EXPIRES</span><span>STATUS</span></div>
        {invitations.map(invite => {
          const status = invite.acceptedAt ? "Accepted" : invite.revokedAt ? "Revoked" : new Date(invite.expiresAt) <= new Date() ? "Expired" : "Pending";
          return <div className="identity-table-row invite-row" key={invite._id}><div><strong>{invite.email}</strong><small>Created {new Date(invite.createdAt).toLocaleDateString()}</small></div><span className="identity-role-pill">{invite.role}</span><span>{new Date(invite.expiresAt).toLocaleDateString()}</span><div className="identity-invite-status"><span className={`identity-status ${status.toLowerCase()}`}>{status}</span>{status === "Pending" && canManage && <button className="identity-row-action danger" onClick={() => void revokeInvitation(invite._id)}>Revoke</button>}</div></div>;
        })}
        {invitations.length === 0 && <div className="identity-empty">No invitations yet.</div>}
        <p className="identity-footnote">Email delivery is not configured. Share invitation tokens through an approved secure channel. Invitation tokens grant access only after successful acceptance.</p>
      </>}
      {tab === "sessions" && <>
        <div className="identity-session-toolbar"><p>Sessions for your account in this workspace. Revoking a session prevents its refresh token from being used again.</p><button className="button-secondary" onClick={() => void revokeOtherSessions()}><XCircle size={14}/> Revoke other sessions</button></div>
        {sessions.map(session => <div className="identity-session-row" key={session.id}><span className="identity-session-icon"><KeyRound size={16}/></span><div><strong>{session.current ? "This device" : session.userAgent || "Other device"}</strong><small>Created {new Date(session.createdAt).toLocaleString()} · expires {new Date(session.expiresAt).toLocaleDateString()}</small></div><span className={`identity-status ${session.revokedAt ? "revoked" : new Date(session.expiresAt) <= new Date() ? "expired" : "active"}`}>{session.revokedAt ? "Revoked" : new Date(session.expiresAt) <= new Date() ? "Expired" : session.current ? "Current" : "Active"}</span>{!session.revokedAt && new Date(session.expiresAt) > new Date() && !session.current && <button className="identity-row-action danger" onClick={() => void revokeSession(session.id)}>Revoke</button>}</div>)}
        {sessions.length === 0 && <div className="identity-empty">No sessions found.</div>}
      </>}
    </div>
    <p className="identity-security-note"><ShieldCheck size={14}/> Access decisions are enforced by the API. Hiding a control in this interface is not a substitute for server-side authorization.</p>
  </section>;
}
