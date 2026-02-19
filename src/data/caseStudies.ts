export type CaseStudy = {
  id: string;
  title: string;
  location: string;
  timeframe: string;
  demographic: string;
  scale: 'small' | 'medium' | 'large';
  tags: string[];
  summary: string;
  keyOutcomes: string[];
  implementationSteps: string[];
  sourceUrl: string;
  sourceLabel: string;
  docDate: string;
  fullContent?: string;
};
