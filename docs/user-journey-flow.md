# User Journey Flow Diagram

## End-to-End User Flow

```mermaid
flowchart TD
    A["Landing Page (/)"] -->|Enter challenge & click 'Get started'| B["Coaching Chat (/coach)"]
    
    B -->|Orchestrator routes message| C{Intent Classification}
    
    C -->|"map_to_question / coach_continue"| D["Coach Agent\n(Socratic Q&A with\nknowledge base search)"]
    C -->|retrieve| E["Retrieval Agent\n(Search for examples,\nguides, evidence)"]
    C -->|suggest_next| F["Suggest Next\n(Recommend next\nquestion)"]
    C -->|general| G["General Handler\n(Greeting / off-topic)"]
    
    D -->|Response streamed via SSE| B
    E -->|Response streamed via SSE| B
    F -->|Suggestion chips shown| B
    G -->|Response streamed via SSE| B
    
    D -->|"Question resolved [[RESOLVED]]"| H{All 9 Questions\nAddressed?}
    
    H -->|No| F
    F -->|User picks a suggestion| D
    
    H -->|"Yes (or user clicks\n'Generate Reflection')"| I["Reflection Page\n(/coach/reflection)"]
    
    I -->|API generates reflection| J["Reflection Report\n- Summary\n- Strengths\n- Areas to Develop\n- Critical Gaps\n- Priority Actions"]
    
    J -->|"'Download Reflection'"| K["PDF Download"]
    J -->|"'Back to Chat'"| B
    
    K --> L["Exit / Done"]

    style A fill:#E4EFFC,stroke:#124D8F,color:#124D8F
    style B fill:#124D8F,stroke:#0e3d72,color:#fff
    style I fill:#124D8F,stroke:#0e3d72,color:#fff
    style J fill:#F4F7FB,stroke:#124D8F,color:#124D8F
    style K fill:#FDCE3E,stroke:#D09006,color:#124D8F
    style L fill:#fff,stroke:#ccc,color:#666
    style D fill:#E4EFFC,stroke:#124D8F,color:#124D8F
    style E fill:#E4EFFC,stroke:#124D8F,color:#124D8F
    style F fill:#E4EFFC,stroke:#124D8F,color:#124D8F
    style G fill:#F4F7FB,stroke:#ccc,color:#666
```

## Simplified Linear Flow

```
Landing Page → Coaching Chat → [Coach / Retrieve / Suggest loop] → Reflection → PDF Download → Exit
```

## Page-by-Page Breakdown

| Step | Page | Route | What Happens |
|------|------|-------|-------------|
| 1 | Landing Page | `/` | User describes their public engagement challenge |
| 2 | Coaching Chat | `/coach` | Orchestrator classifies intent, routes to coach/retrieval/suggest/general agent. Responses stream via SSE with citation badges. |
| 3 | Coaching Loop | `/coach` | User works through 9 GovLab questions one at a time. Each question resolves after 1-4 exchanges. Suggestions appear after each resolution. |
| 4 | Reflection | `/coach/reflection` | User clicks "Generate Reflection" (available after 1+ questions addressed). API builds reflection from session state. |
| 5 | Download | `/coach/reflection` | User downloads PDF with summary, strengths, gaps, and priority actions. |
| 6 | Exit | — | User leaves or clicks "Back to Chat" to continue. |

## Supporting Pages

| Page | Route | Purpose |
|------|-------|---------|
| Case Study Library | `/case-studies` | Browse/filter real-world engagement examples |
| Case Study Detail | `/case-studies/:id` | Full case study view with outcomes and steps |
| About | `/about` | Tool overview, framework explanation, knowledge base sources |
