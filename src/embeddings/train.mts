// Use ".mts" as an extension to be sure this file is not processed as a commonjs module
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { writeFileSync } from 'fs';
//import { PlaywrightWebBaseLoader } from 'langchain/document_loaders/web/playwright';
//import { VectorStore } from 'langchain/vectorstores/base';

// We're in an ES module, so no __dirname, so work around it
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '..', '.env.oai') });

async function getDocsFromMarkdown(dir: string) {
    const loader = new DirectoryLoader(dir, {
        '.md': (filepath: string) => new TextLoader(filepath),
        '.txt': (filepath: string) => new TextLoader(filepath)
    });
    const splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
        chunkSize: 1000,
        chunkOverlap: 200
    });
    const docs = await loader.loadAndSplit(splitter);
    return docs;
}

/*
async function getDocsForSite(url: string) {
    const loader = new PlaywrightWebBaseLoader(url, {
        gotoOptions: {
            waitUntil: 'domcontentloaded'
        }
    });
    const splitter = RecursiveCharacterTextSplitter.fromLanguage('html', {
        chunkSize: 1000,
        chunkOverlap: 200
    });

    const docs = await loader.loadAndSplit(splitter);
    return docs;
}
*/

async function generateEmbeddings() {
    const embeddings = new OpenAIEmbeddings({
        modelName: 'text-embedding-ada-002',
        batchSize: 1,
        azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
        azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
        azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
        azureOpenAIApiEmbeddingsDeploymentName: process.env.AZURE_OPENAI_API_EMBEDDINGS_DEPLOYMENT_NAME
    });

    let docs = await getDocsFromMarkdown(join(__dirname, '..', '..', 'tmp'));
    //docs = docs.concat(await getDocsForSite(store, 'https://eng.ms'));
    const store = await MemoryVectorStore.fromDocuments(docs, embeddings);
    // Save off the embeddings
    writeFileSync(join(__dirname, '..', '..', 'data', 'embeddings.json'), JSON.stringify(store.memoryVectors), 'utf8');
}

await generateEmbeddings();
