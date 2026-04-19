const API = import.meta.env.VITE_API_URL || 'http://localhost:3333';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
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
  dashboard: {
    summary: () => request<any>('/api/dashboard/summary'),
    monthly: (months?: number) => request<any[]>(`/api/dashboard/monthly?months=${months || 6}`),
  },
};
