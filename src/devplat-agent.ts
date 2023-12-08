// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { askAgent, askAgentForJson, outputChannel } from './common.js';
import { ANSWER_QUESTIONS_PROMPT, COMMAND_SELECTION_PROMPT } from './constants.js';
import { getTemplateSummaries } from './devplat-api.js';
import { handleDevPlatformApiChatCommand } from './devplat-api-chat.js';
import {
    AgentCommand,
    AgentConfirmationStatus,
    AgentState,
    CommandRequest,
    DevPlatAgentResult
} from './domain/agent.js';

// We're in a commonjs module, and we need to import an ES module (given that's what langchain is), so use import()
const embeddingsModule = import('./embeddings/search.mjs');

const agentState: AgentState = {
    commandAlreadyInProgress: AgentCommand.None,
    confirmationStatus: AgentConfirmationStatus.NotStarted
};

let allTemplateDataSent = false;

export async function initAgent(context: vscode.ExtensionContext) {
    // Create agent
    const agent = vscode.chat.createChatAgent('devplat', chatAgentHandler);
    agent.fullName = 'Internal Developer Platform';
    agent.description = 'Agent that enables self-service capabilities from an Internal Developer Platform';
    agent.slashCommandProvider = {
        provideSlashCommands(token: vscode.CancellationToken): vscode.ProviderResult<vscode.ChatAgentSlashCommand[]> {
            return [
                { name: 'template', description: 'List available templates available to request.' },
                { name: 'fulfill', description: 'Fulfill a templated action based on inputs.' },
                { name: 'cancel', description: 'Cancel whatever any command that is in flight.' }
            ];
        }
    } as vscode.ChatAgentSlashCommandProvider;
    agent.followupProvider = {
        provideFollowups(result: DevPlatAgentResult, token: vscode.CancellationToken) {
            if (result?.followUps && result.followUps.length > 0) {
                return result.followUps;
            }
        }
    } as vscode.FollowupProvider;

    // Init embeddings
    (await embeddingsModule).initEmbeddings();

    // Add agent
    context.subscriptions.push(agent);
}

async function chatAgentHandler(
    request: vscode.ChatAgentRequest,
    context: vscode.ChatAgentContext,
    progress: vscode.Progress<vscode.ChatAgentProgress>,
    token: vscode.CancellationToken
) {
    const commandRequest = await resolveCommand(request, token);
    if (commandRequest.command === AgentCommand.Cancel) {
        agentState.commandAlreadyInProgress = AgentCommand.None;
        progress.report({
            content: `Right-o! We can pretend that never happened. What do you want to talk about now?`
        } as vscode.ChatAgentContent);
        return {};
    }
    if (commandRequest.command === AgentCommand.Question) {
        const results = await (await embeddingsModule).similaritySearch(commandRequest.argumentString);
        const context = results.map(r => r.pageContent + '\n');
        const response = await askAgent(
            [
                {
                    role: vscode.ChatMessageRole.System,
                    content: `Use the data from the __CONTEXT json to help answer your questions.\n${
                        context ? `` : '\n__CONTEXT=' + JSON.stringify(context)
                    }}`
                },
                {
                    role: vscode.ChatMessageRole.System,
                    content: `Use the data from the __ALL_DEV_PLAT_TEMPLATES json to help answer your questions.\n${
                        allTemplateDataSent
                            ? ``
                            : '\n__ALL_DEV_PLAT_TEMPLATES=' + JSON.stringify(getTemplateSummaries())
                    }}`
                },
                {
                    role: vscode.ChatMessageRole.System,
                    content: ANSWER_QUESTIONS_PROMPT
                },
                {
                    role: vscode.ChatMessageRole.User,
                    content: request.prompt
                }
            ],
            token
        );
        progress.report({ content: response } as vscode.ChatAgentContent);
        return {};
    }
    if (commandRequest.command === AgentCommand.None) {
        progress.report({
            content: `Hmmm. Not sure what you want me to do. Can you try rephrasing?`
        } as vscode.ChatAgentContent);
        return {};
    }
    return await handleDevPlatformApiChatCommand(agentState, commandRequest, progress, token);
}

async function resolveCommand(
    request: vscode.ChatAgentRequest,
    token: vscode.CancellationToken
): Promise<CommandRequest> {
    const promptContent = request.prompt.trim();
    if (
        request.slashCommand?.name === 'cancel' ||
        promptContent.startsWith('/abort') ||
        promptContent.startsWith('/cancel')
    ) {
        return {
            command: AgentCommand.Cancel,
            argumentString: ''
        } as CommandRequest;
    }
    // Return existing state if set so handler can pick it up and use it
    if (
        agentState.commandAlreadyInProgress !== AgentCommand.FindCommand &&
        agentState.commandAlreadyInProgress !== AgentCommand.None
    ) {
        return {
            command: agentState.commandAlreadyInProgress,
            argumentString: promptContent.replace(agentState.commandAlreadyInProgress.toString(), '').trim()
        } as CommandRequest;
    }
    // If command is not set, set it - first, if there's a slash, resolve directly
    if (request.slashCommand) {
        return getCommandRequestFromPrompt(['/' + request.slashCommand.name, ...request.prompt.split(' ')]);
    } else if (promptContent.startsWith('/')) {
        return getCommandRequestFromPrompt(request.prompt.split(' '));
    }

    // Otherwise see if Copilot can help
    try {
        const json = await askAgentForJson(
            [
                {
                    role: vscode.ChatMessageRole.System,
                    content: COMMAND_SELECTION_PROMPT
                },
                {
                    role: vscode.ChatMessageRole.User,
                    content: promptContent
                }
            ],
            token
        );
        outputChannel.appendLine(`Resolved command prompt: ${JSON.stringify(json)}`);
        return getCommandRequestFromPrompt(json);
    } catch (err) {
        outputChannel.appendLine(`Error resolving command prompt: ${err}`);
        return {
            command: AgentCommand.None,
            argumentString: ''
        } as CommandRequest;
    }
}

function getCommandRequestFromPrompt(promptContent: any): CommandRequest {
    let command = AgentCommand.None;
    for (let commandEnum in AgentCommand) {
        const commandString = AgentCommand[commandEnum as keyof typeof AgentCommand].toString();
        if (promptContent[0] === commandString) {
            command = AgentCommand[commandEnum as keyof typeof AgentCommand];
            break;
        }
    }
    let argumentString = '';
    for (let i = 1; i < promptContent.length; i++) {
        argumentString += promptContent[i] + ' ';
    }
    return {
        command: command,
        argumentString: argumentString
    } as CommandRequest;
}
