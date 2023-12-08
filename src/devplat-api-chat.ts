// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TemplateRequest } from '@developer-platform/entities';
import { randomInt } from 'crypto';
import { JSONSchema7 } from 'json-schema';
import * as vscode from 'vscode';
import { askAgentToFindOneTemplate, askAgentToFindTemplateList, outputChannel } from './common.js';
import { callApi, waitForFulfillment } from './devplat-api.js';
import {
    AgentCommand,
    AgentConfirmationStatus,
    AgentState,
    CommandRequest,
    DevPlatAgentResult,
    SubmitRequestInputState
} from './domain/agent.js';
import { DevPlatApiResult, PropDetail, TemplateDetail } from './domain/devplat-api-interfaces.js';

export async function handleDevPlatformApiChatCommand(
    agentState: AgentState,
    commandRequest: CommandRequest,
    progress: vscode.Progress<vscode.ChatAgentProgress>,
    token: vscode.CancellationToken
): Promise<vscode.ProviderResult<DevPlatAgentResult>> {
    switch (commandRequest.command) {
        case AgentCommand.FindTemplate:
            return discussTemplates(agentState, commandRequest, progress, token);
        case AgentCommand.Fulfill:
            return discussFulfillmentRequest(agentState, commandRequest, progress, token);
    }
    return {
        errorDetails: {
            message: `I'm sorry, I don't know how to handle the command: ${commandRequest.command}`
        } as vscode.ChatAgentErrorDetails
    };
}

export async function discussTemplates(
    agentState: AgentState,
    commandRequest: CommandRequest,
    progress: vscode.Progress<vscode.ChatAgentProgress>,
    token: vscode.CancellationToken
): Promise<vscode.ProviderResult<DevPlatAgentResult>> {
    try {
        if (commandRequest.argumentString.length === 0) {
            progress.report({
                content: `I'm sorry, I need some more information to search for templates. Try \`@devplat /template\` followed by what you want to look for.`
            } as vscode.ChatAgentContent);
            return {};
        }

        const templateList = await askAgentToFindTemplateList(commandRequest.argumentString, token);
        if (templateList.length === 0) {
            progress.report({
                content: `I'm sorry, I tried to search for templates using the following query but couldn't find anything: \`${commandRequest.argumentString}\``
            } as vscode.ChatAgentContent);
            return {};
        }
        let markdown = 'Sure! Here is what I found:\n';
        templateList.forEach((template: TemplateDetail) => {
            // Verify Copilot didn't make up an answer
            markdown += `- **${template.metadata.title}**: `;
            if (template.spec.creates) {
                markdown += `Creates ${template.spec.creates.reduce(
                    (acc: string | null, item: any) => (acc ? `${acc}, ${item.kind}` : item.kind),
                    null
                )} entities. `;
            } else {
                markdown += 'Automation template. ';
            }
            markdown += `${template.metadata.description || template.metadata.title}\n`;
        });
        markdown += `\nTo submit a request to the platform, use \`@devplat ${AgentCommand.Fulfill} <title>\`.`;
        progress.report({ content: markdown } as vscode.ChatAgentContent);
        return {
            followUps: [
                { message: vscode.l10n.t(`@devplat ${AgentCommand.Fulfill} ${templateList[0].metadata.title}`) }
            ]
        };
    } catch (err) {
        outputChannel.appendLine(`Error: ${err}`);
        progress.report({ content: `Oh man, I hit a problem!! ${err}` } as vscode.ChatAgentContent);
    }
}

