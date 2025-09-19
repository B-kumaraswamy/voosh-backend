Got it! Here's an updated and more comprehensive README, incorporating the context of your work with LangChain, text processing, and RAG (Retrieval-Augmented Generation) operations:

```markdown
# Voosh Backend

## Overview
Voosh is a backend service that facilitates the processing and retrieval of information from large datasets. It integrates with advanced tools such as **LangChain** for text extraction, **Qdrant** for vector storage, and **Gemini API** for enhanced AI-driven tasks. The system performs **Retrieval-Augmented Generation (RAG)**, enabling dynamic document-based Q&A and other advanced search operations.

### Key Features
- **Text Extraction**: Extracts content from 50 links (or more) using LangChain and its modules.
- **Text Preprocessing**: Uses techniques like **lemmatization** and **recursive text splitting** to prepare data for efficient querying and storage.
- **Vector Storage**: Processes and stores the extracted data in a **Qdrant** vector database for fast, similarity-based searches.
- **Retrieval-Augmented Generation (RAG)**: Enhances AI-based responses by combining real-time retrieval of documents from the vector database with generative AI (via **Gemini API**).

## Prerequisites
To get started with Voosh, ensure you have the following dependencies and tools installed:

- **Node.js 20+**  
  [Install Node.js](https://nodejs.org/)

- **Docker & Docker Compose** (optional for local infra)  
  [Install Docker](https://www.docker.com/)

- **Postgres Connection String**  
  You'll need a PostgreSQL connection string, which can be obtained from services like **Supabase** or any other Postgres provider.
  
  Example:
```

postgresql://USER\:PASS\@HOST:5432/dbname?schema=public

````

- **Redis** (optional, for session storage)
- **Qdrant** (for vector-based search)  
Set up a Qdrant instance and generate an API key. The API URL is required for vector operations.

- **Gemini API**  
Use Google's **Gemini API** for enhanced AI-driven generation and processing.

## Project Structure
- **`src/server.js`**: Main entry point for the backend server.
- **`src/services/sessionStore.js`**: Manages session storage using Redis and Prisma.
- **`prisma/schema.prisma`**: Defines the Prisma schema for database models.
- **`Dockerfile`**: Docker configuration for containerizing the backend service.
- **`docker-compose.yml`** (optional): Defines the services for local Postgres, Redis, and Qdrant.

## Text Extraction & Processing Flow
The core functionality of this backend revolves around the following steps:

### 1. **Text Extraction with LangChain**
LangChain is used to extract raw text from 50+ links (URLs). The extraction process ensures that the relevant content from each link is parsed and ready for further processing.

### 2. **Text Preprocessing**
- **Lemmatization**: We use lemmatization to reduce words to their base or root form, improving data consistency.
- **Recursive Text Splitting**: The raw extracted text is recursively split into smaller chunks to make it easier to process, store, and retrieve from the vector database.

### 3. **Storing to Qdrant Vector DB**
Once the text is processed, it is converted into vectors (embeddings) and stored in **Qdrant**, a vector database. Qdrant enables fast and efficient similarity search operations by comparing vector embeddings.

### 4. **RAG (Retrieval-Augmented Generation)**
When performing queries or generating responses, the backend utilizes the RAG methodology:
- Retrieve relevant documents from Qdrant based on vector similarity.
- Augment the AI model’s response with these retrieved documents.

**Gemini API** is then used to generate contextually relevant responses based on the combination of retrieved documents and input queries.

## Local Development Setup (without containers)
Follow these steps to set up the backend in your local environment without using Docker:

1. **Install Dependencies**  
 Navigate to the `backend` directory and install the necessary dependencies:
 ```bash
 cd backend
 npm install
````

2. **Set Up Environment Variables**
   You'll need to define a `.env` file with the following environment variables:

   * `PORT`: Port for the backend service (default: `4000`).
   * `DATABASE_URL`: Connection string to your PostgreSQL database.
   * `REDIS_URL`: (Optional) Redis URL for session storage.
   * `FRONTEND_ORIGIN`: URL of your frontend (default: `http://localhost:5173`).
   * `QDRANT_URL`: (Optional) The URL for your Qdrant instance.
   * `QDRANT_API_KEY`: (Optional) The API key for your Qdrant instance.
   * `GEMINI_API_KEY`: (Required) API key for interacting with the Gemini API.

   Example `.env` file:

   ```
   PORT=4000
   DATABASE_URL="postgresql://USER:PASS@HOST:5432/dbname?schema=public"
   REDIS_URL="redis://localhost:6379"        # optional
   FRONTEND_ORIGIN="http://localhost:5173"
   QDRANT_URL="https://your-qdrant-instance"
   QDRANT_API_KEY="your-qdrant-api-key"
   GEMINI_API_KEY="your-gemini-api-key"
   ```

3. **Run Prisma Migrations**
   To set up the database schema, run the following Prisma commands:

   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```

4. **Start the Development Server**
   You can start the server in development or production mode:

   * Development mode:

     ```bash
     npm run dev
     ```
   * Production mode:

     ```bash
     npm start
     ```

## Running with Docker (Optional)

You can also use Docker for a containerized local development environment.

1. **Start Services with Docker Compose**
   If you have a `docker-compose.yml` file, run the following to start Postgres, Redis, and Qdrant containers locally in the directory cd backend/docker:

   ```bash
   docker-compose up
   ```


