import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { CreditCard, Plus, Trash2, Pencil, ChevronLeft, ChevronRight, X } from 'lucide-react';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

export function CreditCardsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [billMonth, setBillMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });

  const { data: cards = [] } = useQuery({ queryKey: ['credit-cards'], queryFn: api.creditCards.list });
  const { data: bill } = useQuery({
    queryKey: ['credit-card-bill', selectedCard, billMonth.year, billMonth.month],
    queryFn: () => api.creditCards.bill(selectedCard!, billMonth.year, billMonth.month),
    enabled: !!selectedCard,
  });

  const createMut = useMutation({
    mutationFn: api.creditCards.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit-cards'] }); setShowForm(false); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => api.creditCards.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit-cards'] }); setEditing(null); },
  });
  const deleteMut = useMutation({
    mutationFn: api.creditCards.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit-cards'] }); if (selectedCard) setSelectedCard(null); },
  });

  function prevMonth() {
    setBillMonth(p => {
      if (p.month === 1) return { year: p.year - 1, month: 12 };
      return { ...p, month: p.month - 1 };
    });
  }
  function nextMonth() {
    setBillMonth(p => {
      if (p.month === 12) return { year: p.year + 1, month: 1 };
      return { ...p, month: p.month + 1 };
    });
  }

  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none';

  function CardForm({ initial, onSave, onCancel }: { initial?: any; onSave: (d: any) => void; onCancel: () => void }) {
    const [form, setForm] = useState({
      name: initial?.name ?? '',
      billingDay: initial?.billingDay ?? 10,
      closingDay: initial?.closingDay ?? 3,
      limit: initial?.limit ? String(initial.limit) : '',
    });
    return (
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4">
        <h2 className="font-semibold">{initial ? 'Editar cartão' : 'Novo cartão'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-slate-400">Nome do cartão</label>
            <input className={inputCls} placeholder="Ex: Nubank, Itaú Visa..." value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Dia de vencimento</label>
            <input className={inputCls} type="number" min={1} max={31} value={form.billingDay} onChange={e => setForm(p => ({ ...p, billingDay: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Dia de fechamento</label>
            <input className={inputCls} type="number" min={1} max={31} value={form.closingDay} onChange={e => setForm(p => ({ ...p, closingDay: Number(e.target.value) }))} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-slate-400">Limite (opcional)</label>
            <input className={inputCls} type="number" min={0} step={0.01} placeholder="0,00" value={form.limit} onChange={e => setForm(p => ({ ...p, limit: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-slate-800">Cancelar</button>
          <button
            disabled={!form.name}
            onClick={() => onSave({ ...form, billingDay: Number(form.billingDay), closingDay: Number(form.closingDay), limit: form.limit ? Number(form.limit) : undefined })}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >Salvar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cartões de Crédito</h1>
        <button onClick={() => { setShowForm(true); setEditing(null); }} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600">
          <Plus className="h-4 w-4" /> Novo cartão
        </button>
      </div>

      {showForm && !editing && (
        <CardForm onSave={d => createMut.mutate(d)} onCancel={() => setShowForm(false)} />
      )}

      {/* Cards list */}
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card: any) => (
          <div
            key={card.id}
            onClick={() => setSelectedCard(selectedCard === card.id ? null : card.id)}
            className={`cursor-pointer rounded-2xl border p-5 transition-colors ${selectedCard === card.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}
          >
            {editing?.id === card.id ? (
              <CardForm
                initial={card}
                onSave={d => updateMut.mutate({ id: card.id, data: d })}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <CreditCard className="h-6 w-6 text-emerald-400" />
                    <div>
                      <p className="font-medium">{card.name}</p>
                      <p className="text-xs text-slate-500">Vence dia {card.billingDay} · Fecha dia {card.closingDay}</p>
                    </div>
                  </div>
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <button onClick={() => { setEditing(card); setShowForm(false); }} className="rounded p-1 text-slate-500 hover:text-slate-200">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => deleteMut.mutate(card.id)} className="rounded p-1 text-slate-500 hover:text-rose-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {card.limit && (
                  <p className="mt-2 text-sm text-slate-400">Limite: {fmt(Number(card.limit))}</p>
                )}
              </>
            )}
          </div>
        ))}

        {cards.length === 0 && !showForm && (
          <div className="sm:col-span-2 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-500">
            <CreditCard className="mx-auto mb-2 h-8 w-8" />
            <p>Nenhum cartão cadastrado</p>
            <p className="text-xs mt-1">Cadastre seus cartões para controlar a fatura e rastrear gastos no crédito via WhatsApp</p>
          </div>
        )}
      </div>

      {/* Bill section */}
      {selectedCard && bill && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Fatura — {bill.card.name}</h2>
            <button onClick={() => setSelectedCard(null)} className="text-slate-500 hover:text-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Month nav */}
          <div className="flex items-center gap-3">
            <button onClick={prevMonth} className="rounded-lg border border-slate-700 p-1.5 hover:bg-slate-800">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="flex-1 text-center text-sm font-medium">
              {MONTHS[billMonth.month - 1]} {billMonth.year}
            </span>
            <button onClick={nextMonth} className="rounded-lg border border-slate-700 p-1.5 hover:bg-slate-800">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-800/60 px-4 py-3">
            <span className="text-sm text-slate-400">Total da fatura</span>
            <strong className="text-lg text-rose-400">{fmt(bill.total)}</strong>
          </div>
          <p className="text-xs text-slate-500">
            Vencimento: {new Date(bill.dueDate).toLocaleDateString('pt-BR')} · 
            Período: {new Date(bill.period.start).toLocaleDateString('pt-BR')} – {new Date(bill.period.end).toLocaleDateString('pt-BR')}
          </p>

          {bill.transactions.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-4">Nenhuma compra nesta fatura</p>
          ) : (
            <div className="space-y-1">
              {bill.transactions.map((tx: any) => (
                <div key={tx.id} className="flex items-center justify-between py-1.5 border-b border-slate-800 last:border-0">
                  <div>
                    <p className="text-sm">{tx.description}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(tx.occurredAt).toLocaleDateString('pt-BR')}
                      {tx.category && ` · ${tx.category.name}`}
                    </p>
                  </div>
                  <span className="text-sm text-rose-400">{fmt(Number(tx.amount))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
