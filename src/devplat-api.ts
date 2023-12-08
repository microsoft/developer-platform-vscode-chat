// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ProviderLogin } from '@developer-platform/entities';
import lunr from 'lunr';
import * as vscode from 'vscode';
import { outputChannel } from './common.js';
import {
    DevPlatApiResult,
    ProviderAuthInfo,
    TemplateDetail,
    TemplateSummary
} from './domain/devplat-api-interfaces.js';
// import { ProviderAuth } from '@developer-platform/entities';

let templates: Array<TemplateDetail> = [];
let templateSearchIdx: lunr.Index;
let titleLookup: { [key: string]: TemplateDetail } = {};
let templateRefLookup: { [key: string]: TemplateDetail } = {};
let templateSearchInitialized: Promise<boolean>;
let extensionId = '';

export function initApiCaller(context: vscode.ExtensionContext) {
    extensionId = context.extension.id;

    // Register callback handler for provider auth
    vscode.window.registerUriHandler({
        handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
            if (uri.path === '/provider-auth-callback') {
                outputChannel.appendLine('Provider authorization successful! Re-indexing templates...');
                refreshTemplateSearchIndex();
            }
        }
    });

    refreshTemplateSearchIndex();
}

// Main API caller function
export async function callApi(
    apiPath: string,
    method: string = 'GET',
    bodyJson: any = null
): Promise<DevPlatApiResult> {
    const accessToken = await getAccessToken();
    const options = {
        method: method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
        },
        body: bodyJson ? JSON.stringify(bodyJson) : undefined
    };
    const response = await fetch(`${process.env.DEVPLAT_API_BASE_URL}/${apiPath}`, options);

    // If the response includes an indication that we should do secondary auth, get the appropriate URL
    let additionalAuthInfo: ProviderAuthInfo | null = null;
    const wwwAuth = response.headers.get('www-authenticate');
    if (response.status === 200 && wwwAuth) {
        // comes back as something like: 'Bearer realm="GitHub",authorization_uri="https://devplatform-github.azurewebsites.net/auth/login",scopes="api://009222db-2537-4d5e-9da4-e9ee90e82ecf/.default"'
        // Json becomes: { "realm": "GitHub", "authorization_uri": "https://...", "scopes": "api://..." }
        additionalAuthInfo = wwwAuth.split(',').reduce((acc, param) => {
            let [key, value] = param.split('=');
            if (key === 'Bearer realm') {
                key = 'realm';
            }
            acc[key.trim()] = value.trim().replace(/"/g, '');
            return acc;
        }, {} as any);
    }
    const retryAfter = response.headers.get('retry-after');
    let responseText = '';
    let responseJson: any = {};
    if (response.body) {
        responseText = await response.text();
        try {
            responseJson = JSON.parse(responseText);
        } catch (e) {
            // Ignore since this is a parsing error
        }
    }
    return {
        // 200, 201, 202 are all considered success - e.g., 202 is "Accepted" which is used when fulfilling
        success: [200, 201, 202].includes(response.status),
        retryAfter: retryAfter ? parseInt(retryAfter!) : undefined,
        status: response.status,
        additionalAuthRequested: additionalAuthInfo ? true : false,
        additionalAuthInfo: additionalAuthInfo,
        text: responseText,
        json: responseJson
    };
}

// Use VS Code's MSAL auth provider to get a token
async function getAccessToken(scope: string | null = null): Promise<string> {
    const session = await vscode.authentication.getSession(
        'microsoft',
        [
            `VSCODE_CLIENT_ID:${process.env.DEVPLAT_API_MSAL_CLIENT_ID}`, // Replace by your client id
            `VSCODE_TENANT:${process.env.DEVPLAT_API_MSAL_TENANT_ID}`, // Replace with the tenant ID or common if multi-tenant
            'offline_access', // Required for the refresh token.
            scope || process.env.DEVPLAT_API_MSAL_SCOPE || ''
        ],
        { createIfNone: true }
    );
    if (session) {
        return session.accessToken;
    } else {
        throw new Error('Could not acquire token.');
    }
}

// Call the Dev Platform API to get a URI to facilitate provider auth
async function getProviderAuthUri(info: ProviderAuthInfo | null): Promise<vscode.Uri | null> {
    if (!info) {
        return null;
    }
    const accessToken = await getAccessToken(info.scopes);
    const options = {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    };
    const authCallbackUri = await vscode.env.asExternalUri(
        vscode.Uri.parse(`${vscode.env.uriScheme}://${extensionId}/provider-auth-callback`)
    );
    const response = await fetch(`${info.authorization_uri}?redirect_uri=${authCallbackUri}`, options);
    if (response.status === 200) {
        const responseJson = (await response.json()) as ProviderLogin;
        return vscode.Uri.parse(responseJson.uri);
    }
    return null;
}

