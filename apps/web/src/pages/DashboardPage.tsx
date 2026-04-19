import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ArrowDownCircle, ArrowUpCircle, Wallet, TrendingUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function DashboardPage() {
  const { data: summary, isLoading: loadingSummary } = useQuery({ queryKey: ['dashboard-summary'], queryFn: api.dashboard.summary });
  const { data: monthly, isLoading: loadingMonthly } = useQuery({ queryKey: ['dashboard-monthly'], queryFn: () => api.dashboard.monthly(6) });

  if (loadingSummary || loadingMonthly) {
    return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" /></div>;
  }

  const cards = [
    { label: 'Saldo atual', value: fmt(summary?.balance ?? 0), color: 'text-emerald-400', icon: Wallet },
    { label: 'Receitas do mês', value: fmt(summary?.incomeMonth ?? 0), color: 'text-sky-400', icon: ArrowUpCircle },
    { label: 'Despesas do mês', value: fmt(summary?.expenseMonth ?? 0), color: 'text-rose-400', icon: ArrowDownCircle },
    { label: 'Resultado', value: fmt(summary?.result ?? 0), color: (summary?.result ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400', icon: TrendingUp },
  ];

  const COLORS = summary?.topCategories?.map((c: any) => c.color) ?? ['#ef4444', '#f97316', '#8b5cf6', '#06b6d4', '#ec4899'];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg shadow-slate-950/30">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">{label}</span>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <strong className="text-2xl">{value}</strong>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr,0.6fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-4 text-lg font-semibold">Evolução mensal</h2>
          {monthly && monthly.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthly}>
                <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                <Bar dataKey="income" name="Receitas" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-500">Nenhum dado ainda. Crie lançamentos para ver os gráficos.</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-4 text-lg font-semibold">Top categorias</h2>
          {summary?.topCategories?.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={summary.topCategories} dataKey="total" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3}>
                    {summary.topCategories.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1">
                {summary.topCategories.map((c: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                      <span className="text-slate-300">{c.name}</span>
                    </div>
                    <span className="text-slate-400">{fmt(c.total)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Nenhuma despesa este mês.</p>
          )}
        </div>
      </section>
    </div>
  );
}
