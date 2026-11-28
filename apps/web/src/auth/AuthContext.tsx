import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiRequest, refreshAccessToken, type ApiError } from "../lib/api";

export type IdentityUser = { id: string; email: string; displayName: string };
export type IdentityTenant = { id: string; name: string; slug: string; plan?: string };
export type WorkspaceMembership = { id: string; tenant: IdentityTenant; role: "owner" | "admin" | "operator" | "viewer" };
type AuthPayload = { accessToken: string; user: IdentityUser; tenant: IdentityTenant; role: WorkspaceMembership["role"] };
type AuthContextValue = {
  user: IdentityUser | null;
  tenant: IdentityTenant | null;
  role: WorkspaceMembership["role"] | null;
  accessToken: string | null;
  loading: boolean;
  workspaces: WorkspaceMembership[];
  api: <T>(path: string, options?: RequestInit) => Promise<T>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { organizationName: string; displayName: string; email: string; password: string }) => Promise<void>;
  acceptInvitation: (token: string, displayName: string, password: string) => Promise<void>;
  switchWorkspace: (tenantId: string) => Promise<void>;
  loadWorkspaces: () => Promise<void>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<IdentityUser | null>(null);
  const [tenant, setTenant] = useState<IdentityTenant | null>(null);
  const [role, setRole] = useState<WorkspaceMembership["role"] | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const tokenRef = useRef<string | null>(null);
  const setToken = useCallback((value: string | null) => {
    tokenRef.current = value;
    setAccessToken(value);
  }, []);

  const hydrate = useCallback(async (token: string) => {
    const me = await apiRequest<{ user: IdentityUser; tenant: IdentityTenant; membership: { id: string; role: WorkspaceMembership["role"] } }>("/auth/me", {}, token);
    setUser(me.user);
    setTenant(me.tenant);
    setRole(me.membership.role);
    setToken(token);
  }, [setToken]);

  useEffect(() => {
    let active = true;
    refreshAccessToken()
      .then(({ accessToken: token }) => active ? hydrate(token) : undefined)
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [hydrate]);

  const api = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const token = tokenRef.current;
    try {
      return await apiRequest<T>(path, options, token);
    } catch (error) {
      if ((error as ApiError).status !== 401 || !token) throw error;
      const refreshed = await refreshAccessToken();
      setToken(refreshed.accessToken);
      return apiRequest<T>(path, options, refreshed.accessToken);
    }
  }, [setToken]);

  const applyAuth = useCallback((payload: AuthPayload) => {
    setUser(payload.user);
    setTenant(payload.tenant);
    setRole(payload.role);
    setToken(payload.accessToken);
    setWorkspaces([]);
  }, [setToken]);

  const signIn = useCallback(async (email: string, password: string) => {
    const payload = await apiRequest<AuthPayload>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    applyAuth(payload);
  }, [applyAuth]);

  const signUp = useCallback(async (input: { organizationName: string; displayName: string; email: string; password: string }) => {
    const payload = await apiRequest<AuthPayload>("/auth/signup", { method: "POST", body: JSON.stringify(input) });
    applyAuth(payload);
  }, [applyAuth]);

  const acceptInvitation = useCallback(async (token: string, displayName: string, password: string) => {
    const payload = await apiRequest<AuthPayload>("/auth/accept-invitation", { method: "POST", body: JSON.stringify({ token, displayName, password }) });
    applyAuth(payload);
  }, [applyAuth]);

  const loadWorkspaces = useCallback(async () => {
    const result = await api<{ data: WorkspaceMembership[] }>("/auth/workspaces");
    setWorkspaces(result.data);
  }, [api]);

  const switchWorkspace = useCallback(async (tenantId: string) => {
    const result = await api<{ accessToken: string; tenant: IdentityTenant; role: WorkspaceMembership["role"] }>("/auth/switch-workspace", {
      method: "POST", body: JSON.stringify({ tenantId })
    });
    setToken(result.accessToken);
    setTenant(result.tenant);
    setRole(result.role);
    await loadWorkspaces();
  }, [api, loadWorkspaces, setToken]);

  const signOut = useCallback(async () => {
    try { await apiRequest("/auth/logout", { method: "POST" }, tokenRef.current); }
    finally {
      setToken(null);
      setUser(null);
      setTenant(null);
      setRole(null);
      setWorkspaces([]);
    }
  }, [setToken]);

  const value = useMemo(() => ({
    user, tenant, role, accessToken, loading, workspaces, api, signIn, signUp,
    acceptInvitation, switchWorkspace, loadWorkspaces, signOut
  }), [user, tenant, role, accessToken, loading, workspaces, api, signIn, signUp, acceptInvitation, switchWorkspace, loadWorkspaces, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