async function createTemplateSearchIndex() {
    const apiResult = await callApi('entities/template');
    if (!apiResult.success) {
        throw new Error(`Could not retrieve templates from API. Status: ${apiResult.status}`);
    }
    templates = apiResult.json;

    // Trigger secondary Provider auth if needed
    if (apiResult.additionalAuthRequested && apiResult.additionalAuthInfo) {
        const authorizeActionName = `Authorize ${apiResult.additionalAuthInfo.realm}`;
        vscode.window
            .showInformationMessage(
                `Your Internal Developer Platform can provide more functionality if you give it access to ${apiResult.additionalAuthInfo.realm}. Click below to authorize it using your GitHub account.`,
                authorizeActionName,
                'Cancel'
            )
            .then(async (action: string | undefined) => {
                if (action === authorizeActionName) {
                    const providerAuthUri = await getProviderAuthUri(apiResult.additionalAuthInfo);
                    if (providerAuthUri) {
                        vscode.env.openExternal(providerAuthUri);
                    }
                }
            });
    }

    //templates = require(join(__dirname, '..', 'api-test-data.json'));
    const indexObjs: Array<any> = [];
    templates.forEach((template: any, idx: number) => {
        const templateRef = `${template.kind}:${template.metadata.namespace}/${template.metadata.name}`;
        template.ref = templateRef;
        templateRefLookup[templateRef] = template;

        // Populate title lookup table
        // TODO: Handle duplicate titles
        titleLookup[template.metadata.title.toLowerCase()] = template;

        // Generate search index
        const templateMetadata = template.metadata;
        const indexObj = {
            ref: templateRef,
            kind: template.kind || '',
            name: templateMetadata.name || '',
            title: templateMetadata.title || '',
            description: templateMetadata.description || '',
            tagString: templateMetadata.tags
                ? templateMetadata.tags.reduce((acc: string, tag: string) => `${acc} "${tag}"`)
                : '',
            createsString: template.spec?.creates
                ? templateMetadata.spec?.creates.reduce((acc: string, obj: any) => `${acc} ${obj.kind}`, 'creates ')
                : ''
        };
        indexObjs.push(indexObj);
    });
    return lunr(function () {
        outputChannel.appendLine('Creating Developer Platform API template index...');
        this.ref('ref');
        this.field('kind');
        this.field('name');
        this.field('title');
        this.field('description');
        this.field('tagString');
        this.field('createsString');
        indexObjs.forEach((obj: any) => {
            this.add(obj);
        }, this);
        outputChannel.appendLine('Developer Platform API index created.');
    });
}

// Sets up a promise that will be resolved when the template search index is ready
export function refreshTemplateSearchIndex() {
    templateSearchInitialized = new Promise(async (resolve, reject) => {
        templateSearchIdx = await createTemplateSearchIndex();
        resolve(true);
    });
}

export function lookupTemplateByTitle(title: string) {
    return titleLookup[title.toLowerCase()];
}

export function lookupTemplateByRef(ref: string) {
    return templateRefLookup[ref];
}

export function getTemplateRefToTitleMap() {
    return templates.reduce((acc, template) => {
        if (template.ref && template.metadata.title) {
            acc[template.ref] = template.metadata.title;
        }
        return acc;
    }, {} as { [key: string]: string });
}

export async function searchForTemplate(
    query: string,
    exact = false,
    exactFields: string[] | null = null
): Promise<TemplateDetail[]> {
    if (!(await templateSearchInitialized)) {
        await templateSearchInitialized;
    }
    let results: lunr.Index.Result[];
    if (exact) {
        const opts = {
            presence: lunr.Query.presence.REQUIRED,
            wildcard: lunr.Query.wildcard.NONE
        } as any;
        if (exactFields) {
            opts.fields = exactFields;
        }
        results = templateSearchIdx.query(builder => builder.term(query, opts));
    } else {
        results = templateSearchIdx.search(query);
    }
    const templateList = results.map((result, resultIndex) => {
        const template = lookupTemplateByRef(result.ref as string);
        const clone = structuredClone(template);
        clone.resultIndex = resultIndex;
        return clone;
    });
    return templateList;
}

export function templateToSummary(
    template: TemplateDetail,
    resultIndex: number | undefined = undefined
): Promise<TemplateSummary> {
    return {
        resultIndex: resultIndex,
        ref: template.ref,
        name: template.metadata.name,
        title: template.metadata.title,
        description: template.metadata.description,
        tags: template.metadata.tags,
        creates: template.spec?.creates?.map((obj: any) => obj.kind)
    } as any;
}

export function getTemplateSummaries() {
    return templates.map((template, idx) => templateToSummary(template, idx));
}

export async function checkFulfillmentStatus(id: string) {
    const statusResult = await callApi(`/status/${id}`);
    if (statusResult.status === 200) {
        outputChannel.appendLine(`Request ${id} has finished! ${statusResult.text}`);
        return statusResult;
    } else if (statusResult.status === 202) {
        outputChannel.appendLine(`Request ${id} is still processing...`);
    } else {
        outputChannel.appendLine(`Request ${id} has an unknown status of ${statusResult.status}.`);
    }
    return undefined;
}

export async function waitForFulfillment(apiResult: DevPlatApiResult): Promise<DevPlatApiResult> {
    //TODO: Add a maximum retry count
    let requestResult: DevPlatApiResult | undefined = undefined;
    while (!requestResult) {
        requestResult = await new Promise((resolve, reject) => {
            setTimeout(async () => {
                resolve(await checkFulfillmentStatus(apiResult.json.id));
            }, requestResult?.retryAfter || apiResult.retryAfter! * 1000);
        });
    }
    return requestResult;
}
