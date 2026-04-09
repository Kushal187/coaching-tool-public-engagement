# User Journey Flow Diagram

## End-to-End User Flow

```mermaid
flowchart TD
    A["Landing Page (/)"] -->|"Enter challenge & click Get started"| B["Coaching Chat (/coach)"]

    B ==>|"Every message"| C{"Orchestrator\n(Intent Classification)"}

    C --> D["Coach Agent"]
    C --> E["Retrieval Agent"]
    C --> F["Suggest Next"]
    C --> G["General Handler"]

    D -->|Response| B
    E -->|Response| B
    F -->|Suggestions| B
    G -->|Response| B

    D -->|"Question resolved"| H{"All 9 Questions\nAddressed?"}
    H -->|No| F
    H -->|Yes| I["Reflection Page\n(/coach/reflection)"]

    I --> J["Reflection Report"]
    J -->|Download PDF| K["PDF Download"]
    J -->|Back to Chat| B
    K --> L["Exit / Done"]

    style A fill:#f9fafb,stroke:#d1d5db,color:#374151
    style B fill:#124D8F,stroke:#0e3d72,color:#fff
    style C fill:#f9fafb,stroke:#9ca3af,color:#374151
    style D fill:#f3f4f6,stroke:#d1d5db,color:#374151
    style E fill:#f3f4f6,stroke:#d1d5db,color:#374151
    style F fill:#f3f4f6,stroke:#d1d5db,color:#374151
    style G fill:#f3f4f6,stroke:#d1d5db,color:#374151
    style H fill:#f9fafb,stroke:#9ca3af,color:#374151
    style I fill:#124D8F,stroke:#0e3d72,color:#fff
    style J fill:#f3f4f6,stroke:#d1d5db,color:#374151
    style K fill:#FDCE3E,stroke:#D09006,color:#374151
    style L fill:#fff,stroke:#d1d5db,color:#9ca3af

    linkStyle 0 stroke:#124D8F,stroke-width:2px
    linkStyle 1 stroke:#124D8F,stroke-width:3px
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
