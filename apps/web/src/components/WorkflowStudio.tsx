import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDown, ArrowLeft, ArrowRight, Bot, Check, ChevronDown, CircleAlert, Clock3, GitBranch, LockKeyhole, LogIn, Plus, Save, ShieldCheck, Sparkles, Workflow as WorkflowIcon, X } from "lucide-react";

type NodeType = "start" | "agent" | "condition" | "approval" | "end";
type GraphNode = { id: string; type: NodeType; label: string; position: { x: number; y: number }; config: Record<string, unknown> };
type GraphEdge = { id: string; source: string; target: string; label?: string };
type WorkflowItem = { _id: string; name: string; slug: string; description?: string; status: "draft" | "published" | "archived"; latestVersion: number; activeVersion?: number | null; updatedAt: string };
type VersionItem = { version: number; changelog: string; nodes: GraphNode[]; edges: GraphEdge[]; graphHash: string; createdAt: string };
type WorkflowDetail = { workflow: WorkflowItem; versions: VersionItem[] };
type Issue = { code: string; message: string; nodeId?: string; edgeId?: string };

const API = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
const nodeMeta: Record<NodeType, { title: string; subtitle: string }> = {
  start: { title: "Start", subtitle: "Workflow entry point" },
  agent: { title: "Agent", subtitle: "Invoke a registered agent" },
  condition: { title: "Condition", subtitle: "Evaluate a branch expression" },
  approval: { title: "Human approval", subtitle: "Pause for an authorized reviewer" },
  end: { title: "End", subtitle: "Workflow completion" }
};
const newId = () => globalThis.crypto?.randomUUID?.() ?? `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export default function WorkflowStudio() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [name, setName] = useState("Untitled workflow");
  const [slug, setSlug] = useState("untitled-workflow");
  const [description, setDescription] = useState("");
  const [nodes, setNodes] = useState<GraphNode[]>([
    { id: "start", type: "start", label: "Start", position: { x: 60, y: 70 }, config: {} },
    { id: "finish", type: "end", label: "Complete", position: { x: 650, y: 70 }, config: {} }
  ]);
  const [edges, setEdges] = useState<GraphEdge[]>([{ id: "edge-start-finish", source: "start", target: "finish" }]);
  const [selectedNodeId, setSelectedNodeId] = useState("start");
  const [configText, setConfigText] = useState("{}");
  const [configError, setConfigError] = useState("");
  const [edgeSource, setEdgeSource] = useState("start");
  const [edgeTarget, setEdgeTarget] = useState("finish");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [draggingId, setDraggingId] = useState("");
  const [changelog, setChangelog] = useState("Updated workflow graph");

  const selectedNode = nodes.find(node => node.id === selectedNodeId) ?? null;
  const publishedVersion = detail?.workflow.activeVersion ?? null;
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
    const body = response.status === 204 ? null : await response.json().catch(() => null) as { data?: unknown; error?: { message?: string; details?: Issue[] } } | null;
    if (!response.ok) {
      if (response.status === 401) setToken("");
      const error = new Error(body?.error?.message ?? `Request failed (${response.status})`) as Error & { issues?: Issue[] };
      error.issues = body?.error?.details;
      throw error;
    }
    return body?.data;
  }, [token]);

  const loadWorkflows = useCallback(async () => {
    const result = await api("/workflows?limit=100") as { data: WorkflowItem[] };
    setItems(result.data ?? []);
  }, [api]);

  const loadDetail = useCallback(async (id: string) => {
    const result = await api(`/workflows/${id}`) as WorkflowDetail;
    setDetail(result);
    setSelectedId(id);
    setName(result.workflow.name);
    setSlug(result.workflow.slug);
    setDescription(result.workflow.description ?? "");
    const latest = result.versions.find(version => version.version === result.workflow.latestVersion) ?? result.versions[0];
    if (latest) {
      setNodes(latest.nodes);
      setEdges(latest.edges);
      setSelectedNodeId(latest.nodes[0]?.id ?? "");
      setConfigText(JSON.stringify(latest.nodes[0]?.config ?? {}, null, 2));
    }
    setIssues([]);
    setMessage("");
  }, [api]);

  useEffect(() => {
    if (!token) return;
    loadWorkflows().catch(error => setMessage(error.message));
  }, [token, loadWorkflows]);

  useEffect(() => {
    if (!selectedNode) return;
    setConfigText(JSON.stringify(selectedNode.config, null, 2));
    setConfigError("");
  }, [selectedNodeId]); // node selection is the intended config editor boundary

  const addNode = (type: NodeType) => {
    if (type === "start" && nodes.some(node => node.type === "start")) { setMessage("A workflow can contain exactly one start node."); return; }
    const id = newId();
    const count = nodes.length;
    const node: GraphNode = {
      id, type, label: nodeMeta[type].title,
      position: { x: 80 + (count % 3) * 220, y: 190 + Math.floor(count / 3) * 130 },
      config: type === "condition" ? { expression: "" } : type === "approval" ? { assigneeRole: "operator" } : {}
    };
    setNodes(current => [...current, node]);
    setSelectedNodeId(id);
    setEdgeSource(id);
    setIssues([]);
  };

  const saveNodeConfig = () => {
    try {
      const config = JSON.parse(configText) as Record<string, unknown>;
      if (!config || Array.isArray(config) || typeof config !== "object") throw new Error("Configuration must be a JSON object.");
      setNodes(current => current.map(node => node.id === selectedNodeId ? { ...node, config } : node));
      setConfigError("");
      setMessage("Node configuration applied to the draft.");
    } catch (error) { setConfigError(error instanceof Error ? error.message : "Invalid JSON."); }
  };

  const updatePosition = (id: string, x: number, y: number) => {
    setNodes(current => current.map(node => node.id === id ? { ...node, position: { x: Math.max(12, x), y: Math.max(12, y) } } : node));
  };

  const addEdge = () => {
    if (!edgeSource || !edgeTarget || edgeSource === edgeTarget) { setMessage("Choose two different nodes to connect."); return; }
    if (edges.some(edge => edge.source === edgeSource && edge.target === edgeTarget)) { setMessage("That connection already exists."); return; }
    setEdges(current => [...current, { id: newId(), source: edgeSource, target: edgeTarget }]);
    setIssues([]);
  };

  const graphPayload = useMemo(() => ({ changelog, nodes, edges }), [changelog, nodes, edges]);

  const saveWorkflow = async () => {
    setBusy(true); setMessage(""); setIssues([]);
    try {
      if (!name.trim() || !slug.trim()) throw new Error("Workflow name and slug are required.");
      if (selectedId) {
        await api(`/workflows/${selectedId}/versions`, { method: "POST", body: JSON.stringify(graphPayload) });
        await api(`/workflows/${selectedId}`, { method: "PATCH", body: JSON.stringify({ name, description }) });
        setMessage("New immutable version saved successfully.");
        await loadDetail(selectedId);
      } else {
        const result = await api("/workflows", { method: "POST", body: JSON.stringify({ name, slug, description, tags: ["workflow-studio"], graph: graphPayload }) }) as { workflow: WorkflowItem };
        setMessage("Workflow created as a draft.");
        await loadWorkflows();
        await loadDetail(result.workflow._id);
      }
    } catch (error) {
      const e = error as Error & { issues?: Issue[] };
      setMessage(e.message);
      setIssues(e.issues ?? []);
    } finally { setBusy(false); }
  };

  const publish = async (version: number) => {
    if (!selectedId) return;
    setBusy(true); setMessage("");
    try {
      await api(`/workflows/${selectedId}/versions/${version}/promote`, { method: "POST" });
      await loadWorkflows(); await loadDetail(selectedId);
      setMessage(`Version ${version} is now published. Earlier versions can be promoted to roll back.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Publish failed."); }
    finally { setBusy(false); }
  };

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault(); setAuthBusy(true); setAuthError("");
    try {
      const response = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email, password }) });
      const body = await response.json() as { data?: { accessToken?: string }; error?: { message?: string } };
      if (!response.ok || !body.data?.accessToken) throw new Error(body.error?.message ?? "Sign-in failed.");
      setToken(body.data.accessToken); setPassword("");
    } catch (error) { setAuthError(error instanceof Error ? error.message : "Unable to sign in."); }
    finally { setAuthBusy(false); }
  };

  const signOut = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch { /* local session is still cleared */ }
    setToken(""); setItems([]); setDetail(null); setSelectedId("");
  };

  if (!token) return <section className="studio-auth panel">
    <div className="studio-auth-mark"><LockKeyhole size={22}/></div>
    <span className="studio-kicker">SECURE WORKSPACE</span>
    <h1>Sign in to Workflow Studio</h1>
    <p>Use your AegisFlow account. Workflows are loaded from your authenticated workspace.</p>
    <form onSubmit={signIn} className="studio-login-form">
      <label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required placeholder="you@company.com"/></label>
      <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required/></label>
      {authError && <div className="studio-error"><CircleAlert size={15}/>{authError}</div>}
      <button className="button-primary" disabled={authBusy}><LogIn size={15}/>{authBusy ? "Signing in…" : "Sign in securely"}</button>
    </form>
    <small>Access is governed by your workspace role and workflow permissions.</small>
  </section>;

  return <div className="workflow-studio">
    <div className="studio-heading">
      <div><div className="eyebrow"><span className="live-dot"/> ORCHESTRATION DESIGN</div><h1>Workflow Studio</h1><p>Compose, validate and publish tenant-scoped agent workflows.</p></div>
      <div className="studio-heading-actions"><button className="button-secondary" onClick={signOut}>Sign out</button><button className="button-primary" onClick={() => { setDetail(null); setSelectedId(""); setName("Untitled workflow"); setSlug("untitled-workflow"); setDescription(""); setNodes([{ id: "start", type: "start", label: "Start", position: { x: 60, y: 70 }, config: {} }, { id: "finish", type: "end", label: "Complete", position: { x: 650, y: 70 }, config: {} }]); setEdges([{ id: "edge-start-finish", source: "start", target: "finish" }]); setSelectedNodeId("start"); setMessage("New draft ready. Add nodes and configure your graph."); }}><Plus size={15}/> New workflow</button></div>
    </div>
    <div className="studio-layout">
      <aside className="studio-library panel">
        <div className="studio-section-title"><div><h2>Workflows</h2><small>{items.length} in this workspace</small></div><button className="studio-icon-button" onClick={() => loadWorkflows().catch(error => setMessage(error.message))} aria-label="Refresh workflows"><Activity size={15}/></button></div>
        <div className="workflow-list">
          {items.map(item => <button key={item._id} className={selectedId === item._id ? "workflow-list-item selected" : "workflow-list-item"} onClick={() => loadDetail(item._id).catch(error => setMessage(error.message))}>
            <span className="workflow-list-icon"><WorkflowIcon size={16}/></span><span className="workflow-list-copy"><strong>{item.name}</strong><small>v{item.latestVersion} · {new Date(item.updatedAt).toLocaleDateString()}</small></span><span className={`workflow-status ${item.status}`}>{item.status}</span>
          </button>)}
          {!items.length && <div className="studio-empty"><WorkflowIcon size={22}/><strong>No workflows yet</strong><span>Create your first workflow draft.</span></div>}
        </div>
        <div className="studio-library-foot"><ShieldCheck size={14}/> Tenant workspace scope enforced by API</div>
      </aside>
      <section className="studio-editor">
        <div className="studio-editor-toolbar panel">
          <div className="studio-workflow-meta">
            <input aria-label="Workflow name" value={name} onChange={event => setName(event.target.value)} maxLength={120}/>
            <span className={`workflow-status ${detail?.workflow.status ?? "draft"}`}>{detail?.workflow.status ?? "draft"}</span>
            {detail && <small>Latest v{detail.workflow.latestVersion}{publishedVersion ? ` · Published v${publishedVersion}` : " · Not published"}</small>}
          </div>
          <div className="studio-toolbar-actions"><button className="button-secondary" onClick={saveWorkflow} disabled={busy}><Save size={14}/>{busy ? "Saving…" : selectedId ? "Save version" : "Save draft"}</button>{detail && <button className="button-primary" disabled={busy || detail.workflow.status === "archived"} onClick={() => publish(detail.workflow.latestVersion)}><Sparkles size={14}/> Publish v{detail.workflow.latestVersion}</button>}</div>
        </div>
        <div className="studio-description-row"><input aria-label="Workflow description" placeholder="Describe what this workflow does…" value={description} onChange={event => setDescription(event.target.value)}/><input aria-label="Workflow slug" placeholder="workflow-slug" value={slug} onChange={event => setSlug(event.target.value)} disabled={!!selectedId}/></div>
        <div className="studio-builder panel">
          <div className="studio-builder-head"><div><h2>Canvas</h2><p>Drag nodes to arrange · select a node to configure it</p></div><span className="studio-canvas-meta">{nodes.length} nodes · {edges.length} connections</span></div>
          <div className="studio-node-palette">
            {(Object.keys(nodeMeta) as NodeType[]).filter(type => type !== "start").map(type => <button key={type} onClick={() => addNode(type)}><Plus size={13}/>{nodeMeta[type].title}</button>)}
          </div>
          <div className="studio-canvas" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!draggingId) return; const rect = event.currentTarget.getBoundingClientRect(); updatePosition(draggingId, event.clientX - rect.left - 84, event.clientY - rect.top - 35); setDraggingId(""); }}>
            <div className="studio-canvas-grid"/>
            <svg className="studio-edges" aria-hidden="true">
              {edges.map(edge => {
                const source = nodes.find(node => node.id === edge.source), target = nodes.find(node => node.id === edge.target);
                if (!source || !target) return null;
                const sx = source.position.x + 82, sy = source.position.y + 35, tx = target.position.x + 82, ty = target.position.y + 35, mid = (sx + tx) / 2;
                return <g key={edge.id}><path d={`M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`} fill="none" stroke="#777cf1" strokeWidth="2" strokeDasharray="5 4"/><circle cx={tx} cy={ty} r="3" fill="#9b9fff"/></g>;
              })}
            </svg>
            {nodes.map(node => <button key={node.id} draggable onDragStart={() => setDraggingId(node.id)} onDragEnd={() => setDraggingId("")} onClick={() => setSelectedNodeId(node.id)} className={`studio-node node-${node.type} ${selectedNodeId === node.id ? "active" : ""}`} style={{ left: node.position.x, top: node.position.y }} aria-pressed={selectedNodeId === node.id}>
              <span className="studio-node-icon">{node.type === "agent" ? <Bot size={16}/> : node.type === "condition" ? <GitBranch size={16}/> : node.type === "approval" ? <ShieldCheck size={16}/> : node.type === "start" ? <ArrowRight size={16}/> : <Check size={16}/>}</span>
              <span><strong>{node.label}</strong><small>{nodeMeta[node.type].subtitle}</small></span>
              <span className="studio-node-grip">⠿</span>
            </button>)}
            {!nodes.length && <span className="studio-canvas-empty">Add nodes from the palette to start building.</span>}
          </div>
          <div className="studio-connect-row"><div><strong>Connect nodes</strong><small>Directed edges define execution order</small></div><select aria-label="Connection source" value={edgeSource} onChange={event => setEdgeSource(event.target.value)}>{nodes.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select><ArrowRight size={14}/><select aria-label="Connection target" value={edgeTarget} onChange={event => setEdgeTarget(event.target.value)}>{nodes.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select><button className="button-secondary" onClick={addEdge}>Connect</button></div>
        </div>
        <div className="studio-lower-grid">
          <section className="studio-config panel">
            <div className="studio-panel-head"><div><h2>Node configuration</h2><p>{selectedNode ? `${nodeMeta[selectedNode.type].title} · ${selectedNode.id}` : "Select a node on the canvas"}</p></div>{selectedNode && <button className="studio-icon-button danger" aria-label="Delete selected node" onClick={() => { if (selectedNode.type === "start" || selectedNode.type === "end") { setMessage("Start and end nodes cannot be removed."); return; } setNodes(current => current.filter(node => node.id !== selectedNode.id)); setEdges(current => current.filter(edge => edge.source !== selectedNode.id && edge.target !== selectedNode.id)); setSelectedNodeId("start"); }}><X size={15}/></button>}</div>
            {selectedNode ? <><label className="studio-field">Display label<input value={selectedNode.label} maxLength={120} onChange={event => setNodes(current => current.map(node => node.id === selectedNode.id ? { ...node, label: event.target.value } : node))}/></label><label className="studio-field">Node configuration <textarea value={configText} onChange={event => setConfigText(event.target.value)} spellCheck={false}/></label>{configError && <div className="studio-error"><CircleAlert size={14}/>{configError}</div>}<button className="button-secondary" onClick={saveNodeConfig}>Apply configuration</button></> : <div className="studio-empty">Choose a node to edit its settings.</div>}
          </section>
          <section className="studio-validation panel">
            <div className="studio-panel-head"><div><h2>Graph validation</h2><p>Server validation runs when saving a version</p></div><span className="validation-icon"><ShieldCheck size={17}/></span></div>
            <div className="validation-rule"><Check size={14}/> Exactly one start node</div>
            <div className="validation-rule"><Check size={14}/> At least one end node</div>
            <div className="validation-rule"><Check size={14}/> Valid, reachable acyclic graph</div>
            <div className="validation-rule"><LockKeyhole size={14}/> Tenant-owned agent references</div>
            <div className="validation-rule"><LockKeyhole size={14}/> Secret references only</div>
            {issues.map((issue, index) => <div className="studio-error" key={index}><CircleAlert size={14}/>{issue.message}</div>)}
            <small className="studio-validation-note">This checklist is descriptive; the API is authoritative.</small>
          </section>
        </div>
        {detail && <section className="studio-versions panel"><div className="studio-panel-head"><div><h2>Version history</h2><p>Snapshots are immutable; promote an older version to roll back.</p></div><Clock3 size={16}/></div>{detail.versions.map(version => <div className="studio-version-row" key={version.version}><span className="version-number">v{version.version}</span><span className="version-copy"><strong>{version.changelog || "Workflow snapshot"}</strong><small>{new Date(version.createdAt).toLocaleString()} · {version.graphHash.slice(0, 12)}…</small></span>{publishedVersion === version.version ? <span className="workflow-status published">Published</span> : <button className="text-link" disabled={busy} onClick={() => publish(version.version)}>Promote / rollback <ArrowRight size={13}/></button>}</div>)}</section>}
        {message && <div className={issues.length ? "studio-message error" : "studio-message"} role="status">{issues.length ? <CircleAlert size={15}/> : <Check size={15}/>}<span>{message}</span><button aria-label="Dismiss message" onClick={() => setMessage("")}><X size={14}/></button></div>}
      </section>
    </div>
  </div>;
}
