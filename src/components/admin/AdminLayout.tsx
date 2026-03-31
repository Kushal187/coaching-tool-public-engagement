import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import {
  LayoutDashboard,
  FileText,
  Workflow,
  ArrowLeft,
  Lock,
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { path: '/admin/documents', label: 'Documents', icon: FileText, exact: false },
  { path: '/admin/pipeline', label: 'Pipeline', icon: Workflow, exact: false },
];

const ADMIN_CREDENTIALS_KEY = 'adminCredentials';

function getStoredCredentials(): string | null {
  return sessionStorage.getItem(ADMIN_CREDENTIALS_KEY);
}

function storeCredentials(username: string, password: string) {
  const encoded = btoa(`${username}:${password}`);
  sessionStorage.setItem(ADMIN_CREDENTIALS_KEY, encoded);
}

export function getAdminAuthHeader(): Record<string, string> {
  const creds = getStoredCredentials();
  if (!creds) return {};
  return { Authorization: `Basic ${creds}` };
}

function LoginDialog({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Please enter both username and password.');
      return;
    }

    setLoading(true);
    setError('');

    storeCredentials(username, password);

    try {
      const resp = await fetch('/api/admin/stats', {
        headers: getAdminAuthHeader(),
      });

      if (resp.ok) {
        onLogin();
      } else {
        sessionStorage.removeItem(ADMIN_CREDENTIALS_KEY);
        setError(resp.status === 401 ? 'Invalid credentials.' : `Error: ${resp.status}`);
      }
    } catch {
      sessionStorage.removeItem(ADMIN_CREDENTIALS_KEY);
      setError('Unable to reach server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="bg-white border border-gray-200 rounded-lg p-8 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <Lock className="w-5 h-5 text-[#124D8F]" />
            <h2
              className="text-xl text-[#124D8F]"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              Admin Login
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#124D8F] focus:border-transparent"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#124D8F] focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-[#124D8F] text-white text-sm font-medium rounded-md hover:bg-[#0e3d73] disabled:opacity-50 transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function AdminLayout() {
  const location = useLocation();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (getStoredCredentials()) {
      setAuthenticated(true);
    }
  }, []);

  const isActive = (item: (typeof NAV_ITEMS)[number]) =>
    item.exact
      ? location.pathname === item.path
      : location.pathname.startsWith(item.path);

  if (!authenticated) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center gap-4 mb-8">
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#124D8F] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to app
          </Link>
        </div>
        <LoginDialog onLogin={() => setAuthenticated(true)} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center gap-4 mb-8">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#124D8F] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to app
        </Link>
        <div className="h-5 w-px bg-gray-200" />
        <h1
          className="text-3xl text-[#124D8F]"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Data Dashboard
        </h1>
        <div className="ml-auto">
          <button
            onClick={() => {
              sessionStorage.removeItem(ADMIN_CREDENTIALS_KEY);
              setAuthenticated(false);
            }}
            className="text-sm text-gray-500 hover:text-red-600 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Tab-style nav */}
      <div className="flex gap-1 border-b border-gray-200 mb-8">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              isActive(item)
                ? 'border-[#124D8F] text-[#124D8F]'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </Link>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
