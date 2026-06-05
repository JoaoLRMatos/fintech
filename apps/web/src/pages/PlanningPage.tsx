import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Plus, Trash2, Pencil, X, Check, TrendingUp, TrendingDown, Calendar, Percent } from 'lucide-react';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none';

// ─── Budget Tab ───────────────────────────────────────────────────────────────

function BudgetTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['budget', year, month],
    queryFn: () => api.budget.list(year, month),
  });

  const saveMut = useMutation({
    mutationFn: api.budget.save,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); setEditing(null); },
  });
  const deleteMut = useMutation({
    mutationFn: api.budget.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget'] }),
  });

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1);
  }

  return (
    <div className="space-y-5">
      {/* Month nav */}
      <div className="flex items-center gap-3">
        <button onClick={prevMonth} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800">&lt;</button>
        <span className="flex-1 text-center text-sm font-semibold text-slate-100">{MONTHS[month - 1]} {year}</span>
        <button onClick={nextMonth} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800">&gt;</button>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Carregando…</p>}

      <div className="space-y-2">
        {rows.map((row: any) => (
          <div key={row.categoryId} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{row.categoryName}</p>
              {row.planned != null && (
                <p className="text-xs text-slate-500 mt-0.5">Orçado: {fmt(row.planned)}</p>
              )}
            </div>

            {editing === row.categoryId ? (
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} step={0.01}
                  className="w-28 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                  value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  autoFocus
                />
                <button
                  onClick={() => saveMut.mutate({ categoryId: row.categoryId, year, month, planned: Number(editVal) })}
                  className="rounded-lg bg-emerald-500 p-1.5 text-white hover:bg-emerald-600"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setEditing(null)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setEditing(row.categoryId); setEditVal(String(row.planned ?? '')); }}
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {row.entryId && (
                  <button
                    onClick={() => deleteMut.mutate(row.entryId)}
                    className="rounded p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && !isLoading && (
          <p className="text-center text-sm text-slate-500 py-8">Nenhuma categoria de despesa cadastrada.</p>
        )}
      </div>
    </div>
  );
}

// ─── Planned Events Tab ───────────────────────────────────────────────────────

function emptyEvent() {
  return { type: 'EXPENSE' as 'INCOME' | 'EXPENSE', amount: '', description: '', expectedAt: '', categoryId: '' };
}

function PlannedEventsTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyEvent());
  const [includeRealized, setIncludeRealized] = useState(false);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['planned-events', includeRealized],
    queryFn: () => api.plannedEvents.list(includeRealized ? { includeRealized: 'true' } : {}),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories.list,
  });

  const expenseCategories = (categories as any[]).filter((c: any) => c.kind === 'EXPENSE');
  const incomeCategories = (categories as any[]).filter((c: any) => c.kind === 'INCOME');
  const relevantCats = form.type === 'INCOME' ? incomeCategories : expenseCategories;

  const createMut = useMutation({
    mutationFn: api.plannedEvents.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['planned-events'] }); setShowForm(false); setForm(emptyEvent()); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => api.plannedEvents.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['planned-events'] }); setEditingId(null); setForm(emptyEvent()); },
  });
  const deleteMut = useMutation({
    mutationFn: api.plannedEvents.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['planned-events'] }),
  });
  const realizeMut = useMutation({
    mutationFn: (id: string) => api.plannedEvents.update(id, { realized: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['planned-events'] }),
  });

  function openEdit(ev: any) {
    setEditingId(ev.id);
    setForm({
      type: ev.type,
      amount: String(ev.amount),
      description: ev.description,
      expectedAt: ev.expectedAt ? ev.expectedAt.slice(0, 10) : '',
      categoryId: ev.categoryId ?? '',
    });
    setShowForm(false);
  }

  function openNew() {
    setEditingId(null);
    setForm(emptyEvent());
    setShowForm(true);
  }

  function buildPayload() {
    return {
      type: form.type,
      amount: Number(form.amount),
      description: form.description,
      expectedAt: form.expectedAt,
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
    };
  }

  const EventForm = () => (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-3">
      <h3 className="font-semibold text-slate-100">{editingId ? 'Editar evento' : 'Novo evento futuro'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-slate-400">Tipo</label>
          <select className={inputCls} value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value as any, categoryId: '' }))}>
            <option value="EXPENSE">Despesa</option>
            <option value="INCOME">Receita</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Valor (R$)</label>
          <input className={inputCls} type="number" min={0} step={0.01} placeholder="0,00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-400">Descrição</label>
          <input className={inputCls} placeholder="Ex: 13º salário, IPVA…" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Data prevista</label>
          <input className={inputCls} type="date" value={form.expectedAt} onChange={e => setForm(p => ({ ...p, expectedAt: e.target.value }))} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Categoria (opcional)</label>
          <select className={inputCls} value={form.categoryId} onChange={e => setForm(p => ({ ...p, categoryId: e.target.value }))}>
            <option value="">Sem categoria</option>
            {relevantCats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => { setShowForm(false); setEditingId(null); }} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-slate-800">Cancelar</button>
        <button
          disabled={!form.description || !form.amount || !form.expectedAt}
          onClick={() => editingId ? updateMut.mutate({ id: editingId, data: buildPayload() }) : createMut.mutate(buildPayload())}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >Salvar</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
          <input type="checkbox" checked={includeRealized} onChange={e => setIncludeRealized(e.target.checked)} className="accent-emerald-500" />
          Incluir realizados
        </label>
        <button onClick={openNew} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600">
          <Plus className="h-4 w-4" /> Novo evento
        </button>
      </div>

      {(showForm || editingId) && <EventForm />}

      {isLoading && <p className="text-sm text-slate-500">Carregando…</p>}

      <div className="space-y-2">
        {(events as any[]).map((ev: any) => (
          <div key={ev.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${ev.realized ? 'border-slate-700/50 bg-slate-900/50 opacity-60' : 'border-slate-800 bg-slate-900'}`}>
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ev.type === 'INCOME' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
              {ev.type === 'INCOME' ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{ev.description}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {new Date(ev.expectedAt).toLocaleDateString('pt-BR')}
                {ev.category?.name && <span className="ml-1.5">· {ev.category.name}</span>}
                {ev.realized && <span className="ml-1.5 text-emerald-400">· Realizado</span>}
              </p>
            </div>
            <span className={`text-sm font-semibold shrink-0 ${ev.type === 'INCOME' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {fmt(Number(ev.amount))}
            </span>
            <div className="flex gap-1" onClick={e => e.stopPropagation()}>
              {!ev.realized && (
                <button onClick={() => realizeMut.mutate(ev.id)} className="rounded p-1.5 text-slate-500 hover:bg-emerald-500/10 hover:text-emerald-400" title="Marcar como realizado">
                  <Check className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => openEdit(ev)} className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => { if (window.confirm('Excluir evento?')) deleteMut.mutate(ev.id); }} className="rounded p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {(events as any[]).length === 0 && !isLoading && (
          <p className="text-center text-sm text-slate-500 py-8">Nenhum evento futuro cadastrado.</p>
        )}
      </div>
    </div>
  );
}

// ─── Proportional Rules Tab ───────────────────────────────────────────────────

function emptyRule() {
  return { description: '', percent: '', categoryId: '' };
}

function ProportionalRulesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyRule());

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['proportional-rules'],
    queryFn: api.proportionalRules.list,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories.list,
  });

  const createMut = useMutation({
    mutationFn: api.proportionalRules.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['proportional-rules'] }); setShowForm(false); setForm(emptyRule()); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => api.proportionalRules.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['proportional-rules'] }); setEditingId(null); setForm(emptyRule()); },
  });
  const deleteMut = useMutation({
    mutationFn: api.proportionalRules.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proportional-rules'] }),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, active }: any) => api.proportionalRules.update(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proportional-rules'] }),
  });

  function openEdit(r: any) {
    setEditingId(r.id);
    setForm({ description: r.description, percent: String(Math.round(r.percent * 100)), categoryId: r.categoryId ?? '' });
    setShowForm(false);
  }

  function buildPayload() {
    return {
      description: form.description,
      percent: Number(form.percent) / 100,
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
    };
  }

  const RuleForm = () => (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-3">
      <h3 className="font-semibold text-slate-100">{editingId ? 'Editar regra' : 'Nova regra proporcional'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-400">Descrição</label>
          <input className={inputCls} placeholder="Ex: Dízimo, Poupança…" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Percentual (%)</label>
          <input className={inputCls} type="number" min={0} max={100} step={0.1} placeholder="10" value={form.percent} onChange={e => setForm(p => ({ ...p, percent: e.target.value }))} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-400">Categoria (opcional)</label>
          <select className={inputCls} value={form.categoryId} onChange={e => setForm(p => ({ ...p, categoryId: e.target.value }))}>
            <option value="">Sem categoria</option>
            {(categories as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => { setShowForm(false); setEditingId(null); }} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-slate-800">Cancelar</button>
        <button
          disabled={!form.description || !form.percent}
          onClick={() => editingId ? updateMut.mutate({ id: editingId, data: buildPayload() }) : createMut.mutate(buildPayload())}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >Salvar</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyRule()); }} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600">
          <Plus className="h-4 w-4" /> Nova regra
        </button>
      </div>

      {(showForm || editingId) && <RuleForm />}

      {isLoading && <p className="text-sm text-slate-500">Carregando…</p>}

      <div className="space-y-2">
        {(rules as any[]).map((r: any) => (
          <div key={r.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${r.active ? 'border-slate-800 bg-slate-900' : 'border-slate-700/50 bg-slate-900/50 opacity-60'}`}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
              <Percent className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{r.description}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {Math.round(r.percent * 100)}% da receita
                {r.category?.name && <span className="ml-1.5">· {r.category.name}</span>}
                {!r.active && <span className="ml-1.5 text-rose-400">· Inativa</span>}
              </p>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => toggleMut.mutate({ id: r.id, active: !r.active })}
                className={`rounded p-1.5 text-xs font-medium ${r.active ? 'text-slate-500 hover:bg-slate-800' : 'text-emerald-400 hover:bg-emerald-500/10'}`}
                title={r.active ? 'Desativar' : 'Ativar'}
              >
                <Calendar className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => openEdit(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => { if (window.confirm('Excluir regra?')) deleteMut.mutate(r.id); }} className="rounded p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {(rules as any[]).length === 0 && !isLoading && (
          <p className="text-center text-sm text-slate-500 py-8">Nenhuma regra proporcional cadastrada.</p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'budget' | 'events' | 'proportional';

export function PlanningPage() {
  const [tab, setTab] = useState<Tab>('budget');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'budget', label: 'Orçamento' },
    { id: 'events', label: 'Eventos Futuros' },
    { id: 'proportional', label: 'Regras Proporcionais' },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Planejamento</h1>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-900 border border-slate-800 p-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'budget' && <BudgetTab />}
      {tab === 'events' && <PlannedEventsTab />}
      {tab === 'proportional' && <ProportionalRulesTab />}
    </div>
  );
}
