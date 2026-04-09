# Interaction Scaffolding: Guided Q&A Flow

How the coaching chatbot guides practitioners through the 9 Nesta framework questions, step by step.

---

## Overview

The chatbot acts as a **Socratic coach** that walks practitioners through 9 questions from the Nesta framework for participatory public engagement. Instead of a form, it has a conversation: working through **one question at a time**, asking follow-up questions, sharing real-world examples when needed, and moving on once the practitioner has a clear direction.

---

## The 9 Questions

| # | Question | What It Probes |
|---|----------|---------------|
| 1 | Have you articulated the project's goals? | Purpose, specific outcomes, why input matters |
| 2 | Have you identified the right participants? | Stakeholders, diversity, representation, relevant knowledge holders |
| 3 | Can you reach the participants you identified? | Access channels, digital/physical platforms, barriers to participation |
| 4 | Who is the right owner? | Authority, accountability, follow-through champion |
| 5 | Have you included incentives for participation? | Tangible incentives (compensation, childcare) and intangible (voice, impact) |
| 6 | Have you defined the tasks? | Specific activities, expected contributions, clarity of ask |
| 7 | Have you established the workflow? | Step-by-step process from recruitment to completion |
| 8 | How will you evaluate inputs? | Quality criteria, fairness, surfacing best ideas |
| 9 | How will you use what the group creates? | Decision influence, closing the loop, building trust |

---

## How a Session Progresses

### Step 1: Welcome

The practitioner arrives and either greets the bot or describes their project. The bot welcomes them and nudges them to share what they're working on, or to pick a question to start with.

### Step 2: The Bot Picks a Starting Question

Once the practitioner describes their project, the bot identifies the most relevant Nesta question and begins coaching on it. The practitioner can also choose a question themselves.

### Step 3: Coaching Conversation (1-4 exchanges per question)

The bot coaches one question at a time through a back-and-forth:

1. **Bot asks a probing question**: one focused question grounded in real case studies and best practices from the knowledge base. Example: _"In [Source: Sciencewise Guide], projects with measurable outcomes saw higher participant satisfaction. What specific outcomes would tell you this engagement was successful?"_

2. **Practitioner responds** with their thinking.

3. **Bot evaluates and follows up**: it checks the response against evidence and either:
   - **Probes deeper** if the answer is vague ("You mentioned 'the community': which specific groups are you trying to reach?")
   - **Resolves the question** if the answer is concrete and actionable

4. This repeats for **1-4 exchanges** until the question is resolved.

**Coaching rules:**
- One question at a time: no multi-part probes
- Responses are short: 2-4 sentences plus one question
- Advice is backed by cited sources from the knowledge base, not generic
- The bot stays on the current question and doesn't drift into other Nesta questions

### Step 4: Question Resolved

A question is considered resolved when the practitioner has a **concrete, specific direction**: not a perfect answer, just enough to take a next step.

The bot:
1. Affirms their response
2. Summarizes what they've established in 2-3 sentences
3. Marks the question as complete

**"Good enough" beats "perfect."** After 3+ exchanges, the bot leans strongly toward resolving rather than continuing to probe.

**The bot does NOT resolve when:**
- The practitioner only says "I don't know" with no follow-up
- The response is too vague to act on

### Step 5: Suggesting the Next Question

Immediately after resolving a question, the bot suggests **2-3 remaining questions** to work on next. Each suggestion includes a reason tied to what the practitioner just discussed.

Example: _"Since you've defined your goals around flood preparedness, you might want to explore: Q2: Which community members should contribute to these recommendations?"_

The practitioner picks a suggestion or brings up a different topic, and the coaching loop restarts.

### Step 6: Getting Help Along the Way

At any point, if the practitioner is stuck or asks for examples, the bot switches from asking to **providing**:
- Shares concrete examples from real case studies
- Cites sources so the practitioner can dig deeper
- Connects findings back to their specific project
- Then returns to the coaching conversation

This happens when the practitioner says things like "I don't know," "can you give me an example?", or "how do others do this?"

### Step 7: Reflection

Once enough questions are addressed (or the practitioner clicks "Generate Reflection"), the bot produces a reflection report:
- Summary of what was covered
- Strengths identified
- Areas to develop
- Critical gaps
- Priority actions

The practitioner can download this as a PDF or go back to continue the conversation.

---

## When the Bot Asks vs. Provides

| Bot Behavior | When It Happens |
|-------------|-----------------|
| **Asks** a probing question | Default mode: drawing out the practitioner's own thinking through Socratic coaching |
| **Provides** evidence and examples | Practitioner is stuck, confused, or asks for help/examples |
| **Suggests** next questions | After a question is resolved, or practitioner asks "what's next?" |
| **Greets / orients** | Session start, off-topic messages, questions about the tool itself |

---

## Question Progress Tracking

Each question moves through these stages:

```
Not Started → In Progress → Addressed
```

| Status | Meaning |
|--------|---------|
| Not Started | Question hasn't been discussed yet |
| In Progress | Coaching conversation is active on this question |
| Addressed | Practitioner has a concrete direction: question resolved |

The practitioner can see their progress across all 9 questions and return to any question if needed.

