import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Trash2, Repeat, Pause, Play, CalendarClock } from 'lucide-react';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const freqLabels: Record<string, string> = {
  DAILY: 'Diário',
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
};

export function RecurringPage() {
  const qc = useQueryClient();
  const { data: rules, isLoading } = useQuery({ queryKey: ['recurring'], queryFn: api.recurring.list });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ description: '', amount: '', type: 'EXPENSE', frequency: 'MONTHLY', nextDueDate: new Date().toISOString().slice(0, 10) });

  const createMut = useMutation({
    mutationFn: api.recurring.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring'] }); setShowForm(false); resetForm(); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...d }: any) => api.recurring.update(id, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring'] }),
  });
  const deleteMut = useMutation({
    mutationFn: api.recurring.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring'] }),
  });

  function resetForm() { setForm({ description: '', amount: '', type: 'EXPENSE', frequency: 'MONTHLY', nextDueDate: new Date().toISOString().slice(0, 10) }); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMut.mutate({
      description: form.description,
      amount: Number(form.amount),
      type: form.type as 'INCOME' | 'EXPENSE',
      frequency: form.frequency as any,
      nextDueDate: form.nextDueDate,
    });
  }

  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recorrentes</h1>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
          <Plus className="h-4 w-4" /> Nova regra
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Descrição</label>
              <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required className={inputCls} placeholder="Ex: Netflix" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Valor</label>
              <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required className={inputCls} placeholder="40.00" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Tipo</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>
                <option value="EXPENSE">Despesa</option>
                <option value="INCOME">Receita</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Frequência</label>
              <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))} className={inputCls}>
                <option value="DAILY">Diário</option>
                <option value="WEEKLY">Semanal</option>
                <option value="MONTHLY">Mensal</option>
                <option value="YEARLY">Anual</option>
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Próximo vencimento</label>
              <input type="date" value={form.nextDueDate} onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))} required className={inputCls} />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={createMut.isPending} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              {createMut.isPending ? 'Salvando...' : 'Salvar'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancelar</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-slate-400">Carregando...</p>
      ) : !rules || rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-500">
          <Repeat className="mx-auto mb-3 h-8 w-8" />
          <p>Nenhuma regra recorrente cadastrada.</p>
          <p className="text-sm mt-1">Crie uma aqui ou envie pelo WhatsApp: "netflix todo mês 40"</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((r: any) => (
            <div key={r.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center gap-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${r.type === 'INCOME' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                  {r.type === 'INCOME' ? <Play className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
                </div>
                <div>
                  <p className="font-medium">{r.description}</p>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>{freqLabels[r.frequency] || r.frequency}</span>
                    <span className="flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" />
                      Próx: {new Date(r.nextDueDate).toLocaleDateString('pt-BR')}
                    </span>
                    {!r.active && <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 text-yellow-400">Pausado</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-lg font-semibold ${r.type === 'INCOME' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {r.type === 'INCOME' ? '+' : '-'}{fmt(Number(r.amount))}
                </span>
                <button
                  onClick={() => updateMut.mutate({ id: r.id, active: !r.active })}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  title={r.active ? 'Pausar' : 'Ativar'}
                >
                  {r.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => { if (confirm('Excluir esta regra?')) deleteMut.mutate(r.id); }}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
