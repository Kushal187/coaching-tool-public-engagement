import { useState, useRef, useEffect } from 'react';
import {
  RefreshCw,
  ArrowRight,
  ChevronLeft,
  Edit3,
  Download,
  BookOpen,
  Check,
} from 'lucide-react';
import { Link } from 'react-router';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Badge } from './ui/badge';
import { caseStudies, type CaseStudy } from '../data/caseStudies';

/* ── Question definitions ── */

const Q1_OPTIONS = [
  'Policy development or regulatory change',
  'Budget allocation or spending priorities',
  'Community planning (land use, infrastructure, environment)',
  'Service design or improvement',
  'Crisis response or recovery',
  'Strategic visioning or long-term planning',
];

const Q2_OPTIONS = [
  'Discover what people care about or what problems exist',
  'Gather ideas or proposed solutions',
  'Get feedback on a draft plan or proposal',
  'Help people deliberate and find common ground on a contested issue',
  'Prioritize among options or tradeoffs',
  'Co-create a plan, policy, or program with community members',
];

const Q3_OPTIONS = [
  'The general public / broad community',
  'A specific demographic group (youth, seniors, immigrants, etc.)',
  'People directly affected by a decision or policy',
  'Subject-matter experts or professionals',
  'Hard-to-reach or historically underrepresented communities',
  'Internal stakeholders (other agencies, elected officials)',
];

const Q4_OPTIONS = [
  'Less than 4 weeks',
  '1–3 months',
  '3–6 months',
  '6–12 months',
  'No fixed deadline yet',
];

const Q5_OPTIONS = [
  'Dedicated staff time (1+ people working on this)',
  'Budget for tools, platforms, or contractors',
  'Leadership or political champion supporting the effort',
  'An existing community network or partner organizations',
  'Prior engagement data or community relationships to build on',
  'Very limited — I\'m mostly doing this alone with minimal budget',
];

const Q6_OPTIONS = [
  'Time — I need to move fast',
  'Budget — I have very little funding',
  'Authority — I\'m not sure the decision-makers will act on results',
  'Capacity — My team is small or inexperienced with engagement',
  'Trust — The community is skeptical of government engagement',
  'Technical — I\'m unsure what tools or platforms to use',
];

const Q7_OPTIONS = [
  'We haven\'t used AI in our work yet',
  'We\'ve experimented informally (e.g., ChatGPT for drafting)',
  'We\'ve used AI tools in a structured project before',
  'We have organizational guidance or policy on AI use',
  'We\'re actively looking for ways to integrate AI into engagement',
];

const Q8_OPTIONS = [
  'Decision-makers use the input to shape a real policy or program',
  'Previously unheard communities feel included and represented',
  'The public better understands the tradeoffs involved in a decision',
  'We build a lasting relationship with the community for future engagement',
  'We demonstrate that engagement is worth the investment to leadership',
];

const Q9_OPTIONS = [
  'Figuring out which engagement method to use',
  'Reaching the right people, especially underrepresented groups',
  'Writing clear questions or designing tasks for participants',
  'Making sense of the input once it\'s collected',
  'Convincing leadership that the results matter and should be acted on',
  'Communicating back to participants what happened with their input',
];

const Q10_OPTIONS = [
  'Starting from scratch — I haven\'t designed anything yet',
  'I have a rough plan but need help refining it',
  'I\'m mid-process and something isn\'t working',
  'I\'m redesigning a past engagement that didn\'t go well',
  'I\'ve been told to "do engagement" but haven\'t scoped it yet',
];

const FRESH_STAGES = new Set([
  'Starting from scratch — I haven\'t designed anything yet',
  'I\'ve been told to "do engagement" but haven\'t scoped it yet',
]);

/* ── Types ── */

type CoachingPhase =
  | 'q1-issue'
  | 'q2-goal'
  | 'q3-audience'
  | 'q4-timeline'
  | 'q5-resources'
  | 'q6-constraint'
  | 'q7-ai'
  | 'q8-success'
  | 'q9-stuck'
  | 'q10-process'
  | 'midway-existing-work'
  | 'midway-branch'
  | 'plan-output';

type UserContext = {
  issueArea: string;
  issueAreaOther: string;
  primaryGoal: string;
  audience: string[];
  timeline: string;
  resources: string[];
  biggestConstraint: string;
  aiComfort: string;
  successLooksLike: string;
  stuckPoint: string;
  processStage: string;
  existingWork: string;
  midwayChoice: 'plan' | 'qa' | null;
};

