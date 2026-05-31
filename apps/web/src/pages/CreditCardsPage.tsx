import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  CreditCard, Plus, Trash2, Pencil, ChevronLeft, ChevronRight,
  X, Check, AlertTriangle, Calendar, Wallet,
} from 'lucide-react';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/**
 * Em qual fatura uma compra feita HOJE cairia, com base no closingDay.
 * Ex.: BB (fecha dia 30, vence dia 10) — hoje 31/mai → fatura de jul/10.
 */
function defaultBillMonth(card: any): { year: number; month: number } {
  const now = new Date();
  const day = now.getDate();
  const m = now.getMonth();   // 0-indexed
  const y = now.getFullYear();

  // Qual ciclo de fechamento a compra de hoje entra?
  let closeM = m;
  if (day > card.closingDay) closeM += 1; // passou do fechamento → proximo ciclo

  // Qual mes de vencimento isso produz?
  let dueM = closeM;
  if (card.billingDay <= card.closingDay) dueM += 1; // vence no mes seguinte ao fechamento

  const due = new Date(y, dueM, card.billingDay); // JS normaliza overflow automaticamente
  return { year: due.getFullYear(), month: due.getMonth() + 1 };
}

export function CreditCardsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [billMonth, setBillMonth] = useState<{ year: number; month: number } | null>(null);

  const { data: cards = [] } = useQuery({
    queryKey: ['credit-cards'],
    queryFn: api.creditCards.list,
  });

  const activeCard = cards.find((c: any) => c.id === selectedCard);
  const activeBillMonth = billMonth ?? (activeCard ? defaultBillMonth(activeCard) : null);

  const { data: bill } = useQuery({
    queryKey: ['credit-card-bill', selectedCard, activeBillMonth?.year, activeBillMonth?.month],
    queryFn: () => api.creditCards.bill(selectedCard!, activeBillMonth!.year, activeBillMonth!.month),
    enabled: !!selectedCard && !!activeBillMonth,
  });

  function selectCard(id: string) {
    if (selectedCard === id) { setSelectedCard(null); setBillMonth(null); return; }
    const card = cards.find((c: any) => c.id === id);
    setSelectedCard(id);
    setBillMonth(card ? defaultBillMonth(card) : null);
  }

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit-cards'] }); setSelectedCard(null); setBillMonth(null); },
  });
  const payBillMut = useMutation({
    mutationFn: () => api.creditCards.payBill(selectedCard!, activeBillMonth!.year, activeBillMonth!.month),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit-card-bill'] });
      qc.invalidateQueries({ queryKey: ['credit-cards'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  function prevMonth() {
    setBillMonth(p => {
      const cur = p ?? activeBillMonth!;
      if (cur.month === 1) return { year: cur.year - 1, month: 12 };
      return { ...cur, month: cur.month - 1 };
    });
  }
  function nextMonth() {
    setBillMonth(p => {
      const cur = p ?? activeBillMonth!;
      if (cur.month === 12) return { year: cur.year + 1, month: 1 };
      return { ...cur, month: cur.month + 1 };
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
        <h2 className="font-semibold text-slate-100">{initial ? 'Editar cartao' : 'Novo cartao'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-slate-400">Nome do cartao</label>
            <input className={inputCls} placeholder="Ex: Nubank, Itau Visa..." value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Dia de fechamento</label>
            <input className={inputCls} type="number" min={1} max={31} value={form.closingDay}
              onChange={e => setForm(p => ({ ...p, closingDay: Number(e.target.value) }))} />
            <p className="mt-1 text-xs text-slate-500">Dia que a fatura fecha (corte das compras)</p>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Dia de vencimento</label>
            <input className={inputCls} type="number" min={1} max={31} value={form.billingDay}
              onChange={e => setForm(p => ({ ...p, billingDay: Number(e.target.value) }))} />
            <p className="mt-1 text-xs text-slate-500">Dia que voce paga a fatura</p>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-slate-400">Limite (R$) &mdash; opcional</label>
            <input className={inputCls} type="number" min={0} step={0.01} placeholder="0,00" value={form.limit}
              onChange={e => setForm(p => ({ ...p, limit: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-slate-800">Cancelar</button>
          <button
            disabled={!form.name}
            onClick={() => onSave({ name: form.name, billingDay: Number(form.billingDay), closingDay: Number(form.closingDay), limit: form.limit ? Number(form.limit) : undefined })}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >Salvar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cartoes de Credito</h1>
        <button onClick={() => { setShowForm(true); setEditing(null); }}
          className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600">
          <Plus className="h-4 w-4" /> Novo cartao
        </button>
      </div>

      {showForm && !editing && (
        <CardForm onSave={d => createMut.mutate(d)} onCancel={() => setShowForm(false)} />
      )}

      {/* Lista de cartoes */}
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card: any) => {
          const isSelected = selectedCard === card.id;
          const usedPct = card.limit ? Math.min(100, (card.usedAmount / card.limit) * 100) : null;
          const isOverLimit = card.limit && card.usedAmount > card.limit;

          if (editing?.id === card.id) {
            return (
              <div key={card.id} className="sm:col-span-2">
                <CardForm initial={card} onSave={d => updateMut.mutate({ id: card.id, data: d })} onCancel={() => setEditing(null)} />
              </div>
            );
          }

          return (
            <div
              key={card.id}
              onClick={() => selectCard(card.id)}
              className={`cursor-pointer rounded-2xl border p-5 transition-all space-y-3
                ${isSelected ? 'border-emerald-500 bg-emerald-500/5 shadow-lg shadow-emerald-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isSelected ? 'bg-emerald-500/20' : 'bg-slate-800'}`}>
                    <CreditCard className={`h-5 w-5 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`} />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-100">{card.name}</p>
                    <p className="text-xs text-slate-500">Fecha dia {card.closingDay} &middot; Vence dia {card.billingDay}</p>
                  </div>
                </div>
                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                  <button onClick={() => { setEditing(card); setShowForm(false); }} className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => { if (window.confirm(`Excluir o cartao "${card.name}"?`)) deleteMut.mutate(card.id); }} className="rounded p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Barra de limite */}
              {card.limit ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className={isOverLimit ? 'text-rose-400' : 'text-slate-400'}>
                      {fmt(card.usedAmount)} usado
                    </span>
                    <span className={isOverLimit ? 'text-rose-400 font-semibold' : 'text-slate-300 font-medium'}>
                      {isOverLimit ? 'Limite excedido' : `${fmt(card.availableLimit)} disponivel`}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all ${isOverLimit ? 'bg-rose-500' : usedPct! > 80 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, usedPct!)}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-600">Limite total: {fmt(card.limit)}</p>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Wallet className="h-3.5 w-3.5" />
                  <span>Sem limite cadastrado</span>
                </div>
              )}

              {/* Proximo vencimento */}
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs
                ${card.usedAmount > 0 ? 'bg-amber-500/10 text-amber-300' : 'bg-slate-800/80 text-slate-500'}`}>
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Proximo vencimento: <strong>{card.billingDay}/{String(card.nextDueMonth).padStart(2, '0')}/{card.nextDueYear}</strong>
                  {card.usedAmount > 0 && <span className="ml-1">&middot; {fmt(card.usedAmount)} a pagar</span>}
                </span>
              </div>
            </div>
          );
        })}

        {cards.length === 0 && !showForm && (
          <div className="sm:col-span-2 rounded-2xl border border-dashed border-slate-700 p-10 text-center text-slate-500">
            <CreditCard className="mx-auto mb-3 h-10 w-10 opacity-40" />
            <p className="font-medium">Nenhum cartao cadastrado</p>
            <p className="text-xs mt-1">Cadastre seus cartoes para controlar faturas e gastos</p>
          </div>
        )}
      </div>

      {/* Detalhe da fatura */}
      {selectedCard && activeBillMonth && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
          {/* Header da fatura */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <div>
              <h2 className="font-semibold text-slate-100">Fatura &mdash; {activeCard?.name}</h2>
              {bill && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Compras de {new Date(bill.period.start).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} a {new Date(bill.period.end).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                </p>
              )}
            </div>
            <button onClick={() => { setSelectedCard(null); setBillMonth(null); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Navegacao de meses (por mes de VENCIMENTO) */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800">
            <button onClick={prevMonth} className="rounded-lg border border-slate-700 p-1.5 hover:bg-slate-800">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex-1 text-center">
              <span className="text-sm font-semibold text-slate-100">
                {MONTHS[activeBillMonth.month - 1]} {activeBillMonth.year}
              </span>
              {bill?.dueDate && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Vencimento: {new Date(bill.dueDate).toLocaleDateString('pt-BR')}
                </p>
              )}
            </div>
            <button onClick={nextMonth} className="rounded-lg border border-slate-700 p-1.5 hover:bg-slate-800">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Total da fatura */}
          {bill && (
            <div className="px-5 py-4 space-y-4">
              <div className={`flex items-center justify-between rounded-xl px-4 py-3 ${bill.isPaid ? 'bg-emerald-500/10' : bill.total > 0 ? 'bg-rose-500/10' : 'bg-slate-800/60'}`}>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Total da fatura</p>
                  <strong className={`text-2xl font-bold ${bill.isPaid ? 'text-emerald-400' : bill.total > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                    {fmt(bill.total)}
                  </strong>
                </div>
                {bill.isPaid && (
                  <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400">
                    <Check className="h-3.5 w-3.5" /> Paga
                  </div>
                )}
                {!bill.isPaid && bill.total > 0 && (
                  <div className="flex items-center gap-1.5 rounded-full bg-rose-500/20 px-3 py-1.5 text-xs font-medium text-rose-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> Em aberto
                  </div>
                )}
              </div>

              {/* Botao pagar */}
              {bill.total > 0 && !bill.isPaid && (
                <button
                  onClick={() => payBillMut.mutate()}
                  disabled={payBillMut.isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                >
                  <Check className="h-4 w-4" />
                  {payBillMut.isPending ? 'Registrando pagamento...' : `Pagar ${fmt(bill.total)}`}
                </button>
              )}

              {/* Lista de transacoes */}
              {bill.transactions.length === 0 ? (
                <p className="text-center text-sm text-slate-500 py-6">Nenhuma compra nesta fatura</p>
              ) : (
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Compras ({bill.transactions.length})</p>
                  {bill.transactions.map((tx: any) => (
                    <div key={tx.id} className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-slate-800/60 transition-colors">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-200 flex items-center gap-1.5 truncate">
                          {tx.paidAt && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                          {tx.description}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {new Date(tx.occurredAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                          {tx.category?.name && <span className="ml-1.5">&middot; {tx.category.name}</span>}
                        </p>
                      </div>
                      <span className={`ml-4 text-sm font-semibold shrink-0 ${tx.paidAt ? 'text-slate-500 line-through' : 'text-rose-400'}`}>
                        {fmt(Number(tx.amount))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
