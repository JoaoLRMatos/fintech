import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Pencil, Trash2 } from 'lucide-react';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function TransactionsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  const params: Record<string, string> = { page: String(page), limit: '20' };
  if (typeFilter) params.type = typeFilter;

  const { data, isLoading } = useQuery({ queryKey: ['transactions', params], queryFn: () => api.transactions.list(params) });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: api.accounts.list });

  const createMut = useMutation({ mutationFn: api.transactions.create, onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['dashboard-summary'] }); setShowForm(false); resetForm(); } });
  const updateMut = useMutation({ mutationFn: ({ id, ...d }: any) => api.transactions.update(id, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['dashboard-summary'] }); setEditing(null); setShowForm(false); resetForm(); } });
  const deleteMut = useMutation({ mutationFn: api.transactions.delete, onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['dashboard-summary'] }); } });

  const [form, setForm] = useState({ type: 'EXPENSE', amount: '', description: '', occurredAt: new Date().toISOString().slice(0, 10), categoryId: '', accountId: '', notes: '' });

  function resetForm() {
    setForm({ type: 'EXPENSE', amount: '', description: '', occurredAt: new Date().toISOString().slice(0, 10), categoryId: '', accountId: '', notes: '' });
  }

  function startEdit(tx: any) {
    setEditing(tx);
    setForm({
      type: tx.type,
      amount: String(tx.amount),
      description: tx.description,
      occurredAt: tx.occurredAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      categoryId: tx.categoryId ?? '',
      accountId: tx.accountId ?? '',
      notes: tx.notes ?? '',
    });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...form, amount: Number(form.amount), categoryId: form.categoryId || undefined, accountId: form.accountId || undefined, notes: form.notes || undefined };
    if (editing) {
      updateMut.mutate({ id: editing.id, ...payload });
    } else {
      createMut.mutate(payload);
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Lançamentos</h1>
        <button onClick={() => { setEditing(null); resetForm(); setShowForm(!showForm); }} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
          <Plus className="h-4 w-4" /> Novo lançamento
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <h2 className="font-semibold">{editing ? 'Editar lançamento' : 'Novo lançamento'}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Tipo</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>
                <option value="EXPENSE">Despesa</option>
                <option value="INCOME">Receita</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Valor (R$)</label>
              <input type="number" step="0.01" min="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required className={inputCls} placeholder="0,00" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Descrição</label>
              <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required className={inputCls} placeholder="Ex: Gasolina do carro" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Data</label>
              <input type="date" value={form.occurredAt} onChange={e => setForm(f => ({ ...f, occurredAt: e.target.value }))} required className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Categoria</label>
              <select value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))} className={inputCls}>
                <option value="">Sem categoria</option>
                {categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Conta</label>
              <select value={form.accountId} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))} className={inputCls}>
                <option value="">Sem conta</option>
                {accounts?.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Observações</label>
            <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} placeholder="Opcional" />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={createMut.isPending || updateMut.isPending} className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              {editing ? 'Salvar' : 'Criar'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800">Cancelar</button>
          </div>
        </form>
      )}

      <div className="flex gap-2">
        {['', 'EXPENSE', 'INCOME'].map(t => (
          <button key={t} onClick={() => { setTypeFilter(t); setPage(1); }} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${typeFilter === t ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
            {t === '' ? 'Todos' : t === 'EXPENSE' ? 'Despesas' : 'Receitas'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" /></div>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3">Conta</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data?.data?.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Nenhum lançamento encontrado.</td></tr>
              )}
              {data?.data?.map((tx: any) => (
                <tr key={tx.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-slate-400">{new Date(tx.occurredAt).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3 font-medium">{tx.description}</td>
                  <td className="px-4 py-3">
                    {tx.category && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs">
                        <span className="h-2 w-2 rounded-full" style={{ background: tx.category.color ?? '#64748b' }} />
                        {tx.category.name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{tx.account?.name ?? '—'}</td>
                  <td className={`px-4 py-3 text-right font-medium ${tx.type === 'INCOME' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {tx.type === 'INCOME' ? '+' : '-'} {fmt(Number(tx.amount))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => startEdit(tx)} className="mr-2 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => { if (confirm('Excluir este lançamento?')) deleteMut.mutate(tx.id); }} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data && data.total > 20 && (
            <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-xs text-slate-500">
              <span>{data.total} lançamento(s)</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded border border-slate-700 px-3 py-1 hover:bg-slate-800 disabled:opacity-30">Anterior</button>
                <button disabled={page * 20 >= data.total} onClick={() => setPage(p => p + 1)} className="rounded border border-slate-700 px-3 py-1 hover:bg-slate-800 disabled:opacity-30">Próxima</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
