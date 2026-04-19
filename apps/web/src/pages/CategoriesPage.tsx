import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Pencil, Trash2 } from 'lucide-react';

export function CategoriesPage() {
  const qc = useQueryClient();
  const { data: categories, isLoading } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', kind: 'EXPENSE' as string, color: '#64748b' });

  const createMut = useMutation({ mutationFn: api.categories.create, onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); setShowForm(false); resetForm(); } });
  const updateMut = useMutation({ mutationFn: ({ id, ...d }: any) => api.categories.update(id, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); setEditing(null); setShowForm(false); resetForm(); } });
  const deleteMut = useMutation({ mutationFn: api.categories.delete, onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }) });

  function resetForm() { setForm({ name: '', kind: 'EXPENSE', color: '#64748b' }); }

  function startEdit(c: any) {
    setEditing(c);
    setForm({ name: c.name, kind: c.kind, color: c.color ?? '#64748b' });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMut.mutate({ id: editing.id, name: form.name, color: form.color });
    } else {
      createMut.mutate(form);
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none';

  const expenses = categories?.filter((c: any) => c.kind === 'EXPENSE') ?? [];
  const incomes = categories?.filter((c: any) => c.kind === 'INCOME') ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Categorias</h1>
        <button onClick={() => { setEditing(null); resetForm(); setShowForm(!showForm); }} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
          <Plus className="h-4 w-4" /> Nova categoria
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Nome</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className={inputCls} />
            </div>
            {!editing && (
              <div>
                <label className="mb-1 block text-xs text-slate-400">Tipo</label>
                <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} className={inputCls}>
                  <option value="EXPENSE">Despesa</option>
                  <option value="INCOME">Receita</option>
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs text-slate-400">Cor</label>
              <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} className="h-10 w-full cursor-pointer rounded-lg border border-slate-700 bg-slate-800" />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-500">{editing ? 'Salvar' : 'Criar'}</button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800">Cancelar</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex h-32 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" /></div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {[{ title: 'Despesas', items: expenses }, { title: 'Receitas', items: incomes }].map(({ title, items }) => (
            <div key={title} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="mb-4 font-semibold">{title}</h2>
              {items.length === 0 ? <p className="text-sm text-slate-500">Nenhuma categoria.</p> : (
                <div className="space-y-2">
                  {items.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between rounded-xl bg-slate-800/80 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full" style={{ background: c.color ?? '#64748b' }} />
                        <span className="font-medium">{c.name}</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => startEdit(c)} className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => { if (confirm(`Excluir "${c.name}"?`)) deleteMut.mutate(c.id); }} className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
