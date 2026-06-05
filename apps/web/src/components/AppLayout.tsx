import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LayoutDashboard, ArrowLeftRight, Tag, Wallet, LogOut, MessageCircleMore, Smartphone, Repeat, CreditCard, BarChart2, Upload, Sparkles, Menu, X, CalendarDays } from 'lucide-react';

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/transactions', label: 'Lançamentos', icon: ArrowLeftRight },
  { to: '/import', label: 'Importar', icon: Upload },
  { to: '/categories', label: 'Categorias', icon: Tag },
  { to: '/accounts', label: 'Contas', icon: Wallet },
  { to: '/credit-cards', label: 'Cartões', icon: CreditCard },
  { to: '/recurring', label: 'Recorrentes', icon: Repeat },
  { to: '/planning', label: 'Planejamento', icon: CalendarDays },
  { to: '/reports', label: 'Relatórios', icon: BarChart2 },
  { to: '/projection', label: 'Projeção', icon: Sparkles },
  { to: '/whatsapp', label: 'WhatsApp', icon: Smartphone },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-slate-950 text-slate-100">
      {/* Mobile Top Bar */}
      <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 md:hidden sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <MessageCircleMore className="h-6 w-6 text-emerald-400" />
          <span className="text-lg font-bold">Financeiro</span>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 focus:outline-none"
          aria-label="Toggle Menu"
        >
          {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </header>

      {/* Backdrop for mobile active sidebar */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 transform flex-col border-r border-slate-800 bg-slate-900 p-4 transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } md:flex`}
      >
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircleMore className="h-6 w-6 text-emerald-400" />
            <span className="text-lg font-bold">Financeiro</span>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 md:hidden"
            aria-label="Close Menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setIsMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-800 pt-4 mt-auto">
          <p className="mb-2 truncate text-xs text-slate-500">{user?.email}</p>
          <button onClick={handleLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-rose-400">
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