const INITIAL_CONTEXT: UserContext = {
  issueArea: '',
  issueAreaOther: '',
  primaryGoal: '',
  audience: [],
  timeline: '',
  resources: [],
  biggestConstraint: '',
  aiComfort: '',
  successLooksLike: '',
  stuckPoint: '',
  processStage: '',
  existingWork: '',
  midwayChoice: null,
};

const BASE_PHASES: CoachingPhase[] = [
  'q1-issue',
  'q2-goal',
  'q3-audience',
  'q4-timeline',
  'q5-resources',
  'q6-constraint',
  'q7-ai',
  'q8-success',
  'q9-stuck',
  'q10-process',
];

function getPhases(ctx: UserContext): CoachingPhase[] {
  const isFresh = FRESH_STAGES.has(ctx.processStage);
  if (ctx.processStage && !isFresh) {
    return [...BASE_PHASES, 'midway-existing-work', 'midway-branch', 'plan-output'];
  }
  return [...BASE_PHASES, 'plan-output'];
}

function getPhaseLabel(phase: CoachingPhase): string {
  const labels: Record<CoachingPhase, string> = {
    'q1-issue': 'Engagement Topic',
    'q2-goal': 'Primary Goal',
    'q3-audience': 'Target Audience',
    'q4-timeline': 'Timeline',
    'q5-resources': 'Resources',
    'q6-constraint': 'Biggest Constraint',
    'q7-ai': 'AI Comfort',
    'q8-success': 'Success Criteria',
    'q9-stuck': 'Stuck Point',
    'q10-process': 'Process Stage',
    'midway-existing-work': 'Existing Work',
    'midway-branch': 'Next Step',
    'plan-output': 'Your Plan',
  };
  return labels[phase];
}

/* ── Plan generation ── */

