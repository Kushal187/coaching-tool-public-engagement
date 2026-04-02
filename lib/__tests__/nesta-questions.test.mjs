// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NESTA_QUESTIONS, getQuestionById, formatQuestionsForLLM } from '../nesta-questions.mjs';

describe('nesta-questions', () => {
  describe('NESTA_QUESTIONS', () => {
    it('contains exactly 9 questions', () => {
      expect(NESTA_QUESTIONS).toHaveLength(9);
    });

    it('has sequential IDs from 1 to 9', () => {
      const ids = NESTA_QUESTIONS.map((q) => q.id);
      expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('each question has required fields', () => {
      for (const q of NESTA_QUESTIONS) {
        expect(q.id).toBeGreaterThanOrEqual(1);
        expect(q.question).toBeTruthy();
        expect(typeof q.question).toBe('string');
        expect(q.explanation).toBeTruthy();
        expect(typeof q.explanation).toBe('string');
      }
    });
  });

  describe('getQuestionById', () => {
    it('returns the correct question for valid IDs', () => {
      const q1 = getQuestionById(1);
      expect(q1.question).toContain('goals');

      const q9 = getQuestionById(9);
      expect(q9.question).toContain('use what the group creates');
    });

    it('returns null for non-existent ID', () => {
      expect(getQuestionById(0)).toBeNull();
      expect(getQuestionById(10)).toBeNull();
      expect(getQuestionById(-1)).toBeNull();
    });

    it('returns null for undefined/null', () => {
      expect(getQuestionById(undefined)).toBeNull();
      expect(getQuestionById(null)).toBeNull();
    });
  });

  describe('formatQuestionsForLLM', () => {
    it('formats all 9 questions by default', () => {
      const text = formatQuestionsForLLM();
      expect(text).toContain('Q1:');
      expect(text).toContain('Q9:');

      const lines = text.split('\n');
      expect(lines).toHaveLength(9);
    });

    it('includes question text and explanation', () => {
      const text = formatQuestionsForLLM();
      expect(text).toContain("articulated the project's goals");
      expect(text).toContain('purpose of your public engagement');
    });

    it('formats a subset of questions when provided', () => {
      const subset = [NESTA_QUESTIONS[0], NESTA_QUESTIONS[2]];
      const text = formatQuestionsForLLM(subset);

      const lines = text.split('\n');
      expect(lines).toHaveLength(2);
      expect(text).toContain('Q1:');
      expect(text).toContain('Q3:');
      expect(text).not.toContain('Q2:');
    });
  });
});
