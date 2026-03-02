# APES v2 Full Enterprise Architecture Blueprint

This document contains Mermaid diagrams and structural models for APES v2, a swarm-native orchestration platform, representing the deep structural requirements for APES.

## 1. Layered System Architecture

```mermaid
flowchart TD
    U[USER LAYER<br>CLI • Multi-Terminal • API • Dashboard] --> S[SESSION ORCHESTRATION LAYER<br>Session Manager • Terminal Registry<br>Distributed State]
    S --> C[SWARM ORCHESTRATION CORE<br>Lead Agent • Swarm Manager • Router<br>Consensus Engine]
    C --> T[TASK GRAPH ENGINE<br>DAG Tasks • Locks • Hooks<br>Parallel Executor]
    T --> A[AGENT EXECUTION LAYER 64+<br>Micro-Agent Architecture<br>Knowledge • Skills • Autonomy]
    A --> M[MEMORY & LEARNING LAYER<br>Vector DB • Semantic Store<br>Feedback Loop • Policy Optimizer]
    M --> P[PROVIDER & TOOL LAYER<br>LLM Router • Ollama<br>Workspace Engine • MCP Tools]
```

## 2. Swarm Orchestration Topologies

APES supports dynamic formation of multiple agent coordination strategies:

```mermaid
flowchart TD
    %% Hierarchical
    subgraph Hierarchical Mode
        L[APES LEAD] --> P1[Planner]
        L --> R1[Research]
        L --> E1[Engineer]
        P1 --> S1[Sub-Agents]
        E1 --> CR1[Code Review]
    end

    %% Mesh
    subgraph Mesh Mode
        R2[Research] <--> E2[Engineer]
        E2 <--> CR2[Reviewer]
        CR2 <--> R2
        Mem[(Shared Memory)] --- R2
        Mem --- E2
        Mem --- CR2
    end
```

## 3. Distributed Multi-Terminal Model

```mermaid
flowchart TD
    T1[Terminal 1] --> SM[SESSION MANAGER]
    T2[Terminal 2] --> SM
    T3[Terminal 3] --> SM
    SM --> SG[Shared Task Graph + Locks]
    SG --> SC[Swarm Orchestrator Core]
```

## 4. Agent Internal Micro-Architecture

Each of the 64 agents contains a localized pipeline for execution safety.

```mermaid
flowchart TD
    AI[Agent Interface] --> MO[Mini Orchestrator]
    MO --> K[Knowledge]
    MO --> S[Skills]
    MO --> A[Autonomy]
    K --> M[(Memory)]
    A --> E[Escalation]
    M --> FM[Foundation Model]
    E --> FM
    S --> FM
```

## 5. Task Graph Engine (DAG)

```mermaid
flowchart LR
    T1[Task 1] -->|Unlocks| T2[Task 2]
    T1 -->|Unlocks| T3[Task 3]
    T2 --> T4[Task 4]

    %% Rules
    subgraph Execution Rules
        R1[No Circular Dependencies]
        R2[Lock-based claiming]
        R3[Auto-unlock]
        R4[Retry logic]
        R5[Hook-based validation]
    end
```

## 6. Memory System Architecture

```mermaid
flowchart TD
    MG[Memory Gateway] --> EDB[(Episodic DB)]
    MG --> SDB[(Semantic Vector DB)]
    MG --> PB[(Pattern Bank)]
    
    EDB --> TL[Task Logs]
    SDB --> V[Embeddings]
    PB --> PU[Policy Updates]
```

## 7. Router + Capability Registry

```mermaid
flowchart TD
    AR[Agent Registry] --> CI[Capability Index]
    CI --> R[Adaptive Router]
    R --> BS[Best Agent Selected]
```

## 8. Provider Abstraction Layer

```mermaid
flowchart LR
    A[Agent] --> PR[Provider Router]
    PR --> O1[Ollama]
    PR --> O2[OpenAI]
    PR --> A1[Anthropic]
    PR --> G1[Gemini]
    PR --> L1[Local ONNX]
```