function generatePlan(ctx: UserContext): string {
  const isMidway = !FRESH_STAGES.has(ctx.processStage) && ctx.processStage !== '';
  const issue = ctx.issueArea === 'Other' ? ctx.issueAreaOther : ctx.issueArea;

  let plan = '';
  plan += `## Your Tailored Public Engagement Plan\n\n`;
  plan += `**Engagement Topic:** ${issue}\n`;
  plan += `**Primary Goal:** ${ctx.primaryGoal}\n`;
  plan += `**Target Audience:** ${ctx.audience.join('; ')}\n`;
  plan += `**Timeline:** ${ctx.timeline}\n`;
  plan += `**Available Resources:** ${ctx.resources.join('; ')}\n`;
  plan += `**Key Constraint:** ${ctx.biggestConstraint}\n`;
  plan += `**Current Stage:** ${ctx.processStage}\n\n`;

  if (isMidway && ctx.existingWork) {
    plan += `### Building on Your Existing Progress\n\n`;
    plan += `Based on what you've described, here's how to move forward:\n\n`;
    plan += `> ${ctx.existingWork}\n\n`;
  }

  /* Phase 1 */
  plan += `### Phase 1: ${isMidway ? 'Assessment & Realignment' : 'Preparation & Design'}\n\n`;

  if (isMidway) {
    plan += `- Audit current engagement activities against your stated goal: *${ctx.primaryGoal.toLowerCase()}*\n`;
    plan += `- Identify which audiences have been reached and who is still missing\n`;
    plan += `- Reassess whether your methods are yielding the type of input you need\n`;
    plan += `- Update your stakeholder map with new relationships and feedback\n`;
  } else {
    plan += `- Map all stakeholder groups relevant to *${issue.toLowerCase()}*\n`;
    plan += `- Define clear engagement objectives tied to your goal: *${ctx.primaryGoal.toLowerCase()}*\n`;
    plan += `- Select engagement methods appropriate for your audience and timeline\n`;
    plan += `- Develop a communication plan to recruit and inform participants\n`;
  }

  /* Audience-specific guidance */
  if (ctx.audience.includes('Hard-to-reach or historically underrepresented communities')) {
    plan += `- Partner with trusted community organizations for culturally appropriate outreach\n`;
    plan += `- Provide multiple participation channels (in-person, online, paper, phone)\n`;
    plan += `- Offer childcare, transportation, translation, and accessibility accommodations\n`;
  }
  if (ctx.audience.includes('A specific demographic group (youth, seniors, immigrants, etc.)')) {
    plan += `- Tailor engagement methods and venues to your target demographic\n`;
    plan += `- Test materials with members of the target group before launching\n`;
  }
  if (ctx.audience.includes('Internal stakeholders (other agencies, elected officials)')) {
    plan += `- Brief internal stakeholders early and establish their role in the process\n`;
    plan += `- Create clear decision-making protocols so staff know how input will be used\n`;
  }

  /* Phase 2 */
  plan += `\n### Phase 2: Engagement Implementation\n\n`;

  /* Constraint-aware recommendations */
  if (ctx.biggestConstraint.includes('Time')) {
    plan += `- Focus on rapid, high-impact methods: online surveys, pop-up events, social media polls\n`;
    plan += `- Use existing gatherings (community meetings, events) to embed engagement\n`;
    plan += `- Set a tight feedback window with clear deadlines\n`;
  } else if (ctx.biggestConstraint.includes('Budget')) {
    plan += `- Leverage free tools: Google Forms, social media, community bulletin boards\n`;
    plan += `- Recruit volunteer facilitators and partner with community organizations\n`;
    plan += `- Piggyback on existing events and meetings rather than hosting new ones\n`;
  } else if (ctx.biggestConstraint.includes('Trust')) {
    plan += `- Begin with listening sessions, not presentations — show you're there to hear\n`;
    plan += `- Partner with trusted community voices to co-host and co-design the process\n`;
    plan += `- Be transparent about what is and isn't on the table for change\n`;
    plan += `- Share how past feedback was used (or acknowledge if it wasn't)\n`;
  } else if (ctx.biggestConstraint.includes('Capacity')) {
    plan += `- Start small: pick one method and one audience segment to pilot\n`;
    plan += `- Use templates and toolkits rather than designing from scratch\n`;
    plan += `- Identify allies in other departments or organizations who can share the load\n`;
  } else if (ctx.biggestConstraint.includes('Authority')) {
    plan += `- Before launching, secure a commitment from decision-makers on how input will be used\n`;
    plan += `- Frame engagement results in terms leadership cares about (risk, legitimacy, compliance)\n`;
    plan += `- Document the engagement process rigorously to build an evidence base\n`;
  } else if (ctx.biggestConstraint.includes('Technical')) {
    plan += `- Start with familiar, low-barrier tools (email, paper surveys, phone calls)\n`;
    plan += `- Consider platforms with built-in facilitation (e.g., Pol.is, Decidim, Bang the Table)\n`;
    plan += `- Budget time for staff training or bring in a technical partner\n`;
  }

  /* Goal-specific methods */
  if (ctx.primaryGoal.includes('Discover what people care about')) {
    plan += `- Use open-ended methods: listening sessions, story circles, community walks\n`;
    plan += `- Deploy broad-reach tools like surveys and social media to surface themes\n`;
  } else if (ctx.primaryGoal.includes('deliberate and find common ground')) {
    plan += `- Use structured deliberation formats: citizen panels, world cafés, fishbowl discussions\n`;
    plan += `- Provide balanced background materials so all participants start with shared facts\n`;
  } else if (ctx.primaryGoal.includes('Co-create')) {
    plan += `- Run participatory design workshops where community members build prototypes\n`;
    plan += `- Create iterative feedback loops so participants see how their input evolves\n`;
  } else if (ctx.primaryGoal.includes('Prioritize among options')) {
    plan += `- Present clear options with tradeoffs explained in accessible language\n`;
    plan += `- Use ranking, dot-voting, or structured comparison exercises\n`;
  }

  plan += `- Create regular feedback loops showing participants how input shapes outcomes\n`;
  plan += `- Maintain consistent and transparent communication throughout\n`;

  /* Phase 3 */
  plan += `\n### Phase 3: Synthesis & Closing the Loop\n\n`;

  if (ctx.stuckPoint.includes('Making sense of the input')) {
    plan += `- Use thematic coding to organize qualitative input into actionable categories\n`;
    plan += `- Create a summary dashboard that maps input to decision points\n`;
    plan += `- Distinguish between common themes, outlier ideas worth exploring, and noise\n`;
  } else if (ctx.stuckPoint.includes('Convincing leadership')) {
    plan += `- Prepare an executive summary that connects engagement findings to policy objectives\n`;
    plan += `- Include both quantitative participation data and compelling qualitative stories\n`;
    plan += `- Show how similar jurisdictions benefited from acting on engagement results\n`;
  } else if (ctx.stuckPoint.includes('Communicating back to participants')) {
    plan += `- Publish a "What We Heard" report within 2–4 weeks of engagement closing\n`;
    plan += `- Clearly explain which ideas were adopted, which weren't, and why\n`;
    plan += `- Use the same channels you used to recruit participants for the follow-up\n`;
  } else {
    plan += `- Analyze participation data for demographic representation and gaps\n`;
    plan += `- Synthesize findings into a clear, actionable report for decision-makers\n`;
    plan += `- Communicate results back to participants showing how their input was used\n`;
  }

  plan += `- Document lessons learned for future engagement initiatives\n`;
  plan += `- Establish ongoing communication channels for continued community dialogue\n`;

  /* AI guidance */
  plan += `\n### AI Integration Guidance\n\n`;
  if (ctx.aiComfort.includes('haven\'t used AI')) {
    plan += `- Start simple: use AI to help draft plain-language summaries of technical documents\n`;
    plan += `- Consider AI-assisted translation for multilingual engagement materials\n`;
    plan += `- No AI tools are required — every step above can be done with traditional methods\n`;
  } else if (ctx.aiComfort.includes('experimented informally')) {
    plan += `- Use AI to draft engagement questions, then refine with your team\n`;
    plan += `- Try AI summarization tools to process open-ended survey responses\n`;
    plan += `- Always have humans review AI outputs before sharing with participants\n`;
  } else {
    plan += `- Integrate AI tools for real-time sentiment analysis during large-scale input collection\n`;
    plan += `- Use AI-powered platforms to cluster and theme qualitative feedback at scale\n`;
    plan += `- Consider AI chatbots for 24/7 public-facing Q&A about the engagement process\n`;
    plan += `- Maintain transparency: always disclose when AI is part of the process\n`;
  }

  /* Success criteria */
  plan += `\n### Measuring Success\n\n`;
  plan += `Your stated definition of success: *${ctx.successLooksLike}*\n\n`;
  plan += `Suggested metrics to track:\n`;
  plan += `- Participation volume: total participants, submissions, and touchpoints\n`;
  plan += `- Demographic representation: compare participant demographics to community demographics\n`;
  plan += `- Input quality: richness and actionability of feedback received\n`;
  plan += `- Decision influence: number of engagement findings reflected in final decisions\n`;
  plan += `- Participant satisfaction: post-engagement survey on experience and trust\n`;

  return plan;
}

