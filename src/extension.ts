// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from 'dotenv';
import { join } from 'path';
import * as vscode from 'vscode';
import { initOutputChannel } from './common';
import { initAgent } from './devplat-agent';
import { initApiCaller } from './devplat-api';
import { handleTemplateCommand } from './input-flow';

export async function activate(context: vscode.ExtensionContext) {
    // bring in .env file
    dotenv.config({ path: join(context.extensionPath, '.env') });

    initOutputChannel(context);
    initApiCaller(context);
    initAgent(context);

    // Register commands
    vscode.commands.registerCommand('devplat-agent.fulfill-template', handleTemplateCommand);
}

export function deactivate() {}