export async function discussFulfillmentRequest(
    agentState: AgentState,
    commandRequest: CommandRequest,
    progress: vscode.Progress<vscode.ChatAgentProgress>,
    token: vscode.CancellationToken
): Promise<vscode.ProviderResult<DevPlatAgentResult>> {
    try {
        // Already in progress on command, so delegate to option processing
        if (agentState.commandAlreadyInProgress == AgentCommand.Fulfill) {
            return await discussFulfillmentRequestOptions(agentState, commandRequest, progress, token);
        }
        const template = await askAgentToFindOneTemplate(commandRequest.argumentString, token);
        if (!template) {
            progress.report({
                content: `I'm sorry, I couldn't find a template with the title: \`${commandRequest.argumentString}\``
            } as vscode.ChatAgentContent);
            return {};
        }
        progress.report({
            content: `Sounds like you'd like to submit fulfillment request for **${template.metadata.title}**. `
        } as vscode.ChatAgentContent);
        // Flip agent into input mode
        const inputJsonSchema: JSONSchema7 = template.spec?.inputJsonSchema
            ? JSON.parse(template.spec.inputJsonSchema)
            : null;
        const inputProperties: PropDetail[] = [];
        if (inputJsonSchema && inputJsonSchema.properties && Object.keys(inputJsonSchema.properties).length > 0) {
            progress.report({
                content: `I can do that.\n`
            } as vscode.ChatAgentContent);
            /*
            progress.report(<vscode.ChatAgentContent>{
                content: `I can do that. But first, I need values for the following inputs:\n|Input|Description|\n|---|---|\n`
            });
            */
            // TODO: Ideally we'd only prompt for required fields, and have a chat process to see if they want to set any optional values after required vals are in.
            for (let propKey in inputJsonSchema.properties) {
                const propDetail = (inputJsonSchema.properties[propKey] || {}) as PropDetail;
                propDetail.name = propKey;
                propDetail.isRequired = inputJsonSchema?.required?.indexOf(propDetail.name) || -1 > -1 ? true : false;
                inputProperties.push(propDetail);

                // Output input values
                /*
                progress.report(<vscode.ChatAgentContent>{
                    content: `|${propDetail?.title}|${propDetail?.isRequired ? '(Required) ' : ''}${
                        propDetail.description || propDetail.title + '.'
                    }|\n`
                });
                */
            }
            progress.report({ content: `\nLet's get started!\n\n` } as vscode.ChatAgentContent);
        }
        const inputState: SubmitRequestInputState = {
            template: template,
            inputProperties: inputProperties,
            inputPropertyIndex: -1,
            inputJsonSchema: inputJsonSchema,
            inputValues: {},
            confirmationStatus: AgentConfirmationStatus.NotStarted
        };
        agentState.commandAlreadyInProgress = AgentCommand.Fulfill;
        agentState.submitRequestInputs = inputState;
        return discussFulfillmentRequestOptions(agentState, commandRequest, progress, token);
    } catch (err) {
        outputChannel.appendLine(`Error: ${err}`);
        progress.report({ content: `Oh man, I hit a problem!! ${err}` } as vscode.ChatAgentContent);
        agentState.commandAlreadyInProgress = AgentCommand.None;
        agentState.submitRequestInputs = undefined;
        return {
            followUps: [{ message: vscode.l10n.t(`@devplat /help`) }]
        };
    }
}

export async function discussFulfillmentRequestOptions(
    agentState: AgentState,
    commandRequest: CommandRequest,
    progress: vscode.Progress<vscode.ChatAgentProgress>,
    token: vscode.CancellationToken
): Promise<vscode.ProviderResult<DevPlatAgentResult>> {
    const inputState = agentState.submitRequestInputs!;

    // Process confirmation if we've already asked if we should submit the request
    if (inputState.confirmationStatus === AgentConfirmationStatus.InProgress) {
        return await processInputConfirmation(agentState, commandRequest, progress, token);
    }

    // See if we need to go back to a previous input
    const lowerCaseArgumentString = commandRequest.argumentString.toLocaleLowerCase().trim();
    if (
        lowerCaseArgumentString == '/previous' ||
        lowerCaseArgumentString == '/prev' ||
        lowerCaseArgumentString == '/back'
    ) {
        if (inputState.inputPropertyIndex < 1) {
            progress.report({ content: `I'm sorry, we're already at the first input.\n\n` } as vscode.ChatAgentContent);
        } else {
            progress.report({ content: `Ok, let's go back to the previous input.\n\n` } as vscode.ChatAgentContent);
            inputState.inputPropertyIndex--;
        }
        return await askForInput(inputState.inputProperties[inputState.inputPropertyIndex], inputState, progress);
    }

    // See if we need to skip this input, assuming it is not required
    if (
        lowerCaseArgumentString === '/skip' ||
        lowerCaseArgumentString === '/next' ||
        lowerCaseArgumentString === '/forward'
    ) {
        if (inputState.inputPropertyIndex === inputState.inputProperties.length - 1) {
            progress.report({
                content: `I'm sorry, we're already at the last input, so there is nothing to skip.\n\n`
            } as vscode.ChatAgentContent);
        } else if (inputState.inputProperties[inputState.inputPropertyIndex].required) {
            progress.report({
                content: `I'm sorry, **${
                    inputState.inputProperties[inputState.inputPropertyIndex].title
                }** is a required input. You can't skip it.\n\n`
            } as vscode.ChatAgentContent);
        } else {
            progress.report({
                content: `Ok, skipping the **${
                    inputState.inputProperties[inputState.inputPropertyIndex].title
                }** input.\n\n`
            } as vscode.ChatAgentContent);
            inputState.inputPropertyIndex++;
        }
        return await askForInput(inputState.inputProperties[inputState.inputPropertyIndex], inputState, progress);
    }

    // If we're currently on a valid input response, set input value, but don't return unless it was an invalid value
    if (inputState.inputPropertyIndex > -1) {
        if (
            !(await processInput(
                inputState.inputProperties[inputState.inputPropertyIndex],
                inputState,
                commandRequest,
                progress,
                token
            ))
        ) {
            outputChannel.appendLine(
                `Invalid input for ${inputState.inputProperties[inputState.inputPropertyIndex].name}. Asking to retry.`
            );
            return await askForInput(inputState.inputProperties[inputState.inputPropertyIndex], inputState, progress);
        }
    }

    // Then ask for next input unless we're done
    inputState.inputPropertyIndex++;
    if (inputState.inputPropertyIndex < inputState.inputProperties.length) {
        return await askForInput(inputState.inputProperties[inputState.inputPropertyIndex], inputState, progress);
    }

    // If we're done with inputs, ask for confirmation to submit
    progress.report({
        content: `I have all the information I need to submit a fulfillment request.\n`
    } as vscode.ChatAgentContent);
    for (let propKey in inputState.inputValues) {
        const props = inputState.inputJsonSchema?.properties || {};
        const propDetail = (props[propKey] || {}) as PropDetail;
        progress.report({
            content: `1. **${propDetail?.title}**: ${inputState.inputValues[propKey]}\n`
        } as vscode.ChatAgentContent);
    }
    progress.report({
        content: `\n**Do you want me to submit the fulfillment request now?**`
    } as vscode.ChatAgentContent);
    inputState.confirmationStatus = AgentConfirmationStatus.InProgress;
    return {
        followUps: [{ message: vscode.l10n.t(`@devplat Yes`) }, { message: vscode.l10n.t(`@devplat No`) }]
    };
}

