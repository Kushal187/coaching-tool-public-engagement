import { Link, Outlet, useLocation } from 'react-router';
import {
  LayoutDashboard,
  FileText,
  Workflow,
  ArrowLeft,
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { path: '/admin/documents', label: 'Documents', icon: FileText, exact: false },
  { path: '/admin/pipeline', label: 'Pipeline', icon: Workflow, exact: false },
];

export function AdminLayout() {
  const location = useLocation();

  const isActive = (item: (typeof NAV_ITEMS)[number]) =>
    item.exact
      ? location.pathname === item.path
      : location.pathname.startsWith(item.path);

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
