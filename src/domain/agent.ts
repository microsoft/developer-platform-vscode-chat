// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JSONSchema7 } from 'json-schema';
import * as vscode from 'vscode';
import { PropDetail, TemplateDetail } from './devplat-api-interfaces';

export enum AgentCommand {
    FindCommand = '~~*command*~~',
    FindTemplate = '/template',
    FindAzdTemplate = '/azd-template',
    Fulfill = '/fulfill',
    Cancel = '/cancel',
    Help = '/help',
    None = '~~*none*~~'
}
export interface CommandRequest {
    command: AgentCommand;
    argumentString: string;
}

export enum AgentConfirmationStatus {
    NotStarted,
    InProgress,
    Confirmed,
    Rejected
}

export interface SubmitRequestInputState {
    template: TemplateDetail;
    inputProperties: PropDetail[];
    inputPropertyIndex: number;
    inputJsonSchema: JSONSchema7;
    inputValues: { [key: string]: number | string | boolean };
    confirmationStatus: AgentConfirmationStatus;
}

export interface AgentState {
    commandAlreadyInProgress: AgentCommand;
    confirmationStatus: AgentConfirmationStatus;
    submitRequestInputs?: SubmitRequestInputState;
}

export interface DevPlatAgentResult extends vscode.ChatAgentResult2 {
    followUps?: vscode.ChatAgentFollowup[];
}