async function askForInput(
    input: any,
    inputState: SubmitRequestInputState,
    progress: vscode.Progress<vscode.ChatAgentProgress>
): Promise<vscode.ProviderResult<DevPlatAgentResult>> {
    const validValues =
        input.type === 'boolean'
            ? '`true` or `false`.'
            : input.enum
            ? 'one of these values: ' +
              input.enum.reduce((acc: string | null, cur: string) => (acc ? `${acc}, ${cur}` : cur), null) +
              '. '
            : `a ${input.type}.`;
    /*
    progress.report(<vscode.ChatAgentContent>{
        content: `**[${inputState.inputPropertyIndex + 1} / ${inputState.inputProperties.length}] ${input.title}**:${
            input.description || input.title + '.'
        }`
    });
    */
    progress.report({
        content: `What do you want me to use as the **${input.title}**?\n\nReply with ${validValues}`
    } as vscode.ChatAgentContent);

    let followUps = [];
    switch (input.type) {
        case 'boolean':
            followUps.push({ message: vscode.l10n.t(`@devplat true`) });
            followUps.push({ message: vscode.l10n.t(`@devplat false`) });
            break;
        case 'string':
            if (input.default) {
                followUps.push({ message: vscode.l10n.t(`@devplat ${input.default}`) });
            } else if (input.enum) {
                followUps.push({ message: vscode.l10n.t(`@devplat ${input.enum[randomInt(input.enum.length)]}`) });
            }
            break;
        default:
            if (input.default) {
                followUps.push({ message: vscode.l10n.t(`@devplat ${input.default}`) });
            }
    }
    if (inputState.inputPropertyIndex > 0) {
        followUps.push({ message: vscode.l10n.t(`@devplat /previous`) });
    }
    if (!input.required && inputState.inputPropertyIndex < inputState.inputProperties.length - 1) {
        followUps.push({ message: vscode.l10n.t(`@devplat /skip`) });
    }
    followUps.push({ message: vscode.l10n.t(`@devplat /cancel`) });
    return { followUps: followUps };
}

