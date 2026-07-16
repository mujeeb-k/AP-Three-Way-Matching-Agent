import { useState, useEffect, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  LayoutDashboard,
  ListTodo,
  Moon,
  Settings,
  Sun,
  Zap,
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import WorkQueue from './pages/WorkQueue'
import WorkItemDetail from './pages/WorkItemDetail'
import TimelinePage from './pages/TimelinePage'
import ConfigPage from './pages/ConfigPage'
import AssistantPage from './pages/AssistantPage'
import AssistantHistoryPage from './pages/AssistantHistoryPage'
import { fetchStats } from './api'

// Sidebar context
interface SidebarContextType { collapsed: boolean; setCollapsed: (v: boolean) => void; queueBadge: number }
const SidebarContext = createContext<SidebarContextType>({ collapsed: false, setCollapsed: () => {}, queueBadge: 0 })
export const useSidebar = () => useContext(SidebarContext)

// Theme context
interface ThemeContextType { dark: boolean; toggleTheme: () => void }
const ThemeContext = createContext<ThemeContextType>({ dark: false, toggleTheme: () => {} })
export const useTheme = () => useContext(ThemeContext)

// Navigation
const NAV_TOP = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/queue', label: 'Work Queue', icon: ListTodo, showBadge: true },
  { to: '/timeline', label: 'Timeline', icon: Clock3 },
  { to: '/assistant', label: 'AP Copilot', icon: Bot },
]
const NAV_BOTTOM = [
  { to: '/assistant/history', label: 'Copilot History', icon: History },
]

// ConfigNavLink — extracted so it can call useLocation as a real component
function ConfigNavLink({ collapsed }: { collapsed: boolean }) {
  const { pathname } = useLocation()
  const active = pathname === '/config'
  return (
    <NavLink
      to="/config"
      className="sidebar-tooltip sidebar-control"
      data-tooltip={collapsed ? 'Configuration' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 18px', margin: '1px 6px', borderRadius: 2,
        background: active ? 'var(--bg-active)' : 'transparent',
        border: active ? '1px solid var(--border-active)' : '1px solid transparent',
        cursor: 'pointer', textDecoration: 'none',
      }}
    >
      <Settings size={16} aria-hidden="true" style={{ color: active ? 'var(--text-primary)' : 'var(--text-tertiary)', flexShrink: 0 }} />
      <span className="sidebar-label font-sans" style={{ fontSize: 14, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: active ? 500 : 400 }}>
        Configuration
      </span>
    </NavLink>
  )
}

