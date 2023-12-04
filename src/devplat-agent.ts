// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { ANSWER_QUESTIONS_PROMPT, COMMAND_SELECTION_PROMPT } from './constants';
import { outputChannel, askAgentForJson, askAgent } from './common';
import { handleDevPlatformApiChatCommand } from './devplat-api-chat';
import { AgentCommand, AgentState, AgentConfirmationStatus, CommandRequest, DevPlatAgentResult } from './domain/agent';
import { getTemplateSummaries, templateToSummary } from './devplat-api';

const agentState: AgentState = {
    commandAlreadyInProgress: AgentCommand.None,
    confirmationStatus: AgentConfirmationStatus.NotStarted
};

let allTemplateDataSent = false;

export function initAgent(context: vscode.ExtensionContext) {
    // Create agent
    const agent = vscode.chat.createChatAgent('devplat', chatAgentHandler);
    agent.fullName = 'Internal Developer Platform';
    agent.description = 'Agent that enables self-service capabilities from an Internal Developer Platform';
    agent.slashCommandProvider = <vscode.ChatAgentSlashCommandProvider>{
        provideSlashCommands(token: vscode.CancellationToken): vscode.ProviderResult<vscode.ChatAgentSlashCommand[]> {
            return [
                { name: 'template', description: 'List available templates available to request.' },
                { name: 'fulfill', description: 'Fulfill a templated action based on inputs.' },
                { name: 'cancel', description: 'Cancel whatever any command that is in flight.' }
            ];
        }
    };
    agent.followupProvider = <vscode.FollowupProvider>{
        provideFollowups(result: DevPlatAgentResult, token: vscode.CancellationToken) {
            if (result?.followUps && result.followUps.length > 0) {
                return result.followUps;
            }
        }
    };

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
        progress.report(<vscode.ChatAgentContent>{
            content: `Right-o! We can pretend that never happened. What do you want to talk about now?`
        });
        return {};
    }
    if (commandRequest.command === AgentCommand.Question) {
        const response = await askAgent(
            [
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
        progress.report(<vscode.ChatAgentContent>{ content: response });
        return {};
    }
    if (commandRequest.command === AgentCommand.None) {
        progress.report(<vscode.ChatAgentContent>{
            content: `Hmmm. Not sure what you want me to do. Can you try rephrasing?`
        });
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
        return <CommandRequest>{
            command: AgentCommand.Cancel,
            argumentString: ''
        };
    }
    // Return existing state if set so handler can pick it up and use it
    if (
        agentState.commandAlreadyInProgress !== AgentCommand.FindCommand &&
        agentState.commandAlreadyInProgress !== AgentCommand.None
    ) {
        return <CommandRequest>{
            command: agentState.commandAlreadyInProgress,
            argumentString: promptContent.replace(agentState.commandAlreadyInProgress.toString(), '').trim()
        };
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
        return <CommandRequest>{
            command: AgentCommand.None,
            argumentString: ''
        };
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
    return <CommandRequest>{
        command: command,
        argumentString: argumentString
    };
}
