import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ChevronRight, X, Sparkles } from 'lucide-react';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

type PreviewRow = {
  rowIndex: number;
  date: string | null;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  category: string | null;
};

export function ImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [accountId, setAccountId] = useState('');
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [result, setResult] = useState<any>(null);

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: api.accounts.list });

  const previewMut = useMutation({
    mutationFn: (f: File) => api.import.preview(f),
    onSuccess: (data) => {
      setPreview(data);
      // allRows contém TODAS as linhas (preview + restante); preview contém só as 20 primeiras para exibir
      setRows(data.allRows ?? data.preview);
      setStep('preview');
    },
  });

  const confirmMut = useMutation({
    mutationFn: () => api.import.confirm({ accountId: accountId || undefined, rows }),
    onSuccess: (data) => { setResult(data); setStep('done'); },
  });

  function handleFile(f: File) {
    setFile(f);
    previewMut.mutate(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function toggleType(idx: number) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, type: r.type === 'INCOME' ? 'EXPENSE' : 'INCOME' } : r));
  }

  function removeRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx));
  }

  function reset() {
    setFile(null); setPreview(null); setRows([]); setAccountId(''); setStep('upload'); setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const inputCls = 'rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Importar Planilha</h1>

      {/* Steps indicator */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {['Upload', 'Revisão', 'Concluído'].map((s, i) => {
          const current = ['upload', 'preview', 'done'].indexOf(step);
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <ChevronRight className="h-3 w-3 text-slate-600" />}
              <span className={`px-2 py-0.5 rounded-full font-medium ${i === current ? 'bg-emerald-500/20 text-emerald-400' : i < current ? 'text-slate-400' : 'text-slate-600'}`}>
                {s}
              </span>
            </div>
          );
        })}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900 p-12 text-center hover:border-emerald-500/50 transition-colors"
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <FileSpreadsheet className="mx-auto mb-4 h-12 w-12 text-slate-500" />
          <p className="text-lg font-medium text-slate-300">Arraste ou clique para selecionar</p>
          <p className="mt-1 text-sm text-slate-500">Suporta Excel (.xlsx, .xls) e CSV</p>
          <p className="mt-4 text-xs text-slate-600">
            A planilha deve ter colunas de data, descrição e valor.<br />
            O sistema identifica automaticamente entradas e saídas.
          </p>
          {previewMut.isPending && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
              <span>Analisando planilha com IA...</span>
            </div>
          )}
          {previewMut.isError && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4" />
              {(previewMut.error as Error).message}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 'preview' && preview && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">
                <strong className="text-slate-200">{file?.name}</strong> · {preview.totalRows} linhas · {rows.length} identificadas
              </p>
            </div>
            <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
              <X className="h-3 w-3" /> Trocar arquivo
            </button>
          </div>

          {/* AI explanation banner */}
          {preview?.usedAI && preview?.aiExplanation && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-800/40 bg-emerald-500/5 p-3">
              <Sparkles className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-emerald-400">Analisado por IA</p>
                <p className="text-xs text-slate-400 mt-0.5">{preview.aiExplanation}</p>
              </div>
            </div>
          )}
          {!preview?.usedAI && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-800/40 bg-amber-500/5 p-3">
              <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-400">IA não disponível — usando detecção automática por padrões. Verifique os tipos antes de confirmar.</p>
            </div>
          )}

          {/* Account selector */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="text-sm text-slate-400 whitespace-nowrap">Vincular à conta:</label>
            <div className="flex items-center gap-2">
              <select value={accountId} onChange={e => setAccountId(e.target.value)} className={inputCls}>
                <option value="">Sem vínculo</option>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <span className="text-xs text-slate-500">(opcional — atualiza saldo)</span>
            </div>
          </div>

          {/* Rows list/table */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="hidden sm:grid sm:grid-cols-[90px,1fr,100px,100px,32px] gap-2 text-xs text-slate-500 px-4 py-2 border-b border-slate-800 font-medium">
              <span>Data</span>
              <span>Descrição</span>
              <span>Valor</span>
              <span>Tipo</span>
              <span></span>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-800/40">
              {rows.slice(0, 20).map((row, idx) => (
                <div key={row.rowIndex} className="flex flex-col sm:grid sm:grid-cols-[90px,1fr,100px,100px,32px] sm:items-center gap-2 sm:gap-2 px-4 py-3 sm:py-2.5 hover:bg-slate-800/30 transition-colors">
                  <div className="flex items-center justify-between sm:block">
                    <span className="text-xs text-slate-500 font-medium sm:font-normal">
                      {row.date ? new Date(row.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'}
                    </span>
                    <button onClick={() => removeRow(idx)} className="sm:hidden text-slate-500 hover:text-rose-400 p-1" aria-label="Remover">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  
                  <span className="text-sm font-medium sm:font-normal text-slate-200 truncate">{row.description}</span>
                  
                  <div className="flex items-center justify-between sm:block pt-1 sm:pt-0 border-t border-slate-800/30 sm:border-t-0">
                    <span className="sm:hidden text-xs text-slate-500 font-medium">Valor:</span>
                    <span className="text-sm font-semibold text-slate-100 sm:text-slate-200">{fmt(row.amount)}</span>
                  </div>

                  <div className="flex items-center justify-between sm:block pt-1 sm:pt-0">
                    <span className="sm:hidden text-xs text-slate-500 font-medium flex items-center gap-1">Tipo: <span className="text-[10px] font-normal text-slate-600">(toque p/ mudar)</span></span>
                    <button
                      onClick={() => toggleType(idx)}
                      className={`px-3 py-0.5 rounded-full text-xs font-medium ${row.type === 'INCOME' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}
                    >
                      {row.type === 'INCOME' ? 'Entrada' : 'Saída'}
                    </button>
                  </div>

                  <button onClick={() => removeRow(idx)} className="hidden sm:block text-slate-600 hover:text-rose-400 ml-auto p-1" aria-label="Remover">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {rows.length > 20 && (
                <div className="px-4 py-2.5 text-xs text-slate-500 text-center border-t border-slate-800">
                  + {rows.length - 20} linhas adicionais não exibidas (todas serão importadas)
                </div>
              )}
            </div>
          </div>

          {/* Summary */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-sm font-medium">
            <span className="text-emerald-400">
              Entradas: {fmt(rows.filter(r => r.type === 'INCOME').reduce((s, r) => s + r.amount, 0))}
            </span>
            <span className="text-rose-400">
              Saídas: {fmt(rows.filter(r => r.type === 'EXPENSE').reduce((s, r) => s + r.amount, 0))}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={reset} className="w-full sm:w-auto rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 text-center">
              Cancelar
            </button>
            <button
              disabled={rows.length === 0 || confirmMut.isPending}
              onClick={() => confirmMut.mutate()}
              className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {confirmMut.isPending ? 'Importando...' : `Importar ${rows.length} lançamentos`}
            </button>
          </div>

          {confirmMut.isError && (
            <p className="text-sm text-rose-400 flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {(confirmMut.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* Step 3: Done */}
      {step === 'done' && result && (
        <div className="rounded-2xl border border-emerald-800/50 bg-emerald-500/5 p-8 text-center space-y-4">
          <CheckCircle className="mx-auto h-12 w-12 text-emerald-400" />
          <p className="text-xl font-semibold">Importação concluída!</p>
          <p className="text-slate-400">{result.imported} lançamentos foram adicionados ao sistema.</p>
          <div className="flex justify-center gap-3 pt-2">
            <button onClick={reset} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800">
              Nova importação
            </button>
            <a href="/transactions" className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600">
              Ver lançamentos
            </a>
          </div>
        </div>
      )}

      {/* Tips */}
      {step === 'upload' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-2">
          <p className="text-sm font-medium text-slate-300">Dicas para a planilha</p>
          <ul className="space-y-1 text-xs text-slate-500">
            <li>• A primeira linha deve ser o cabeçalho (ex: Data, Descrição, Valor)</li>
            <li>• Datas no formato dd/mm/aaaa são reconhecidas automaticamente</li>
            <li>• Valores negativos ou colunas de "Débito" são marcados como saída</li>
            <li>• Palavras como "salário", "recebi" nas descrições são marcadas como entrada</li>
            <li>• Você pode ajustar o tipo (entrada/saída) antes de confirmar</li>
            <li>• Exportações do Nubank, Itaú e outros bancos costumam funcionar</li>
          </ul>
        </div>
      )}
    </div>
  );
}