// Sidebar
function Sidebar() {
  const { collapsed, setCollapsed, queueBadge } = useSidebar()
  const { dark, toggleTheme } = useTheme()
  const { pathname } = useLocation()

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname.startsWith(to)

  const w = collapsed ? 60 : 300

  return (
    <aside
      className="sidebar flex flex-col flex-shrink-0 h-full"
      style={{ width: w, minWidth: w, background: 'var(--bg-surface)', borderRight: '1px solid var(--border-default)' }}
    >
      {/* Product identity */}
      <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid var(--border-default)' }}>
        <div className="flex items-center" style={{ gap: 8, marginBottom: 4 }}>
          <Zap size={17} aria-hidden="true" style={{ color: 'var(--accent-link)', flexShrink: 0 }} />
          <span className="sidebar-label font-sans" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            AP Three-Way-Matching Agent
          </span>
        </div>
        <div className="sidebar-label font-mono" style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', paddingLeft: 24 }}>
          DEMO WORKSPACE
        </div>
      </div>

      {/* Top nav */}
      <nav style={{ padding: '8px 0' }}>
        {NAV_TOP.map(({ to, label, icon: Icon, exact, showBadge }) => {
          const active = isActive(to, exact)
          const badge = showBadge ? queueBadge : 0
          return (
            <NavLink
              key={to}
              to={to}
              className="sidebar-tooltip sidebar-control"
              data-tooltip={collapsed ? label : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 18px', margin: '1px 6px', borderRadius: 2,
                background: active ? 'var(--bg-active)' : 'transparent',
                border: active ? '1px solid var(--border-active)' : '1px solid transparent',
                cursor: 'pointer', textDecoration: 'none', position: 'relative',
              }}
            >
              <Icon size={16} aria-hidden="true" style={{ color: active ? 'var(--text-primary)' : 'var(--text-tertiary)', flexShrink: 0 }} />
              <span className="sidebar-label font-sans" style={{ fontSize: 14, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: active ? 500 : 400 }}>
                {label}
              </span>
              {/* Badge (Work Queue pending count — live from API) */}
              {badge > 0 && !collapsed && (
                <span className="ml-auto font-mono" style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 10, fontSize: 9, fontWeight: 700, background: 'var(--status-critical)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {badge}
                </span>
              )}
              {badge > 0 && collapsed && (
                <span style={{ position: 'absolute', top: 6, right: 8, width: 6, height: 6, borderRadius: '50%', background: 'var(--status-critical)' }} />
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom nav */}
      <nav>
        {NAV_BOTTOM.map(({ to, label, icon: Icon }) => {
          const active = isActive(to)
          return (
            <NavLink key={to} to={to} className="sidebar-tooltip sidebar-control" data-tooltip={collapsed ? label : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px', margin: '1px 6px', borderRadius: 2, background: active ? 'var(--bg-active)' : 'transparent', border: active ? '1px solid var(--border-active)' : '1px solid transparent', cursor: 'pointer', textDecoration: 'none' }}
            >
              <Icon size={16} aria-hidden="true" style={{ color: active ? 'var(--text-primary)' : 'var(--text-tertiary)', flexShrink: 0 }} />
              <span className="sidebar-label font-sans" style={{ fontSize: 14, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: active ? 500 : 400 }}>{label}</span>
            </NavLink>
          )
        })}

        {/* Theme toggle */}
        <button onClick={toggleTheme} className="sidebar-tooltip sidebar-control" data-tooltip={collapsed ? (dark ? 'Light Mode' : 'Dark Mode') : undefined}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px', margin: '1px 6px', borderRadius: 2, background: 'transparent', border: '1px solid transparent', cursor: 'pointer', width: 'calc(100% - 12px)', textAlign: 'left' }}
        >
          {dark
            ? <Sun size={16} aria-hidden="true" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
            : <Moon size={16} aria-hidden="true" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
          <span className="sidebar-label font-sans" style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            {dark ? 'Light Mode' : 'Dark Mode'}
          </span>
        </button>

        {/* Configuration */}
        <ConfigNavLink collapsed={collapsed} />
      </nav>

      {/* User + collapse */}
      <div className="flex items-center flex-shrink-0" style={{ padding: '12px 18px', borderTop: '1px solid var(--border-default)' }}>
        <div className="flex items-center justify-center flex-shrink-0 font-mono" style={{ width: 26, height: 26, borderRadius: 2, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', fontSize: 10, fontWeight: 700, color: 'var(--accent-link)' }}>
          AP
        </div>
        <div className="sidebar-label" style={{ marginLeft: 8 }}>
          <div className="font-sans" style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.2 }}>AP Analyst</div>
          <div className="font-mono" style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Demo Workspace</div>
        </div>
        <button onClick={() => setCollapsed(!collapsed)} className="ml-auto flex items-center justify-center sidebar-tooltip sidebar-collapse-control" data-tooltip={collapsed ? 'Expand' : undefined}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ width: 40, height: 40, padding: 0, borderRadius: 2, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>
    </aside>
  )
}

// Page wrapper
function PageWrapper({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return <div key={pathname} className="page-enter h-full">{children}</div>
}

// App
export default function App() {
  // Persist the selected theme and sidebar state.
  const [dark, setDark] = useState(() => localStorage.getItem('ap-recon-theme') === 'dark')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ap-recon-sidebar') === 'collapsed')
  const [queueBadge, setQueueBadge] = useState(0)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('ap-recon-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    localStorage.setItem('ap-recon-sidebar', collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

  // Live badge count: pending + in-review items
  useEffect(() => {
    fetchStats()
      .then(s => setQueueBadge((s.pending ?? 0) + (s.inReview ?? 0)))
      .catch(() => {})
  }, [])

  return (
    <ThemeContext.Provider value={{ dark, toggleTheme: () => setDark(d => !d) }}>
      <SidebarContext.Provider value={{ collapsed, setCollapsed, queueBadge }}>
        <BrowserRouter>
          <div className={collapsed ? 'sidebar-collapsed' : ''} style={{ height: '100dvh', display: 'flex', overflow: 'hidden', background: 'var(--bg-base)' }}>
            <Sidebar />
            <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflow: 'hidden', padding: '24px 28px' }}>
                <PageWrapper>
                  <Routes>
                    <Route path="/"              element={<Dashboard />} />
                    <Route path="/queue"         element={<WorkQueue />} />
                    <Route path="/queue/:id"     element={<WorkItemDetail />} />
                    <Route path="/timeline"      element={<TimelinePage />} />
                    <Route path="/config"        element={<ConfigPage />} />
                    <Route path="/assistant"         element={<AssistantPage />} />
                    <Route path="/assistant/history" element={<AssistantHistoryPage />} />
                  </Routes>
                </PageWrapper>
              </div>
            </main>
          </div>
        </BrowserRouter>
      </SidebarContext.Provider>
    </ThemeContext.Provider>
  )
}