/* ── Case study scoring ── */

function scoreCaseStudy(cs: CaseStudy, ctx: UserContext): number {
  let score = 0;

  if (ctx.biggestConstraint.includes('Budget') && cs.relevanceFactors.budgetLevel === 'low') score += 3;
  if (ctx.biggestConstraint.includes('Time') && cs.sizeCategory === 'small') score += 2;
  if (ctx.audience.includes('Hard-to-reach or historically underrepresented communities') && cs.relevanceFactors.ruralFocus) score += 3;
  if (ctx.audience.includes('A specific demographic group (youth, seniors, immigrants, etc.)') && cs.relevanceFactors.youthFocus) score += 3;
  if (ctx.issueArea.includes('Policy') && cs.relevanceFactors.policyFocus) score += 2;
  if (ctx.issueArea.includes('Community planning') && cs.relevanceFactors.policyFocus) score += 2;
  if (ctx.resources.includes('Very limited') && cs.relevanceFactors.budgetLevel === 'low') score += 2;
  if (ctx.primaryGoal.includes('Co-create') && cs.tags.includes('Co-Design')) score += 3;
  if (ctx.primaryGoal.includes('deliberate') && cs.tags.includes('Deliberative Democracy')) score += 3;

  const timelineShort = ctx.timeline.includes('4 weeks') || ctx.timeline.includes('1–3');
  const timelineLong = ctx.timeline.includes('6–12') || ctx.timeline.includes('No fixed');
  if (timelineShort && cs.sizeCategory === 'small') score += 2;
  if (timelineLong && cs.sizeCategory === 'large') score += 2;

  if (ctx.stuckPoint.includes('Reaching the right people') && cs.relevanceFactors.ruralFocus) score += 2;
  if (ctx.stuckPoint.includes('engagement method') && cs.tags.includes('Hybrid Engagement')) score += 2;

  score += Math.random() * 1.5;
  return score;
}

/* ── Main component ── */

