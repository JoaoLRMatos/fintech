import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, XAxis, YAxis, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, Sparkles, ShieldCheck, Info, Calculator } from 'lucide-react';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const LEVEL_STYLES: Record<string, { ring: string; bg: string; icon: any; iconColor: string }> = {
  danger: { ring: 'border-rose-800/50', bg: 'bg-rose-500/5', icon: AlertTriangle, iconColor: 'text-rose-400' },
  warning: { ring: 'border-amber-800/50', bg: 'bg-amber-500/5', icon: AlertTriangle, iconColor: 'text-amber-400' },
  success: { ring: 'border-emerald-800/50', bg: 'bg-emerald-500/5', icon: ShieldCheck, iconColor: 'text-emerald-400' },
  info: { ring: 'border-sky-800/50', bg: 'bg-sky-500/5', icon: Info, iconColor: 'text-sky-400' },
};

export function ProjectionPage() {
  const [months, setMonths] = useState(6);

  const { data, isLoading } = useQuery({
    queryKey: ['insights', months],
    queryFn: () => api.projection.insights(months),
  });

  const projection: any[] = data?.projection ?? [];
  const insights: any[] = data?.insights ?? [];
  const safe = data?.safeToSpend;

  const chartData = projection.map((m: any) => ({
    month: m.label.split(' ')[0],
    Saldo: Math.round(m.closingBalance),
    Entradas: Math.round(m.income),
    Saídas: Math.round(m.expense),
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-emerald-400" /> Projeção financeira
          </h1>
          <p className="text-sm text-slate-500 mt-1">Veja o futuro do seu saldo antes de gastar.</p>
        </div>
        <select
          value={months}
          onChange={e => setMonths(Number(e.target.value))}
          className="w-full sm:w-auto rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100"
        >
          {[3, 6, 12].map(n => <option key={n} value={n}>{n} meses</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Limite saudável de gasto */}
          {safe && (
            <div className="rounded-2xl border border-emerald-800/40 bg-emerald-500/5 p-4 sm:p-5">
              <p className="text-xs uppercase tracking-wide text-emerald-400/80 mb-1 font-medium">Limite saudável de gasto este mês</p>
              <strong className={`text-2xl sm:text-3xl font-bold ${safe.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(safe.amount)}</strong>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                Saldo hoje {fmt(safe.currentBalance)} + a receber {fmt(safe.remainingIncome)} − compromissos {fmt(safe.remainingCommitted)}
              </p>
            </div>
          )}

          {/* Insights */}
          {insights.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {insights.map((ins: any, i: number) => {
                const s = LEVEL_STYLES[ins.level] ?? LEVEL_STYLES.info;
                const Icon = s.icon;
                return (
                  <div key={i} className={`rounded-xl border ${s.ring} ${s.bg} p-4 flex gap-3`}>
                    <Icon className={`h-5 w-5 shrink-0 ${s.iconColor}`} />
                    <div>
                      <p className="text-sm font-semibold">{ins.title}</p>
                      <p className="text-sm text-slate-400 mt-0.5">{ins.message.replace(/\*/g, '')}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Curva de saldo acumulado */}
          {chartData.length > 0 && (
            <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <h2 className="mb-4 text-lg font-semibold">Saldo acumulado previsto</h2>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData}>
                  <defs>
                    <linearGradient id="saldoFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} tickLine={false} />
                  <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" />
                  <Bar dataKey="Entradas" fill="#22c55e" radius={[4, 4, 0, 0]} barSize={10} />
                  <Bar dataKey="Saídas" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={10} />
                  <Area type="monotone" dataKey="Saldo" stroke="#34d399" strokeWidth={2} fill="url(#saldoFill)" />
                  <Line type="monotone" dataKey="Saldo" stroke="#34d399" strokeWidth={0} dot={{ r: 3, fill: '#34d399' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabela mês a mês */}
          {projection.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-slate-800"><h2 className="font-semibold">Mês a mês</h2></div>
              {projection.map((m: any) => (
                <div key={m.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-3 sm:py-3.5 border-b border-slate-800 last:border-0 hover:bg-slate-800/10">
                  <span className="text-sm font-semibold capitalize text-slate-100">{m.label}</span>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 sm:gap-5 text-sm">
                    <span className="flex items-center gap-1 text-xs sm:text-sm text-emerald-400 font-medium"><TrendingUp className="h-3.5 w-3.5 shrink-0" />{fmt(m.income)}</span>
                    <span className="flex items-center gap-1 text-xs sm:text-sm text-rose-400 font-medium"><TrendingDown className="h-3.5 w-3.5 shrink-0" />{fmt(m.expense)}</span>
                    <span className="text-xs text-slate-500 sm:w-28 sm:text-right font-medium">{Math.round(m.committedRatio * 100)}% comprometido</span>
                    <span className={`text-sm font-bold sm:w-28 sm:text-right ${m.closingBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {fmt(m.closingBalance)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Simulator />
        </>
      )}
    </div>
  );
}

function Simulator() {
  const [total, setTotal] = useState('');
  const [installments, setInstallments] = useState('1');
  const [description, setDescription] = useState('');

  const sim = useMutation({
    mutationFn: () => api.projection.simulate({
      total: Number(total),
      installments: Number(installments) || 1,
      description: description || 'Compra simulada',
    }),
  });

  const r = sim.data;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
      <h2 className="mb-1 text-lg font-semibold flex items-center gap-2"><Calculator className="h-5 w-5 text-sky-400" /> Posso comprar?</h2>
      <p className="text-sm text-slate-500 mb-4">Simule o impacto de uma compra no seu saldo futuro.</p>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-4">
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="O quê? (ex: Notebook)"
          className="sm:col-span-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500" />
        <input value={total} onChange={e => setTotal(e.target.value)} type="number" placeholder="Valor total"
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500" />
        <input value={installments} onChange={e => setInstallments(e.target.value)} type="number" min={1} placeholder="Parcelas"
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500" />
      </div>

      <button
        onClick={() => sim.mutate()}
        disabled={!total || sim.isPending}
        className="mt-3 w-full sm:w-auto rounded-lg bg-sky-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40 text-center"
      >
        {sim.isPending ? 'Simulando…' : 'Simular'}
      </button>

      {r && (
        <div className={`mt-4 rounded-xl border p-4 ${r.affordable ? 'border-emerald-800/50 bg-emerald-500/5' : 'border-rose-800/50 bg-rose-500/5'}`}>
          <p className="text-sm">
            {Number(installments) > 1 ? `${installments}x de ${fmt(r.perInstallment)}` : 'À vista'} · comprometimento máx. {Math.round(r.maxCommittedRatio * 100)}%
          </p>
          {r.affordable ? (
            <p className="mt-1 font-semibold text-emerald-400">✅ Cabe no orçamento — o saldo nunca fica negativo.</p>
          ) : (
            <p className="mt-1 font-semibold text-rose-400">
              ⚠️ Não recomendado: saldo fica negativo em {r.firstNegativeMonth?.label} ({fmt(r.firstNegativeMonth?.closingBalance)}).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
