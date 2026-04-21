const API = import.meta.env.VITE_API_URL || 'http://localhost:3333';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erro ${res.status}`);
  }
  return res.json();
}

/** Upload multipart (sem Content-Type header — browser define boundary) */
async function upload<T>(path: string, formData: FormData): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erro ${res.status}`);
  }
  return res.json();
}

export const api = {
  auth: {
    register: (data: { email: string; password: string; fullName: string }) =>
      request<{ user: any; token: string; workspaceId: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    login: (data: { email: string; password: string }) =>
      request<{ user: any; token: string; workspaceId: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    me: () => request<{ user: any; workspaceId: string }>('/api/auth/me'),
    logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  },
  transactions: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<{ data: any[]; total: number }>(`/api/transactions${qs}`);
    },
    create: (data: any) => request<any>('/api/transactions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/api/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/api/transactions/${id}`, { method: 'DELETE' }),
  },
  categories: {
    list: () => request<any[]>('/api/categories'),
    create: (data: any) => request<any>('/api/categories', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/api/categories/${id}`, { method: 'DELETE' }),
  },
  accounts: {
    list: () => request<any[]>('/api/accounts'),
    create: (data: any) => request<any>('/api/accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/api/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/api/accounts/${id}`, { method: 'DELETE' }),
  },
  recurring: {
    list: () => request<any[]>('/api/recurring'),
    create: (data: any) => request<any>('/api/recurring', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/api/recurring/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/api/recurring/${id}`, { method: 'DELETE' }),
  },
  creditCards: {
    list: () => request<any[]>('/api/credit-cards'),
    create: (data: any) => request<any>('/api/credit-cards', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/api/credit-cards/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/api/credit-cards/${id}`, { method: 'DELETE' }),
    bill: (id: string, year: number, month: number) =>
      request<any>(`/api/credit-cards/${id}/bill?year=${year}&month=${month}`),
  },
  reports: {
    monthly: (pastMonths = 6, futureMonths = 3) =>
      request<any[]>(`/api/reports/monthly?pastMonths=${pastMonths}&futureMonths=${futureMonths}`),
    yearSummary: (year?: number) =>
      request<any>(`/api/reports/year-summary${year ? `?year=${year}` : ''}`),
  },
  import: {
    preview: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return upload<any>('/api/import/preview', fd);
    },
    confirm: (data: any) => request<any>('/api/import/confirm', { method: 'POST', body: JSON.stringify(data) }),
  },
  dashboard: {
    summary: () => request<any>('/api/dashboard/summary'),
    monthly: (months?: number) => request<any[]>(`/api/dashboard/monthly?months=${months || 6}`),
  },
  whatsapp: {
    qr: (clientId: string) => request<{ clientId: string; status: string; hasQr: boolean; qrImage: string | null }>(`/api/whatsapp/qr/${clientId}`),
    status: (clientId: string) => request<{ clientId: string; status: string; hasQr: boolean }>(`/api/whatsapp/status/${clientId}`),
    pair: (clientId: string, phoneNumber: string) => request<{ clientId: string; pairingCode?: string; status?: string }>(`/api/whatsapp/pair/${clientId}`, { method: 'POST', body: JSON.stringify({ phoneNumber }) }),
    disconnect: (clientId: string) => request<{ success: boolean }>(`/api/whatsapp/disconnect/${clientId}`, { method: 'POST' }),
    getGroupName: () => request<{ groupName: string }>('/api/whatsapp/webhook-group'),
    setGroupName: (groupName: string) => request<{ groupName: string }>('/api/whatsapp/webhook-group', { method: 'PUT', body: JSON.stringify({ groupName }) }),
    getProvider: () => request<{ active: string; twilioConfigured: boolean; twilioPhone: string | null }>('/api/whatsapp/provider'),
    setProvider: (provider: string) => request<{ active: string }>('/api/whatsapp/provider', { method: 'PUT', body: JSON.stringify({ provider }) }),
  },
};
  auth: {
    register: (data: { email: string; password: string; fullName: string }) =>
      request<{ user: any; token: string; workspaceId: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    login: (data: { email: string; password: string }) =>
      request<{ user: any; token: string; workspaceId: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    me: () => request<{ user: any; workspaceId: string }>('/api/auth/me'),
    logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  },
  transactions: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<{ data: any[]; total: number }>(`/api/transactions${qs}`);
    },
    create: (data: any) => request<any>('/api/transactions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/api/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/api/transactions/${id}`, { method: 'DELETE' }),
  },
  categories: {
    list: () => request<any[]>('/api/categories'),
    create: (data: any) => request<any>('/api/categories', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/api/categories/${id}`, { method: 'DELETE' }),
  },
  accounts: {
    list: () => request<any[]>('/api/accounts'),
    create: (data: any) => request<any>('/api/accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/api/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/api/accounts/${id}`, { method: 'DELETE' }),
  },
  recurring: {
    list: () => request<any[]>('/api/recurring'),
    create: (data: any) => request<any>('/api/recurring', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/api/recurring/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/api/recurring/${id}`, { method: 'DELETE' }),
  },
  dashboard: {
    summary: () => request<any>('/api/dashboard/summary'),
    monthly: (months?: number) => request<any[]>(`/api/dashboard/monthly?months=${months || 6}`),
  },
  whatsapp: {
    qr: (clientId: string) => request<{ clientId: string; status: string; hasQr: boolean; qrImage: string | null }>(`/api/whatsapp/qr/${clientId}`),
    status: (clientId: string) => request<{ clientId: string; status: string; hasQr: boolean }>(`/api/whatsapp/status/${clientId}`),
    pair: (clientId: string, phoneNumber: string) => request<{ clientId: string; pairingCode?: string; status?: string }>(`/api/whatsapp/pair/${clientId}`, { method: 'POST', body: JSON.stringify({ phoneNumber }) }),
    disconnect: (clientId: string) => request<{ success: boolean }>(`/api/whatsapp/disconnect/${clientId}`, { method: 'POST' }),
    getGroupName: () => request<{ groupName: string }>('/api/whatsapp/webhook-group'),
    setGroupName: (groupName: string) => request<{ groupName: string }>('/api/whatsapp/webhook-group', { method: 'PUT', body: JSON.stringify({ groupName }) }),
    getProvider: () => request<{ active: string; twilioConfigured: boolean; twilioPhone: string | null }>('/api/whatsapp/provider'),
    setProvider: (provider: string) => request<{ active: string }>('/api/whatsapp/provider', { method: 'PUT', body: JSON.stringify({ provider }) }),
  },
};
