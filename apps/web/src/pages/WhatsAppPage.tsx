import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Smartphone, QrCode, Hash, Wifi, WifiOff, Loader2, RefreshCw, Save, LogOut, Radio, Phone } from 'lucide-react';

const CLIENT_ID = 'default';

export function WhatsAppPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'qr' | 'code'>('qr');
  const [phone, setPhone] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupSaved, setGroupSaved] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Queries ──
  const { data: qrData, refetch: refetchQr } = useQuery({
    queryKey: ['whatsapp-qr', CLIENT_ID],
    queryFn: () => api.whatsapp.qr(CLIENT_ID),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d?.status === 'connected') return false;
      return 3000;
    },
  });

  const { data: groupData } = useQuery({
    queryKey: ['whatsapp-group'],
    queryFn: api.whatsapp.getGroupName,
  });

  useEffect(() => {
    if (groupData?.groupName !== undefined && groupName === '') {
      setGroupName(groupData.groupName);
    }
  }, [groupData]);

  // ── Mutations ──
  const pairMut = useMutation({
    mutationFn: () => api.whatsapp.pair(CLIENT_ID, phone),
    onSuccess: (data) => {
      if (data.pairingCode) setPairingCode(data.pairingCode);
    },
  });

  const disconnectMut = useMutation({
    mutationFn: () => api.whatsapp.disconnect(CLIENT_ID),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-qr'] });
      setPairingCode('');
    },
  });

  const groupMut = useMutation({
    mutationFn: (name: string) => api.whatsapp.setGroupName(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-group'] });
      setGroupSaved(true);
      setTimeout(() => setGroupSaved(false), 2000);
    },
  });

  // ── Provider ──
  const { data: providerData } = useQuery({
    queryKey: ['whatsapp-provider'],
    queryFn: api.whatsapp.getProvider,
  });

  const providerMut = useMutation({
    mutationFn: (provider: string) => api.whatsapp.setProvider(provider),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp-provider'] }),
  });

  const activeProvider = providerData?.active || 'baileys';

  const connected = qrData?.status === 'connected';
  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">WhatsApp</h1>

      {/* ── Status Card ── */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {connected ? (
              <Wifi className="h-5 w-5 text-emerald-400" />
            ) : (
              <WifiOff className="h-5 w-5 text-rose-400" />
            )}
            <div>
              <p className="font-medium">{connected ? 'Conectado' : 'Desconectado'}</p>
              <p className="text-xs text-slate-500">Cliente: {CLIENT_ID}</p>
            </div>
          </div>
          {connected && (
            <button
              onClick={() => disconnectMut.mutate()}
              disabled={disconnectMut.isPending}
              className="flex items-center gap-2 rounded-lg border border-rose-800 px-3 py-2 text-sm text-rose-400 hover:bg-rose-500/10"
            >
              <LogOut className="h-4 w-4" />
              Desconectar
            </button>
          )}
        </div>
      </div>

      {/* ── Provider Selector ── */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-emerald-400" />
          <h2 className="text-lg font-semibold">Canal de envio</h2>
        </div>
        <p className="text-sm text-slate-400">
          Escolha por onde o bot recebe e responde as mensagens do WhatsApp.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => providerMut.mutate('baileys')}
            disabled={providerMut.isPending}
            className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${
              activeProvider === 'baileys'
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                : 'border-slate-700 text-slate-400 hover:border-slate-600'
            }`}
          >
            <Smartphone className="h-6 w-6" />
            <span className="text-sm font-medium">Baileys</span>
            <span className="text-xs text-slate-500">Conexão direta (QR Code)</span>
          </button>
          <button
            onClick={() => providerMut.mutate('twilio')}
            disabled={providerMut.isPending || !providerData?.twilioConfigured}
            className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${
              activeProvider === 'twilio'
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                : 'border-slate-700 text-slate-400 hover:border-slate-600'
            } ${!providerData?.twilioConfigured ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <Phone className="h-6 w-6" />
            <span className="text-sm font-medium">Twilio</span>
            <span className="text-xs text-slate-500">
              {providerData?.twilioConfigured
                ? providerData.twilioPhone || 'Configurado'
                : 'Não configurado'}
            </span>
          </button>
        </div>
        {activeProvider === 'twilio' && (
          <div className="rounded-xl border border-amber-800/50 bg-amber-500/5 p-3">
            <p className="text-xs text-amber-400">
              <strong>Twilio ativo.</strong> Configure a URL de webhook no painel do Twilio:
            </p>
            <code className="mt-1 block rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
              {window.location.origin.replace('5173', '3333')}/api/whatsapp/twilio-webhook
            </code>
            <p className="mt-1 text-xs text-slate-500">
              Método: POST · No Twilio Console → Messaging → WhatsApp Sandbox → When a message comes in
            </p>
          </div>
        )}
      </div>

      {/* ── Connection (QR / Pairing Code) — só mostra se provider = baileys ── */}
      {!connected && activeProvider === 'baileys' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-semibold">Conectar WhatsApp</h2>
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setTab('qr')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'qr' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <QrCode className="h-4 w-4" />
              QR Code
            </button>
            <button
              onClick={() => setTab('code')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === 'code' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Hash className="h-4 w-4" />
              Código de pareamento
            </button>
          </div>

          {/* QR Tab */}
          {tab === 'qr' && (
            <div className="flex flex-col items-center gap-4">
              {qrData?.qrImage ? (
                <div className="rounded-xl bg-white p-3">
                  <img src={qrData.qrImage} alt="QR Code" className="h-64 w-64" />
                </div>
              ) : (
                <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-slate-700">
                  <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
                </div>
              )}
              <p className="text-sm text-slate-400">
                Abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho
              </p>
              <button
                onClick={() => refetchQr()}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-emerald-400"
              >
                <RefreshCw className="h-4 w-4" />
                Atualizar QR
              </button>
            </div>
          )}

          {/* Pairing Code Tab */}
          {tab === 'code' && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Número com DDI (ex: 5511999999999)</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="5511999999999"
                  className={inputCls}
                />
              </div>
              <button
                onClick={() => pairMut.mutate()}
                disabled={!phone || pairMut.isPending}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {pairMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Gerar código
              </button>

              {pairingCode && (
                <div className="rounded-xl border border-emerald-800 bg-emerald-500/10 p-4 text-center">
                  <p className="text-xs text-slate-400 mb-2">
                    Digite este código no WhatsApp &gt; Aparelhos conectados &gt; Conectar com número
                  </p>
                  <p className="font-mono text-3xl font-bold tracking-[0.3em] text-emerald-400">
                    {pairingCode}
                  </p>
                </div>
              )}

              {pairMut.isError && (
                <p className="text-sm text-rose-400">{(pairMut.error as Error).message}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Group Name Config ── */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Hash className="h-5 w-5 text-emerald-400" />
          <h2 className="text-lg font-semibold">Grupo do WhatsApp</h2>
        </div>
        <p className="text-sm text-slate-400">
          Nome do grupo onde o bot escuta as mensagens. Deixe vazio para escutar DMs.
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Ex: jarvis"
            className={inputCls}
          />
          <button
            onClick={() => groupMut.mutate(groupName)}
            disabled={groupMut.isPending}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {groupMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </button>
        </div>
        {groupSaved && (
          <p className="text-sm text-emerald-400">Nome do grupo salvo com sucesso!</p>
        )}
      </div>
    </div>
  );
}
