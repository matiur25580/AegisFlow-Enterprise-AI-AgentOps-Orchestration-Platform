import { useEffect, useState, type ReactNode } from "react";
import AuthScreen from "./auth/AuthScreen";
import IdentityCenter from "./auth/IdentityCenter";
import { useAuth } from "./auth/AuthContext";
import WorkflowStudio from "./components/WorkflowStudio";
import ApprovalsInbox from "./components/ApprovalsInbox";
import RunsTraces from "./components/RunsTraces";
import Evaluations from "./components/Evaluations";
import CostIntelligence from "./components/CostIntelligence";
import BudgetManagement from "./components/BudgetManagement";
import BudgetAlerts from "./components/BudgetAlerts";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bot, Boxes, ChevronDown, CircleHelp,
  Command, CreditCard, Gauge, GitBranch, LayoutDashboard, LifeBuoy, LockKeyhole,
  Menu, MoreHorizontal, Plus, Search, Settings2, ShieldCheck, Sparkles,
  Workflow, Zap, Bell, CheckCircle2, Clock3, AlertTriangle
} from "lucide-react";

type NavItem = { label: string; icon: typeof LayoutDashboard; section: string };
const nav: NavItem[] = [
  { label: "Overview", icon: LayoutDashboard, section: "Workspace" },
  { label: "Agent registry", icon: Bot, section: "Workspace" },
  { label: "Workflow studio", icon: Workflow, section: "Workspace" },
  { label: "Runs & traces", icon: Activity, section: "Operate" },
  { label: "Approvals", icon: ShieldCheck, section: "Operate" },
  { label: "Evaluations", icon: Sparkles, section: "Operate" },
  { label: "Incidents", icon: LifeBuoy, section: "Operate" },
  { label: "Integrations", icon: Boxes, section: "Govern" },
  { label: "Access & policies", icon: LockKeyhole, section: "Govern" },
  { label: "Usage & billing", icon: CreditCard, section: "Govern" },
  { label: "Budgets", icon: Gauge, section: "Govern" },
  { label: "Budget alerts", icon: Bell, section: "Govern" }
];

const activity = [
  { title: "Invoice extraction workflow", detail: "Production · run completed", time: "2 min ago", status: "success" },
  { title: "Customer support agent", detail: "Staging · evaluation passed", time: "18 min ago", status: "success" },
  { title: "Vendor risk classifier", detail: "Production · approval required", time: "31 min ago", status: "warning" },
  { title: "Knowledge sync pipeline", detail: "Production · retry scheduled", time: "46 min ago", status: "pending" }
];

