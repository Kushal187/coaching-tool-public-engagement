import { Link, Outlet, useLocation } from 'react-router';
import { MessageSquare, BookOpen } from 'lucide-react';
import { ChatBot } from './ChatBot';

export function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-xl font-semibold text-gray-900">
              Public Engagement Coach
            </Link>
            <div className="flex gap-6">
              <Link
                to="/coach"
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
                  location.pathname === '/coach'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                Coach
              </Link>
              <Link
                to="/case-studies"
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
                  location.pathname === '/case-studies' ||
                  location.pathname.startsWith('/case-studies/')
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                Case Studies
              </Link>
            </div>
          </div>
        </div>
      </nav>
      <main>
        <Outlet />
      </main>
      <ChatBot />
    </div>
  );
}
