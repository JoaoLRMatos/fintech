import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Pencil, Trash2, Wallet, CreditCard, Banknote } from 'lucide-react';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const typeIcons: Record<string, typeof Wallet> = { cash: Banknote, bank: CreditCard, credit_card: CreditCard };

export function AccountsPage() {
  const qc = useQueryClient();
  const { data: accounts, isLoading } = useQuery({ queryKey: ['accounts'], queryFn: api.accounts.list });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', type: 'bank', balance: '0' });

  const createMut = useMutation({ mutationFn: api.accounts.create, onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); setShowForm(false); resetForm(); } });
  const updateMut = useMutation({ mutationFn: ({ id, ...d }: any) => api.accounts.update(id, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); setEditing(null); setShowForm(false); resetForm(); } });
  const deleteMut = useMutation({ mutationFn: api.accounts.delete, onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }) });

  function resetForm() { setForm({ name: '', type: 'bank', balance: '0' }); }

  function startEdit(a: any) {
    setEditing(a);
    setForm({ name: a.name, type: a.type, balance: String(a.balance) });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMut.mutate({ id: editing.id, name: form.name, type: form.type });
    } else {
      createMut.mutate({ ...form, balance: Number(form.balance) });
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none';
  const total = accounts?.reduce((s: number, a: any) => s + Number(a.balance), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Contas</h1>
        <button onClick={() => { setEditing(null); resetForm(); setShowForm(!showForm); }} className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
          <Plus className="h-4 w-4" /> Nova conta
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5 space-y-4">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Nome</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className={inputCls} placeholder="Ex: Nubank" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Tipo</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>
                <option value="bank">Conta bancária</option>
                <option value="cash">Dinheiro</option>
                <option value="credit_card">Cartão de crédito</option>
              </select>
            </div>
            {!editing && (
              <div>
                <label className="mb-1 block text-xs text-slate-400">Saldo inicial (R$)</label>
                <input type="number" step="0.01" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} className={inputCls} />
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button type="submit" className="flex-1 sm:flex-none rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-500">{editing ? 'Salvar' : 'Criar'}</button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="flex-1 sm:flex-none rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 text-center">Cancelar</button>
          </div>
        </form>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="font-semibold text-lg">Suas contas</h2>
          <span className="text-sm text-slate-400">Total: <span className="font-semibold text-emerald-400">{fmt(total)}</span></span>
        </div>

        {isLoading ? (
          <div className="flex h-20 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" /></div>
        ) : accounts?.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma conta cadastrada.</p>
        ) : (
          <div className="space-y-3">
            {accounts?.map((a: any) => {
              const Icon = typeIcons[a.type] ?? Wallet;
              return (
                <div key={a.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-slate-800/80 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-slate-400 shrink-0" />
                    <div>
                      <p className="font-medium text-slate-100">{a.name}</p>
                      <p className="text-xs text-slate-500">{a.type === 'bank' ? 'Banco' : a.type === 'cash' ? 'Dinheiro' : 'Cartão'}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-4 border-t border-slate-700/50 sm:border-0 pt-2 sm:pt-0">
                    <span className={`font-semibold ${Number(a.balance) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(Number(a.balance))}</span>
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(a)} className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200" aria-label="Editar"><Pencil className="h-4 w-4 sm:h-3.5 sm:w-3.5" /></button>
                      <button onClick={() => { if (confirm(`Excluir "${a.name}"?`)) deleteMut.mutate(a.id); }} className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-rose-400" aria-label="Excluir"><Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
