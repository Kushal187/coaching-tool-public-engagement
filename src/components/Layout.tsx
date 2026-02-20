import { Link, Outlet, useLocation } from 'react-router';
import { MessageSquare, BookOpen } from 'lucide-react';
import { ChatBot } from './ChatBot';

export function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <nav className="bg-[#124D8F]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link
              to="/"
              className="text-xl text-white"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              Public Engagement Coach
            </Link>
            <div className="flex gap-2">
              <Link
                to="/coach"
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors text-sm font-medium ${
                  location.pathname === '/coach'
                    ? 'bg-white/20 text-white'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                Coach
              </Link>
              <Link
                to="/case-studies"
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors text-sm font-medium ${
                  location.pathname === '/case-studies' ||
                  location.pathname.startsWith('/case-studies/')
                    ? 'bg-white/20 text-white'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                Case Studies
              </Link>
            </div>
          </div>
        </div>
        <div className="h-1 bg-[#FDCE3E]" />
      </nav>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-[#124D8F] text-white mt-16">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h3
                className="text-lg mb-4"
                style={{ fontFamily: "'DM Serif Display', serif" }}
              >
                Public Engagement Coach
              </h3>
              <p className="text-white/70 text-sm leading-relaxed max-w-md">
                A practical resource for public sector workers to enhance their
                public engagement skills through guided coaching and real-world
                case studies.
              </p>
              <div className="flex gap-4 mt-4">
                <Link
                  to="/coach"
                  className="text-sm text-white/70 hover:text-[#FDCE3E] transition-colors"
                >
                  Coach
                </Link>
                <Link
                  to="/case-studies"
                  className="text-sm text-white/70 hover:text-[#FDCE3E] transition-colors"
                >
                  Case Studies
                </Link>
              </div>
            </div>
            <div className="flex flex-col items-start md:items-end justify-between">
              <div>
                <p className="text-sm text-white/70 mb-1 md:text-right">
                  Brought to you by
                </p>
                <a
                  href="https://innovate-us.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#FDCE3E] hover:text-[#D09006] transition-colors font-medium"
                >
                  InnovateUS
                </a>
              </div>
              <p className="text-xs text-white/50 mt-6">
                This work is licensed under a Creative Commons
                Attribution-ShareAlike 4.0 International License.
              </p>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <p className="text-xs text-white/40 text-center">
              &copy; {new Date().getFullYear()} InnovateUS &middot; The
              Governance Lab
            </p>
          </div>
        </div>
      </footer>

      <ChatBot />
    </div>
  );
}
