import { Link } from 'react-router';
import { MessageSquare, BookOpen, ArrowRight } from 'lucide-react';

export function Home() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <div className="max-w-3xl mx-auto text-center mb-16">
        <h1
          className="text-4xl text-[#124D8F] mb-4"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Public Engagement Coaching Tool
        </h1>
        <p className="text-lg text-gray-600">
          A practical resource for public sector workers to enhance their public
          engagement skills through guided coaching and real-world case studies.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
        <Link
          to="/coach"
          className="group p-8 border border-gray-200 rounded-lg hover:border-[#124D8F] transition-all hover:shadow-lg relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-1 h-full bg-[#124D8F] opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="w-12 h-12 bg-[#FDCE3E] text-[#124D8F] rounded-lg flex items-center justify-center mb-4">
            <MessageSquare className="w-6 h-6" />
          </div>
          <h2
            className="text-2xl text-[#124D8F] mb-3"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Coach
          </h2>
          <p className="text-gray-600 mb-4">
            Get personalized guidance on your public engagement challenges.
            Answer questions about your context and receive a tailored,
            editable implementation plan grounded in course frameworks.
          </p>
          <div className="flex items-center text-[#124D8F] font-medium group-hover:gap-2 transition-all">
            Start coaching session
            <ArrowRight className="w-4 h-4 ml-1 text-[#D09006]" />
          </div>
        </Link>

        <Link
          to="/case-studies"
          className="group p-8 border border-gray-200 rounded-lg hover:border-[#124D8F] transition-all hover:shadow-lg relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-1 h-full bg-[#124D8F] opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="w-12 h-12 bg-[#FDCE3E] text-[#124D8F] rounded-lg flex items-center justify-center mb-4">
            <BookOpen className="w-6 h-6" />
          </div>
          <h2
            className="text-2xl text-[#124D8F] mb-3"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Case Studies
          </h2>
          <p className="text-gray-600 mb-4">
            Explore real-world examples of successful public engagement
            initiatives. Filter by criteria and adapt any case study to your
            own situation with a simplified coaching flow.
          </p>
          <div className="flex items-center text-[#124D8F] font-medium group-hover:gap-2 transition-all">
            Browse case studies
            <ArrowRight className="w-4 h-4 ml-1 text-[#D09006]" />
          </div>
        </Link>
      </div>
    </div>
  );
}
