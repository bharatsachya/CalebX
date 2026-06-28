# CALEBX 🪐

> **Context-Aware Social Recommendation Engine**
> CALEBX transforms everyday conversations on WhatsApp and Telegram into meaningful social connections and hyper-local recommendations.

By analyzing chat intents in real-time, CALEBX connects users with like-minded profiles and relevant places using a hybrid vector-graph recommendation pipeline.

---

## 🚀 Features

- **Real-Time Intent Parsing:** Extracts context, sentiment, and named entities (places, topics) from unstructured chat messages on the fly.
- **Platform Agnostic:** Built to run as a headless backend for WhatsApp Business API and Telegram Bot API.
- **Dual-Engine Recommendations:**
  - _Semantic Matching (Vector DB):_ Finds users with similar conversational "vibes" and interests.
  - _Relational Matching (Graph DB):_ Filters by social proximity (2nd-degree connections) and geographic location.
- **Privacy-First:** Node anonymization and transient message caching ensure PII is protected.

---

## 🏗️ System Architecture

CALEBX uses an event-driven, decoupled microservices architecture to handle the constraints of third-party chat platforms.

1. **Ingestion:** Webhooks receive messages from WhatsApp/Telegram, gated by an API Gateway and pushed into a Message Queue (Kafka/RabbitMQ) for asynchronous processing.
2. **Orchestration (The Brain):** An LLM pipeline reads the queue, checks short-term memory (Redis), and parses the user's intent.
3. **Retrieval & Scoring:**
   - **Pinecone/pgvector** fetches semantically similar candidate profiles.
   - **Neo4j** filters candidates based on geographic and social graphs.
4. **Delivery:** The top scored matches are formatted natively for the user's specific chat platform.

---

## 💻 Tech Stack

### Core Infrastructure

- **Language:** Python 3.11+ / Node.js
- **API Gateway:** Kong / AWS API Gateway
- **Message Broker:** Apache Kafka / RabbitMQ
- **Cache/Session State:** Redis

### Data & AI Layer

- **LLM Orchestration:** LangChain / LlamaIndex
- **Vector Database (Semantic):** Pinecone / Milvus / pgvector
- **Graph Database (Relational):** Neo4j
- **Embeddings:** OpenAI `text-embedding-3-small` / HuggingFace

---

## 🛠️ Local Development Setup

### Prerequisites

- Docker & Docker Compose
- Python 3.11+ or Node.js v18+
- API Keys for OpenAI/Anthropic, Telegram Bot API, and Twilio (for WhatsApp)

### Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/yourusername/calebx.git](https://github.com/yourusername/calebx.git)
   cd calebx
   ```
