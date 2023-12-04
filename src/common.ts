// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import {
    AGENT_NAME,
    DEVPLAT_RESOLVE_TEMPLATE_PREFIX,
    DEVPLAT_RESOLVE_TEMPLATE_SUFFIX,
    DEVPLAT_TEMPLATE_LIST_PROMPT_PREFIX,
    DEVPLAT_TEMPLATE_LIST_PROMPT_SUFFIX,
    TEMPLATE_SEARCH_QUERY_PROMPT
} from './constants';
import {
    getTemplateRefToTitleMap,
    lookupTemplateByTemplateRef,
    lookupTemplateByTitle,
    searchForTemplate,
    templateToSummary
} from './devplat-api';
import { TemplateDetail } from './domain/devplat-api-interfaces';

let chatAccess: vscode.ChatAccess | undefined;
export let outputChannel: vscode.OutputChannel;

export function initOutputChannel(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Dev Platform');
}

export async function askAgent(
    messages: vscode.ChatMessage[],
    token: vscode.CancellationToken,
    agentName: string = 'copilot'
) {
    messages.forEach(message => {
        message.name = AGENT_NAME;
    });
    if (!chatAccess || chatAccess.isRevoked) {
        chatAccess = await vscode.chat.requestChatAccess(agentName);
    }
    const chatRequest = chatAccess.makeRequest(messages, {}, token);
    await chatRequest.result;
    let responseString = '';
    for await (const response of chatRequest.response) {
        responseString += response;
    }
    return responseString.replace('[RESPONSE END]', '');
}

export async function askAgentForJson(
    messages: vscode.ChatMessage[],
    token: vscode.CancellationToken,
    agentName: string = 'copilot'
) {
    // Of we see IFAILEDTODOITOHNO, consider that a failure. Otherwise retry 5 times before
    // giving up since sometimes LLMs fail, but work on retry. Throw if that fails.
    let retryCount = 0;
    let lastResponse = '';
    while (retryCount < 5) {
        const response = await askAgent(messages, token, agentName);
        if (response.includes('IFAILEDTODOITOHNO')) {
            throw new Error(`LLM failed to generate json based on input. Response: ${response}`);
        }
        try {
            lastResponse = response;
            const json = JSON.parse(response);
            return json;
        } catch (err) {
            retryCount++;
            console.log(`Unable to parse JSON from LLM response. This is retry ${retryCount}. Response: ${response}`);
        }
    }
    throw new Error(`LLM was unable to generate a JSON response. Giving up. Last response: ${lastResponse}`);
}

export async function refineSearchQuery(searchQuery: string, token: vscode.CancellationToken) {
    try {
        let json = await askAgentForJson(
            [
                {
                    role: vscode.ChatMessageRole.System,
                    content: TEMPLATE_SEARCH_QUERY_PROMPT
                },
                {
                    role: vscode.ChatMessageRole.User,
                    content: `Refine the following search query: ${searchQuery}`
                }
            ],
            token
        );
        if (json.length > 0) {
            outputChannel.appendLine(`Copilot created search query: ${JSON.stringify(json)}`);
            return json.reduce((acc: string, cur: string) => `${acc} ${cur}`, '') as string;
        }
    } catch (err) {
        // Output was likely not json (or invalid), so fall through to just return the original prompt
    }
    outputChannel.appendLine(`Unable to generate a search query. Using input: ${searchQuery}`);
    return searchQuery;
}

export async function askAgentToFindTemplateList(
    searchQuery: string,
    token: vscode.CancellationToken
): Promise<TemplateDetail[]> {
    const result = <Array<TemplateDetail>>[];
    const searchCriteriaPrompt = await refineSearchQuery(searchQuery, token);
    outputChannel.appendLine(`Modified prompt: ${searchCriteriaPrompt}`);
    const templateList = await searchForTemplate(searchCriteriaPrompt);
    outputChannel.appendLine(`Templates found: ${JSON.stringify(templateList)}`);
    if (templateList.length === 0) {
        return result;
    }
    // TODO: Determine if list is too large and will exceed max tokens. If so, trim the results. Or it could just take the first 10.
    try {
        const templateSummaryList = templateList.map(templateToSummary);
        let incomingJson = await askAgentForJson(
            [
                {
                    role: vscode.ChatMessageRole.System,
                    content: `${DEVPLAT_TEMPLATE_LIST_PROMPT_PREFIX} ${JSON.stringify(
                        templateSummaryList
                    )} ${DEVPLAT_TEMPLATE_LIST_PROMPT_SUFFIX}`
                },
                {
                    role: vscode.ChatMessageRole.User,
                    content: `What templates can I use that best match the following criteria? ${searchQuery}`
                }
            ],
            token
        );
        incomingJson.forEach((incomingResult: any) => {
            const template = templateList[parseInt(incomingResult.resultIndex)];
            if (template.templateRef !== incomingResult.templateRef) {
                outputChannel.appendLine(
                    `Incoming json and result templateRef mismatch. Incoming json: ${incomingResult.templateRef}, result: ${template.templateRef}. Omitting from output.`
                );
            } else {
                result.push(template);
            }
        });
    } catch (err) {
        // Fall through to just return the current results
    }
    return result;
}

export async function askAgentToFindOneTemplate(
    searchQuery: string,
    token: vscode.CancellationToken
): Promise<TemplateDetail | null> {
    // Otherwise try to start template input flow
    let template = lookupTemplateByTitle(searchQuery.toLocaleLowerCase().trim());
    if (template) {
        outputChannel.appendLine(`Found template by title all lower case match: ${template.metadata.title}`);
        return template;
    }
    outputChannel.appendLine(`Unable to find template using all lower case match. Trying search index...`);

    // Try search index for title field specifically
    const templateList = await searchForTemplate(`title:${searchQuery}`);
    if (templateList.length === 1) {
        template = templateList[0];
        outputChannel.appendLine(`Found template by title field query: ${template.metadata.title}`);
        return template;
    }
    // Try using Copilot to refine the search query
    const refinedSearchQuery = await refineSearchQuery(searchQuery, token);
    const refinedTemplateList = await searchForTemplate(`title:${refinedSearchQuery}`);
    if (refinedTemplateList.length === 1) {
        template = refinedTemplateList[0];
        outputChannel.appendLine(`Found template by Copilot refined title field query: ${template.metadata.title}`);
        return template;
    }
    // Log if both failed
    outputChannel.appendLine(
        `Unable to find template using search index. Result count was ${templateList.length} and ${refinedTemplateList.length}. Trying Copilot...`
    );

    // Try Copilot
    // TODO: Determine if list is too large and will exceed max tokens. If so, trim the results. Or it could just take the first 10.
    try {
        const inputJson = getTemplateRefToTitleMap();
        const outputJson = await askAgentForJson(
            [
                {
                    role: vscode.ChatMessageRole.System,
                    content: `${DEVPLAT_RESOLVE_TEMPLATE_PREFIX} ${JSON.stringify(
                        inputJson
                    )} ${DEVPLAT_RESOLVE_TEMPLATE_SUFFIX}`
                },
                {
                    role: vscode.ChatMessageRole.User,
                    content: `What template best matches the following title? ${searchQuery}`
                }
            ],
            token
        );
        const templateRef = Object.keys(outputJson)[0] as string;
        template = lookupTemplateByTemplateRef(templateRef);
        outputChannel.appendLine(`Found template using copilot: ${template.metadata.title}`);
        return template;
    } catch (err) {
        // Fall through
    }
    return null;
}
