import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { TrendingUp, TrendingDown, Calendar, ChevronDown, ChevronUp } from 'lucide-react';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const currentYear = new Date().getFullYear();

export function ReportsPage() {
  const [pastMonths, setPastMonths] = useState(6);
  const [futureMonths, setFutureMonths] = useState(3);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [yearTab, setYearTab] = useState<'monthly' | 'year'>('monthly');
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const { data: months = [], isLoading } = useQuery({
    queryKey: ['reports-monthly', pastMonths, futureMonths],
    queryFn: () => api.reports.monthly(pastMonths, futureMonths),
  });

  const { data: yearData } = useQuery({
    queryKey: ['reports-year', selectedYear],
    queryFn: () => api.reports.yearSummary(selectedYear),
    enabled: yearTab === 'year',
  });

  const pastData = months.filter((m: any) => !m.isProjection);
  const futureData = months.filter((m: any) => m.isProjection);
  const chartData = pastData.map((m: any) => ({
    month: m.label.split(' ')[0], // só o nome do mês
    Receitas: m.income,
    Despesas: m.expense,
    Resultado: m.balance,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Relatórios</h1>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-800">
        {(['monthly', 'year'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setYearTab(tab)}
            className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${yearTab === tab ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            {tab === 'monthly' ? 'Histórico mensal' : 'Visão anual'}
          </button>
        ))}
      </div>

      {yearTab === 'monthly' && (
        <>
          {/* Controls */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span>Últimos</span>
              <select
                value={pastMonths}
                onChange={e => setPastMonths(Number(e.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100"
              >
                {[3, 6, 9, 12].map(n => <option key={n} value={n}>{n} meses</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span>Projeção</span>
              <select
                value={futureMonths}
                onChange={e => setFutureMonths(Number(e.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100"
              >
                {[0, 1, 2, 3, 6].map(n => <option key={n} value={n}>{n === 0 ? 'desabilitada' : `${n} meses`}</option>)}
              </select>
            </div>
          </div>

          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            </div>
          ) : (
            <>
              {/* Chart */}
              {chartData.length > 0 && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                  <h2 className="mb-4 text-lg font-semibold">Evolução histórica</h2>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData}>
                      <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
                      <YAxis stroke="#64748b" fontSize={12} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                      <Legend />
                      <Bar dataKey="Receitas" fill="#22c55e" radius={[4,4,0,0]} />
                      <Bar dataKey="Despesas" fill="#ef4444" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Past months */}
              {pastData.length > 0 && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-800">
                    <h2 className="font-semibold">Meses anteriores</h2>
                  </div>
                  {pastData.map((m: any) => (
                    <MonthRow key={m.key} m={m} expanded={expandedKey === m.key} onToggle={() => setExpandedKey(expandedKey === m.key ? null : m.key)} />
                  ))}
                </div>
              )}

              {/* Future projection */}
              {futureData.length > 0 && (
                <div className="rounded-2xl border border-amber-800/40 bg-amber-500/5 overflow-hidden">
                  <div className="px-5 py-4 border-b border-amber-800/40 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-amber-400" />
                    <h2 className="font-semibold text-amber-300">Projeção futura (recorrentes)</h2>
                  </div>
                  {futureData.map((m: any) => (
                    <MonthRow key={m.key} m={m} expanded={expandedKey === m.key} onToggle={() => setExpandedKey(expandedKey === m.key ? null : m.key)} projected />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {yearTab === 'year' && (
        <>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">Ano:</span>
            <div className="flex gap-1">
              {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                <button
                  key={y}
                  onClick={() => setSelectedYear(y)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${selectedYear === y ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:bg-slate-800'}`}
                >{y}</button>
              ))}
            </div>
          </div>

          {yearData && (
            <>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Total de receitas', value: yearData.totalIncome, color: 'text-emerald-400' },
                  { label: 'Total de despesas', value: yearData.totalExpense, color: 'text-rose-400' },
                  { label: 'Resultado do ano', value: yearData.totalBalance, color: yearData.totalBalance >= 0 ? 'text-emerald-400' : 'text-rose-400' },
                ].map(c => (
                  <div key={c.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <p className="text-xs text-slate-500 mb-1">{c.label}</p>
                    <strong className={`text-xl ${c.color}`}>{fmt(c.value)}</strong>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <h2 className="mb-4 font-semibold">Mês a mês — {selectedYear}</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={yearData.months}>
                    <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                    <Legend />
                    <Line type="monotone" dataKey="income" name="Receitas" stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="expense" name="Despesas" stroke="#ef4444" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function MonthRow({ m, expanded, onToggle, projected = false }: { m: any; expanded: boolean; onToggle: () => void; projected?: boolean }) {
  return (
    <div className={`border-b border-slate-800 last:border-0 ${projected ? 'border-amber-800/20' : ''}`}>
      <button onClick={onToggle} className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800/50 transition-colors text-left">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium capitalize">{m.label}</span>
          {projected && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">projeção</span>}
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-sm text-emerald-400">{fmt(m.income)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
            <span className="text-sm text-rose-400">{fmt(m.expense)}</span>
          </div>
          <span className={`text-sm font-medium w-24 text-right ${m.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {m.balance >= 0 ? '+' : ''}{fmt(m.balance)}
          </span>
          {expanded ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
        </div>
      </button>

      {expanded && m.transactions && m.transactions.length > 0 && (
        <div className="px-5 pb-4 space-y-1">
          {m.transactions.map((tx: any) => (
            <div key={tx.id} className="flex items-center justify-between py-1 border-b border-slate-800/50 last:border-0 text-sm">
              <div>
                <span className={tx.isProjection ? 'text-amber-300' : 'text-slate-200'}>{tx.description}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {new Date(tx.occurredAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  {tx.category?.name && ` · ${tx.category.name}`}
                  {tx.paymentMethod === 'credit' && ' · 💳'}
                </span>
              </div>
              <span className={tx.type === 'INCOME' ? 'text-emerald-400' : 'text-rose-400'}>
                {tx.type === 'INCOME' ? '+' : '-'}{fmt(Number(tx.amount))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