export function Coach() {
  const [currentPhase, setCurrentPhase] = useState<CoachingPhase>('q1-issue');
  const [ctx, setCtx] = useState<UserContext>({ ...INITIAL_CONTEXT });
  const [generatedPlan, setGeneratedPlan] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editablePlan, setEditablePlan] = useState('');
  const [recommendedStudies, setRecommendedStudies] = useState<
    { study: CaseStudy; score: number }[]
  >([]);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPhase]);

  const phases = getPhases(ctx);
  const currentIdx = phases.indexOf(currentPhase);
  const progressPct =
    currentPhase === 'plan-output'
      ? 100
      : Math.round(((currentIdx + 1) / phases.length) * 100);

  const goTo = (phase: CoachingPhase) => {
    if (phase === 'plan-output') {
      const plan = generatePlan(ctx);
      setGeneratedPlan(plan);
      setEditablePlan(plan);
      const scored = caseStudies
        .map((cs) => ({ study: cs, score: scoreCaseStudy(cs, ctx) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      setRecommendedStudies(scored);
    }
    setCurrentPhase(phase);
  };

  const goBack = () => {
    if (currentIdx > 0) setCurrentPhase(phases[currentIdx - 1]);
  };

  const handleReset = () => {
    setCurrentPhase('q1-issue');
    setCtx({ ...INITIAL_CONTEXT });
    setGeneratedPlan('');
    setEditablePlan('');
    setRecommendedStudies([]);
    setIsEditing(false);
  };

  const handleDownload = () => {
    const content = editablePlan || generatedPlan;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'engagement-plan.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* After Q10, decide the path */
  const handleProcessStageSelect = (option: string) => {
    setCtx((prev) => ({ ...prev, processStage: option }));
    if (FRESH_STAGES.has(option)) {
      setTimeout(() => goTo('plan-output'), 200);
    } else {
      setTimeout(() => goTo('midway-existing-work'), 200);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">
            Coaching Session
          </h1>
          <p className="text-gray-600">
            Answer questions to receive a tailored engagement plan
          </p>
        </div>
        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          Reset
        </button>
      </div>

      {/* Progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            Step {currentIdx + 1} of {phases.length}:{' '}
            {getPhaseLabel(currentPhase)}
          </span>
          <span className="text-sm text-gray-500">{progressPct}%</span>
        </div>
        <Progress value={progressPct} />
      </div>

      {/* Content */}
      <div
        ref={contentRef}
        className="border border-gray-200 rounded-lg bg-white shadow-sm min-h-[500px]"
      >
        <div className="p-8">
          {/* ── Q1 ── */}
          {currentPhase === 'q1-issue' && (
            <SingleSelectQuestion
              number={1}
              title="What's your engagement about?"
              subtitle="What best describes the issue or decision you're designing engagement around?"
              options={Q1_OPTIONS}
              value={ctx.issueArea}
              onSelect={(v) => {
                setCtx((prev) => ({ ...prev, issueArea: v }));
                if (v !== 'Other') setTimeout(() => goTo('q2-goal'), 200);
              }}
              hasOther
              otherValue={ctx.issueAreaOther}
              onOtherChange={(v) =>
                setCtx((prev) => ({ ...prev, issueAreaOther: v }))
              }
              onOtherSubmit={() => {
                setCtx((prev) => ({ ...prev, issueArea: 'Other' }));
                goTo('q2-goal');
              }}
              canGoBack={false}
            />
          )}

          {/* ── Q2 ── */}
          {currentPhase === 'q2-goal' && (
            <SingleSelectQuestion
              number={2}
              title="What's your primary goal?"
              subtitle="What do you most need from the public in this engagement?"
              options={Q2_OPTIONS}
              value={ctx.primaryGoal}
              onSelect={(v) => {
                setCtx((prev) => ({ ...prev, primaryGoal: v }));
                setTimeout(() => goTo('q3-audience'), 200);
              }}
              onBack={goBack}
            />
          )}

          {/* ── Q3 (multi-select) ── */}
          {currentPhase === 'q3-audience' && (
            <MultiSelectQuestion
              number={3}
              title="Who are you trying to reach?"
              subtitle="Select all that apply."
              options={Q3_OPTIONS}
              value={ctx.audience}
              onChange={(v) => setCtx((prev) => ({ ...prev, audience: v }))}
              onNext={() => goTo('q4-timeline')}
              onBack={goBack}
            />
          )}

          {/* ── Q4 ── */}
          {currentPhase === 'q4-timeline' && (
            <SingleSelectQuestion
              number={4}
              title="What's your timeline?"
              subtitle="How much time do you have before engagement needs to be completed?"
              options={Q4_OPTIONS}
              value={ctx.timeline}
              onSelect={(v) => {
                setCtx((prev) => ({ ...prev, timeline: v }));
                setTimeout(() => goTo('q5-resources'), 200);
              }}
              onBack={goBack}
            />
          )}

          {/* ── Q5 (multi-select) ── */}
          {currentPhase === 'q5-resources' && (
            <MultiSelectQuestion
              number={5}
              title="What resources do you have?"
              subtitle="Select all that apply."
              options={Q5_OPTIONS}
              value={ctx.resources}
              onChange={(v) => setCtx((prev) => ({ ...prev, resources: v }))}
              onNext={() => goTo('q6-constraint')}
              onBack={goBack}
            />
          )}

          {/* ── Q6 ── */}
          {currentPhase === 'q6-constraint' && (
            <SingleSelectQuestion
              number={6}
              title="What's your biggest constraint?"
              subtitle="Pick the one that feels most limiting right now."
              options={Q6_OPTIONS}
              value={ctx.biggestConstraint}
              onSelect={(v) => {
                setCtx((prev) => ({ ...prev, biggestConstraint: v }));
                setTimeout(() => goTo('q7-ai'), 200);
              }}
              onBack={goBack}
            />
          )}

          {/* ── Q7 ── */}
          {currentPhase === 'q7-ai' && (
            <SingleSelectQuestion
              number={7}
              title="How comfortable are you with AI tools?"
              subtitle="Which best describes your team's current relationship with AI?"
              options={Q7_OPTIONS}
              value={ctx.aiComfort}
              onSelect={(v) => {
                setCtx((prev) => ({ ...prev, aiComfort: v }));
                setTimeout(() => goTo('q8-success'), 200);
              }}
              onBack={goBack}
            />
          )}

          {/* ── Q8 ── */}
          {currentPhase === 'q8-success' && (
            <SingleSelectQuestion
              number={8}
              title="What does success look like?"
              subtitle="If this engagement goes well, what's the most important outcome?"
              options={Q8_OPTIONS}
              value={ctx.successLooksLike}
              onSelect={(v) => {
                setCtx((prev) => ({ ...prev, successLooksLike: v }));
                setTimeout(() => goTo('q9-stuck'), 200);
              }}
              onBack={goBack}
            />
          )}

          {/* ── Q9 ── */}
          {currentPhase === 'q9-stuck' && (
            <SingleSelectQuestion
              number={9}
              title="Where do you feel most stuck?"
              subtitle="What's the single biggest thing you need help with right now?"
              options={Q9_OPTIONS}
              value={ctx.stuckPoint}
              onSelect={(v) => {
                setCtx((prev) => ({ ...prev, stuckPoint: v }));
                setTimeout(() => goTo('q10-process'), 200);
              }}
              onBack={goBack}
            />
          )}

          {/* ── Q10 (branching) ── */}
          {currentPhase === 'q10-process' && (
            <SingleSelectQuestion
              number={10}
              title="Where are you in the process?"
              subtitle="Which best describes where you are right now?"
              options={Q10_OPTIONS}
              value={ctx.processStage}
              onSelect={handleProcessStageSelect}
              onBack={goBack}
            />
          )}

          {/* ── Midway: Existing Work ── */}
          {currentPhase === 'midway-existing-work' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  What have you already done?
                </h2>
                <p className="text-gray-600">
                  Tell us about your engagement activities so far — methods
                  used, who you've reached, what feedback you've gathered, and
                  any challenges encountered. This is optional.
                </p>
              </div>
              <textarea
                className="w-full min-h-[140px] p-4 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-y"
                placeholder="e.g., We held three community workshops with ~200 participants, ran an online survey with 500 responses, partnered with two local organizations..."
                value={ctx.existingWork}
                onChange={(e) =>
                  setCtx((prev) => ({ ...prev, existingWork: e.target.value }))
                }
              />
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={goBack}
                  className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
                <Button onClick={() => goTo('midway-branch')}>
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-gray-400 text-center">
                This step is optional — feel free to skip if you don't have
                details to share.
              </p>
            </div>
          )}

          {/* ── Midway: Branch ── */}
          {currentPhase === 'midway-branch' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  How can we help you next?
                </h2>
                <p className="text-gray-600">
                  Choose how you'd like to proceed based on your current needs.
                </p>
              </div>
              <div className="space-y-4">
                <button
                  onClick={() => {
                    setCtx((prev) => ({ ...prev, midwayChoice: 'plan' }));
                    goTo('plan-output');
                  }}
                  className="w-full text-left p-6 border border-gray-200 rounded-lg hover:border-gray-900 hover:shadow-md transition-all group cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-1">
                        Generate a plan that builds on my progress
                      </h3>
                      <p className="text-gray-600 text-sm">
                        Get a tailored plan that accounts for what you've
                        already done and focuses on next steps.
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-gray-900 group-hover:translate-x-1 transition-all" />
                  </div>
                </button>
                <button
                  onClick={() => {
                    setCtx((prev) => ({ ...prev, midwayChoice: 'qa' }));
                    alert(
                      'This will open the Q&A chatbot with your context pre-loaded. (Backend not connected yet — placeholder.)'
                    );
                  }}
                  className="w-full text-left p-6 border border-gray-200 rounded-lg hover:border-gray-900 hover:shadow-md transition-all group cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-1">
                        Ask questions about my engagement
                      </h3>
                      <p className="text-gray-600 text-sm">
                        Open the Q&A chatbot pre-loaded with your context to
                        get targeted advice on specific challenges.
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-gray-900 group-hover:translate-x-1 transition-all" />
                  </div>
                </button>
              </div>
              <div className="pt-2">
                <button
                  onClick={goBack}
                  className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
              </div>
            </div>
          )}

          {/* ── Plan Output ── */}
          {currentPhase === 'plan-output' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-1">
                    Your Engagement Plan
                  </h2>
                  <p className="text-gray-500 text-sm">
                    Review, edit, and download your tailored plan
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(!isEditing)}
                  >
                    <Edit3 className="w-4 h-4" />
                    {isEditing ? 'Preview' : 'Edit'}
                  </Button>
                  <Button size="sm" onClick={handleDownload}>
                    <Download className="w-4 h-4" />
                    Download
                  </Button>
                </div>
              </div>

              {isEditing ? (
                <textarea
                  className="w-full min-h-[400px] p-4 border border-gray-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-y"
                  value={editablePlan}
                  onChange={(e) => setEditablePlan(e.target.value)}
                />
              ) : (
                <div className="prose prose-sm max-w-none p-6 bg-gray-50 rounded-lg border border-gray-200">
                  <MarkdownRenderer text={editablePlan || generatedPlan} />
                </div>
              )}

              {/* Recommended Case Studies */}
              {recommendedStudies.length > 0 && (
                <div className="mt-8">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    Recommended Case Studies
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Ranked by relevance to your context, constraints, and
                    timeline
                  </p>
                  <div className="space-y-3">
                    {recommendedStudies.map(({ study, score }, idx) => (
                      <Link
                        key={study.id}
                        to={`/case-studies/${study.id}`}
                        className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-400 hover:shadow-sm transition-all group"
                      >
                        <div className="flex items-start gap-4">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 text-sm font-semibold flex-shrink-0">
                            {idx + 1}
                          </div>
                          <div>
                            <h4 className="font-medium text-gray-900 group-hover:underline">
                              {study.title}
                            </h4>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                              <span>{study.location}</span>
                              <span>&bull;</span>
                              <span>{study.timeframe}</span>
                              <span>&bull;</span>
                              <span>{study.size}</span>
                            </div>
                            <div className="flex gap-1.5 mt-2">
                              {study.tags.map((tag) => (
                                <Badge
                                  key={tag}
                                  variant="secondary"
                                  className="text-xs"
                                >
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-right">
                            <div className="text-xs text-gray-500">
                              Relevance
                            </div>
                            <div className="text-sm font-semibold text-gray-900">
                              {Math.min(
                                Math.round((score / 12) * 100),
                                98
                              )}
                              %
                            </div>
                          </div>
                          <BookOpen className="w-4 h-4 text-gray-400 group-hover:text-gray-900 transition-colors" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500 italic">
                  This plan is a starting point grounded in course frameworks.
                  Edit it freely to match your specific context. The tool does
                  not generate engagement outputs (like reports or surveys) —
                  it provides guidance for you to follow.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Reusable: single-select question ── */

function SingleSelectQuestion({
  number,
  title,
  subtitle,
  options,
  value,
  onSelect,
  onBack,
  canGoBack = true,
  hasOther = false,
  otherValue = '',
  onOtherChange,
  onOtherSubmit,
}: {
  number: number;
  title: string;
  subtitle: string;
  options: string[];
  value: string;
  onSelect: (v: string) => void;
  onBack?: () => void;
  canGoBack?: boolean;
  hasOther?: boolean;
  otherValue?: string;
  onOtherChange?: (v: string) => void;
  onOtherSubmit?: () => void;
}) {
  const [showOtherInput, setShowOtherInput] = useState(
    value === 'Other' && hasOther
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
          Question {number} of 10
        </div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">{title}</h2>
        <p className="text-gray-600">{subtitle}</p>
      </div>

      <div className="space-y-2.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => {
              setShowOtherInput(false);
              onSelect(opt);
            }}
            className={`w-full text-left px-5 py-3.5 border rounded-lg transition-all group cursor-pointer ${
              value === opt
                ? 'border-gray-900 bg-gray-50 shadow-sm'
                : 'border-gray-200 hover:border-gray-400'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-gray-900">{opt}</span>
              {value === opt ? (
                <Check className="w-4 h-4 text-gray-900 flex-shrink-0" />
              ) : (
                <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
              )}
            </div>
          </button>
        ))}

        {hasOther && (
          <>
            <button
              onClick={() => setShowOtherInput(true)}
              className={`w-full text-left px-5 py-3.5 border rounded-lg transition-all cursor-pointer ${
                showOtherInput || value === 'Other'
                  ? 'border-gray-900 bg-gray-50 shadow-sm'
                  : 'border-gray-200 hover:border-gray-400'
              }`}
            >
              <span className="text-gray-900">Other</span>
            </button>
            {showOtherInput && (
              <div className="flex gap-2 ml-4">
                <input
                  type="text"
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  placeholder="Describe your engagement topic..."
                  value={otherValue}
                  onChange={(e) => onOtherChange?.(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && otherValue?.trim())
                      onOtherSubmit?.();
                  }}
                  autoFocus
                />
                <Button
                  onClick={onOtherSubmit}
                  disabled={!otherValue?.trim()}
                >
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {canGoBack && onBack && (
        <div className="pt-2">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Reusable: multi-select question ── */

function MultiSelectQuestion({
  number,
  title,
  subtitle,
  options,
  value,
  onChange,
  onNext,
  onBack,
}: {
  number: number;
  title: string;
  subtitle: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  onNext: () => void;
  onBack?: () => void;
}) {
  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
          Question {number} of 10
        </div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">{title}</h2>
        <p className="text-gray-600">{subtitle}</p>
      </div>

      <div className="space-y-2.5">
        {options.map((opt) => {
          const selected = value.includes(opt);
          return (
            <button
              key={opt}
              onClick={() => toggle(opt)}
              className={`w-full text-left px-5 py-3.5 border rounded-lg transition-all cursor-pointer ${
                selected
                  ? 'border-gray-900 bg-gray-50 shadow-sm'
                  : 'border-gray-200 hover:border-gray-400'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    selected
                      ? 'bg-gray-900 border-gray-900'
                      : 'border-gray-300'
                  }`}
                >
                  {selected && <Check className="w-3 h-3 text-white" />}
                </div>
                <span className="text-gray-900">{opt}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2">
        {onBack ? (
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
        ) : (
          <div />
        )}
        <Button onClick={onNext} disabled={value.length === 0}>
          Continue
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

/* ── Simple markdown renderer ── */

function MarkdownRenderer({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        if (line.startsWith('## '))
          return (
            <h2
              key={i}
              className="text-xl font-semibold text-gray-900 mt-4 mb-2"
            >
              {line.replace('## ', '')}
            </h2>
          );
        if (line.startsWith('### '))
          return (
            <h3
              key={i}
              className="text-lg font-semibold text-gray-900 mt-6 mb-2"
            >
              {line.replace('### ', '')}
            </h3>
          );
        if (line.startsWith('> '))
          return (
            <blockquote
              key={i}
              className="border-l-4 border-gray-300 pl-4 text-gray-600 italic my-2"
            >
              {line.replace('> ', '')}
            </blockquote>
          );
        if (line.startsWith('**')) {
          const match = line.match(/\*\*(.*?)\*\*(.*)/);
          if (match)
            return (
              <p key={i} className="text-gray-700 mb-1">
                <strong>{match[1]}</strong>
                {renderInlineEmphasis(match[2])}
              </p>
            );
        }
        if (line.startsWith('- '))
          return (
            <div key={i} className="flex gap-2 text-gray-700 mb-1 ml-4">
              <span className="text-gray-400 flex-shrink-0">&bull;</span>
              <span>{renderInlineEmphasis(line.replace('- ', ''))}</span>
            </div>
          );
        if (line.trim() === '') return <div key={i} className="h-2" />;
        return (
          <p key={i} className="text-gray-700 mb-1">
            {renderInlineEmphasis(line)}
          </p>
        );
      })}
    </>
  );
}

function renderInlineEmphasis(text: string) {
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      return (
        <em key={i} className="text-gray-600">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}
