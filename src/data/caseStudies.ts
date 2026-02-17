export type CaseStudy = {
  id: string;
  title: string;
  location: string;
  timeframe: string;
  demographic: string;
  size: string;
  sizeCategory: 'small' | 'medium' | 'large';
  tags: string[];
  description: string;
  keyOutcomes: string[];
  implementationSteps: string[];
  relevanceFactors: {
    budgetLevel: 'low' | 'medium' | 'high';
    digitalFocus: boolean;
    ruralFocus: boolean;
    youthFocus: boolean;
    policyFocus: boolean;
  };
};

export const caseStudies: CaseStudy[] = [
  {
    id: '1',
    title: 'Taiwan Digital Democracy Initiative (vTaiwan)',
    location: 'Taiwan',
    timeframe: '6 months',
    demographic: 'General public (18-65+)',
    size: 'Large scale (100,000+ participants)',
    sizeCategory: 'large',
    tags: ['Digital Engagement', 'Policy Development', 'Deliberation'],
    description:
      'A comprehensive digital platform enabling citizens to participate in policy-making through online consultations, collaborative deliberation using Pol.is, and transparent feedback loops between government and citizens.',
    keyOutcomes: [
      'Successfully engaged over 200,000 citizens in policy discussions',
      'Implemented 85% of citizen-proposed amendments',
      'Increased public trust in government by 23%',
      'Created replicable framework for digital democracy',
    ],
    implementationSteps: [
      'Mapped all stakeholder groups across digital and traditional channels',
      'Developed accessible platform with multiple language options',
      'Conducted pilot testing with diverse demographic groups',
      'Established clear feedback loops and transparency mechanisms',
      'Trained government officials in online facilitation',
    ],
    relevanceFactors: {
      budgetLevel: 'medium',
      digitalFocus: true,
      ruralFocus: false,
      youthFocus: false,
      policyFocus: true,
    },
  },
  {
    id: '2',
    title: 'Community Consultation on Urban Planning (Bristol)',
    location: 'United Kingdom',
    timeframe: '3 months',
    demographic: 'Local residents (all ages)',
    size: 'Medium scale (5,000-10,000 participants)',
    sizeCategory: 'medium',
    tags: ['Urban Planning', 'Hybrid Engagement', 'Community Design'],
    description:
      'A hybrid engagement process combining online surveys, town halls, and pop-up consultation booths to redesign a city center with meaningful community input.',
    keyOutcomes: [
      'Reached 8,500 residents through multiple channels',
      'Achieved 45% youth participation (under 25)',
      'Identified 12 key community priorities',
      'Co-designed final urban plan with resident input',
    ],
    implementationSteps: [
      'Established baseline community satisfaction metrics',
      'Deployed mobile consultation units in high-traffic areas',
      'Hosted evening and weekend sessions for accessibility',
      'Created visual feedback boards showing how input shaped plans',
      'Published transparent evaluation report with participation data',
    ],
    relevanceFactors: {
      budgetLevel: 'medium',
      digitalFocus: false,
      ruralFocus: false,
      youthFocus: true,
      policyFocus: false,
    },
  },
  {
    id: '3',
    title: 'Participatory Budgeting Evaluation (Toronto)',
    location: 'Canada',
    timeframe: '12 months',
    demographic: 'Municipal residents (16+)',
    size: 'Medium scale (3,000-5,000 participants)',
    sizeCategory: 'medium',
    tags: ['Participatory Budgeting', 'Evaluation', 'Equity'],
    description:
      'A comprehensive evaluation framework for participatory budgeting that measured impact, inclusion, and democratic outcomes across multiple neighborhoods.',
    keyOutcomes: [
      'Established 15 key performance indicators',
      'Tracked participation across 8 demographic categories',
      'Identified barriers to youth and immigrant participation',
      'Increased budget allocation transparency by 90%',
    ],
    implementationSteps: [
      'Defined clear evaluation objectives with stakeholder input',
      'Collected baseline data before program launch',
      'Implemented real-time participation tracking dashboard',
      'Conducted quarterly reviews and adjustments',
      'Published accessible annual evaluation reports',
    ],
    relevanceFactors: {
      budgetLevel: 'low',
      digitalFocus: false,
      ruralFocus: false,
      youthFocus: false,
      policyFocus: true,
    },
  },
  {
    id: '4',
    title: 'Rural Health Service Co-Design (Queensland)',
    location: 'Australia',
    timeframe: '4 months',
    demographic: 'Rural community members',
    size: 'Small scale (500-1,000 participants)',
    sizeCategory: 'small',
    tags: ['Health Services', 'Co-Design', 'Rural Communities'],
    description:
      'A targeted engagement process with rural and remote communities to co-design accessible health services, with a focus on reaching underserved populations.',
    keyOutcomes: [
      'Engaged 750 participants across 12 remote locations',
      'Identified 8 critical service gaps',
      'Co-designed 3 new mobile health services',
      'Improved service satisfaction by 40%',
    ],
    implementationSteps: [
      'Mapped diverse stakeholder groups including indigenous communities',
      'Partnered with trusted local organizations for outreach',
      'Used mobile consultation units to reach remote areas',
      'Provided childcare and meal support at sessions',
      'Created culturally appropriate engagement materials',
    ],
    relevanceFactors: {
      budgetLevel: 'low',
      digitalFocus: false,
      ruralFocus: true,
      youthFocus: false,
      policyFocus: false,
    },
  },
  {
    id: '5',
    title: 'Youth Climate Action Platform (Wellington)',
    location: 'New Zealand',
    timeframe: '8 months',
    demographic: 'Youth (13-24)',
    size: 'Large scale (15,000+ participants)',
    sizeCategory: 'large',
    tags: ['Climate Action', 'Youth Engagement', 'Digital Platform'],
    description:
      'A digital and in-person engagement initiative empowering young people to shape local climate action plans through schools, social media, and design thinking workshops.',
    keyOutcomes: [
      'Engaged 18,000 young people through schools and social media',
      'Generated 250+ climate action proposals',
      'Integrated 40 youth-led initiatives into city climate plan',
      'Created ongoing youth advisory council',
    ],
    implementationSteps: [
      'Designed engagement activities for educational settings',
      'Leveraged social media and gaming platforms for outreach',
      'Hosted youth-led design thinking workshops',
      'Established transparent decision-making criteria',
      'Measured engagement quality and demographic reach',
    ],
    relevanceFactors: {
      budgetLevel: 'medium',
      digitalFocus: true,
      ruralFocus: false,
      youthFocus: true,
      policyFocus: true,
    },
  },
  {
    id: '6',
    title: "Constitutional Reform Consultation (Citizens' Assembly)",
    location: 'Ireland',
    timeframe: '18 months',
    demographic: 'General public (18+)',
    size: 'Large scale (50,000+ participants)',
    sizeCategory: 'large',
    tags: ['Deliberative Democracy', 'Constitutional Reform', 'Citizens Assembly'],
    description:
      "A nationwide deliberative process on constitutional reform using citizens' assemblies and public consultations that became a global model for participatory governance.",
    keyOutcomes: [
      'Convened 99-member citizen assembly representative of population',
      'Received 65,000 public submissions',
      'Achieved 85% public awareness of consultation process',
      'Led to successful constitutional referendum',
    ],
    implementationSteps: [
      'Recruited demographically representative citizen assembly',
      'Provided expert briefings and balanced information',
      'Facilitated structured deliberation over multiple weekends',
      'Integrated public submissions into assembly discussions',
      'Published comprehensive evaluation of process integrity',
    ],
    relevanceFactors: {
      budgetLevel: 'high',
      digitalFocus: false,
      ruralFocus: false,
      youthFocus: false,
      policyFocus: true,
    },
  },
];