function App() {
  const { user, tenant, role, loading, workspaces, loadWorkspaces, switchWorkspace, signOut } = useAuth();
  const [active, setActive] = useState("Overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [period, setPeriod] = useState("24 hours");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);

  useEffect(() => { if (user) void loadWorkspaces(); }, [user, loadWorkspaces]);

  if (loading) return <main className="identity-loading"><div className="brand-mark"><Command size={19}/></div><p>Restoring your secure session…</p></main>;
  if (!user) return <AuthScreen />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#" aria-label="AegisFlow home">
          <span className="brand-mark"><Command size={19} /></span>
          <span><strong>AegisFlow</strong><small>AGENT OPERATIONS</small></span>
        </a>
        <button className="workspace-switch" type="button" aria-expanded={workspaceMenuOpen} onClick={() => setWorkspaceMenuOpen(value => !value)}>
          <span className="workspace-avatar">{tenant?.name?.slice(0, 1).toUpperCase() ?? "W"}</span>
          <span className="workspace-copy"><strong>{tenant?.name ?? "Workspace"}</strong><small>{role ?? "Member"} workspace</small></span>
          <ChevronDown size={15} />
        </button>
        {workspaceMenuOpen && <div className="workspace-menu">{workspaces.map(workspace => <button key={workspace.id} className={workspace.tenant.id === tenant?.id ? "current" : ""} onClick={async () => { if (workspace.tenant.id !== tenant?.id) await switchWorkspace(workspace.tenant.id); setWorkspaceMenuOpen(false); }}><span>{workspace.tenant.name}</span><small>{workspace.role}</small></button>)}{workspaces.length === 0 && <p>No other workspaces</p>}</div>}
        {["Workspace", "Operate", "Govern"].map(section => (
          <div className="nav-section" key={section}>
            <p className="nav-heading">{section}</p>
            {nav.filter(item => item.section === section).map(item => {
              const Icon = item.icon;
              return <button key={item.label} onClick={() => { setActive(item.label); setSidebarOpen(false); }} className={`nav-link ${active === item.label ? "active" : ""}`} aria-current={active === item.label ? "page" : undefined}>
                <Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>
                {item.label === "Approvals" && <span className="nav-count">4</span>}
              </button>;
            })}
          </div>
        ))}
        <div className="sidebar-bottom">
          <button className="nav-link" onClick={() => setActive("Access & policies")}><Settings2 size={17} /><span>Identity settings</span></button>
          <button className="nav-link" onClick={() => void signOut()}><LockKeyhole size={17} /><span>Sign out</span></button>
          <button className="help-card"><span className="help-icon"><CircleHelp size={17} /></span><span><strong>Need a hand?</strong><small>Visit the knowledge center</small></span><ArrowUpRight size={14} /></button>
          <div className="profile-row"><div className="profile-avatar">{user.displayName.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase()}</div><span><strong>{user.displayName}</strong><small>{role} · {user.email}</small></span><MoreHorizontal size={18} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation"><Menu size={19} /></button>
          <div className="breadcrumbs"><span>{tenant?.name ?? "Workspace"}</span><span className="crumb-slash">/</span><strong>{active}</strong></div>
          <div className="top-actions">
            <button className="search-trigger"><Search size={16} /><span>Search anything</span><kbd>⌘ K</kbd></button>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <button className="top-avatar profile-trigger" title={user.email} onClick={() => void signOut()}>{user.displayName.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase()}</button>
          </div>
        </header>

        <div className="content">
          {active === "Access & policies" ? <IdentityCenter /> : active === "Approvals" ? <ApprovalsInbox /> : active === "Runs & traces" ? <RunsTraces /> : active === "Evaluations" ? <Evaluations /> : active === "Workflow studio" ? <WorkflowStudio /> : active === "Usage & billing" ? <CostIntelligence /> : active === "Budgets" ? <BudgetManagement /> : active === "Budget alerts" ? <BudgetAlerts /> : <>
          <div className="page-heading">
            <div><div className="eyebrow"><span className="live-dot" /> SYSTEM OPERATIONAL</div><h1>{active === "Overview" ? `Good morning, ${user.displayName.split(" ")[0]}` : active}</h1><p>Here's what's happening across your AI operations today.</p></div>
            <div className="heading-actions"><button className="button-secondary"><GitBranch size={15} /> Production <ChevronDown size={14} /></button><button className="button-primary"><Plus size={16} /> Create agent</button></div>
          </div>

          <section className="metrics-grid" aria-label="Platform metrics">
            <Metric title="Active agents" value="24" change="+3 this week" icon={<Bot size={17} />} trend="up" foot="Across 4 environments" />
            <Metric title="Workflow executions" value="18,429" change="+12.8%" icon={<Workflow size={17} />} trend="up" foot="vs. previous 24 hours" />
            <Metric title="Success rate" value="99.82%" change="+0.24%" icon={<CheckCircle2 size={17} />} trend="up" foot="Target ≥ 99.5%" />
            <Metric title="AI spend" value="$284.62" change="-8.4%" icon={<Zap size={17} />} trend="down" foot="Month-to-date · USD" />
          </section>

          <section className="primary-grid">
            <div className="panel execution-panel">
              <div className="panel-header"><div><h2>Execution volume</h2><p>Workflow runs across your environment</p></div><select value={period} onChange={e => setPeriod(e.target.value)} aria-label="Execution chart time range"><option>24 hours</option><option>7 days</option><option>30 days</option></select></div>
              <div className="chart-summary"><strong>18,429</strong><span className="trend-pill"><ArrowUpRight size={13} /> 12.8%</span><span className="muted">vs. previous period</span></div>
              <div className="chart" role="img" aria-label="Illustrative area chart showing workflow execution volume trending upward during the selected period">
                <div className="chart-y-labels"><span>2.0k</span><span>1.5k</span><span>1.0k</span><span>0.5k</span><span>0</span></div>
                <svg viewBox="0 0 700 190" preserveAspectRatio="none" aria-hidden="true">
                  <defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#7c83ff" stopOpacity=".28"/><stop offset="100%" stopColor="#7c83ff" stopOpacity="0"/></linearGradient></defs>
                  {[18,58,98,138,178].map(y => <line key={y} x1="0" x2="700" y1={y} y2={y} stroke="#242b3c" strokeDasharray="3 5" />)}
                  <path d="M0 145 C35 139 43 113 75 121 S126 137 150 105 S196 115 225 93 S272 113 300 81 S348 98 375 74 S420 87 450 60 S496 81 525 53 S570 70 600 39 S650 48 700 17 L700 190 L0 190Z" fill="url(#area)"/>
                  <path d="M0 145 C35 139 43 113 75 121 S126 137 150 105 S196 115 225 93 S272 113 300 81 S348 98 375 74 S420 87 450 60 S496 81 525 53 S570 70 600 39 S650 48 700 17" fill="none" stroke="#858bff" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
                  <circle cx="600" cy="39" r="4" fill="#a6a9ff" stroke="#171d2c" strokeWidth="3"/>
                </svg>
                <div className="chart-x-labels"><span>00:00</span><span>04:00</span><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>Now</span></div>
              </div>
              <div className="chart-legend"><span><i className="legend-dot purple" /> Successful runs</span><span><i className="legend-dot muted-dot" /> Failed / retried</span><span className="illustrative-note">Illustrative preview data</span></div>
            </div>

            <div className="panel health-panel">
              <div className="panel-header"><div><h2>Reliability posture</h2><p>Live platform health snapshot</p></div><button className="icon-button subtle" aria-label="More reliability options"><MoreHorizontal size={18} /></button></div>
              <div className="health-score"><div className="score-ring"><div><strong>98</strong><small>/ 100</small></div></div><div><strong>Excellent</strong><p>All core systems healthy</p></div></div>
              <div className="health-list">
                <HealthRow icon={<CheckCircle2 />} title="API availability" value="99.99%" state="healthy" />
                <HealthRow icon={<CheckCircle2 />} title="Queue processing" value="Normal" state="healthy" />
                <HealthRow icon={<AlertTriangle />} title="Pending approvals" value="4 waiting" state="attention" />
                <HealthRow icon={<Clock3 />} title="Avg. response time" value="842 ms" state="healthy" />
              </div>
              <button className="text-link" onClick={() => setActive("Incidents")}>View reliability center <ArrowUpRight size={14} /></button>
            </div>
          </section>

          <section className="bottom-grid">
            <div className="panel activity-panel">
              <div className="panel-header"><div><h2>Recent activity</h2><p>Latest events from your agent fleet</p></div><button className="text-link">View all <ArrowUpRight size={14} /></button></div>
              <div className="activity-list">{activity.map(item => <div className="activity-item" key={item.title}><span className={`activity-status ${item.status}`}>{item.status === "success" ? <CheckCircle2 size={15}/> : item.status === "warning" ? <ShieldCheck size={15}/> : <Clock3 size={15}/>}</span><span className="activity-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><time>{item.time}</time></div>)}</div>
            </div>
            <div className="panel quick-panel">
              <div className="panel-header"><div><h2>Quick actions</h2><p>Move your operations forward</p></div></div>
              <button className="quick-action"><span className="quick-icon violet"><Bot size={17}/></span><span><strong>Register an agent</strong><small>Add a new agent to your fleet</small></span><ArrowUpRight size={15}/></button>
              <button className="quick-action"><span className="quick-icon blue"><Workflow size={17}/></span><span><strong>Build a workflow</strong><small>Design an orchestration flow</small></span><ArrowUpRight size={15}/></button>
              <button className="quick-action"><span className="quick-icon green"><Sparkles size={17}/></span><span><strong>Run an evaluation</strong><small>Measure agent quality</small></span><ArrowUpRight size={15}/></button>
            </div>
          </section>
          <footer className="footer"><span>© 2026 AegisFlow Systems</span><span><i className="live-dot"/> All systems operational</span><span>Platform preview · v0.1.0</span></footer>
          </>}
        </div>
      </main>
      {sidebarOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
}

function Metric({ title, value, change, icon, trend, foot }: { title: string; value: string; change: string; icon: ReactNode; trend: "up" | "down"; foot: string }) {
  return <article className="panel metric-card"><div className="metric-top"><span>{title}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{value}</div><div className="metric-bottom"><span className={`metric-change ${trend}`}>{trend === "up" ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>} {change}</span><span className="metric-foot">{foot}</span></div></article>;
}

function HealthRow({ icon, title, value, state }: { icon: ReactNode; title: string; value: string; state: "healthy" | "attention" }) {
  return <div className="health-row"><span className={`health-icon ${state}`}>{icon}</span><span>{title}</span><strong>{value}</strong></div>;
}

export default App;
