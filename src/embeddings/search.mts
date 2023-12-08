import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { outputChannel } from '../common.js';

// We're in an ES module, so no __dirname, so work around it
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const oaiEnv = join(__dirname, '..', '..', '.env.oai');

let store: MemoryVectorStore;

export async function initEmbeddings() {
    if (!existsSync(oaiEnv)) {
        outputChannel.appendLine('No .env.oai file found, skipping embeddings initialization.');
        return;
    }

    dotenv.config({ path: join(__dirname, '..', '..', '.env.oai') });

    outputChannel.appendLine('Connecting to Azure OpenAI...');
    const embeddings = new OpenAIEmbeddings({
        modelName: 'text-embedding-ada-002',
        batchSize: 1,
        azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
        azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
        azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
        azureOpenAIApiEmbeddingsDeploymentName: process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME
    });
    store = new MemoryVectorStore(embeddings);

    // Load the embeddings from disk to test
    outputChannel.appendLine('Loading embeddings from disk...');
    store.memoryVectors = JSON.parse(readFileSync(join(__dirname, '..', '..', 'data', 'embeddings.json'), 'utf8'));
    outputChannel.appendLine('Embeddings loaded.');
}

export async function similaritySearch(query: string, k = 10) {
    if (!store) {
        return null;
    }
    return await store.similaritySearch(query, k);
}
