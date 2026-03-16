import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  Download,
  ChevronLeft,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import jsPDF from 'jspdf';
import { Button } from './ui/button';
import { MarkdownContent } from './ui/markdown-content';
import type { AssessmentCard } from './CoachingChatPanel';
import type { NestaResponses } from './Coach';

interface ReflectionItem {
  questionId: number;
  question: string;
  analysis: string;
  nextSteps?: string[];
}

interface PriorityAction {
  action: string;
  rationale: string;
  timeline: string;
}

interface ReflectionData {
  summary: string;
  addressed: ReflectionItem[];
  partial: ReflectionItem[];
  notAddressed: ReflectionItem[];
  priorityActions: PriorityAction[];
}

export function Reflection() {
  const navigate = useNavigate();
  const [reflection, setReflection] = useState<ReflectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolvedWithoutChat, setResolvedWithoutChat] = useState<Set<number>>(new Set());
  const [resolvedViaCrossChat, setResolvedViaCrossChat] = useState<Set<number>>(new Set());
  const [resolvedInAssessment, setResolvedInAssessment] = useState<Set<number>>(new Set());

  const fetchReflection = async () => {
    setLoading(true);
    setError('');

    const savedResponses = sessionStorage.getItem('nestaResponses');
    const savedEvaluations = sessionStorage.getItem('nestaEvaluations');

    if (!savedResponses || !savedEvaluations) {
      navigate('/coach');
      return;
    }

    try {
      const responses: NestaResponses = JSON.parse(savedResponses);
      const evaluations: AssessmentCard[] = JSON.parse(savedEvaluations);

      const chatHistories: Record<number, { role: string; content: string }[]> = {};
      for (let i = 1; i <= 9; i++) {
        const saved = sessionStorage.getItem(`nestaChat_${i}`);
        if (saved) {
          try { chatHistories[i] = JSON.parse(saved); } catch { /* skip */ }
        }
      }

      let crossResolved = new Set<number>();
      try {
        const saved = sessionStorage.getItem('nestaCrossResolved');
        if (saved) crossResolved = new Set(JSON.parse(saved));
      } catch { /* ignore */ }
      setResolvedViaCrossChat(crossResolved);

      let initiallyAddressed = new Set<number>();
      try {
        const saved = sessionStorage.getItem('nestaInitiallyAddressed');
        if (saved) initiallyAddressed = new Set(JSON.parse(saved));
      } catch { /* ignore */ }

      const noChat = new Set<number>();
      const fromAssessment = new Set<number>();
      for (const ev of evaluations) {
        if (ev.status === 'addressed') {
          const chat = chatHistories[ev.questionId];
          const userMsgs = chat?.filter((m) => m.role === 'user') || [];
          if (userMsgs.length === 0 && !crossResolved.has(ev.questionId)) {
            if (initiallyAddressed.has(ev.questionId)) {
              fromAssessment.add(ev.questionId);
            } else {
              noChat.add(ev.questionId);
            }
          }
        }
      }
      setResolvedWithoutChat(noChat);
      setResolvedInAssessment(fromAssessment);

      const res = await fetch('/api/generate-reflection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses, evaluations, chatHistories }),
      });

      if (!res.ok) throw new Error('Reflection generation failed');

      const data = await res.json();
      setReflection(data.reflection);
    } catch (err) {
      console.error('Failed to generate reflection:', err);
      setError('Failed to generate your reflection. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReflection();
  }, []);

  const handleDownload = () => {
    if (!reflection) return;

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const checkPage = (needed: number) => {
      if (y + needed > pageHeight - 25) {
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(
          'Public Engagement Coach \u2014 Nesta Framework Assessment',
          pageWidth / 2,
          pageHeight - 10,
          { align: 'center' },
        );
        doc.addPage();
        y = margin;
      }
    };

    const stripMarkdown = (text: string): string =>
      text
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/#{1,6}\s/g, '')
        .replace(/`(.*?)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^\s*[-*]\s/gm, '\u2022 ');

    const writeWrapped = (
      text: string,
      fontSize: number,
      color: [number, number, number] = [50, 50, 50],
      style: 'normal' | 'bold' = 'normal',
      indent = 0,
    ) => {
      doc.setFontSize(fontSize);
      doc.setTextColor(...color);
      doc.setFont('helvetica', style);
      const cleaned = stripMarkdown(text);
      const wrapped = doc.splitTextToSize(cleaned, contentWidth - indent);
      for (const line of wrapped) {
        checkPage(fontSize * 0.5);
        doc.text(line, margin + indent, y);
        y += fontSize * 0.45;
      }
    };

    // ── Title page ──
    y = 60;
    doc.setFontSize(28);
    doc.setTextColor(18, 77, 143);
    doc.setFont('helvetica', 'bold');
    doc.text('Public Engagement', pageWidth / 2, y, { align: 'center' });
    y += 12;
    doc.text('Reflection', pageWidth / 2, y, { align: 'center' });
    y += 20;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, y, {
      align: 'center',
    });
    y += 6;
    doc.text('Nesta Framework Self-Assessment', pageWidth / 2, y, {
      align: 'center',
    });

    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(
      'Public Engagement Coach \u2014 Nesta Framework Assessment',
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' },
    );

    // ── Overall Summary ──
    doc.addPage();
    y = margin;
    doc.setFontSize(18);
    doc.setTextColor(18, 77, 143);
    doc.setFont('helvetica', 'bold');
    doc.text('Overall Summary', margin, y);
    y += 3;
    doc.setDrawColor(18, 77, 143);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
    writeWrapped(reflection.summary, 10.5);
    y += 6;

    const renderSection = (
      title: string,
      items: ReflectionItem[],
      color: [number, number, number],
      showNextSteps: boolean,
      highlightNoChat = false,
    ) => {
      if (items.length === 0) return;
      checkPage(20);
      doc.setFontSize(16);
      doc.setTextColor(...color);
      doc.setFont('helvetica', 'bold');
      doc.text(title, margin, y);
      y += 3;
      doc.setDrawColor(...color);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      items.forEach((item, i) => {
        checkPage(14);
        if (highlightNoChat && resolvedWithoutChat.has(item.questionId)) {
          checkPage(10);
          doc.setFillColor(255, 243, 205);
          doc.setDrawColor(217, 164, 6);
          doc.roundedRect(margin, y - 3, contentWidth, 8, 1.5, 1.5, 'FD');
          doc.setFontSize(9);
          doc.setTextColor(146, 100, 0);
          doc.setFont('helvetica', 'bold');
          doc.text('\u26A0  Resolved without coaching conversation', margin + 3, y + 2);
          y += 9;
        } else if (highlightNoChat && resolvedViaCrossChat.has(item.questionId)) {
          checkPage(10);
          doc.setFillColor(228, 239, 252);
          doc.setDrawColor(18, 77, 143);
          doc.roundedRect(margin, y - 3, contentWidth, 8, 1.5, 1.5, 'FD');
          doc.setFontSize(9);
          doc.setTextColor(18, 77, 143);
          doc.setFont('helvetica', 'bold');
          doc.text('Resolved through a different conversation', margin + 3, y + 2);
          y += 9;
        } else if (highlightNoChat && resolvedInAssessment.has(item.questionId)) {
          checkPage(10);
          doc.setFillColor(230, 245, 241);
          doc.setDrawColor(9, 114, 97);
          doc.roundedRect(margin, y - 3, contentWidth, 8, 1.5, 1.5, 'FD');
          doc.setFontSize(9);
          doc.setTextColor(9, 114, 97);
          doc.setFont('helvetica', 'bold');
          doc.text('Resolved in the Coaching Assessment', margin + 3, y + 2);
          y += 9;
        }
        writeWrapped(
          `${i + 1}. ${item.question}`,
          11,
          [30, 30, 30],
          'bold',
        );
        y += 2;
        writeWrapped(item.analysis, 10);
        if (showNextSteps && item.nextSteps?.length) {
          y += 2;
          writeWrapped('Next Steps:', 10, color, 'bold', 4);
          y += 1;
          item.nextSteps.forEach((step) => {
            writeWrapped(`\u2022 ${step}`, 10, [50, 50, 50], 'normal', 8);
          });
        }
        y += 6;
      });
    };

    renderSection(
      'Strengths \u2014 What You\'ve Figured Out',
      reflection.addressed,
      [9, 114, 97],
      false,
      true,
    );
    renderSection(
      'Areas to Develop \u2014 What\'s Underdeveloped',
      reflection.partial,
      [208, 144, 6],
      true,
    );
    renderSection(
      'Critical Gaps \u2014 What to Work On Next',
      reflection.notAddressed,
      [157, 12, 27],
      true,
    );

    // ── Priority Actions ──
    if (reflection.priorityActions.length > 0) {
      checkPage(20);
      doc.setFontSize(16);
      doc.setTextColor(18, 77, 143);
      doc.setFont('helvetica', 'bold');
      doc.text('Priority Actions', margin, y);
      y += 3;
      doc.setDrawColor(18, 77, 143);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      reflection.priorityActions.forEach((pa, i) => {
        checkPage(18);
        writeWrapped(`${i + 1}. ${pa.action}`, 11, [30, 30, 30], 'bold');
        y += 1;
        writeWrapped(pa.rationale, 10);
        y += 1;
        writeWrapped(`Timeline: ${pa.timeline}`, 10, [18, 77, 143], 'bold', 4);
        y += 6;
      });
    }

    // Footer on last page
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(
      'Public Engagement Coach \u2014 Nesta Framework Assessment',
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' },
    );

    doc.save('engagement-reflection.pdf');
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-10 h-10 text-[#124D8F] animate-spin" />
          <p className="text-gray-700 font-medium text-lg">
            Generating your reflection...
          </p>
          <p className="text-sm text-gray-400">
            Our AI is analyzing your assessment and coaching sessions to create
            an in-depth reflection
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <p className="text-red-600 font-medium">{error}</p>
          <Button type="button" onClick={fetchReflection}>
            <RefreshCw className="w-4 h-4" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!reflection) return null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1
          className="text-3xl text-[#124D8F] mb-2"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Your Reflection
        </h1>
        <p className="text-gray-600 text-lg">
          An in-depth analysis of your public engagement readiness across the
          Nesta framework, with specific recommendations.
        </p>
      </div>

      {/* Overall Summary */}
      <div className="bg-[#E4EFFC]/40 border border-[#124D8F]/15 rounded-xl p-8 mb-8">
        <h2
          className="text-xl text-[#124D8F] mb-4"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Overall Summary
        </h2>
        <div className="text-gray-700 leading-relaxed">
          <MarkdownContent>{reflection.summary}</MarkdownContent>
        </div>
      </div>

      <div className="space-y-6 mb-8">
        {/* Strengths */}
        {reflection.addressed.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-8">
            <div className="mb-6">
              <h2
                className="text-2xl text-[#097261]"
                style={{ fontFamily: "'DM Serif Display', serif" }}
              >
                Strengths
              </h2>
              <p className="text-[#097261]/70 text-sm">
                What you've figured out and why it matters
              </p>
            </div>
            <div className="space-y-5">
              {reflection.addressed.map((item) => {
                const isCrossResolved = resolvedViaCrossChat.has(item.questionId);
                const isNoChat = resolvedWithoutChat.has(item.questionId);
                const isFromAssessment = resolvedInAssessment.has(item.questionId);

                return (
                <div
                  key={item.questionId}
                  className="rounded-lg p-5 bg-white border border-gray-200"
                >
                  {isNoChat && (
                    <div
                      className="mb-3 rounded-r-md border-l-4 border-gray-500 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800"
                      role="status"
                    >
                      Resolved without coaching conversation
                    </div>
                  )}
                  {isCrossResolved && !isNoChat && (
                    <div
                      className="mb-3 rounded-r-md border-l-4 border-gray-500 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800"
                      role="status"
                    >
                      Resolved through a different conversation
                    </div>
                  )}
                  {isFromAssessment && (
                    <div
                      className="mb-3 rounded-r-md border-l-4 border-gray-500 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800"
                      role="status"
                    >
                      Resolved in the Coaching Assessment
                    </div>
                  )}
                  <h3 className="font-semibold text-gray-800 mb-2">
                    {item.questionId}. {item.question}
                  </h3>
                  <div className="text-gray-600 text-sm leading-relaxed">
                    <MarkdownContent compact>{item.analysis}</MarkdownContent>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Areas to Develop */}
        {reflection.partial.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-8">
            <div className="mb-6">
              <h2
                className="text-2xl text-[#D09006]"
                style={{ fontFamily: "'DM Serif Display', serif" }}
              >
                Areas to Develop
              </h2>
              <p className="text-[#D09006]/70 text-sm">
                Good start, but needs more work
              </p>
            </div>
            <div className="space-y-5">
              {reflection.partial.map((item) => (
                <div
                  key={item.questionId}
                  className="bg-white border border-gray-200 rounded-lg p-5"
                >
                  <h3 className="font-semibold text-gray-800 mb-2">
                    {item.questionId}. {item.question}
                  </h3>
                  <div className="text-gray-600 text-sm leading-relaxed mb-3">
                    <MarkdownContent compact>{item.analysis}</MarkdownContent>
                  </div>
                  {item.nextSteps && item.nextSteps.length > 0 && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
                        Next Steps
                      </p>
                      <ul className="space-y-1">
                        {item.nextSteps.map((step, i) => (
                          <li
                            key={i}
                            className="text-sm text-gray-700 flex gap-2"
                          >
                            <span className="text-gray-500 flex-shrink-0">
                              &bull;
                            </span>
                            {step}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Critical Gaps */}
        {reflection.notAddressed.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-8">
            <div className="mb-6">
              <h2
                className="text-2xl text-[#9D0C1B]"
                style={{ fontFamily: "'DM Serif Display', serif" }}
              >
                Critical Gaps
              </h2>
              <p className="text-[#9D0C1B]/70 text-sm">
                Areas that need immediate attention
              </p>
            </div>
            <div className="space-y-5">
              {reflection.notAddressed.map((item) => (
                <div
                  key={item.questionId}
                  className="bg-white border border-gray-200 rounded-lg p-5"
                >
                  <h3 className="font-semibold text-gray-800 mb-2">
                    {item.questionId}. {item.question}
                  </h3>
                  <div className="text-gray-600 text-sm leading-relaxed mb-3">
                    <MarkdownContent compact>{item.analysis}</MarkdownContent>
                  </div>
                  {item.nextSteps && item.nextSteps.length > 0 && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
                        Next Steps
                      </p>
                      <ul className="space-y-1">
                        {item.nextSteps.map((step, i) => (
                          <li
                            key={i}
                            className="text-sm text-gray-700 flex gap-2"
                          >
                            <span className="text-gray-500 flex-shrink-0">
                              &bull;
                            </span>
                            {step}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Priority Actions */}
      {reflection.priorityActions.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 mb-8">
          <div className="mb-6">
            <h2
                className="text-2xl text-[#124D8F]"
                style={{ fontFamily: "'DM Serif Display', serif" }}
              >
                Priority Actions
              </h2>
            <p className="text-gray-500 text-sm">
              Your top next steps, in order of impact
            </p>
          </div>
          <div className="space-y-4">
            {reflection.priorityActions.map((pa, i) => (
              <div
                key={i}
                className="flex gap-4 bg-[#E4EFFC]/30 rounded-lg p-5"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[#124D8F] text-white text-lg font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800 mb-1">
                    {pa.action}
                  </h3>
                  <p className="text-sm text-gray-600 mb-2">{pa.rationale}</p>
                  <span className="inline-block text-xs font-medium text-[#124D8F] bg-[#E4EFFC] px-3 py-1 rounded-full">
                    {pa.timeline}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-4 justify-center pb-8">
        <Button type="button" onClick={handleDownload} className="px-8 py-3">
          <Download className="w-5 h-5" />
          Download Reflection
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate('/coach/dashboard')}
          className="px-8 py-3"
        >
          <ChevronLeft className="w-5 h-5" />
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
