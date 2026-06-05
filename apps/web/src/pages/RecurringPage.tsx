import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Trash2, Repeat, Pause, Play, CalendarClock, CreditCard, Pencil } from 'lucide-react';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const freqLabels: Record<string, string> = {
  DAILY: 'Diário',
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
};

const emptyForm = () => ({
  description: '',
  amount: '',
  type: 'EXPENSE',
  frequency: 'MONTHLY',
  nextDueDate: new Date().toISOString().slice(0, 10),
  isFifthBusinessDay: false,
  creditCardId: '',
  accountId: '',
});

export function RecurringPage() {
  const qc = useQueryClient();
  const { data: rules, isLoading } = useQuery({ queryKey: ['recurring'], queryFn: api.recurring.list });
  const { data: cards } = useQuery({ queryKey: ['credit-cards'], queryFn: api.creditCards.list });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.accounts.list });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: api.recurring.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring'] }); closeForm(); },
    onError: (err: any) => alert(`Erro ao criar regra: ${err.message}`),
  });

  const editMut = useMutation({
    mutationFn: ({ id, ...d }: any) => api.recurring.update(id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring'] }); closeForm(); },
    onError: (err: any) => alert(`Erro ao salvar alterações: ${err.message}`),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, ...d }: any) => api.recurring.update(id, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring'] }),
    onError: (err: any) => alert(`Erro ao atualizar regra: ${err.message}`),
  });

  const deleteMut = useMutation({
    mutationFn: api.recurring.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring'] }),
    onError: (err: any) => alert(`Erro ao excluir regra: ${err.message}`),
  });

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  }

  function openEdit(r: any) {
    setEditingId(r.id);
    setForm({
      description: r.description ?? '',
      amount: String(r.amount ?? ''),
      type: r.type ?? 'EXPENSE',
      frequency: r.frequency ?? 'MONTHLY',
      nextDueDate: r.nextDueDate
        ? new Date(r.nextDueDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      isFifthBusinessDay: !!r.isFifthBusinessDay,
      creditCardId: r.creditCardId ?? '',
      accountId: r.accountId ?? '',
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const useCard = form.type === 'EXPENSE' && !!form.creditCardId;
    const payload = {
      description: form.description,
      amount: Number(form.amount),
      type: form.type as 'INCOME' | 'EXPENSE',
      frequency: form.frequency as any,
      nextDueDate: form.nextDueDate,
      isFifthBusinessDay: form.frequency === 'MONTHLY' ? form.isFifthBusinessDay : false,
      ...(useCard ? { creditCardId: form.creditCardId, accountId: null } : { creditCardId: null }),
      ...(!useCard && form.accountId ? { accountId: form.accountId } : {}),
    };

    if (editingId) {
      editMut.mutate({ id: editingId, ...payload });
    } else {
      createMut.mutate(payload);
    }
  }

  const cardName = (id?: string | null) => cards?.find((c: any) => c.id === id)?.name;
  const accountName = (id?: string | null) => accounts?.find((a: any) => a.id === id)?.name;
  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none';
  const isPending = createMut.isPending || editMut.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Recorrentes</h1>
        <button onClick={openCreate} className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
          <Plus className="h-4 w-4" /> Nova regra
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5 space-y-4">
          <p className="text-sm font-semibold text-slate-300">
            {editingId ? 'Editar regra recorrente' : 'Nova regra recorrente'}
          </p>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
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
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value, creditCardId: e.target.value === 'INCOME' ? '' : f.creditCardId }))} className={inputCls}>
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

          <div>
            <label className="mb-1 block text-xs text-slate-400">
              {form.type === 'INCOME' ? 'Entra em qual conta' : 'Lançar em'}
            </label>
            <select
              value={form.creditCardId ? `card:${form.creditCardId}` : form.accountId ? `acc:${form.accountId}` : ''}
              onChange={e => {
                const v = e.target.value;
                if (v.startsWith('card:')) setForm(f => ({ ...f, creditCardId: v.slice(5), accountId: '' }));
                else if (v.startsWith('acc:')) setForm(f => ({ ...f, accountId: v.slice(4), creditCardId: '' }));
                else setForm(f => ({ ...f, accountId: '', creditCardId: '' }));
              }}
              className={inputCls}
            >
              <option value="">Sem conta (só previsão, não mexe no saldo)</option>
              {accounts?.map((a: any) => (
                <option key={a.id} value={`acc:${a.id}`}>Conta: {a.name}</option>
              ))}
              {form.type === 'EXPENSE' && cards?.map((c: any) => (
                <option key={c.id} value={`card:${c.id}`}>💳 Cartão {c.name} (entra na fatura)</option>
              ))}
            </select>
            {form.accountId && (
              <p className="mt-1 text-[11px] text-slate-500">
                {form.type === 'INCOME'
                  ? 'Todo período credita o saldo dessa conta.'
                  : 'Todo período sai do saldo dessa conta.'}
              </p>
            )}
            {form.creditCardId && (
              <p className="mt-1 text-[11px] text-slate-500">
                Lançado nesse cartão a cada período. O limite só é usado quando o lançamento é criado.
              </p>
            )}
          </div>

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            {!form.isFifthBusinessDay && (
              <div>
                <label className="mb-1 block text-xs text-slate-400">
                  {form.type === 'INCOME' ? 'Próximo recebimento' : 'Próximo vencimento'}
                </label>
                <input
                  type="date"
                  value={form.nextDueDate}
                  onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))}
                  required
                  className={inputCls}
                />
              </div>
            )}
            {form.frequency === 'MONTHLY' && (
              <div className="flex items-center gap-2.5 pt-6">
                <input
                  type="checkbox"
                  id="isFifthBusinessDay"
                  checked={form.isFifthBusinessDay}
                  onChange={e => setForm(f => ({ ...f, isFifthBusinessDay: e.target.checked }))}
                  className="rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-emerald-500 h-4 w-4 cursor-pointer"
                />
                <label htmlFor="isFifthBusinessDay" className="text-sm font-medium text-slate-300 cursor-pointer select-none">
                  Smart: 5º dia útil do mês
                </label>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="flex-1 sm:flex-none rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 text-center">
              {isPending ? 'Salvando...' : editingId ? 'Atualizar' : 'Salvar'}
            </button>
            <button type="button" onClick={closeForm} className="flex-1 sm:flex-none rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 text-center font-medium">
              Cancelar
            </button>
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
            <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-start gap-4 min-w-0">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 ${r.type === 'INCOME' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                  {r.type === 'INCOME' ? <Play className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-slate-100 truncate">{r.description}</p>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-500 mt-1">
                    <span className="font-medium bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-slate-400 uppercase">{freqLabels[r.frequency] || r.frequency}</span>
                    {r.isFifthBusinessDay && (
                      <span className="font-semibold bg-emerald-500/15 px-1.5 py-0.5 rounded text-[10px] text-emerald-400 uppercase tracking-wide">5º Dia Útil Smart</span>
                    )}
                    <span className="flex items-center gap-1">
                      <CalendarClock className="h-3 w-3 text-slate-500" />
                      Próx: {new Date(r.nextDueDate).toLocaleDateString('pt-BR')}
                    </span>
                    {r.creditCardId && (
                      <span className="flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-400 uppercase tracking-wide">
                        <CreditCard className="h-3 w-3" />
                        {cardName(r.creditCardId) ?? 'Cartão'}
                      </span>
                    )}
                    {r.accountId && !r.creditCardId && (
                      <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
                        {accountName(r.accountId) ?? 'Conta'}
                      </span>
                    )}
                    {!r.active && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Pausado</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between sm:justify-end gap-3 border-t border-slate-800/40 sm:border-0 pt-2 sm:pt-0 shrink-0">
                <span className={`text-base sm:text-lg font-semibold ${r.type === 'INCOME' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {r.type === 'INCOME' ? '+' : '-'}{fmt(Number(r.amount))}
                </span>
                {confirmDeleteId === r.id ? (
                  <div className="flex items-center gap-1.5 animate-fadeIn">
                    <span className="text-[11px] text-rose-400 font-medium">Excluir?</span>
                    <button
                      onClick={() => { deleteMut.mutate(r.id); setConfirmDeleteId(null); }}
                      className="rounded bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
                    >
                      Sim
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-800"
                    >
                      Não
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEdit(r)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleMut.mutate({ id: r.id, active: !r.active })}
                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      title={r.active ? 'Pausar' : 'Ativar'}
                    >
                      {r.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(r.id)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
                      aria-label="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