async function processInput(
    input: any,
    inputState: SubmitRequestInputState,
    commandRequest: CommandRequest,
    progress: vscode.Progress<vscode.ChatAgentProgress>,
    token: vscode.CancellationToken
): Promise<boolean> {
    try {
        switch (input.type) {
            case 'boolean':
                const lowerCase = commandRequest.argumentString.toLocaleLowerCase().trim();
                inputState.inputValues[input.name] =
                    lowerCase === 'yes' ||
                    lowerCase === 'true' ||
                    lowerCase === 'y' ||
                    lowerCase === 't' ||
                    lowerCase === '1';
                break;
            case 'integer':
                inputState.inputValues[input.name] = parseInt(commandRequest.argumentString);
                break;
            case 'number':
                inputState.inputValues[input.name] = parseFloat(commandRequest.argumentString);
                break;
            default:
                if (input.enum && input.enum.indexOf(commandRequest.argumentString) === -1) {
                    progress.report({
                        content: `I'm sorry "${commandRequest.argumentString}" isn't a valid value for **${input.title}**. Please try again.\n\n`
                    } as vscode.ChatAgentContent);
                    return false;
                }
                inputState.inputValues[input.name] = commandRequest.argumentString;
                break;
        }
    } catch (err) {
        outputChannel.appendLine(`Error parsing input value: ${err}`);
        progress.report({
            content: `I'm sorry, I didn't understand "${commandRequest.argumentString}." I need a ${input.type} value for **${input.title}**. Please try again.\n\n`
        } as vscode.ChatAgentContent);
        return false;
    }
    /*
    progress.report(<vscode.ChatAgentContent>{
        content: `Ok, I'll use "${commandRequest.argumentString}" for **${input.title}**.\n\n`
    });
    */
    return true;
}

async function processInputConfirmation(
    agentState: any,
    commandRequest: CommandRequest,
    progress: vscode.Progress<vscode.ChatAgentProgress>,
    token: vscode.CancellationToken
): Promise<vscode.ProviderResult<DevPlatAgentResult>> {
    const inputState = agentState.submitRequestInputs;
    const templateTitle = inputState.template.metadata.title;
    const response = commandRequest.argumentString.toLocaleLowerCase().trim();
    if (response === 'yes' || response === 'true' || response === 'y' || response === 't' || response === '1') {
        progress.report({ content: `Ok! Submitting fulfillment request **now**.\n` } as vscode.ChatAgentContent);
        agentState.commandAlreadyInProgress = AgentCommand.None;
        agentState.submitRequestInputs = null;
        return await submitFulfillmentRequestToApi(inputState, progress, token);
    } else {
        progress.report({
            content: `Ok, I **won't** create a request to fulfill **${templateTitle}**. Aborting!`
        } as vscode.ChatAgentContent);
        agentState.commandAlreadyInProgress = AgentCommand.None;
        agentState.submitRequestInputs = null;
        return {
            followUps: [{ message: vscode.l10n.t(`@devplat ${AgentCommand.Fulfill} ${templateTitle}`) }]
        };
    }
}

async function submitFulfillmentRequestToApi(
    inputState: any,
    progress: vscode.Progress<vscode.ChatAgentProgress>,
    token: vscode.CancellationToken
): Promise<vscode.ProviderResult<DevPlatAgentResult>> {
    const request: TemplateRequest = {
        templateRef: inputState.template.ref,
        provider: inputState.template.metadata.provider,
        inputJson: JSON.stringify(inputState.inputValues)
    };
    const apiResult = await callApi('/entities', 'POST', request);
    if (!apiResult.success) {
        throw new Error(`Could not retrieve templates from API. Status: ${apiResult.status}`);
    }
    // Long running requests will return a 202 with an entity ID, so periodically retry until we get a 200
    if (apiResult.status === 202) {
        progress.report({
            content: `\nRequest ${apiResult.json.id} submitted! I'll let you know when it's done!`
        } as vscode.ChatAgentContent);
        reportFulfillmentStatusWhenDone(inputState, apiResult, progress, token); // Async but don't wait.
        return {};
    }
    progress.report({ content: `\nRequest${apiResult.json.id} complete!` } as vscode.ChatAgentContent);
    return {};
}

async function reportFulfillmentStatusWhenDone(
    inputState: any,
    apiResult: DevPlatApiResult,
    progress: vscode.Progress<vscode.ChatAgentProgress>,
    token: vscode.CancellationToken
): Promise<void> {
    const requestResult = await waitForFulfillment(apiResult);
    if (requestResult) {
        if (
            inputState?.template?.spec?.creates?.reduce(
                (acc: boolean, cur: any) => acc || cur.kind === 'Repo',
                false
            ) &&
            inputState?.inputValues?.name
        ) {
            // TODO: This is a hack to get the repo URL. We should get this from the API.
            const fullRepo = `https://github.com/contoso-inc/${inputState.inputValues.name}`;
            // TODO: We can likely do other kinds of "open" type actions here.
            vscode.window
                .showInformationMessage(`${fullRepo} is ready! Clone it now?`, 'Clone repo', 'Cancel')
                .then((button: string | undefined) => {
                    if (button === 'Clone repo') {
                        vscode.commands.executeCommand('git.clone', fullRepo);
                    }
                });
        } else {
            vscode.window.showInformationMessage(
                `Internal Developer Platform request ${apiResult.json.id} is complete! ${requestResult.text}`
            );
        }
    }
}
