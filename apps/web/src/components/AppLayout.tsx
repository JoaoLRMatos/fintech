import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LayoutDashboard, ArrowLeftRight, Tag, Wallet, LogOut, MessageCircleMore, Smartphone, Repeat, CreditCard, BarChart2, Upload } from 'lucide-react';

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/transactions', label: 'Lançamentos', icon: ArrowLeftRight },
  { to: '/import', label: 'Importar', icon: Upload },
  { to: '/categories', label: 'Categorias', icon: Tag },
  { to: '/accounts', label: 'Contas', icon: Wallet },
  { to: '/credit-cards', label: 'Cartões', icon: CreditCard },
  { to: '/recurring', label: 'Recorrentes', icon: Repeat },
  { to: '/reports', label: 'Relatórios', icon: BarChart2 },
  { to: '/whatsapp', label: 'WhatsApp', icon: Smartphone },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="flex w-60 flex-col border-r border-slate-800 bg-slate-900/70 p-4">
        <div className="mb-8 flex items-center gap-2">
          <MessageCircleMore className="h-6 w-6 text-emerald-400" />
          <span className="text-lg font-bold">Financeiro</span>
        </div>

        <nav className="flex-1 space-y-1">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
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

        <div className="border-t border-slate-800 pt-4">
          <p className="mb-2 truncate text-xs text-slate-500">{user?.email}</p>
          <button onClick={handleLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-rose-400">
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
